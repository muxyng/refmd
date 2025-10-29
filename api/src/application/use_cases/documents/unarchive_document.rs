use uuid::Uuid;

use crate::application::ports::document_repository::DocumentRepository;
use crate::application::ports::realtime_port::RealtimeEngine;
use crate::domain::documents::document::Document as DomainDocument;

pub struct UnarchiveDocument<'a, R, RT>
where
    R: DocumentRepository + ?Sized,
    RT: RealtimeEngine + ?Sized,
{
    pub repo: &'a R,
    pub realtime: &'a RT,
}

impl<'a, R, RT> UnarchiveDocument<'a, R, RT>
where
    R: DocumentRepository + ?Sized,
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
        if meta.archived_at.is_none() {
            return Ok(None);
        }

        let doc = self.repo.unarchive_subtree(doc_id, owner_id).await?;

        if doc.is_some() {
            let _ = self.realtime.force_persist(&doc_id.to_string()).await;
        }

        Ok(doc)
    }
}
