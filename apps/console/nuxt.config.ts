export default defineNuxtConfig({
  compatibilityDate: '2026-06-12',
  ssr: false, // staff console runs as SPA; the portal app does SSR
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  build: {
    transpile: ['@egrm/config-schemas', '@egrm/core'],
  },
  runtimeConfig: {
    public: {
      apiBase: (process.env.NUXT_PUBLIC_API_BASE ?? '').trim() || 'http://localhost:4100',
      tenant: (process.env.NUXT_PUBLIC_TENANT ?? '').trim() || 'kisip',
    },
  },
});
