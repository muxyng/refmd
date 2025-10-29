import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlignLeft, Clock, Columns2, DownloadCloud, History as HistoryIcon, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { SnapshotDiffKind, SnapshotDiffBaseParam } from '@/shared/api'
import type { SnapshotDiffResponse, SnapshotSummary } from '@/shared/api'
import { overlayPanelClass } from '@/shared/lib/overlay-classes'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { DiffViewer } from '@/shared/ui/diff-viewer'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/shared/ui/resizable'
import { ScrollArea } from '@/shared/ui/scroll-area'

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

  const baseParam =
    compareBase === 'previous' ? SnapshotDiffBaseParam.PREVIOUS : SnapshotDiffBaseParam.CURRENT

  const diffQueryOptions = snapshotDiffQuery(
    documentId,
    selectedSnapshotId ?? '__pending__',
    { token, base: baseParam }
  )
  const diffQuery = useQuery({
    ...diffQueryOptions,
    enabled: Boolean(selectedSnapshotId),
  })

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
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={28} minSize={20} maxSize={40}>
              <div className="flex flex-col h-full min-h-0 border-r">
                <div className="px-4 py-3 border-b">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <HistoryIcon className="h-4 w-4 text-muted-foreground" />
                    History
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">Select a snapshot to review changes.</p>
                </div>
                <ScrollArea className="flex-1 min-h-0">
                  <div className="p-4 space-y-3">
                    {isLoading && (
                      <div className="flex justify-center items-center py-6 text-sm text-muted-foreground">
                        Loading snapshots…
                      </div>
                    )}
                    {error && !isLoading && (
                      <Alert variant="destructive">
                        <AlertDescription>Failed to load snapshots.</AlertDescription>
                      </Alert>
                    )}
                    {!isLoading && !error && snapshots.length === 0 && (
                      <div className="text-center py-6 text-sm text-muted-foreground">
                        No snapshots available yet
                      </div>
                    )}
                    {snapshots.map((snapshot) => {
                      const isActive = selectedSnapshotId === snapshot.id
                      return (
                        <button
                          key={snapshot.id}
                          onClick={() => setSelectedId(snapshot.id)}
                          className={cn(
                            'w-full text-left border rounded-lg p-3 transition-colors backdrop-blur-sm',
                            isActive ? 'bg-accent border-accent-foreground/20' : 'hover:bg-accent/40'
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium truncate">{snapshot.label}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatRelative(snapshot.created_at)}
                          </div>
                          {snapshot.notes && snapshot.notes.trim().length > 0 && (
                            <div className="mt-2 text-xs text-muted-foreground/80 line-clamp-3">{snapshot.notes}</div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </ScrollArea>
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={72}>
              <div className="h-full flex flex-col min-h-0">
                <div className="px-6 py-4 border-b flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold truncate">
                        {selectedSnapshot?.label ?? 'Snapshot'}
                      </h3>
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
                            <span className="truncate max-w-[320px]">
                              {selectedSnapshot.notes}
                            </span>
                          )}
                        </>
                      ) : (
                        <span>Select a snapshot to review</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center flex-wrap gap-2 justify-end">
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
                        <AlignLeft className="h-3 w-3 mr-1" />
                        Unified
                      </Button>
                      <Button
                        variant={viewMode === 'split' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-8 px-3 text-xs"
                        onClick={() => setViewMode('split')}
                      >
                        <Columns2 className="h-3 w-3 mr-1" />
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
                <ScrollArea className="flex-1 min-h-0">
                  <div className="p-6">
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
                      <div className="text-center py-12 text-sm text-muted-foreground">
                        Select a snapshot to view changes.
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SnapshotDiffViewer({ diff, viewMode }: { diff: SnapshotDiffResponse; viewMode: 'unified' | 'split' }) {
  const baseLabel = diff.base.kind === SnapshotDiffKind.SNAPSHOT && diff.base.snapshot
    ? diff.base.snapshot.label || 'Snapshot'
    : 'Current document'
  const diffResult = diff.diff

  return (
    <div className="h-full flex flex-col rounded-lg border bg-background/80 backdrop-blur-sm shadow-sm">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/40 text-xs text-muted-foreground">
        <span>Comparing to: {baseLabel}</span>
        <span>{diffResult.diff_lines.length} lines</span>
      </div>
      <DiffViewer diffResult={diffResult} viewMode={viewMode} />
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
