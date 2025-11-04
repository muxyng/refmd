import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router'
import { Archive, Book, ChevronLeft, ChevronRight, Download, FileDigit, FileText, FileType, Globe, History, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { ScrollArea } from '@/shared/ui/scroll-area'

import { overlayPanelClass } from '@/shared/lib/overlay-classes'
import { cn } from '@/shared/lib/utils'

import {
  DOWNLOAD_FORMAT_METADATA,
  downloadDocumentFile,
  fetchDocumentMeta,
  type DocumentDownloadFormat,
  type DocumentDownloadFormatMetadata,
} from '@/entities/document'
import { buildCanonicalUrl, buildOgImageUrl } from '@/entities/public'

import { documentBeforeLoadGuard, useAuthContext } from '@/features/auth'
import { BacklinksPanel } from '@/features/document-backlinks'
import { SnapshotHistoryDialog } from '@/features/document-snapshots'
import { EditorOverlay, MarkdownEditor, useViewContext } from '@/features/edit-document'
import { usePluginDocumentRedirect } from '@/features/plugins'
import { useSecondaryViewer } from '@/features/secondary-viewer'

import RouteError from '@/widgets/routes/RouteError'
import RoutePending from '@/widgets/routes/RoutePending'
import SecondaryViewer from '@/widgets/secondary-viewer/SecondaryViewer'

import { useCollaborativeDocument, useRealtime } from '@/processes/collaboration'
import type { DocumentHeaderAction } from '@/processes/collaboration/contexts/realtime-context'

export type DocumentRouteSearch = {
  token?: string
  [key: string]: string | string[] | undefined
}

const formatIcons: Partial<Record<DocumentDownloadFormat, React.ComponentType<{ className?: string }>>> = {
  archive: Archive,
  markdown: FileText,
  html: Globe,
  html5: Globe,
  pdf: FileDigit,
  docx: FileType,
  latex: FileDigit,
  beamer: FileDigit,
  context: FileDigit,
  man: FileText,
  mediawiki: FileText,
  dokuwiki: FileText,
  textile: FileText,
  org: FileText,
  texinfo: FileText,
  opml: FileDigit,
  docbook: FileDigit,
  opendocument: FileType,
  odt: FileType,
  rtf: FileType,
  epub: Book,
  epub3: Book,
  fb2: Book,
  asciidoc: FileText,
  icml: FileType,
  slidy: Globe,
  slideous: Globe,
  dzslides: Globe,
  revealjs: Globe,
  s5: Globe,
  json: FileDigit,
  plain: FileText,
  commonmark: FileText,
  commonmark_x: FileText,
  markdown_strict: FileText,
  markdown_phpextra: FileText,
  markdown_github: FileText,
  rst: FileText,
  native: FileDigit,
  haddock: FileText,
}

type DownloadOption = {
  format: DocumentDownloadFormat
  label: string
  description: string
}

type DownloadOptionGroup = {
  title: string
  description?: string
  items: DownloadOption[]
}

const PRIMARY_FORMATS: DocumentDownloadFormat[] = ['archive', 'markdown', 'html', 'pdf', 'docx']

const PRIMARY_OPTIONS: DownloadOption[] = PRIMARY_FORMATS.map((format) => {
  const meta = DOWNLOAD_FORMAT_METADATA[format]
  return { format, label: meta.label, description: meta.description }
})

const OTHER_GROUP_TITLES: string[] = [
  'Web & Slides',
  'TeX & Academic',
  'Office & Rich Text',
  'E-books',
  'Wiki & Markup',
  'Data & Interchange',
  'Manuals',
] 

const GROUP_DESCRIPTIONS: Record<string, string> = {
  'Web & Slides': 'HTML presentations and web-ready documents.',
  'TeX & Academic': 'TeX-based outputs for academic workflows.',
  'Office & Rich Text': 'Office document formats and rich text.',
  'E-books': 'Digital book formats supported by e-readers.',
  'Wiki & Markup': 'Markup languages and wiki syntaxes.',
  'Data & Interchange': 'Structured data formats and AST exports.',
  'Manuals': 'Formats suited for manuals and reference pages.',
}

const METADATA_ENTRIES = Object.entries(DOWNLOAD_FORMAT_METADATA) as Array<
  [DocumentDownloadFormat, DocumentDownloadFormatMetadata]
>

const OTHER_FORMAT_GROUPS: DownloadOptionGroup[] = (() => {
  const groups = OTHER_GROUP_TITLES.map((title) => {
    const items = METADATA_ENTRIES.filter(
      ([, meta]) => meta.category === 'other' && meta.group === title,
    ).map(([format, meta]) => ({ format, label: meta.label, description: meta.description }))
    return {
      title,
      description: GROUP_DESCRIPTIONS[title],
      items,
    }
  }).filter((group) => group.items.length > 0)

  const remaining = METADATA_ENTRIES.filter(
    ([, meta]) => meta.category === 'other' && (!meta.group || !OTHER_GROUP_TITLES.includes(meta.group)),
  ).map(([format, meta]) => ({ format, label: meta.label, description: meta.description }))

  if (remaining.length > 0) {
    groups.push({
      title: 'Other formats',
      description: 'Additional writers supported by Pandoc.',
      items: remaining,
    })
  }

  return groups
})()

function DocumentDownloadDialog({
  open,
  onOpenChange,
  primaryOptions,
  otherGroups,
  onSelect,
  isPending,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  primaryOptions: DownloadOption[]
  otherGroups: DownloadOptionGroup[]
  onSelect: (format: DocumentDownloadFormat) => void | Promise<void>
  isPending: boolean
}) {
  const [showOther, setShowOther] = useState(false)

  useEffect(() => {
    if (!open) {
      setShowOther(false)
    }
  }, [open])

  const renderOption = useCallback(
    (option: DownloadOption) => {
      const Icon = formatIcons[option.format] ?? FileType
      return (
        <button
          type="button"
          key={option.format}
          onClick={() => onSelect(option.format)}
          disabled={isPending}
          className={cn(
            'group flex w-full items-center gap-4 rounded-xl border border-border/60 bg-background/70 px-4 py-4 text-left transition',
            'hover:border-primary/60 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex flex-col items-start text-left">
            <span className="text-sm font-medium">{option.label}</span>
            <span className="text-xs text-muted-foreground">{option.description}</span>
          </div>
          <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground group-hover:text-primary" />
        </button>
      )
    },
    [isPending, onSelect],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('sm:max-w-lg p-0', overlayPanelClass)}>
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle>Download document</DialogTitle>
          <DialogDescription>
            {showOther
              ? 'Select from additional Pandoc-supported formats.'
              : 'Select an export format for the current document.'}
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 py-4 flex flex-col gap-4">
          {showOther ? (
            <>
              <div className="flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowOther(false)}
                  disabled={isPending}
                  className="-ml-2"
                >
                  <ChevronLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
              </div>
              <ScrollArea className="max-h-72 pr-2">
                <div className="flex flex-col gap-4">
                  {otherGroups.map((group) => (
                    <div key={group.title} className="space-y-2">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-semibold">{group.title}</span>
                        {group.description ? (
                          <span className="text-xs text-muted-foreground">{group.description}</span>
                        ) : null}
                      </div>
                      <div className="flex flex-col gap-2">
                        {group.items.map((option) => renderOption(option))}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                {primaryOptions.map((option) => renderOption(option))}
              </div>
              <button
                type="button"
                onClick={() => setShowOther(true)}
                disabled={isPending || otherGroups.length === 0}
                className={cn(
                  'group flex w-full items-center gap-4 rounded-xl border border-dashed border-border/60 bg-background/50 px-4 py-4 text-left transition',
                  'hover:border-primary/60 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:text-primary">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="flex flex-col text-left">
                  <span className="text-sm font-medium">Other formats…</span>
                  <span className="text-xs text-muted-foreground">
                    Export using any other Pandoc-supported writer.
                  </span>
                </div>
                <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground group-hover:text-primary" />
              </button>
            </>
          )}
        </div>
        <DialogFooter className="px-6 py-4 border-t flex items-center gap-3">
          <div className="mr-auto text-sm text-muted-foreground">
            {isPending ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Preparing download…
              </span>
            ) : showOther ? (
              'Choose a format from the list or go back to quick options.'
            ) : (
              'Choose a format to start exporting.'
            )}
          </div>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type LoaderData = {
  title: string
  token?: string
}

function normalizeDocumentSearch(search: Record<string, unknown>): DocumentRouteSearch {
  const result: DocumentRouteSearch = {}
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === 'string') {
      result[key] = value
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      result[key] = String(value)
    } else if (Array.isArray(value)) {
      const strings = value.filter((item): item is string => typeof item === 'string')
      if (strings.length) {
        result[key] = strings.length === 1 ? strings[0] : strings
      }
    }
  }
  return result
}

export const Route = createFileRoute('/(app)/document/$id')({
  staticData: { layout: 'document' },
  ssr: true,
  validateSearch: normalizeDocumentSearch,
  pendingComponent: () => <RoutePending label="Loading editor…" />,
  errorComponent: ({ error }) => <RouteError error={error} />,
  beforeLoad: documentBeforeLoadGuard,
  loader: async ({ params, location }) => {
    const normalizedSearch = normalizeDocumentSearch((location?.search ?? {}) as Record<string, unknown>)
    const token = typeof normalizedSearch.token === 'string' && normalizedSearch.token.trim().length > 0 ? normalizedSearch.token.trim() : undefined
    try {
      const meta = await fetchDocumentMeta(params.id, token)
      const title = typeof meta?.title === 'string' ? meta.title.trim() : ''
      return { title, token } satisfies LoaderData
    } catch {
      return { title: '', token } satisfies LoaderData
    }
  },
  head: ({ loaderData, params }) => {
    const data = (loaderData as LoaderData | undefined) ?? { title: '', token: undefined }
    const token = data.token
    const baseTitle = data.title?.trim() || 'Untitled Document'
    const isShare = Boolean(token)
    const metaTitle = isShare ? baseTitle : `${baseTitle} • RefMD`
    const description = isShare ? baseTitle : `${baseTitle} on RefMD`
    const query = token ? `?token=${encodeURIComponent(token)}` : ''
    const canonicalPath = `/document/${encodeURIComponent(params.id)}${query}`
    const { base, url: canonicalUrl } = buildCanonicalUrl(canonicalPath)
    const ogImage = buildOgImageUrl(base, {
      variant: 'document',
      title: baseTitle,
      subtitle: isShare ? 'Shared document on RefMD' : 'Workspace document',
      description,
      badge: isShare ? 'Shared Document' : 'Document',
      meta: isShare ? 'refmd.io - share link' : 'refmd.io',
    })

    return {
      meta: [
        { title: metaTitle },
        { name: 'description', content: description },
        { property: 'og:title', content: metaTitle },
        { property: 'og:description', content: description },
        { property: 'og:type', content: 'article' },
        { property: 'og:url', content: canonicalUrl },
        { property: 'og:image', content: ogImage },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: metaTitle },
        { name: 'twitter:description', content: description },
        { name: 'twitter:image', content: ogImage },
      ],
      links: [{ rel: 'canonical', href: canonicalUrl }],
    }
  },
  component: InnerDocument,
})

function InnerDocument() {
  const { id } = useParams({ from: '/(app)/document/$id' })
  const loaderData = Route.useLoaderData() as LoaderData | undefined
  const search = Route.useSearch() as DocumentRouteSearch
  const shareToken = loaderData?.token ?? (typeof search.token === 'string' && search.token.trim().length > 0 ? search.token.trim() : undefined)
  const [isClient, setIsClient] = useState(typeof window !== 'undefined')

  useEffect(() => {
    setIsClient(true)
  }, [])

  if (!isClient) {
    return <DocumentSSRPlaceholder />
  }

  return <DocumentClient id={id} loaderData={loaderData} shareToken={shareToken} />
}

function DocumentSSRPlaceholder() {
  return (
    <div className="relative flex h-full flex-1 min-h-0 flex-col">
      <EditorOverlay label="Loading…" />
    </div>
  )
}

function DocumentClient({
  id,
  loaderData,
  shareToken,
}: {
  id: string
  loaderData?: LoaderData
  shareToken?: string
}) {
  const navigate = useNavigate()
  const { user } = useAuthContext()
  const [showSnapshots, setShowSnapshots] = useState(false)
  const openSnapshots = useCallback(() => setShowSnapshots(true), [])
  const [showDownloadDialog, setShowDownloadDialog] = useState(false)
  const [downloadPending, setDownloadPending] = useState(false)
  const { secondaryDocumentId, secondaryDocumentType, showSecondaryViewer, closeSecondaryViewer, openSecondaryViewer } = useSecondaryViewer()
  const { showBacklinks, setShowBacklinks } = useViewContext()
  const { status, doc, awareness, isReadOnly, error: realtimeError } = useCollaborativeDocument(id, shareToken)
  const { documentTitle: realtimeTitle, documentActions, setDocumentActions } = useRealtime()
  const hasDoc = Boolean(doc)
  const redirecting = usePluginDocumentRedirect(id, {
    navigate: (to) => navigate({ to }),
  })
  const anonIdentity = useMemo(() => {
    if (user) return null
    try {
      const keyName = 'refmd_anon_identity'
      const saved = localStorage.getItem(keyName)
      if (saved) return JSON.parse(saved) as { id: string; name: string }
      const rnd = Math.random().toString(36).slice(-4)
      const ident = { id: `guest:${rnd}`, name: `Guest-${rnd}` }
      localStorage.setItem(keyName, JSON.stringify(ident))
      return ident
    } catch {
      const rnd = Math.random().toString(36).slice(-4)
      return { id: `guest:${rnd}`, name: `Guest-${rnd}` }
    }
  }, [user])

  useEffect(() => {
    setShowBacklinks(false)
  }, [id, setShowBacklinks])

  const loaderTitle = loaderData?.title
  const resolvedTitle = (realtimeTitle && realtimeTitle.trim()) || loaderTitle

  const openDownloadDialog = useCallback(() => {
    if (!hasDoc) return
    setShowDownloadDialog(true)
  }, [hasDoc])

  const handleDownload = useCallback(
    async (format: DocumentDownloadFormat) => {
      if (!hasDoc) return
      setDownloadPending(true)
      try {
        const filename = await downloadDocumentFile(id, {
          token: shareToken,
          title: resolvedTitle,
          format,
        })
        toast.success(`Download ready: ${filename}`)
        setShowDownloadDialog(false)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to download document'
        toast.error(message)
      } finally {
        setDownloadPending(false)
      }
    },
    [hasDoc, id, shareToken, resolvedTitle],
  )

  useEffect(() => {
    const ensureAction = (
      list: DocumentHeaderAction[],
      action: DocumentHeaderAction,
    ): DocumentHeaderAction[] => {
      const existing = list.find((item) => item.id === action.id)
      if (!existing) {
        return [...list, action]
      }
      if (
        existing.onSelect !== action.onSelect ||
        existing.disabled !== action.disabled ||
        existing.label !== action.label
      ) {
        return list.map((item) => (item.id === action.id ? action : item))
      }
      return list
    }

    const actions = documentActions ?? []
    const snapshotAction: DocumentHeaderAction = {
      id: 'snapshot-history',
      label: 'Snapshots',
      onSelect: openSnapshots,
      disabled: !hasDoc,
      icon: <History className="h-4 w-4" />,
      tooltip: 'Snapshot history',
    }
    const downloadAction: DocumentHeaderAction = {
      id: 'download-document',
      label: 'Download',
      onSelect: openDownloadDialog,
      disabled: !hasDoc,
      icon: <Download className="h-4 w-4" />,
      tooltip: 'Download document',
    }

    let next = ensureAction(actions, snapshotAction)
    next = ensureAction(next, downloadAction)
    if (next !== actions) {
      setDocumentActions(next)
    }
  }, [documentActions, setDocumentActions, openSnapshots, hasDoc, openDownloadDialog])

  useEffect(() => {
    if (showBacklinks && showSecondaryViewer) {
      closeSecondaryViewer()
    }
  }, [showBacklinks, showSecondaryViewer, closeSecondaryViewer])

  const hasCollaborativeState = Boolean(doc && awareness)

  const shouldShowOverlay = redirecting || Boolean(realtimeError) || !hasCollaborativeState

  const overlayLabel = realtimeError
    ? realtimeError
    : redirecting
      ? 'Loading…'
      : status === 'connecting'
        ? 'Connecting…'
        : 'Loading…'

  useEffect(() => {
    if (typeof document === 'undefined') return
    const originalTitle = document.title
    const baseTitle = (realtimeTitle && realtimeTitle.trim()) || loaderData?.title?.trim() || ''
    const computedTitle = (() => {
      if (!baseTitle) return 'RefMD'
      if (shareToken) return baseTitle
      return `${baseTitle} • RefMD`
    })()
    document.title = computedTitle

    const summary = (() => {
      if (!baseTitle) return shareToken ? 'Shared document on RefMD' : 'Editing a document on RefMD'
      if (shareToken) return baseTitle
      return `${baseTitle} on RefMD`
    })()

    const metaDefs: Array<{ selector: string; attr: 'name' | 'property'; value: string }> = [
      { selector: 'description', attr: 'name', value: summary },
      { selector: 'og:title', attr: 'property', value: computedTitle },
      { selector: 'og:description', attr: 'property', value: summary },
      { selector: 'og:url', attr: 'property', value: typeof window !== 'undefined' ? window.location.href : '' },
      { selector: 'og:type', attr: 'property', value: 'article' },
    ]

    const cleanupFns: Array<() => void> = []
    for (const def of metaDefs) {
      if (!def.value) continue
      const selector = def.attr === 'name' ? `meta[name="${def.selector}"]` : `meta[property="${def.selector}"]`
      const element = document.head.querySelector(selector) as HTMLMetaElement | null
      if (element) {
        const prev = element.getAttribute('content')
        element.setAttribute('content', def.value)
        cleanupFns.push(() => {
          if (prev == null) element.removeAttribute('content')
          else element.setAttribute('content', prev)
        })
      } else {
        const metaEl = document.createElement('meta')
        metaEl.setAttribute(def.attr, def.selector)
        metaEl.setAttribute('content', def.value)
        document.head.appendChild(metaEl)
        cleanupFns.push(() => {
          document.head.removeChild(metaEl)
        })
      }
    }

    return () => {
      document.title = originalTitle
      cleanupFns.forEach((fn) => fn())
    }
  }, [id, realtimeTitle, loaderData?.title, shareToken])

  return (
    <div className="relative flex h-full flex-1 min-h-0 flex-col">
      {shouldShowOverlay && <EditorOverlay label={overlayLabel} />}
      {doc && awareness && !realtimeError && (
        <MarkdownEditor
          key={id}
          doc={doc}
          awareness={awareness}
          connected={status === 'connected'}
          initialView="split"
          userId={user?.id || anonIdentity?.id}
          userName={user?.name || anonIdentity?.name}
          documentId={id}
          readOnly={isReadOnly}
          extraRight={showBacklinks ? (
            <BacklinksPanel documentId={id} className="h-full" onClose={() => setShowBacklinks(false)} />
          ) : (showSecondaryViewer && secondaryDocumentId ? (
              <SecondaryViewer
                documentId={secondaryDocumentId}
                documentType={secondaryDocumentType}
                onClose={closeSecondaryViewer}
                onDocumentChange={(docId, type) => openSecondaryViewer(docId, type)}
                className="h-full"
              />
            ) : undefined)}
        />
      )}
      <SnapshotHistoryDialog
        documentId={id}
        open={showSnapshots}
        onOpenChange={setShowSnapshots}
        token={shareToken}
        canRestore={!isReadOnly}
      />
      <DocumentDownloadDialog
        open={showDownloadDialog}
        onOpenChange={setShowDownloadDialog}
        primaryOptions={PRIMARY_OPTIONS}
        otherGroups={OTHER_FORMAT_GROUPS}
        onSelect={handleDownload}
        isPending={downloadPending}
      />
    </div>
  )
}
