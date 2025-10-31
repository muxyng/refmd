import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  archiveDocument as apiArchiveDocument,
  createDocument as apiCreateDocument,
  deleteDocument as apiDeleteDocument,
  downloadDocument as apiDownloadDocument,
  downloadDocumentSnapshot as apiDownloadDocumentSnapshot,
  getBacklinks as apiGetBacklinks,
  getDocument as apiGetDocument,
  getDocumentContent as apiGetDocumentContent,
  getDocumentSnapshotDiff as apiGetDocumentSnapshotDiff,
  getOutgoingLinks as apiGetOutgoingLinks,
  listDocumentSnapshots as apiListDocumentSnapshots,
  listDocuments as apiListDocuments,
  restoreDocumentSnapshot as apiRestoreDocumentSnapshot,
  unarchiveDocument as apiUnarchiveDocument,
  updateDocument as apiUpdateDocument,
} from '@/shared/api'
import type {
  DocumentListResponse,
  Document as ApiDocument,
  BacklinksResponse,
  OutgoingLinksResponse,
  SnapshotListResponse,
  SnapshotDiffBaseParam,
  SnapshotDiffResponse,
  SnapshotRestoreResponse,
  SnapshotSummary,
} from '@/shared/api'

export const documentKeys = {
  all: ['documents'] as const,
  list: (params?: { query?: string; tag?: string; state?: 'active' | 'archived' | 'all' }) =>
    ['documents', 'list', params ?? {}] as const,
  byId: (id: string) => ['documents', id] as const,
  backlinks: (id: string) => ['documents', id, 'backlinks'] as const,
  links: (id: string) => ['documents', id, 'links'] as const,
  snapshots: (id: string) => ['documents', id, 'snapshots'] as const,
  snapshotDiff: (
    id: string,
    snapshotId: string,
    compare?: string | null,
    base?: SnapshotDiffBaseParam | 'auto'
  ) => ['documents', id, 'snapshot', snapshotId, compare ?? 'current', base ?? 'auto'] as const,
}

export const listDocumentsQuery = (params?: { query?: string; tag?: string; state?: 'active' | 'archived' | 'all' }) => {
  const state = params?.state ?? 'active'
  const finalParams = { ...(params ?? {}), state }
  return {
    queryKey: documentKeys.list(finalParams),
    queryFn: () =>
      apiListDocuments({
        query: params?.query ?? null,
        tag: params?.tag ?? null,
        state,
      }) as Promise<DocumentListResponse>,
  }
}

export const backlinksQuery = (id: string) => ({
  queryKey: documentKeys.backlinks(id),
  queryFn: () => apiGetBacklinks({ id }) as Promise<BacklinksResponse>,
  enabled: !!id,
})

export const outgoingLinksQuery = (id: string) => ({
  queryKey: documentKeys.links(id),
  queryFn: () => apiGetOutgoingLinks({ id }) as Promise<OutgoingLinksResponse>,
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
    apiListDocumentSnapshots({
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
  params?: { compare?: string | null; base?: SnapshotDiffBaseParam | 'auto'; token?: string | null },
) => ({
  queryKey: documentKeys.snapshotDiff(
    id,
    snapshotId,
    params?.compare ?? undefined,
    params?.base ?? 'auto'
  ),
  queryFn: () =>
    apiGetDocumentSnapshotDiff({
      id,
      snapshotId,
      compare: params?.compare ?? null,
      base: params?.base === 'auto' ? null : params?.base ?? null,
      token: params?.token ?? null,
    }) as Promise<SnapshotDiffResponse>,
})

export async function triggerSnapshotRestore(params: {
  documentId: string
  snapshotId: string
  token?: string | null
}): Promise<SnapshotSummary> {
  const response = (await apiRestoreDocumentSnapshot({
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
  const blob = (await apiDownloadDocumentSnapshot({
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
      apiCreateDocument({
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

export function useArchiveDocument(options?: { onSuccess?: (document: ApiDocument, id: string) => void }) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => apiArchiveDocument({ id }) as Promise<ApiDocument>,
    onSuccess: (doc, id) => {
      qc.invalidateQueries({ queryKey: documentKeys.all })
      options?.onSuccess?.(doc, id)
    },
  })
}

export function useUnarchiveDocument(options?: { onSuccess?: (document: ApiDocument, id: string) => void }) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => apiUnarchiveDocument({ id }) as Promise<ApiDocument>,
    onSuccess: (doc, id) => {
      qc.invalidateQueries({ queryKey: documentKeys.all })
      options?.onSuccess?.(doc, id)
    },
  })
}

export type Document = ApiDocument

// Use-case oriented helpers
export async function fetchDocumentMeta(id: string, token?: string) {
  return apiGetDocument({ id, token: token ?? undefined })
}

export async function fetchDocumentContent(id: string) {
  return apiGetDocumentContent({ id })
}

export async function listDocuments(params?: { query?: string | null; tag?: string | null; state?: 'active' | 'archived' | 'all' }) {
  return apiListDocuments({
    query: params?.query ?? null,
    tag: params?.tag ?? null,
    state: params?.state ?? 'active',
  })
}

export async function createDocument(input: { title?: string; parent_id?: string | null; type?: 'folder' | 'document' }) {
  return apiCreateDocument({ requestBody: input as any })
}

export async function updateDocumentTitle(id: string, title: string) {
  return apiUpdateDocument({ id, requestBody: { title } as any })
}

export async function updateDocumentParent(id: string, parent_id: string | null) {
  return apiUpdateDocument({ id, requestBody: { parent_id } as any })
}

export async function deleteDocument(id: string) {
  return apiDeleteDocument({ id })
}

export async function downloadDocumentArchive(id: string, options?: { token?: string; title?: string }) {
  const blob = await apiDownloadDocument({ id, token: options?.token ?? null })
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
