import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { DocumentsService } from '@/shared/api'
import type {
  DocumentListResponse,
  Document as ApiDocument,
  BacklinksResponse,
  OutgoingLinksResponse,
  SnapshotListResponse,
  SnapshotDiffResponse,
  SnapshotRestoreResponse,
  SnapshotSummary,
} from '@/shared/api'

export const documentKeys = {
  all: ['documents'] as const,
  list: (params?: { query?: string; tag?: string }) => ['documents','list', params ?? {}] as const,
  byId: (id: string) => ['documents', id] as const,
  backlinks: (id: string) => ['documents', id, 'backlinks'] as const,
  links: (id: string) => ['documents', id, 'links'] as const,
  snapshots: (id: string) => ['documents', id, 'snapshots'] as const,
  snapshotDiff: (id: string, snapshotId: string, compare?: string | null) =>
    ['documents', id, 'snapshot', snapshotId, compare ?? 'current'] as const,
}

export const listDocumentsQuery = (params?: { query?: string; tag?: string }) => ({
  queryKey: documentKeys.list(params),
  queryFn: () => DocumentsService.listDocuments(params ?? {}) as Promise<DocumentListResponse>,
})

export const backlinksQuery = (id: string) => ({
  queryKey: documentKeys.backlinks(id),
  queryFn: () => DocumentsService.getBacklinks({ id }) as Promise<BacklinksResponse>,
  enabled: !!id,
})

export const outgoingLinksQuery = (id: string) => ({
  queryKey: documentKeys.links(id),
  queryFn: () => DocumentsService.getOutgoingLinks({ id }) as Promise<OutgoingLinksResponse>,
  enabled: !!id,
})

export function useBacklinks(id: string) {
  return useQuery(backlinksQuery(id))
}

export function useOutgoingLinks(id: string) {
  return useQuery(outgoingLinksQuery(id))
}

export const documentSnapshotsQuery = (id: string, params?: { token?: string | null }) => ({
  queryKey: documentKeys.snapshots(id),
  queryFn: () =>
    DocumentsService.listDocumentSnapshots({
      id,
      token: params?.token ?? null,
      limit: null,
      offset: null,
    }) as Promise<SnapshotListResponse>,
  enabled: !!id,
})

export function useDocumentSnapshots(id: string, params?: { token?: string | null }) {
  return useQuery(documentSnapshotsQuery(id, params))
}

export const snapshotDiffQuery = (
  id: string,
  snapshotId: string,
  params?: { compare?: string | null; token?: string | null },
) => ({
  queryKey: documentKeys.snapshotDiff(id, snapshotId, params?.compare ?? undefined),
  queryFn: () =>
    DocumentsService.getDocumentSnapshotDiff({
      id,
      snapshotId,
      compare: params?.compare ?? null,
      token: params?.token ?? null,
    }) as Promise<SnapshotDiffResponse>,
})

export async function triggerSnapshotRestore(params: {
  documentId: string
  snapshotId: string
  token?: string | null
}): Promise<SnapshotSummary> {
  const response = (await DocumentsService.restoreDocumentSnapshot({
    id: params.documentId,
    snapshotId: params.snapshotId,
    token: params.token ?? null,
  })) as SnapshotRestoreResponse
  return response.snapshot
}

export async function downloadSnapshot(params: {
  documentId: string
  snapshotId: string
  token?: string | null
  filename?: string
}) {
  const blob = (await DocumentsService.downloadDocumentSnapshot({
    id: params.documentId,
    snapshotId: params.snapshotId,
    token: params.token ?? null,
  })) as Blob
  const name = params.filename ?? `snapshot-${params.snapshotId}.zip`
  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  } finally {
    URL.revokeObjectURL(url)
  }
  return name
}

export function useCreateDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { title?: string; parent_id?: string | null; type?: 'folder' | 'document' }) =>
      DocumentsService.createDocument({
        requestBody: {
          title: input.title ?? 'Untitled',
          parent_id: input.parent_id ?? null,
          type: input.type,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: documentKeys.all })
    },
  })
}

export type Document = ApiDocument
export { DocumentsService }

// Use-case oriented helpers
export async function fetchDocumentMeta(id: string, token?: string) {
  return DocumentsService.getDocument({ id, token: token ?? undefined })
}

export async function fetchDocumentContent(id: string) {
  return DocumentsService.getDocumentContent({ id })
}

export async function listDocuments(params?: { query?: string | null; tag?: string | null }) {
  return DocumentsService.listDocuments({ query: params?.query ?? null, tag: params?.tag ?? null })
}

export async function createDocument(input: { title?: string; parent_id?: string | null; type?: 'folder' | 'document' }) {
  return DocumentsService.createDocument({ requestBody: input as any })
}

export async function updateDocumentTitle(id: string, title: string) {
  return DocumentsService.updateDocument({ id, requestBody: { title } as any })
}

export async function updateDocumentParent(id: string, parent_id: string | null) {
  return DocumentsService.updateDocument({ id, requestBody: { parent_id } as any })
}

export async function deleteDocument(id: string) {
  return DocumentsService.deleteDocument({ id })
}

export async function downloadDocumentArchive(id: string, options?: { token?: string; title?: string }) {
  const blob = await DocumentsService.downloadDocument({ id, token: options?.token ?? null })
  const filename = `${sanitizeExportName(options?.title)}.zip`
  const blobUrl = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = filename
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
  return filename
}

function sanitizeExportName(input?: string) {
  const invalid = new Set(['/','\\',':','*','?','"','<','>','|','\0'])
  let base = (input ?? '').trim()
  if (!base) base = 'document'
  let sanitized = ''
  for (const ch of base) {
    sanitized += invalid.has(ch) ? '-' : ch
  }
  sanitized = sanitized.replace(/ /g, '_')
  if (sanitized.length > 100) sanitized = sanitized.slice(0, 100)
  if (!sanitized) sanitized = 'document'
  return sanitized
}
