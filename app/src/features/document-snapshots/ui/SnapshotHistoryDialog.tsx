import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { SnapshotDiffKind } from '@/shared/api'
import type { SnapshotDiffResponse, SnapshotSummary } from '@/shared/api'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
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
  const { data, isLoading, error } = useDocumentSnapshots(documentId, { token })
  const snapshots = data?.items ?? []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!open) {
      return
    }
    if (!selectedId && snapshots.length > 0) {
      setSelectedId(snapshots[0].id)
      return
    }
    if (selectedId && snapshots.every((snap) => snap.id !== selectedId) && snapshots.length > 0) {
      setSelectedId(snapshots[0].id)
    }
  }, [open, snapshots, selectedId])

  const selectedSnapshotId = selectedId ?? snapshots[0]?.id

  const diffQueryOptions = snapshotDiffQuery(
    documentId,
    selectedSnapshotId ?? '__pending__',
    { token }
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
      <DialogContent className="sm:max-w-[1100px] max-w-[95vw] h-[85vh] p-0 flex flex-col">
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <DialogTitle>Snapshots</DialogTitle>
        </DialogHeader>
        <div className="flex flex-1 min-h-0">
          <aside className="w-72 border-r flex flex-col">
            <div className="p-4 border-b">
              <h3 className="text-sm font-medium">History</h3>
              <p className="text-xs text-muted-foreground">Select a snapshot to review changes.</p>
            </div>
            <ScrollArea className="flex-1">
              <div className="flex flex-col gap-1 p-2">
                {isLoading && (
                  <div className="px-2 py-4 text-sm text-muted-foreground">Loading snapshots…</div>
                )}
                {error && !isLoading && (
                  <div className="px-2 py-4 text-sm text-destructive">Failed to load snapshots.</div>
                )}
                {!isLoading && !error && snapshots.length === 0 && (
                  <div className="px-2 py-4 text-sm text-muted-foreground">No snapshots available yet.</div>
                )}
                {snapshots.map((snapshot) => (
                  <button
                    key={snapshot.id}
                    onClick={() => setSelectedId(snapshot.id)}
                    className={cn(
                      'text-left rounded-md px-3 py-2 transition-colors border border-transparent',
                      selectedSnapshotId === snapshot.id
                        ? 'bg-primary/10 border-primary/40 text-primary'
                        : 'hover:bg-muted'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{snapshot.label}</span>
                      <Badge variant="secondary" className="text-[11px] uppercase tracking-wide">
                        v{snapshot.version}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatRelative(snapshot.created_at)}
                    </div>
                    {snapshot.notes && snapshot.notes.trim().length > 0 && (
                      <div className="mt-1 text-xs text-muted-foreground/80">{snapshot.notes}</div>
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </aside>
          <section className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h3 className="text-lg font-semibold">{selectedSnapshot?.label ?? 'Snapshot'}</h3>
                <p className="text-sm text-muted-foreground">
                  {selectedSnapshot
                    ? `${formatRelative(selectedSnapshot.created_at)} • ${Math.round((selectedSnapshot.byte_size / 1024) * 10) / 10} KB`
                    : 'Select a snapshot to review'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!selectedSnapshot || downloadMutation.isPending}
                  onClick={() => selectedSnapshot && downloadMutation.mutate(selectedSnapshot)}
                >
                  {downloadMutation.isPending ? 'Downloading…' : 'Download'}
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  disabled={!canRestore || !selectedSnapshot || restoreMutation.isPending}
                  onClick={() => selectedSnapshot && restoreMutation.mutate(selectedSnapshot)}
                >
                  {restoreMutation.isPending ? 'Restoring…' : 'Restore'}
                </Button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              {diffQuery.isLoading && (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  Loading diff…
                </div>
              )}
              {diffQuery.error && !diffQuery.isLoading && (
                <div className="p-6 text-sm text-destructive">Failed to load diff.</div>
              )}
              {!diffQuery.isLoading && !diffQuery.error && diffData && (
                <SnapshotDiffViewer diff={diffData} />
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SnapshotDiffViewer({ diff }: { diff: SnapshotDiffResponse }) {
  const baseMarkdown = diff.base.markdown
  const diffLines = useMemo(() => buildDiff(baseMarkdown, diff.target_markdown), [baseMarkdown, diff.target_markdown])

  const baseLabel = diff.base.kind === SnapshotDiffKind.SNAPSHOT && diff.base.snapshot
    ? `Snapshot v${diff.base.snapshot.version}`
    : 'Current document'

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-3 border-b bg-muted/40 text-xs text-muted-foreground">
        <span>Comparing to: {baseLabel}</span>
        <span>{diffLines.length} lines</span>
      </div>
      <ScrollArea className="flex-1">
        <div className="font-mono text-sm">
          {diffLines.map((line, idx) => (
            <div
              key={`${idx}-${line.targetLine ?? 'x'}-${line.baseLine ?? 'x'}`}
              className={cn(
                'grid grid-cols-[60px_60px_1fr] gap-3 px-6 py-[3px] border-b border-border/40',
                line.type === 'add' && 'bg-emerald-50 text-emerald-900',
                line.type === 'remove' && 'bg-rose-50 text-rose-900'
              )}
            >
              <span className="text-xs text-muted-foreground/70">
                {line.baseLine !== null ? line.baseLine : ''}
              </span>
              <span className="text-xs text-muted-foreground/70">
                {line.targetLine !== null ? line.targetLine : ''}
              </span>
              <span>
                {line.type === 'add' && '+'}
                {line.type === 'remove' && '-'}
                {line.type === 'equal' && ' '}
                {line.value === '' ? <span className="text-muted-foreground/50">(empty)</span> : ` ${line.value}`}
              </span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

type DiffLine = {
  type: 'equal' | 'add' | 'remove'
  value: string
  baseLine: number | null
  targetLine: number | null
}

function buildDiff(base: string, target: string): DiffLine[] {
  const a = base.split('\n')
  const b = target.split('\n')
  const m = a.length
  const n = b.length
  const dp: number[][] = Array(m + 1)
    .fill(0)
    .map(() => Array(n + 1).fill(0))

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const result: DiffLine[] = []
  let i = 0
  let j = 0
  let baseLine = 1
  let targetLine = 1

  while (i < m && j < n) {
    if (a[i] === b[j]) {
      result.push({ type: 'equal', value: a[i], baseLine, targetLine })
      i += 1
      j += 1
      baseLine += 1
      targetLine += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: 'remove', value: a[i], baseLine, targetLine: null })
      i += 1
      baseLine += 1
    } else {
      result.push({ type: 'add', value: b[j], baseLine: null, targetLine })
      j += 1
      targetLine += 1
    }
  }

  while (i < m) {
    result.push({ type: 'remove', value: a[i], baseLine, targetLine: null })
    i += 1
    baseLine += 1
  }

  while (j < n) {
    result.push({ type: 'add', value: b[j], baseLine: null, targetLine })
    j += 1
    targetLine += 1
  }

  return result
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
