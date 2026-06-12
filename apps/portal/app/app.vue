<script setup lang="ts">
const config = useRuntimeConfig();
const appConfig = useAppConfig();

// Tenant-wide branding: tab title, favicon, and Nuxt UI semantic palette colors (CD-01).
const { data: identity } = await useFetch<{
  payload: {
    name: string;
    branding: { favicon_url?: string; primary?: string; secondary?: string; neutral?: string };
  };
}>('/api/v1/config/cd01_identity', {
  baseURL: config.public.apiBase,
  headers: { 'x-tenant': config.public.tenant },
});

watchEffect(() => {
  const b = identity.value?.payload.branding;
  if (!b) return;
  if (b.primary) appConfig.ui.colors.primary = b.primary;
  if (b.secondary) appConfig.ui.colors.secondary = b.secondary;
  if (b.neutral) appConfig.ui.colors.neutral = b.neutral;
});

useHead(() => ({
  title: identity.value?.payload.name ?? 'Grievance Portal',
  link: identity.value?.payload.branding.favicon_url
    ? [{ rel: 'icon', href: identity.value.payload.branding.favicon_url }]
    : [],
}));
</script>

<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
