/** Extract JSON body from a Nuxt/$fetch error (422, 400, etc.). */
export function apiErrorData(e: unknown): Record<string, unknown> | undefined {
  if (!e || typeof e !== 'object') return undefined;
  const err = e as Record<string, unknown>;
  if (err.data && typeof err.data === 'object') return err.data as Record<string, unknown>;
  const response = err.response as { _data?: unknown } | undefined;
  if (response?._data && typeof response._data === 'object') return response._data as Record<string, unknown>;
  return undefined;
}

export function apiErrorMessage(e: unknown, messages: Record<string, string> = {}): string {
  const data = apiErrorData(e);
  const code = typeof data?.error === 'string' ? data.error : undefined;
  if (code && messages[code]) return messages[code];
  if (typeof data?.message === 'string' && data.message) return data.message;
  const err = e as { statusMessage?: string; message?: string };
  if (err.statusMessage && err.statusMessage !== 'Unprocessable Entity') return err.statusMessage;
  if (code) return code.replace(/_/g, ' ');
  return err.message ?? 'Request failed';
}

function isLocalHost(): boolean {
  if (import.meta.server) return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

function devApiHint(apiBase: string): string {
  return apiBase ? `(configured base: ${apiBase})` : '(dev proxy: console :3100 → API :4100)';
}

export function apiMisconfiguredMessage(apiBase: string): string {
  return [
    'API URL points to localhost but this console is not running locally.',
    'Set NUXT_PUBLIC_API_BASE to your deployed API URL',
    apiBase ? `(currently: ${apiBase}).` : 'and redeploy the console.',
  ].join(' ');
}

export function apiUnreachableMessage(apiBase: string): string {
  if (import.meta.dev || isLocalHost()) {
    return [
      'Cannot reach the API.',
      'Run `pnpm dev` from the repo root and wait until @egrm/api is listening on port 4100.',
      devApiHint(apiBase),
    ].join(' ');
  }
  if (!apiBase) {
    return 'Cannot reach API — NUXT_PUBLIC_API_BASE was not set at build time. Set it on Railway and redeploy the console.';
  }
  return `Cannot reach API at ${apiBase}. Check NUXT_PUBLIC_API_BASE and redeploy.`;
}

export function isFetchFailure(e: unknown): boolean {
  const err = e as { statusCode?: number; message?: string };
  return err.statusCode === 0 || Boolean(err.message?.includes('fetch') || err.message?.includes('Failed to fetch'));
}
