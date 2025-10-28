use uuid::Uuid;

use crate::application::ports::document_snapshot_archive_repository::SnapshotArchiveRecord;
use crate::application::ports::realtime_port::RealtimeEngine;
use crate::application::services::realtime::snapshot::SnapshotService;

pub enum SnapshotDiffBase {
    Current {
        markdown: String,
    },
    Snapshot {
        record: SnapshotArchiveRecord,
        markdown: String,
    },
}

pub struct SnapshotDiffResult {
    pub target: SnapshotArchiveRecord,
    pub target_markdown: String,
    pub base: SnapshotDiffBase,
}

pub struct SnapshotDiff<'a, RT>
where
    RT: RealtimeEngine + ?Sized,
{
    pub snapshots: &'a SnapshotService,
    pub realtime: &'a RT,
}

impl<'a, RT> SnapshotDiff<'a, RT>
where
    RT: RealtimeEngine + ?Sized,
{
    pub async fn execute(
        &self,
        document_id: Uuid,
        snapshot_id: Uuid,
        compare_to: Option<Uuid>,
    ) -> anyhow::Result<Option<SnapshotDiffResult>> {
        let Some((target_record, target_markdown)) =
            self.snapshots.load_archive_markdown(snapshot_id).await?
        else {
            return Ok(None);
        };

        if target_record.document_id != document_id {
            anyhow::bail!("snapshot_document_mismatch");
        }

        let base = if let Some(compare_id) = compare_to {
            let Some((base_record, base_markdown)) =
                self.snapshots.load_archive_markdown(compare_id).await?
            else {
                return Ok(None);
            };
            if base_record.document_id != document_id {
                anyhow::bail!("compare_snapshot_document_mismatch");
            }
            SnapshotDiffBase::Snapshot {
                record: base_record,
                markdown: base_markdown,
            }
        } else {
            let current = self.realtime.get_content(&document_id.to_string()).await?;
            let markdown = current.unwrap_or_default();
            SnapshotDiffBase::Current { markdown }
        };

        Ok(Some(SnapshotDiffResult {
            target: target_record,
            target_markdown,
            base,
        }))
    }
}
