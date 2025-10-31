import { uploadFile as apiUploadFile } from '@/shared/api'

export const fileKeys = {
  all: ['files'] as const,
}

export async function uploadAttachment(documentId: string, file: File) {
  return apiUploadFile({
    formData: { file: file as any, document_id: documentId } as any,
  })
}
