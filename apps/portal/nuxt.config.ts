const apiBaseEnv = (process.env.NUXT_PUBLIC_API_BASE ?? '').trim();
const isProductionBuild = process.env.NODE_ENV === 'production';

if (isProductionBuild && !apiBaseEnv) {
  console.warn(
    '[egrm/portal] NUXT_PUBLIC_API_BASE is unset — production builds must set it to your API URL (e.g. https://egrmapi-production.up.railway.app).',
  );
}

/** Dev: empty → same-origin /api proxy. Production: must be set at build time. */
const apiBase = apiBaseEnv;

export default defineNuxtConfig({
  compatibilityDate: '2026-06-12',
  ssr: true, // public portal is SSR for SEO, low-bandwidth and accessibility
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  build: {
    transpile: ['@egrm/core'],
  },
  runtimeConfig: {
    public: {
      apiBase,
      tenant: (process.env.NUXT_PUBLIC_TENANT ?? '').trim() || 'kisip',
    },
  },
  nitro: {
    devProxy: {
      '/api': {
        target: 'http://127.0.0.1:4100/api',
        changeOrigin: true,
      },
    },
  },
});
