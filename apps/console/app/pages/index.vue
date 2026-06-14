<script setup lang="ts">
definePageMeta({ layout: 'shell' });

import type { Widget } from '~/types/dashboard';

const route = useRoute();
const { user, fetchMe } = useAuth();
const { loadDashboards, visibleDashboards, loading: dashLoading } = useDashboards();

const activeDashId = ref<string | null>(null);
const activeDash = computed(
  () => visibleDashboards.value.find((d) => d.id === activeDashId.value) ?? visibleDashboards.value[0] ?? null,
);

function widgetGridClass(widget: Widget, layout?: string) {
  if (layout === 'single_col') return '';
  const size = widget.size ?? 'standard';
  if (size === 'full') return 'col-span-full';
  if (size === 'wide') return 'sm:col-span-2';
  return '';
}

function pickDash(qd?: string) {
  const match = qd && visibleDashboards.value.find((d) => d.id === qd);
  activeDashId.value = match ? match.id : (visibleDashboards.value[0]?.id ?? null);
}

onMounted(async () => {
  const me = await fetchMe();
  if (!me) return navigateTo({ path: '/login', query: { reason: 'session_expired' } });
  await loadDashboards();
  pickDash(route.query.d as string | undefined);
});

watch(() => route.query.d, (qd) => pickDash(qd as string | undefined));

function switchDashboard(id: string) {
  activeDashId.value = id;
  navigateTo({ query: { d: id } }, { replace: true });
}
</script>

<template>
  <div v-if="user" class="p-4 sm:p-8">

      <!-- Loading dashboards -->
      <div v-if="dashLoading" class="flex items-center gap-2 text-muted py-12 justify-center">
        <UIcon name="i-lucide-loader-2" class="animate-spin size-5" />
        <span class="text-sm">Loading dashboards…</span>
      </div>

      <!-- No dashboards configured -->
      <div v-else-if="visibleDashboards.length === 0" class="py-12 text-center space-y-3">
        <UIcon name="i-lucide-layout-dashboard" class="size-10 text-muted mx-auto" />
        <h1 class="text-xl font-semibold">Welcome, {{ user.name }}</h1>
        <p class="text-muted text-sm">No dashboards have been configured yet.</p>
        <UButton v-if="user.permissions.some((p: string) => p.startsWith('admin:'))" variant="soft" to="/admin/config/cd15_dashboards">
          Configure dashboards
        </UButton>
      </div>

      <!-- Dashboard viewer -->
      <template v-else>
        <!-- Dashboard tabs (if more than one) -->
        <div class="flex items-center gap-3 mb-6 flex-wrap">
          <div v-if="visibleDashboards.length > 1" class="flex gap-1 flex-wrap">
            <UButton
              v-for="d in visibleDashboards"
              :key="d.id"
              size="sm"
              :variant="activeDashId === d.id ? 'solid' : 'ghost'"
              :icon="d.icon || 'i-lucide-layout-dashboard'"
              @click="switchDashboard(d.id)"
            >
              {{ d.title }}
            </UButton>
          </div>
          <template v-else-if="activeDash">
            <UIcon :name="activeDash.icon || 'i-lucide-layout-dashboard'" class="text-primary size-5" />
            <h1 class="text-xl font-semibold">{{ activeDash.title }}</h1>
          </template>
          <div class="flex-1" />
          <UButton
            v-if="user.permissions.some((p: string) => p.startsWith('admin:'))"
            size="xs"
            variant="ghost"
            icon="i-lucide-settings"
            to="/admin/config/cd15_dashboards"
          >
            Edit dashboards
          </UButton>
        </div>

        <!-- Sections -->
        <div v-if="activeDash" class="space-y-8">
          <div v-for="section in activeDash.sections" :key="section.id" class="space-y-3">
            <!-- Section header -->
            <div class="flex items-center gap-2">
              <UIcon v-if="section.icon" :name="section.icon" class="text-muted size-4" />
              <h2 class="text-sm font-semibold uppercase tracking-wide text-muted">{{ section.title }}</h2>
            </div>

            <!-- Widgets grid -->
            <div
              :class="[
                'grid gap-4',
                activeDash.layout === 'single_col'
                  ? 'grid-cols-1'
                  : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4',
              ]"
            >
              <div
                v-for="widget in section.widgets"
                :key="widget.id"
                :class="widgetGridClass(widget, activeDash.layout)"
              >
                <DashboardWidget :widget="widget" />
              </div>
            </div>
          </div>

          <p v-if="activeDash.sections.length === 0" class="text-sm text-muted italic">
            This dashboard has no sections yet.
            <NuxtLink to="/admin/config/cd15_dashboards" class="text-primary underline">Add sections in the config editor.</NuxtLink>
          </p>
        </div>
      </template>

  </div>
</template>
