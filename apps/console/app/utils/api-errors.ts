export function isLocalHost(): boolean {
  if (import.meta.server) return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

function devApiHint(apiBase: string): string {
  return apiBase ? `(configured base: ${apiBase})` : '(dev proxy: console :3100 → API :4100)';
}

/** User-facing message when $fetch cannot reach the API. */
export function apiUnreachableMessage(apiBase: string): string {
  if (import.meta.dev || isLocalHost()) {
    return [
      'Cannot reach the API.',
      'Run `pnpm dev` from the repo root and wait until the terminal shows',
      '`[server] listening on 0.0.0.0:4100` for @egrm/api.',
      devApiHint(apiBase),
    ].join(' ');
  }
  if (!apiBase) {
    return 'Cannot reach API — NUXT_PUBLIC_API_BASE was not set at build time. Set it on Railway and redeploy the console.';
  }
  return `Cannot reach API at ${apiBase}. Check NUXT_PUBLIC_API_BASE and redeploy the console.`;
}

export function apiMisconfiguredMessage(apiBase: string): string {
  if (import.meta.dev || isLocalHost()) {
    return `API URL points at localhost but this page is not — unset NUXT_PUBLIC_API_BASE locally or use http://localhost:3100. (${apiBase})`;
  }
  if (!apiBase) {
    return 'Console API URL is missing — set NUXT_PUBLIC_API_BASE on Railway and redeploy.';
  }
  if (apiBase.includes('localhost') || apiBase.includes('127.0.0.1')) {
    return `Console API URL points at localhost (${apiBase}) — set NUXT_PUBLIC_API_BASE to your deployed API URL and redeploy.`;
  }
  return `Console API URL is misconfigured (${apiBase}). Set NUXT_PUBLIC_API_BASE on Railway and redeploy.`;
}

export function isFetchFailure(e: unknown): boolean {
  const err = e as { statusCode?: number; message?: string };
  return err.statusCode === 0 || Boolean(err.message?.includes('fetch') || err.message?.includes('Failed to fetch'));
}
