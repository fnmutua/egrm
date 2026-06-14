export function isLocalHost(): boolean {
  if (import.meta.server) return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

function devApiHint(apiBase: string): string {
  return apiBase ? `(configured base: ${apiBase})` : '(dev proxy: portal :3200 → API :4100)';
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
    return 'Cannot reach API — NUXT_PUBLIC_API_BASE was not set at build time. Set it on Railway and redeploy the portal.';
  }
  return `Cannot reach API at ${apiBase}. Check NUXT_PUBLIC_API_BASE and redeploy.`;
}

export function isFetchFailure(e: unknown): boolean {
  const err = e as { statusCode?: number; message?: string };
  return err.statusCode === 0 || Boolean(err.message?.includes('fetch') || err.message?.includes('Failed to fetch'));
}
