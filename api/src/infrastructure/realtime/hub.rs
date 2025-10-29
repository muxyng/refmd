use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::Context;
use chrono::Utc;
use futures_util::SinkExt;
use tokio::sync::mpsc;
use tokio::sync::{Mutex, RwLock};
use tokio::time::{Duration, Instant, sleep};
use uuid::Uuid;
use yrs::GetString;
use yrs::encoding::write::Write as YWrite;
use yrs::sync::protocol::{MSG_SYNC, MSG_SYNC_UPDATE};
use yrs::sync::{DefaultProtocol, Protocol};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::{Encoder, EncoderV1};
use yrs::{Doc, ReadTxn, StateVector, Text, Transact, Update};
use yrs_warp::AwarenessRef;
use yrs_warp::broadcast::BroadcastGroup;

use crate::application::ports::document_snapshot_archive_repository::DocumentSnapshotArchiveRepository;
use crate::application::ports::linkgraph_repository::LinkGraphRepository;
use crate::application::ports::realtime_hydration_port::{DocStateReader, RealtimeBacklogReader};
use crate::application::ports::realtime_persistence_port::DocPersistencePort;
use crate::application::ports::storage_port::StoragePort;
use crate::application::ports::tagging_repository::TaggingRepository;
use crate::application::services::realtime::doc_hydration::{
    DocHydrationService, HydrationOptions,
};
use crate::application::services::realtime::snapshot::{
    SnapshotArchiveKind, SnapshotArchiveOptions, SnapshotPersistOptions, SnapshotService,
};
use crate::infrastructure::db::PgPool;
use crate::infrastructure::db::repositories::linkgraph_repository_sqlx::SqlxLinkGraphRepository;
use crate::infrastructure::db::repositories::tagging_repository_sqlx::SqlxTaggingRepository;
use crate::infrastructure::realtime::utils::wrap_stream_with_edit_guard;
use crate::infrastructure::realtime::{
    DynRealtimeSink, DynRealtimeStream, NoopBacklogReader, SqlxDocPersistenceAdapter,
    SqlxDocStateReader,
};

#[derive(Clone)]
pub struct DocumentRoom {
    pub doc: Doc,
    pub awareness: AwarenessRef,
    pub broadcast: Arc<BroadcastGroup>,
    #[allow(dead_code)]
    persist_sub: yrs::Subscription,
    pub seq: Arc<Mutex<i64>>, // latest persisted seq
}

#[derive(Clone)]
pub struct Hub {
    inner: Arc<RwLock<HashMap<String, Arc<DocumentRoom>>>>,
    hydration_service: Arc<DocHydrationService>,
    snapshot_service: Arc<SnapshotService>,
    persistence: Arc<dyn DocPersistencePort>,
    save_flags: Arc<Mutex<HashMap<String, bool>>>,
    auto_archive_interval: Duration,
    last_auto_archive: Arc<Mutex<HashMap<String, Instant>>>,
    edit_flags: Arc<RwLock<HashMap<String, Arc<AtomicBool>>>>,
}

