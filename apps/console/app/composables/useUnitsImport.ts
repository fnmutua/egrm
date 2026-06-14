/** Download and upload jurisdiction unit Excel templates. */
export function useUnitsImport() {
  const apiBase = usePublicApiBase();
  const config = useRuntimeConfig();
  const token = useCookie<string | null>('egrm_token');

  function authHeaders(): Record<string, string> {
    return {
      authorization: `Bearer ${token.value}`,
      'x-tenant': config.public.tenant,
    };
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadTemplate() {
    const blob = await $fetch<Blob>('/api/v1/units/import/template', {
      baseURL: apiBase.value,
      headers: authHeaders(),
      responseType: 'blob',
    });
    downloadBlob(blob, 'jurisdiction-units-template.xlsx');
  }

  async function downloadExport() {
    const blob = await $fetch<Blob>('/api/v1/units/export', {
      baseURL: apiBase.value,
      headers: authHeaders(),
      responseType: 'blob',
    });
    downloadBlob(blob, 'jurisdiction-units.xlsx');
  }

  async function importFile(file: File): Promise<{
    ok: boolean;
    created: number;
    skipped: number;
    errors: { row: number; message: string }[];
  }> {
    const form = new FormData();
    form.append('file', file);
    return await $fetch('/api/v1/units/import', {
      baseURL: apiBase.value,
      method: 'POST',
      headers: authHeaders(),
      body: form,
    });
  }

  async function resetAll(): Promise<{
    ok: boolean;
    units: number;
    casesUnlinked: number;
    rolesCleared: number;
  }> {
    return await $fetch('/api/v1/units/reset', {
      baseURL: apiBase.value,
      method: 'POST',
      headers: authHeaders(),
    });
  }

  return { downloadTemplate, downloadExport, importFile, resetAll };
}
