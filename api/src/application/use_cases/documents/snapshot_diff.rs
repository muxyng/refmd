use uuid::Uuid;

use crate::application::dto::diff::TextDiffResult;
use crate::application::ports::document_snapshot_archive_repository::SnapshotArchiveRecord;
use crate::application::ports::realtime_port::RealtimeEngine;
use crate::application::services::diff::text_diff::compute_text_diff;
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

pub enum SnapshotDiffBaseMode {
    Auto,
    ForceCurrent,
    ForcePrevious,
}

pub struct SnapshotDiffResult {
    pub target: SnapshotArchiveRecord,
    pub target_markdown: String,
    pub base: SnapshotDiffBase,
    pub diff: TextDiffResult,
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
        base_mode: SnapshotDiffBaseMode,
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
            match base_mode {
                SnapshotDiffBaseMode::ForceCurrent => SnapshotDiffBase::Current {
                    markdown: self.load_current_markdown(document_id).await?,
                },
                SnapshotDiffBaseMode::ForcePrevious | SnapshotDiffBaseMode::Auto => {
                    if let Some((prev_record, prev_markdown)) = self
                        .snapshots
                        .load_previous_archive_markdown(document_id, target_record.version)
                        .await?
                    {
                        SnapshotDiffBase::Snapshot {
                            record: prev_record,
                            markdown: prev_markdown,
                        }
                    } else {
                        SnapshotDiffBase::Current {
                            markdown: self.load_current_markdown(document_id).await?,
                        }
                    }
                }
            }
        };

        let base_markdown = match &base {
            SnapshotDiffBase::Current { markdown } => markdown.as_str(),
            SnapshotDiffBase::Snapshot { markdown, .. } => markdown.as_str(),
        };

        let diff = compute_text_diff(base_markdown, &target_markdown, "snapshot.md");

        Ok(Some(SnapshotDiffResult {
            target: target_record,
            target_markdown,
            diff,
            base,
        }))
    }

    async fn load_current_markdown(&self, document_id: Uuid) -> anyhow::Result<String> {
        let current = self
            .realtime
            .get_content(&document_id.to_string())
            .await?
            .unwrap_or_default();
        Ok(current)
    }
}
