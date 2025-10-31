import { listTags as apiListTags } from '@/shared/api'

export const tagKeys = {
  all: ['tags'] as const,
  list: (q?: string) => ['tags',{ q: q ?? '' }] as const,
}

// Use-case oriented helpers
export async function listTags(q?: string) {
  return apiListTags({ q: q as any })
}
