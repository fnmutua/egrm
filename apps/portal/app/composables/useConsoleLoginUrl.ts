/** Staff console login URL (portal header link). */
export function useConsoleLoginUrl(): ComputedRef<string | null> {
  const config = useRuntimeConfig();
  return computed(() => {
    const base = String(config.public.consoleUrl ?? '').trim();
    if (base) return `${base.replace(/\/$/, '')}/login`;
    if (import.meta.dev) return 'http://localhost:3100/login';
    return null;
  });
}
