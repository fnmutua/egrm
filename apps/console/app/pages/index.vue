<script setup lang="ts">
import { hasPermission } from '@egrm/core';

const { user, fetchMe, logout } = useAuth();
const { loadDashboards, visibleDashboards, loading: dashLoading } = useDashboards();

const activeDashId = ref<string | null>(null);
const activeDash = computed(
  () => visibleDashboards.value.find((d) => d.id === activeDashId.value) ?? visibleDashboards.value[0] ?? null,
);

onMounted(async () => {
  const me = await fetchMe();
  if (!me) return navigateTo({ path: '/login', query: { reason: 'session_expired' } });
  await loadDashboards();
  if (visibleDashboards.value.length) activeDashId.value = visibleDashboards.value[0].id;
});

const nav = computed(() => {
  const perms = user.value?.permissions ?? [];
  const items: Record<string, unknown>[] = [
    { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', to: '/' },
    { label: 'Cases', icon: 'i-lucide-inbox', to: '/cases' },
    { label: 'Reports', icon: 'i-lucide-bar-chart-3', to: '/', disabled: true, badge: 'Phase 4' },
  ];
  if (perms.some((p) => p.startsWith('admin:'))) {
    items.push({ label: 'Configs', icon: 'i-lucide-settings', to: '/admin' });
  }
  if (user.value?.manages_staff_users || hasPermission(perms, 'admin:users') || perms.includes('admin:*')) {
    items.push({
      label: 'Admin',
      icon: 'i-lucide-user-cog',
      children: [{ label: 'Users', icon: 'i-lucide-users', to: '/admin/users' }],
    });
  }
  return [items];
});
</script>

<template>
  <div v-if="user" class="min-h-screen flex flex-col md:flex-row">
    <!-- Mobile top bar -->
    <div class="md:hidden border-b border-default px-4 py-2.5">
      <div class="flex items-center justify-between">
        <span class="font-semibold">eGRM Console</span>
        <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-log-out" aria-label="Sign out" @click="logout" />
      </div>
      <UNavigationMenu orientation="horizontal" :items="nav" class="mt-1 -mx-2 overflow-x-auto" />
    </div>

    <!-- Desktop sidebar -->
    <aside class="hidden md:flex w-60 border-r border-default p-4 flex-col gap-4">
      <div class="font-semibold text-lg px-2">eGRM Console</div>
      <UNavigationMenu orientation="vertical" :items="nav" class="flex-1" />
      <div class="border-t border-default pt-3 px-2">
        <div class="text-sm font-medium">{{ user.name }}</div>
        <div class="text-xs text-muted truncate">{{ user.email }}</div>
        <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-log-out" class="mt-2" @click="logout">
          Sign out
        </UButton>
      </div>
    </aside>

    <main class="flex-1 p-4 sm:p-8 min-w-0">

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
              @click="activeDashId = d.id"
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

        <!-- Filter bar -->
        <div v-if="activeDash?.filter_bar && Object.values(activeDash.filter_bar).some(Boolean)" class="flex flex-wrap gap-2 mb-5">
          <UBadge v-if="activeDash.filter_bar.period" variant="outline" color="neutral" icon="i-lucide-calendar">
            All time
          </UBadge>
          <UBadge v-if="activeDash.filter_bar.unit" variant="outline" color="neutral" icon="i-lucide-map-pin">
            All units
          </UBadge>
          <UBadge v-if="activeDash.filter_bar.category" variant="outline" color="neutral" icon="i-lucide-tag">
            All categories
          </UBadge>
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
              <DashboardWidget
                v-for="widget in section.widgets"
                :key="widget.id"
                :widget="widget"
              />
            </div>
          </div>

          <p v-if="activeDash.sections.length === 0" class="text-sm text-muted italic">
            This dashboard has no sections yet.
            <NuxtLink to="/admin/config/cd15_dashboards" class="text-primary underline">Add sections in the config editor.</NuxtLink>
          </p>
        </div>
      </template>

    </main>
  </div>
</template>
