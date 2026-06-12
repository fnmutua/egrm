export default defineNuxtConfig({
  compatibilityDate: '2026-06-12',
  ssr: true, // public portal is SSR for SEO, low-bandwidth and accessibility
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://localhost:4100',
      tenant: process.env.NUXT_PUBLIC_TENANT ?? 'kisip2',
    },
  },
});
