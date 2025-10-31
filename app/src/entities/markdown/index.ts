import type { RenderManyRequest, RenderManyResponse, RenderRequest, RenderResponseBody } from '@/shared/api'
import { renderMarkdown as apiRenderMarkdown, renderMarkdownMany as apiRenderMarkdownMany } from '@/shared/api'

export type { RenderRequest as MarkdownRenderRequest, RenderResponseBody as MarkdownRenderResponse } from '@/shared/api'

export async function renderMarkdown(request: RenderRequest): Promise<RenderResponseBody> {
  return apiRenderMarkdown({ requestBody: request })
}

export async function renderMarkdownMany(request: RenderManyRequest): Promise<RenderManyResponse> {
  return apiRenderMarkdownMany({ requestBody: request })
}
