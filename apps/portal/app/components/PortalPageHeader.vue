<script setup lang="ts">
const apiBase = usePublicApiBase();
const config = useRuntimeConfig();

const { data: identity } = await useFetch<{
  payload: { name: string; branding: { logo_url?: string } };
}>('/api/v1/config/cd01_identity', {
  baseURL: apiBase.value,
  headers: { 'x-tenant': config.public.tenant },
});

const p = computed(() => identity.value?.payload);
const logoFailed = ref(false);
</script>

<template>
  <header class="border-b border-default sticky top-0 bg-default/95 backdrop-blur z-10">
    <div class="max-w-6xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between gap-2">
      <NuxtLink to="/" class="flex items-center gap-2 sm:gap-3 min-w-0 hover:opacity-80 transition-opacity">
        <img
          v-if="p?.branding.logo_url && !logoFailed"
          :src="p.branding.logo_url"
          alt=""
          class="h-7 sm:h-9 w-auto object-contain shrink-0"
          @error="logoFailed = true"
        />
        <span class="font-semibold text-base sm:text-lg truncate text-primary">
          {{ p?.name ?? 'Grievance Portal' }}
        </span>
      </NuxtLink>
      <div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <PortalStaffLoginButton />
        <slot />
      </div>
    </div>
  </header>
</template>
