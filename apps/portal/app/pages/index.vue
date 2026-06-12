<script setup lang="ts">
interface IdentityConfig {
  payload: {
    name: string;
    branding: { primary_color: string };
    locales: { default: string; enabled: string[] };
    statements: Record<string, Record<string, string>>;
  };
}

const config = useRuntimeConfig();

// Tenant branding & mandatory statements come from the config registry (CD-01) — not from code.
const { data: identity } = await useFetch<IdentityConfig>('/api/v1/config/cd01_identity', {
  baseURL: config.public.apiBase,
  headers: { 'x-tenant': config.public.tenant },
});

const locale = computed(() => identity.value?.payload.locales.default ?? 'en');
const t = (key: string) => identity.value?.payload.statements[key]?.[locale.value] ?? '';
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header class="border-b border-default">
      <div class="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
        <div class="font-semibold text-lg" :style="{ color: identity?.payload.branding.primary_color }">
          {{ identity?.payload.name ?? 'Grievance Portal' }}
        </div>
        <nav class="flex gap-2">
          <UButton to="/submit" size="sm">Submit a grievance</UButton>
          <UButton to="/track" size="sm" variant="outline">Track status</UButton>
        </nav>
      </div>
    </header>

    <main class="flex-1 max-w-4xl mx-auto px-4 py-12 w-full">
      <h1 class="text-3xl font-bold mb-3">Raise your concern. We will respond.</h1>
      <p class="text-muted max-w-2xl mb-8">
        This portal lets you submit a grievance or feedback about the programme, track its progress
        using your reference number, and receive a response within the published timelines.
      </p>

      <div class="grid sm:grid-cols-3 gap-4 mb-12">
        <UCard><div class="text-sm">{{ t('free_of_charge') }}</div></UCard>
        <UCard><div class="text-sm">{{ t('non_retaliation') }}</div></UCard>
        <UCard><div class="text-sm">{{ t('confidentiality') }}</div></UCard>
      </div>

      <div class="flex gap-3">
        <UButton to="/submit" size="lg">Submit a grievance</UButton>
        <UButton to="/track" size="lg" variant="outline">Track an existing case</UButton>
      </div>
    </main>

    <footer class="border-t border-default py-6 text-center text-sm text-muted">
      {{ identity?.payload.name }} — electronic Grievance Redress Mechanism
    </footer>
  </div>
</template>
