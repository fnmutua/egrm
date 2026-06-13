/** Stage and download case attachments (multipart upload). */
export function useCaseAttachmentUpload(caseId: string) {
  const config = useRuntimeConfig();
  const token = useCookie<string | null>('egrm_token');

  async function stageFile(file: File, kind: string): Promise<{ attachment_id: string }> {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    return await $fetch<{ attachment_id: string }>(`/api/v1/cases/${caseId}/attachments/stage`, {
      baseURL: config.public.apiBase,
      method: 'POST',
      headers: {
        authorization: `Bearer ${token.value}`,
        'x-tenant': config.public.tenant,
      },
      body: form,
    });
  }

  async function removeStaged(attachmentId: string): Promise<void> {
    await $fetch(`/api/v1/cases/${caseId}/attachments/${attachmentId}`, {
      baseURL: config.public.apiBase,
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token.value}`,
        'x-tenant': config.public.tenant,
      },
    });
  }

  async function downloadFile(attachmentId: string, filename: string): Promise<void> {
    const blob = await $fetch<Blob>(`/api/v1/cases/${caseId}/attachments/${attachmentId}/download`, {
      baseURL: config.public.apiBase,
      headers: {
        authorization: `Bearer ${token.value}`,
        'x-tenant': config.public.tenant,
      },
      responseType: 'blob',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return { stageFile, removeStaged, downloadFile };
}
