<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui';

const route = useRoute();

const navItems = computed<NavigationMenuItem[]>(() => {
  const items: NavigationMenuItem[] = [
    { label: 'Overview', icon: 'i-lucide-layout-grid', to: '/admin', exact: true },
  ];
  for (const section of ADMIN_SECTIONS) {
    items.push({ label: section.label, type: 'label' });
    for (const entry of section.entries) {
      if (entry.type === 'page') {
        items.push({ label: entry.label, icon: entry.icon, to: entry.to });
      } else {
        const meta = domainMeta(entry.domain);
        if (!meta) continue;
        const to = `/admin/config/${entry.domain}`;
        if (meta.subsections?.length) {
          // Render editor sections as sub-items; open automatically while on that page.
          items.push({
            label: meta.title,
            icon: meta.icon,
            defaultOpen: route.path === to,
            children: meta.subsections.map((s) => ({
              label: s.label,
              to: `${to}#${s.id}`,
              exactHash: true,
            })),
          });
        } else {
          items.push({ label: meta.title, icon: meta.icon, to });
        }
      }
    }
  }
  return items;
});
</script>

<template>
  <div class="flex h-screen overflow-hidden">
    <aside class="w-64 shrink-0 border-r border-default bg-elevated/30 flex flex-col">
      <div class="px-4 py-3 border-b border-default">
        <NuxtLink to="/" class="flex items-center gap-1.5 text-xs text-muted hover:text-highlighted transition">
          <UIcon name="i-lucide-arrow-left" />
          Back to dashboard
        </NuxtLink>
        <div class="flex items-center gap-2 mt-2">
          <UIcon name="i-lucide-settings" class="text-primary" />
          <h2 class="font-semibold">Administration</h2>
        </div>
      </div>
      <nav class="flex-1 overflow-y-auto p-3">
        <UNavigationMenu orientation="vertical" :items="navItems" highlight />
      </nav>
    </aside>
    <main class="flex-1 min-w-0 overflow-y-auto">
      <slot />
    </main>
  </div>
</template>
