/** Resolved API base for $fetch. Dev client uses same-origin proxy; SSR hits API directly. */
export function usePublicApiBase() {
  const config = useRuntimeConfig();
  return computed(() => {
    const configured = (config.public.apiBase as string) ?? '';
    if (configured) return configured;
    if (import.meta.server) return 'http://127.0.0.1:4100';
    return '';
  });
}