impl Hub {
    pub fn new(
        pool: PgPool,
        storage: Arc<dyn StoragePort>,
        archives: Arc<dyn DocumentSnapshotArchiveRepository>,
        auto_archive_interval: Duration,
    ) -> Self {
        let doc_state_reader: Arc<dyn DocStateReader> =
            Arc::new(SqlxDocStateReader::new(pool.clone()));
        let backlog_reader: Arc<dyn RealtimeBacklogReader> = Arc::new(NoopBacklogReader::default());
        let hydration_service = Arc::new(DocHydrationService::new(
            doc_state_reader.clone(),
            backlog_reader,
            storage.clone(),
        ));
        let persistence: Arc<dyn DocPersistencePort> =
            Arc::new(SqlxDocPersistenceAdapter::new(pool.clone()));
        let linkgraph_repo: Arc<dyn LinkGraphRepository> =
            Arc::new(SqlxLinkGraphRepository::new(pool.clone()));
        let tagging_repo: Arc<dyn TaggingRepository> = Arc::new(SqlxTaggingRepository::new(pool));
        let snapshot_service = Arc::new(SnapshotService::new(
            doc_state_reader,
            persistence.clone(),
            storage,
            linkgraph_repo,
            tagging_repo,
            archives,
        ));

        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
            hydration_service,
            snapshot_service,
            persistence,
            save_flags: Arc::new(Mutex::new(HashMap::new())),
            auto_archive_interval,
            last_auto_archive: Arc::new(Mutex::new(HashMap::new())),
            edit_flags: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    pub async fn get_or_create(&self, doc_id: &str) -> anyhow::Result<Arc<DocumentRoom>> {
        if let Some(r) = self.inner.read().await.get(doc_id).cloned() {
            return Ok(r);
        }

        // Create Doc; hydration will run asynchronously after room is registered to avoid blocking WS
        let doc = Doc::new();
        let doc_uuid = Uuid::parse_str(doc_id)?;

        let awareness: AwarenessRef = Arc::new(yrs::sync::Awareness::new(doc.clone()));
        let bcast = Arc::new(BroadcastGroup::new(awareness.clone(), 64).await);

        let save_flags = self.save_flags.clone();
        let start_seq = self
            .persistence
            .latest_update_seq(&doc_uuid)
            .await?
            .unwrap_or(0);
        let seq = Arc::new(Mutex::new(start_seq));
        // Persist updates through a channel. We'll await send in a spawned task to avoid dropping updates.
        let (tx, mut rx) = mpsc::channel::<Vec<u8>>(512);
        let persistence = self.persistence.clone();
        let snapshot_service = self.snapshot_service.clone();
        let last_auto_archive = self.last_auto_archive.clone();
        let auto_archive_interval = self.auto_archive_interval;
        let persist_doc = doc_uuid;
        let persist_seq = seq.clone();
        let doc_for_snap = doc.clone();
        tokio::spawn(async move {
            while let Some(bytes) = rx.recv().await {
                let mut guard = persist_seq.lock().await;
                *guard += 1;
                let s = *guard;
                if let Err(e) = persistence
                    .append_update_with_seq(&persist_doc, s, &bytes)
                    .await
                {
                    tracing::error!(
                        document_id = %persist_doc,
                        seq = s,
                        error = ?e,
                        "persist_document_update_failed"
                    );
                }
                if s % 100 == 0 && !auto_archive_interval.is_zero() {
                    let should_archive = {
                        let mut guard = last_auto_archive.lock().await;
                        let now = Instant::now();
                        match guard.get(&persist_doc.to_string()) {
                            Some(last) if now.duration_since(*last) < auto_archive_interval => {
                                false
                            }
                            _ => {
                                guard.insert(persist_doc.to_string(), now);
                                true
                            }
                        }
                    };

                    if should_archive {
                        match snapshot_service
                            .persist_snapshot(
                                &persist_doc,
                                &doc_for_snap,
                                SnapshotPersistOptions {
                                    clear_updates: false,
                                    ..Default::default()
                                },
                            )
                            .await
                        {
                            Ok(result) => {
                                let label = format!(
                                    "Snapshot {}",
                                    Utc::now().format("%Y-%m-%d %H:%M:%S UTC")
                                );
                                if let Err(e) = snapshot_service
                                    .archive_snapshot(
                                        &persist_doc,
                                        &result.snapshot_bytes,
                                        result.version,
                                        SnapshotArchiveOptions {
                                            label: label.as_str(),
                                            notes: None,
                                            kind: SnapshotArchiveKind::Automatic,
                                            created_by: None,
                                        },
                                    )
                                    .await
                                {
                                    tracing::debug!(
                                        document_id = %persist_doc,
                                        version = result.version,
                                        error = ?e,
                                        "persist_document_snapshot_archive_failed"
                                    );
                                }
                            }
                            Err(e) => {
                                tracing::error!(
                                    document_id = %persist_doc,
                                    version = s,
                                    error = ?e,
                                    "persist_document_snapshot_failed"
                                );
                            }
                        }
                    }
                }
            }
        });

        let tx_obs = tx.clone();
        let hub_for_save = self.clone();
        let doc_id_str = doc_uuid.to_string();
        let doc_for_markdown = doc.clone();
        let persist_sub = doc
            .observe_update_v1(move |_txn, u| {
                // Send to the channel asynchronously to avoid blocking and prevent drops under load
                let tx_clone = tx_obs.clone();
                let bytes = u.update.clone();
                tokio::spawn(async move {
                    let _ = tx_clone.send(bytes).await;
                });
                // schedule fs save (debounced)
                let save_flags = save_flags.clone();
                let doc_id_s = doc_id_str.clone();
                let hub_clone = hub_for_save.clone();
                let doc_for_markdown = doc_for_markdown.clone();
                tokio::spawn(async move {
                    // simple debounce: set flag and sleep; if still set after sleep, run
                    {
                        let mut m = save_flags.lock().await;
                        m.insert(doc_id_s.clone(), true);
                    }
                    sleep(Duration::from_millis(600)).await;
                    let should_run = {
                        let mut m = save_flags.lock().await;
                        m.remove(&doc_id_s).is_some()
                    };
                    if should_run {
                        if let Ok(doc_uuid) = Uuid::parse_str(&doc_id_s) {
                            if let Err(e) = hub_clone
                                .snapshot_service
                                .write_markdown(&doc_uuid, &doc_for_markdown)
                                .await
                            {
                                tracing::error!(
                                    document_id = %doc_id_s,
                                    error = ?e,
                                    "debounced_save_failed"
                                );
                            }
                        }
                    }
                });
            })
            .unwrap();

        let room = Arc::new(DocumentRoom {
            doc: doc.clone(),
            awareness: awareness.clone(),
            broadcast: bcast.clone(),
            persist_sub,
            seq: seq.clone(),
        });
        self.inner
            .write()
            .await
            .insert(doc_id.to_string(), room.clone());
        let _ = self.ensure_edit_flag(doc_id).await;
        // Hydrate in background (snapshot + updates). Non-blocking for WS subscription
        let bcast_h = bcast.clone();
        let hydration = self.hydration_service.clone();
        let seq_for_hydrate = seq.clone();
        tokio::spawn(async move {
            tracing::debug!(%doc_uuid, "hydrate:start");
            match hydration
                .hydrate(&doc_uuid, HydrationOptions::default())
                .await
            {
                Ok(hydrated_state) => {
                    let update_bin = {
                        let txn = hydrated_state.doc.transact();
                        txn.encode_state_as_update_v1(&StateVector::default())
                    };
                    if let Ok(update) = Update::decode_v1(&update_bin) {
                        let mut txn = doc.transact_mut();
                        if let Err(e) = txn.apply_update(update) {
                            tracing::debug!(document_id = %doc_uuid, error = ?e, "hydrate_apply_failed");
                        }
                    }

                    {
                        let mut guard = seq_for_hydrate.lock().await;
                        if hydrated_state.last_seq > *guard {
                            *guard = hydrated_state.last_seq;
                        }
                    }

                    let txn = doc.transact();
                    let bin = txn.encode_state_as_update_v1(&StateVector::default());
                    drop(txn);
                    let mut enc = EncoderV1::new();
                    enc.write_var(MSG_SYNC);
                    enc.write_var(MSG_SYNC_UPDATE);
                    enc.write_buf(&bin);
                    let msg = enc.to_vec();
                    if let Err(e) = bcast_h.broadcast(msg) {
                        tracing::debug!(
                            document_id = %doc_uuid,
                            error = %e,
                            "hydrate:broadcast_failed"
                        );
                    }
                    tracing::debug!(document_id = %doc_uuid, "hydrate:complete");
                }
                Err(e) => {
                    tracing::error!(document_id = %doc_uuid, error = ?e, "hydrate_failed");
                }
            }
        });
        Ok(room)
    }

    pub fn snapshot_service(&self) -> Arc<SnapshotService> {
        self.snapshot_service.clone()
    }

    pub async fn apply_snapshot(&self, doc_id: &str, snapshot: &Doc) -> anyhow::Result<()> {
        let room = self.get_or_create(doc_id).await?;
        let new_markdown = {
            let txt_new = snapshot.get_or_insert_text("content");
            let txn = snapshot.transact();
            txt_new.get_string(&txn)
        };

        let update_bytes = {
            let txt = room.doc.get_or_insert_text("content");
            let mut txn = room.doc.transact_mut();
            let len = txt.len(&txn);
            if len > 0 {
                txt.remove_range(&mut txn, 0, len);
            }
            if !new_markdown.is_empty() {
                txt.insert(&mut txn, 0, &new_markdown);
            }
            txn.encode_update_v1()
        };

        if update_bytes.is_empty() {
            return Ok(());
        }

        let mut encoder = EncoderV1::new();
        encoder.write_var(MSG_SYNC);
        encoder.write_var(MSG_SYNC_UPDATE);
        encoder.write_buf(&update_bytes);
        let frame = encoder.to_vec();
        room.broadcast
            .broadcast(frame)
            .map_err(|err| anyhow::anyhow!(err))
            .context("broadcast_snapshot_update")?;

        Ok(())
    }

    pub async fn get_content(&self, doc_id: &str) -> anyhow::Result<Option<String>> {
        if let Some(room) = self.inner.read().await.get(doc_id).cloned() {
            let txt = room.doc.get_or_insert_text("content");
            let txn = room.doc.transact();
            return Ok(Some(txt.get_string(&txn)));
        }

        let uuid = match Uuid::parse_str(doc_id) {
            Ok(id) => id,
            Err(_) => return Ok(None),
        };
        let hydrated = self
            .hydration_service
            .hydrate(&uuid, HydrationOptions::default())
            .await?;
        let txt = hydrated.doc.get_or_insert_text("content");
        let txn = hydrated.doc.transact();
        Ok(Some(txt.get_string(&txn)))
    }
}

impl Hub {
    pub async fn snapshot_all(
        &self,
        keep_versions: i64,
        updates_keep_window: i64,
    ) -> anyhow::Result<()> {
        let rooms: Vec<(String, Arc<DocumentRoom>)> = {
            let map = self.inner.read().await;
            map.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
        };
        for (doc_id, room) in rooms {
            let doc_uuid = match Uuid::parse_str(&doc_id) {
                Ok(x) => x,
                Err(_) => continue,
            };
            let current_seq = {
                let guard = room.seq.lock().await;
                *guard
            };
            let cutoff = (current_seq - updates_keep_window).max(0);
            self.snapshot_service
                .persist_snapshot(
                    &doc_uuid,
                    &room.doc,
                    SnapshotPersistOptions {
                        clear_updates: false,
                        prune_snapshots: Some(keep_versions),
                        prune_updates_before: Some(cutoff),
                    },
                )
                .await?;
        }
        Ok(())
    }

