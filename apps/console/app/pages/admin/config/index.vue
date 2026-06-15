<script setup lang="ts">
definePageMeta({ layout: 'shell' });

const { api } = useApi();
const { user, fetchMe } = useAuth();
const { canAdmin, canConfig } = usePermissions();

interface DomainRow {
  domain: string;
  active_version: number | null;
  activated_at: string | null;
  draft_count: number;
  latest_version: number | null;
}

const rows = ref<DomainRow[]>([]);
const loading = ref(true);
const search = ref('');

onMounted(async () => {
  const me = await fetchMe();
  if (!me) return navigateTo('/login');
  if (!canAdmin()) return navigateTo('/');
  const res = await api<{ domains: DomainRow[] }>('/api/v1/config');
  rows.value = res.domains;
  loading.value = false;
});

const permittedSections = computed(() =>
  CONFIG_SECTIONS.map((section) => ({
    ...section,
    entries: section.entries.filter((entry) => canConfig(entry.domain)),
  })).filter((section) => section.entries.length > 0),
);

const visibleSections = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return permittedSections.value;
  return permittedSections.value
    .map((section) => ({
      ...section,
      entries: section.entries.filter((entry) => {
        const meta = domainMeta(entry.domain);
        return (
          (meta?.cd ?? '').toLowerCase().includes(q) ||
          (meta?.title ?? '').toLowerCase().includes(q) ||
          (meta?.description ?? '').toLowerCase().includes(q) ||
          entry.domain.toLowerCase().includes(q) ||
          section.label.toLowerCase().includes(q) ||
          (meta?.subsections ?? []).some((s) => s.label.toLowerCase().includes(q))
        );
      }),
    }))
    .filter((section) => section.entries.length > 0);
});

const byDomain = computed(() => new Map(rows.value.map((r) => [r.domain, r])));
const configuredCount = computed(() => rows.value.filter((r) => r.active_version).length);
</script>

<template>
  <div v-if="user" class="p-4 sm:p-8">
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <h1 class="text-2xl font-semibold">
        Configuration
        <span v-if="!loading" class="text-sm font-normal text-muted ml-2">
          {{ configuredCount }}/{{ rows.length }}
        </span>
      </h1>
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Search…"
        class="w-full sm:w-56"
        :disabled="loading"
      />
    </div>

    <div v-if="loading" class="text-muted p-8 text-center">Loading…</div>
    <div v-else-if="visibleSections.length === 0" class="text-muted p-8 text-center">
      No configs match "{{ search }}"
    </div>
    <div v-else class="space-y-6">
      <div v-for="section in visibleSections" :key="section.label">
        <h2 class="text-xs font-semibold text-muted uppercase tracking-wide mb-2">{{ section.label }}</h2>
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <ul class="divide-y divide-default">
            <li
              v-for="entry in section.entries"
              :key="entry.domain"
              class="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-elevated/50 cursor-pointer transition"
              @click="navigateTo(`/admin/config/${entry.domain}`)"
            >
              <div class="flex items-center gap-3 min-w-0">
                <UIcon :name="domainMeta(entry.domain)?.icon ?? 'i-lucide-settings'" class="text-primary shrink-0" />
                <div class="flex items-center gap-2 min-w-0">
                  <span class="font-medium text-sm truncate">{{ domainMeta(entry.domain)?.title }}</span>
                  <UBadge size="sm" variant="subtle" color="neutral" class="shrink-0">
                    {{ domainMeta(entry.domain)?.cd }}
                  </UBadge>
                </div>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <UBadge v-if="byDomain.get(entry.domain)?.draft_count" size="sm" color="info" variant="subtle">
                  {{ byDomain.get(entry.domain)!.draft_count }} draft(s)
                </UBadge>
                <UBadge v-if="byDomain.get(entry.domain)?.active_version" size="sm" color="success" variant="subtle">
                  v{{ byDomain.get(entry.domain)!.active_version }} active
                </UBadge>
                <UBadge v-else size="sm" color="warning" variant="subtle">not configured</UBadge>
                <UIcon name="i-lucide-chevron-right" class="text-muted" />
              </div>
            </li>
          </ul>
        </UCard>
      </div>
    </div>
  </div>
</template>
