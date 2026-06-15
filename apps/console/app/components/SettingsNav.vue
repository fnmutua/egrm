<script setup lang="ts">
/**
 * Settings sidebar — operational pages (users, units, …).
 */
import { canAccessAdminPage } from '@egrm/core';

const props = defineProps<{ compact?: boolean }>();

const route = useRoute();
const { user } = useAuth();
const { count: staffUserCount } = useStaffUserCount();

const visibleSections = computed(() => {
  const perms = user.value?.permissions ?? [];
  const opts = { managesStaffUsers: user.value?.manages_staff_users === true };
  return SETTINGS_SECTIONS.map((section) => ({
    ...section,
    entries: section.entries.filter((entry) => canAccessAdminPage(perms, entry.to, opts)),
  })).filter((section) => section.entries.length > 0);
});

const overviewActive = computed(() => route.path === '/admin/settings' && !route.hash);

function pageActive(to: string) {
  return route.path === to;
}

const linkClass = (active: boolean) =>
  [
    'flex items-center gap-2 rounded-md px-2 transition-colors w-full text-left',
    props.compact ? 'py-1 text-xs font-medium' : 'py-1.5 text-sm font-medium',
    active ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-elevated/80 hover:text-highlighted',
  ].join(' ');

function entryBadge(to: string) {
  if (to !== '/admin/settings/users' || staffUserCount.value == null) return null;
  return staffUserCount.value.toLocaleString();
}
</script>

<template>
  <nav class="space-y-5">
    <NuxtLink to="/admin/settings" :class="linkClass(overviewActive)">
      <UIcon name="i-lucide-layout-grid" class="size-4 shrink-0" />
      Overview
    </NuxtLink>

    <div v-for="section in visibleSections" :key="section.label" class="space-y-1">
      <div
        class="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted"
        :class="compact ? 'py-0.5' : 'py-1'"
      >
        {{ section.label }}
      </div>
      <ul class="space-y-0.5">
        <li v-for="entry in section.entries" :key="entry.to">
          <NuxtLink :to="entry.to" :class="linkClass(pageActive(entry.to))">
            <UIcon :name="entry.icon" class="size-4 shrink-0" />
            <span class="flex-1 truncate">{{ entry.label }}</span>
            <UBadge
              v-if="entryBadge(entry.to)"
              size="xs"
              variant="subtle"
              color="neutral"
              class="shrink-0 tabular-nums"
            >
              {{ entryBadge(entry.to) }}
            </UBadge>
          </NuxtLink>
        </li>
      </ul>
    </div>
  </nav>
</template>