    pub async fn force_save_to_fs(&self, doc_id: &str) -> anyhow::Result<()> {
        let uuid = Uuid::parse_str(doc_id)?;
        if let Some(room) = self.inner.read().await.get(doc_id).cloned() {
            self.snapshot_service
                .write_markdown(&uuid, &room.doc)
                .await?;
        } else {
            let hydrated = self
                .hydration_service
                .hydrate(&uuid, HydrationOptions::default())
                .await?;
            self.snapshot_service
                .write_markdown(&uuid, &hydrated.doc)
                .await?;
        }
        Ok(())
    }

    pub async fn subscribe(
        &self,
        doc_id: &str,
        sink: DynRealtimeSink,
        stream: DynRealtimeStream,
        can_edit: bool,
    ) -> anyhow::Result<()> {
        let room = self.get_or_create(doc_id).await?;
        let edit_flag = self.ensure_edit_flag(doc_id).await;
        let effective_can_edit = can_edit && edit_flag.load(Ordering::Relaxed);
        let guarded_stream =
            wrap_stream_with_edit_guard(stream, doc_id.to_string(), edit_flag.clone());
        let subscription = if effective_can_edit {
            room.broadcast.subscribe(sink.clone(), guarded_stream)
        } else {
            room.broadcast
                .subscribe_with(sink.clone(), guarded_stream, ReadOnlyProtocol)
        };

        let awareness = room.awareness.clone();
        if effective_can_edit {
            Self::send_protocol_start(sink, awareness, DefaultProtocol).await?;
        } else {
            Self::send_protocol_start(sink, awareness, ReadOnlyProtocol).await?;
        }

        subscription
            .completed()
            .await
            .map_err(|e| anyhow::anyhow!(e))
    }

