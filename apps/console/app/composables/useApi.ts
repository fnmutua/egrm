export function useApi() {
  const config = useRuntimeConfig();
  const token = useCookie<string | null>('egrm_token');

  async function api<T>(path: string, opts: Parameters<typeof $fetch>[1] = {}): Promise<T> {
    return await $fetch<T>(path, {
      baseURL: config.public.apiBase,
      ...opts,
      headers: {
        authorization: `Bearer ${token.value}`,
        'x-tenant': config.public.tenant,
        ...(opts.headers ?? {}),
      },
    }) as T;
  }

  return { api };
}
