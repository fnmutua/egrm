<script setup lang="ts">
/**
 * Configuration sidebar — versioned CD domains only.
 */
import type { ConfigEntry } from '~/utils/config-domains';
import type { ConfigDomain } from '@egrm/core';
import { canAccessConfigDomain } from '@egrm/core';

const props = defineProps<{ compact?: boolean }>();

const route = useRoute();
const { user } = useAuth();

const visibleSections = computed(() => {
  const perms = user.value?.permissions ?? [];
  return CONFIG_SECTIONS.map((section) => ({
    ...section,
    entries: section.entries.filter((entry) =>
      canAccessConfigDomain(perms, entry.domain as ConfigDomain),
    ),
  })).filter((section) => section.entries.length > 0);
});

const overviewActive = computed(() => route.path === '/admin/config' && !route.hash);

function domainTo(domain: string) {
  return `/admin/config/${domain}`;
}

function subTo(domain: string, id: string) {
  return `${domainTo(domain)}#${id}`;
}

function domainOpen(domain: string) {
  return route.path === domainTo(domain);
}

function subActive(domain: string, id: string) {
  return route.path === domainTo(domain) && route.hash === `#${id}`;
}

function isSingleDomainSection(entries: ConfigEntry[]) {
  return entries.length === 1;
}

function singleDomain(entries: ConfigEntry[]) {
  return entries[0]?.domain ?? null;
}

function sectionIcon(section: { icon?: string; entries: ConfigEntry[] }) {
  if (section.icon) return section.icon;
  const first = section.entries[0];
  if (!first) return 'i-lucide-settings';
  return domainMeta(first.domain)?.icon ?? 'i-lucide-settings';
}

function sectionOpen(section: { entries: ConfigEntry[] }) {
  return section.entries.some((entry) => {
    if (domainMeta(entry.domain)?.subsections?.length) return domainOpen(entry.domain);
    return domainOpen(entry.domain);
  });
}

function entryActive(entry: ConfigEntry) {
  return domainOpen(entry.domain) && !route.hash;
}

const groupSummaryClass = computed(() =>
  `flex cursor-pointer list-none items-center gap-2 rounded-md px-2 ${props.compact ? 'py-1 text-xs' : 'py-1.5 text-sm'} font-semibold text-default hover:bg-elevated/60 [&::-webkit-details-marker]:hidden`,
);

const nestedListClass = 'mt-0.5 ml-2 space-y-0.5 border-l border-default pl-2';

const linkClass = (active: boolean, size: 'md' | 'sm' = 'md') =>
  [
    'flex items-center gap-2 rounded-md px-2 transition-colors w-full text-left',
    props.compact ? 'py-1' : 'py-1.5',
    props.compact
      ? (size === 'md' ? 'text-xs font-medium' : 'text-[11px] font-normal')
      : (size === 'md' ? 'text-sm font-medium' : 'text-xs font-normal'),
    active ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-elevated/80 hover:text-highlighted',
  ].join(' ');
</script>

<template>
  <nav class="space-y-5">
    <NuxtLink to="/admin/config" :class="linkClass(overviewActive)">
      <UIcon name="i-lucide-layout-grid" class="size-4 shrink-0" />
      Overview
    </NuxtLink>

    <div v-for="section in visibleSections" :key="section.label" class="space-y-1">
      <template v-if="isSingleDomainSection(section.entries)">
        <template v-if="domainMeta(singleDomain(section.entries)!)?.subsections?.length">
          <details :open="domainOpen(singleDomain(section.entries)!)" class="group">
            <summary :class="groupSummaryClass">
              <UIcon
                :name="domainMeta(singleDomain(section.entries)!)?.icon ?? 'i-lucide-settings'"
                class="size-4 shrink-0 text-primary"
              />
              <span class="flex-1 truncate">{{ section.label }}</span>
              <UIcon
                name="i-lucide-chevron-down"
                class="size-4 shrink-0 text-muted transition-transform group-open:rotate-180"
              />
            </summary>
            <ul :class="nestedListClass">
              <li v-for="sub in domainMeta(singleDomain(section.entries)!)!.subsections!" :key="sub.id">
                <NuxtLink
                  :to="subTo(singleDomain(section.entries)!, sub.id)"
                  :class="linkClass(subActive(singleDomain(section.entries)!, sub.id), 'sm')"
                >
                  {{ sub.label }}
                </NuxtLink>
              </li>
            </ul>
          </details>
        </template>
        <NuxtLink
          v-else
          :to="domainTo(singleDomain(section.entries)!)"
          :class="linkClass(domainOpen(singleDomain(section.entries)!))"
        >
          <UIcon
            :name="domainMeta(singleDomain(section.entries)!)?.icon ?? 'i-lucide-settings'"
            class="size-4 shrink-0"
          />
          {{ section.label }}
        </NuxtLink>
      </template>

      <template v-else>
        <details :open="sectionOpen(section)" class="group">
          <summary :class="groupSummaryClass">
            <UIcon :name="sectionIcon(section)" class="size-4 shrink-0 text-primary" />
            <span class="flex-1 truncate">{{ section.label }}</span>
            <UIcon
              name="i-lucide-chevron-down"
              class="size-4 shrink-0 text-muted transition-transform group-open:rotate-180"
            />
          </summary>
          <ul :class="nestedListClass">
            <li v-for="entry in section.entries" :key="entry.domain">
              <template v-if="domainMeta(entry.domain)?.subsections?.length">
                <details :open="domainOpen(entry.domain)" class="group/nested">
                  <summary
                    class="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-normal text-muted hover:bg-elevated/60 hover:text-highlighted [&::-webkit-details-marker]:hidden"
                    :class="domainOpen(entry.domain) ? 'text-primary' : ''"
                  >
                    <span class="flex-1 truncate">{{ domainMeta(entry.domain)!.title }}</span>
                    <UIcon
                      name="i-lucide-chevron-down"
                      class="size-3.5 shrink-0 text-muted transition-transform group-open/nested:rotate-180"
                    />
                  </summary>
                  <ul class="mt-0.5 ml-2 space-y-0.5 border-l border-default/70 pl-2">
                    <li v-for="sub in domainMeta(entry.domain)!.subsections!" :key="sub.id">
                      <NuxtLink
                        :to="subTo(entry.domain, sub.id)"
                        :class="linkClass(subActive(entry.domain, sub.id), 'sm')"
                      >
                        {{ sub.label }}
                      </NuxtLink>
                    </li>
                  </ul>
                </details>
              </template>
              <NuxtLink v-else :to="domainTo(entry.domain)" :class="linkClass(entryActive(entry), 'sm')">
                {{ domainMeta(entry.domain)?.title }}
              </NuxtLink>
            </li>
          </ul>
        </details>
      </template>
    </div>
  </nav>
</template>
