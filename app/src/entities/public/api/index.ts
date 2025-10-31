import { useQuery } from '@tanstack/react-query'

import {
  getPublicByOwnerAndId as apiGetPublicByOwnerAndId,
  getPublicContentByOwnerAndId as apiGetPublicContentByOwnerAndId,
  getPublishStatus as apiGetPublishStatus,
  listUserPublicDocuments as apiListUserPublicDocuments,
  publishDocument as apiPublishDocument,
  unpublishDocument as apiUnpublishDocument,
} from '@/shared/api'
import type { PublicDocumentSummary } from '@/shared/api'

export const publicKeys = {
  all: ['public'] as const,
  byUser: (name: string) => ['public','byUser', name] as const,
  status: (id: string) => ['public','status', id] as const,
}

export const userPublicDocsQuery = (name: string) => ({
  queryKey: publicKeys.byUser(name),
  queryFn: () => apiListUserPublicDocuments({ name }) as Promise<PublicDocumentSummary[]>,
  enabled: !!name,
})

export function useUserPublicDocuments(name?: string) {
  return useQuery(userPublicDocsQuery(name || ''))
}

// Use-case oriented helpers
export async function listUserPublicDocuments(name: string) {
  return apiListUserPublicDocuments({ name })
}

export async function getPublicByOwnerAndId(name: string, id: string) {
  return apiGetPublicByOwnerAndId({ name, id })
}

export async function getPublicContentByOwnerAndId(name: string, id: string) {
  return apiGetPublicContentByOwnerAndId({ name, id })
}

export async function publishDocument(id: string) {
  return apiPublishDocument({ id })
}

export async function unpublishDocument(id: string) {
  return apiUnpublishDocument({ id })
}

export async function getPublishStatus(id: string) {
  return apiGetPublishStatus({ id })
}
