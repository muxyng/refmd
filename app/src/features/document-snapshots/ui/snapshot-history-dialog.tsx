import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlignLeft, Clock, Columns2, DownloadCloud, History as HistoryIcon, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import type { SnapshotDiffResponse, SnapshotSummary } from '@/shared/api'
import { overlayPanelClass } from '@/shared/lib/overlay-classes'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { DiffViewer } from '@/shared/ui/diff-viewer'
import { ScrollArea } from '@/shared/ui/scroll-area'

import { useIsMobile } from '@/shared/hooks/use-mobile'
import { documentKeys, downloadSnapshot, snapshotDiffQuery, triggerSnapshotRestore, useDocumentSnapshots } from '@/entities/document'

type SnapshotHistoryDialogProps = {
  documentId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  token?: string
  canRestore?: boolean
}

export function SnapshotHistoryDialog({ documentId, open, onOpenChange, token, canRestore = false }: SnapshotHistoryDialogProps) {
  const { data, isLoading, isFetching, error } = useDocumentSnapshots(documentId, { token })
  const snapshots = data?.items ?? []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified')
  const [compareBase, setCompareBase] = useState<'previous' | 'current'>('previous')
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list')

  useEffect(() => {
    if (!open) {
      return
    }

    if (snapshots.length === 0) {
      if (selectedId !== null) {
        setSelectedId(null)
      }
      return
    }

    if (!selectedId) {
      setSelectedId(snapshots[0].id)
      return
    }

    const hasSelected = snapshots.some((snapshot) => snapshot.id === selectedId)
    if (!hasSelected && !isFetching) {
      setSelectedId(snapshots[0].id)
    }
  }, [open, snapshots, selectedId, isFetching])

  const selectedSnapshotId = selectedId ?? snapshots[0]?.id

  const selectedIndex = useMemo(
    () => snapshots.findIndex((snapshot) => snapshot.id === selectedSnapshotId),
    [snapshots, selectedSnapshotId]
  )
  const previousSnapshot = selectedIndex >= 0 ? snapshots[selectedIndex + 1] ?? null : null
  const hasPreviousSnapshot = Boolean(previousSnapshot)

  useEffect(() => {
    if (compareBase === 'previous' && !hasPreviousSnapshot) {
      setCompareBase('current')
    }
  }, [compareBase, hasPreviousSnapshot])

  useEffect(() => {
    if (!open) {
      setMobileView('list')
      return
    }
    if (!isMobile) {
      setMobileView('list')
    }
  }, [open, isMobile])

  useEffect(() => {
    if (!isMobile) return
    if (!selectedSnapshotId) {
      setMobileView('list')
    }
  }, [isMobile, selectedSnapshotId])

  const baseParam =
    compareBase === 'previous' ? 'previous' : 'current'

  const diffQueryOptions = snapshotDiffQuery(
    documentId,
    selectedSnapshotId ?? '__pending__',
    { token, base: baseParam }
  )
  const diffQuery = useQuery({
    ...diffQueryOptions,
    enabled: Boolean(selectedSnapshotId),
  })

  const handleSelectSnapshot = (snapshotId: string) => {
    setSelectedId(snapshotId)
    if (isMobile) {
      setMobileView('detail')
    }
  }

  const restoreMutation = useMutation({
    mutationFn: (snapshot: SnapshotSummary) =>
      triggerSnapshotRestore({ documentId, snapshotId: snapshot.id, token }),
    onSuccess: (restored) => {
      toast.success('Snapshot restored')
      queryClient.invalidateQueries({ queryKey: documentKeys.snapshots(documentId) })
      setSelectedId(restored.id)
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to restore snapshot')
    },
  })

  const downloadMutation = useMutation({
    mutationFn: (snapshot: SnapshotSummary) =>
      downloadSnapshot({
        documentId,
        snapshotId: snapshot.id,
        token,
        filename: `${sanitizeFilename(snapshot.label)}.zip`,
      }),
    onError: (err: any) => toast.error(err?.message || 'Failed to download snapshot'),
  })

  const selectedSnapshot = snapshots.find((s) => s.id === selectedSnapshotId) || null

  const diffData = diffQuery.data ?? null

  const historyListContent = (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <HistoryIcon className="h-4 w-4 text-muted-foreground" />
          History
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">Select a snapshot to review changes.</p>
      </div>
      <ScrollArea className={cn('flex-1 min-h-0', isMobile ? 'max-h-[65vh]' : 'max-h-none')}>
        <div className="min-w-0 space-y-3 p-4">
          {isLoading && (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              Loading snapshots…
            </div>
          )}
          {error && !isLoading && (
            <Alert variant="destructive">
              <AlertDescription>Failed to load snapshots.</AlertDescription>
            </Alert>
          )}
          {!isLoading && !error && snapshots.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">No snapshots available yet</div>
          )}
          {snapshots.map((snapshot) => {
            const isActive = selectedSnapshotId === snapshot.id
            return (
              <button
                key={snapshot.id}
                onClick={() => handleSelectSnapshot(snapshot.id)}
                className={cn(
                  'w-full overflow-hidden rounded-lg border p-3 text-left backdrop-blur-sm transition-colors',
                  isActive ? 'border-accent-foreground/20 bg-accent' : 'hover:bg-accent/40',
                )}
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="block max-w-full min-w-0 text-sm font-medium">{snapshot.label}</span>
                </div>
                <div className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {formatRelative(snapshot.created_at)}
                </div>
                {snapshot.notes && snapshot.notes.trim().length > 0 && (
                  <div className="mt-2 line-clamp-3 text-xs text-muted-foreground/80">{snapshot.notes}</div>
                )}
              </button>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )

  const detailContent = (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-6 py-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-lg font-semibold">{selectedSnapshot?.label ?? 'Snapshot'}</h3>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {selectedSnapshot ? (
              <>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatRelative(selectedSnapshot.created_at)}
                </span>
                <span>{formatBytes(selectedSnapshot.byte_size)}</span>
                {selectedSnapshot.notes && (
                  <span className="max-w-[320px] truncate">{selectedSnapshot.notes}</span>
                )}
              </>
            ) : (
              <span>Select a snapshot to review</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant={compareBase === 'previous' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 px-3 text-xs"
              disabled={!hasPreviousSnapshot}
              onClick={() => setCompareBase('previous')}
            >
              Prev Snapshot
            </Button>
            <Button
              variant={compareBase === 'current' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => setCompareBase('current')}
            >
              Current Document
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant={viewMode === 'unified' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => setViewMode('unified')}
            >
              <AlignLeft className="mr-1 h-3 w-3" />
              Unified
            </Button>
            <Button
              variant={viewMode === 'split' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => setViewMode('split')}
            >
              <Columns2 className="mr-1 h-3 w-3" />
              Split
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 text-xs"
            disabled={!selectedSnapshot || downloadMutation.isPending}
            onClick={() => selectedSnapshot && downloadMutation.mutate(selectedSnapshot)}
          >
            {downloadMutation.isPending ? (
              'Downloading…'
            ) : (
              <span className="flex items-center gap-1">
                <DownloadCloud className="h-3 w-3" />
                Download
              </span>
            )}
          </Button>
          <Button
            variant="default"
            size="sm"
            className="h-8 px-3 text-xs"
            disabled={!canRestore || !selectedSnapshot || restoreMutation.isPending}
            onClick={() => selectedSnapshot && restoreMutation.mutate(selectedSnapshot)}
          >
            {restoreMutation.isPending ? (
              'Restoring…'
            ) : (
              <span className="flex items-center gap-1">
                <RotateCcw className="h-3 w-3" />
                Restore
              </span>
            )}
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0 min-w-0">
        <div className="min-w-0 p-6">
          {diffQuery.isLoading && (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              Loading diff…
            </div>
          )}
          {diffQuery.error && !diffQuery.isLoading && (
            <Alert variant="destructive">
              <AlertDescription>Failed to load diff.</AlertDescription>
            </Alert>
          )}
          {!diffQuery.isLoading && !diffQuery.error && diffData && (
            <SnapshotDiffViewer diff={diffData} viewMode={viewMode} />
          )}
          {!diffQuery.isLoading && !diffQuery.error && !diffData && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Select a snapshot to view changes.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('sm:max-w-[85vw] max-w-[95vw] h-[90vh] p-0 flex flex-col', overlayPanelClass)}>
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <HistoryIcon className="h-4 w-4 text-muted-foreground" />
            Snapshots
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          {isMobile ? (
            <div className="flex h-full flex-col">
              {mobileView === 'list' && (
                <>
                  {historyListContent}
                  {selectedSnapshot && (
                    <div className="border-t px-4 py-3">
                      <Button
                        className="w-full"
                        variant="secondary"
                        onClick={() => setMobileView('detail')}
                      >
                        View snapshot details
                      </Button>
                    </div>
                  )}
                </>
              )}
              {mobileView === 'detail' && (
                <div className="flex h-full flex-col">
                  <div className="border-b px-4 py-3">
                    <Button variant="ghost" size="sm" onClick={() => setMobileView('list')}>
                      ← Back to history
                    </Button>
                  </div>
                  {detailContent}
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full min-w-0 flex-row">
              <div className="w-[28%] min-w-[220px] max-w-[340px] border-r">
                {historyListContent}
              </div>
              <div className="flex h-full flex-1 flex-col">{detailContent}</div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SnapshotDiffViewer({ diff, viewMode }: { diff: SnapshotDiffResponse; viewMode: 'unified' | 'split' }) {
  const baseLabel = diff.base.kind === 'snapshot' && diff.base.snapshot
    ? diff.base.snapshot.label || 'Snapshot'
    : 'Current document'
  const diffResult = diff.diff

  return (
    <div className="flex h-full w-full flex-col rounded-lg border bg-background/80 backdrop-blur-sm shadow-sm">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/40 text-xs text-muted-foreground">
        <span>Comparing to: {baseLabel}</span>
        <span>{diffResult.diff_lines.length} lines</span>
      </div>
      <div className="flex-1 min-h-0 min-w-0">
        <div className="h-full w-full overflow-auto">
          <div className="w-full">
            <DiffViewer diffResult={diffResult} viewMode={viewMode} />
          </div>
        </div>
      </div>
    </div>
  )
}
function formatRelative(date: string): string {
  const target = new Date(date)
  const now = Date.now()
  const diff = target.getTime() - now
  const absMs = Math.abs(diff)
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 1000 * 60 * 60 * 24 * 365],
    ['month', 1000 * 60 * 60 * 24 * 30],
    ['week', 1000 * 60 * 60 * 24 * 7],
    ['day', 1000 * 60 * 60 * 24],
    ['hour', 1000 * 60 * 60],
    ['minute', 1000 * 60],
  ]

  for (const [unit, ms] of units) {
    if (absMs >= ms || unit === 'minute') {
      const value = Math.round(diff / ms)
      const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
      return rtf.format(value, unit)
    }
  }
  return target.toLocaleString()
}

function sanitizeFilename(input: string) {
  return input.replace(/[\\/:*?"<>|\0]/g, '-').replace(/\s+/g, '_') || 'snapshot'
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB']
  let idx = 0
  let size = bytes
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024
    idx++
  }
  return `${Math.round(size * 10) / 10} ${units[idx]}`
}
