use uuid::Uuid;

use crate::application::ports::document_repository::DocumentRepository;
use crate::application::ports::realtime_port::RealtimeEngine;
use crate::application::ports::shares_repository::SharesRepository;
use crate::domain::documents::document::Document as DomainDocument;

pub struct ArchiveDocument<'a, R, S, RT>
where
    R: DocumentRepository + ?Sized,
    S: SharesRepository + ?Sized,
    RT: RealtimeEngine + ?Sized,
{
    pub repo: &'a R,
    pub shares: &'a S,
    pub realtime: &'a RT,
}

impl<'a, R, S, RT> ArchiveDocument<'a, R, S, RT>
where
    R: DocumentRepository + ?Sized,
    S: SharesRepository + ?Sized,
    RT: RealtimeEngine + ?Sized,
{
    pub async fn execute(
        &self,
        owner_id: Uuid,
        doc_id: Uuid,
    ) -> anyhow::Result<Option<DomainDocument>> {
        let meta = match self.repo.get_meta_for_owner(doc_id, owner_id).await? {
            Some(meta) => meta,
            None => return Ok(None),
        };
        if meta.archived_at.is_some() {
            return Ok(None);
        }

        // Save latest real-time state on a best-effort basis before archiving
        let _ = self.realtime.force_persist(&doc_id.to_string()).await;

        self.shares.revoke_subtree_shares(owner_id, doc_id).await?;

        let doc = self
            .repo
            .archive_subtree(doc_id, owner_id, owner_id)
            .await?;
        Ok(doc)
    }
}
