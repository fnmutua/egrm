<script setup lang="ts">
import type { PortalLegalSection } from '~/composables/usePortalIdentity';

defineProps<{
  title: string;
  intro: string;
  sections: PortalLegalSection[];
  version?: string;
  effectiveDate?: string;
  relatedLinks?: { to: string; label: string }[];
}>();

const { p, locales, locale, t } = usePortalIdentity();

const ui = computed(() => ({
  back: locale.value === 'sw' ? 'Rudi mwanzo' : 'Back to home',
  version: locale.value === 'sw' ? 'Toleo' : 'Version',
  effective: locale.value === 'sw' ? 'Tarehe ya kuanza kutumika' : 'Effective',
  contact: locale.value === 'sw' ? 'Wasiliana nasi' : 'Contact us',
  related: locale.value === 'sw' ? 'Taarifa husika' : 'Related',
}));
</script>

<template>
  <div class="min-h-screen flex flex-col bg-default">
    <PortalPageHeader>
      <div v-if="locales.length > 1" class="flex rounded-md border border-default overflow-hidden">
        <button
          v-for="loc in locales"
          :key="loc"
          class="px-2 py-1 text-xs font-medium uppercase transition"
          :class="loc === locale ? 'bg-primary text-inverted' : 'text-muted hover:text-highlighted'"
          @click="locale = loc"
        >
          {{ loc }}
        </button>
      </div>
    </PortalPageHeader>

    <main class="flex-1 w-full">
      <div class="max-w-3xl mx-auto px-4 py-10 sm:py-14">
        <p class="text-sm text-muted mb-2">
          <NuxtLink to="/" class="text-primary hover:underline inline-flex items-center gap-1">
            <UIcon name="i-lucide-arrow-left" class="size-3.5" />
            {{ ui.back }}
          </NuxtLink>
        </p>

        <h1 class="text-2xl sm:text-3xl font-bold mb-2">{{ title }}</h1>
        <p class="text-sm text-muted mb-6">
          {{ p?.legal_name ?? p?.name }}
          <span v-if="version"> · {{ ui.version }} {{ version }}</span>
          <span v-if="effectiveDate"> · {{ ui.effective }} {{ effectiveDate }}</span>
        </p>

        <p class="text-muted leading-relaxed mb-10">{{ intro }}</p>

        <div class="space-y-8">
          <section v-for="section in sections" :key="section.id">
            <h2 class="text-lg font-semibold mb-2">{{ t(section.title) }}</h2>
            <p class="text-muted leading-relaxed whitespace-pre-line">{{ t(section.body) }}</p>
          </section>
        </div>

        <div v-if="relatedLinks?.length" class="mt-10 pt-6 border-t border-default">
          <div class="text-xs font-semibold uppercase tracking-wide text-muted mb-2">{{ ui.related }}</div>
          <div class="flex flex-wrap gap-x-4 gap-y-1">
            <NuxtLink
              v-for="link in relatedLinks"
              :key="link.to"
              :to="link.to"
              class="text-sm text-primary hover:underline"
            >
              {{ link.label }}
            </NuxtLink>
          </div>
        </div>

        <UCard v-if="p?.footer" class="mt-12" :ui="{ body: 'p-5 space-y-2 text-sm' }">
          <div class="font-medium text-highlighted">{{ ui.contact }}</div>
          <div v-if="p.footer.address" class="text-muted">{{ p.footer.address }}</div>
          <div class="flex flex-wrap gap-x-4 text-muted">
            <span v-if="p.footer.phone" class="inline-flex items-center gap-1">
              <UIcon name="i-lucide-phone" class="size-3.5" />{{ p.footer.phone }}
            </span>
            <span v-if="p.footer.email" class="inline-flex items-center gap-1">
              <UIcon name="i-lucide-mail" class="size-3.5" />{{ p.footer.email }}
            </span>
          </div>
          <p v-if="p.footer.privacy_note" class="text-xs pt-2 border-t border-default">{{ t(p.footer.privacy_note) }}</p>
        </UCard>
      </div>
    </main>
  </div>
</template>