    async fn ensure_edit_flag(&self, doc_id: &str) -> Arc<AtomicBool> {
        let mut guard = self.edit_flags.write().await;
        guard
            .entry(doc_id.to_string())
            .or_insert_with(|| Arc::new(AtomicBool::new(true)))
            .clone()
    }

    pub async fn set_document_editable(&self, doc_id: &str, editable: bool) -> anyhow::Result<()> {
        let flag = self.ensure_edit_flag(doc_id).await;
        flag.store(editable, Ordering::SeqCst);
        Ok(())
    }
}

#[derive(Debug, Clone, Copy)]
struct ReadOnlyProtocol;

impl yrs::sync::Protocol for ReadOnlyProtocol {
    fn handle_sync_step2(
        &self,
        _awareness: &yrs::sync::Awareness,
        _update: yrs::Update,
    ) -> Result<Option<yrs::sync::Message>, yrs::sync::Error> {
        Ok(None)
    }

    fn handle_update(
        &self,
        _awareness: &yrs::sync::Awareness,
        _update: yrs::Update,
    ) -> Result<Option<yrs::sync::Message>, yrs::sync::Error> {
        Ok(None)
    }
}

impl Hub {
    async fn send_protocol_start<P>(
        sink: DynRealtimeSink,
        awareness: AwarenessRef,
        protocol: P,
    ) -> anyhow::Result<()>
    where
        P: Protocol,
    {
        let mut encoder = EncoderV1::new();
        protocol
            .start::<EncoderV1>(awareness.as_ref(), &mut encoder)
            .map_err(|err| anyhow::anyhow!(err))?;
        let frame = encoder.to_vec();
        if frame.is_empty() {
            return Ok(());
        }
        let mut guard = sink.lock().await;
        guard
            .send(frame)
            .await
            .map_err(|err| anyhow::anyhow!(err))?;
        Ok(())
    }
}
