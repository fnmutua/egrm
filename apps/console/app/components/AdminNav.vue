<script setup lang="ts">
/**
 * Admin sidebar navigation with explicit typography:
 * section headers ≥ parent links > subsection links (indented).
 */
import type { AdminEntry } from '~/utils/config-domains';
import type { ConfigDomain } from '@egrm/core';
import { canAccessAdminPage, canAccessConfigDomain } from '@egrm/core';

const route = useRoute();
const { user } = useAuth();

const visibleSections = computed(() => {
  const perms = user.value?.permissions ?? [];
  return ADMIN_SECTIONS.map((section) => ({
    ...section,
    entries: section.entries.filter((entry) => {
      if (entry.type === 'page') return canAccessAdminPage(perms, entry.to);
      return canAccessConfigDomain(perms, entry.domain as ConfigDomain);
    }),
  })).filter((section) => section.entries.length > 0);
});

const overviewActive = computed(() => route.path === '/admin' && !route.hash);

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

function pageActive(to: string) {
  return route.path === to;
}

/** One domain in a section — use the section label as the collapsible title (avoids label + title duplication). */
function isSingleDomainSection(entries: AdminEntry[]) {
  return entries.length === 1 && entries[0]!.type === 'domain';
}

function singleDomain(entries: AdminEntry[]) {
  const e = entries[0];
  return e?.type === 'domain' ? e.domain : null;
}

function sectionIcon(section: { icon?: string; entries: AdminEntry[] }) {
  if (section.icon) return section.icon;
  const first = section.entries[0];
  if (!first) return 'i-lucide-settings';
  if (first.type === 'page') return first.icon;
  return domainMeta(first.domain)?.icon ?? 'i-lucide-settings';
}

function sectionOpen(section: { entries: AdminEntry[] }) {
  return section.entries.some((entry) => {
    if (entry.type === 'page') return pageActive(entry.to);
    if (domainMeta(entry.domain)?.subsections?.length) return domainOpen(entry.domain);
    return domainOpen(entry.domain);
  });
}

function entryActive(entry: AdminEntry) {
  if (entry.type === 'page') return pageActive(entry.to);
  return domainOpen(entry.domain) && !route.hash;
}

const groupSummaryClass =
  'flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold text-default hover:bg-elevated/60 [&::-webkit-details-marker]:hidden';

const nestedListClass = 'mt-0.5 ml-2 space-y-0.5 border-l border-default pl-2';

const linkClass = (active: boolean, size: 'md' | 'sm' = 'md') =>
  [
    'flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors w-full text-left',
    size === 'md' ? 'text-sm font-medium' : 'text-xs font-normal',
    active ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-elevated/80 hover:text-highlighted',
  ].join(' ');
</script>

<template>
  <nav class="space-y-5">
    <NuxtLink to="/admin" :class="linkClass(overviewActive)">
      <UIcon name="i-lucide-layout-grid" class="size-4 shrink-0" />
      Overview
    </NuxtLink>

    <div v-for="section in visibleSections" :key="section.label" class="space-y-1">
      <!-- Single config domain with subsections: section name is the group header. -->
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

      <!-- Multi-entry sections: same collapsible group + nested links (e.g. Jurisdiction & hierarchy). -->
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
            <li v-for="(entry, i) in section.entries" :key="i">
              <template v-if="entry.type === 'page'">
                <NuxtLink :to="entry.to" :class="linkClass(pageActive(entry.to), 'sm')">
                  {{ entry.label }}
                </NuxtLink>
              </template>
              <template v-else-if="domainMeta(entry.domain)?.subsections?.length">
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
