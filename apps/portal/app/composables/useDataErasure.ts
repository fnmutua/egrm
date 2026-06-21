export function useDataErasure() {
  const apiBase = usePublicApiBase();
  const config = useRuntimeConfig();
  const headers = { 'x-tenant': config.public.tenant };

  async function submit(input: { name: string; phone: string; email: string }) {
    return $fetch<{
      ok: true;
      parties_affected: number;
      cases_affected: number;
    }>('/api/v1/public/data-erasure', {
      method: 'POST',
      baseURL: apiBase.value,
      headers,
      body: input,
    });
  }

  return { submit };
}
