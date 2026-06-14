<script setup lang="ts">
const props = defineProps<{ modelValue?: string | null; placeholder?: string }>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();

const search = ref('');
const open = ref(false);

const ICONS = [
  // Cases & intake
  'i-lucide-inbox', 'i-lucide-clipboard-list', 'i-lucide-clipboard-check',
  'i-lucide-clipboard', 'i-lucide-file-text', 'i-lucide-file-check', 'i-lucide-folder-open',
  // People
  'i-lucide-users', 'i-lucide-user', 'i-lucide-user-check', 'i-lucide-user-x',
  'i-lucide-contact', 'i-lucide-hand', 'i-lucide-headphones',
  // Status & workflow
  'i-lucide-check-circle', 'i-lucide-circle-check', 'i-lucide-circle-x', 'i-lucide-circle-alert',
  'i-lucide-alert-circle', 'i-lucide-alert-triangle', 'i-lucide-clock', 'i-lucide-timer',
  'i-lucide-hourglass', 'i-lucide-refresh-cw', 'i-lucide-git-branch',
  // Charts & stats
  'i-lucide-bar-chart-2', 'i-lucide-bar-chart', 'i-lucide-bar-chart-3',
  'i-lucide-pie-chart', 'i-lucide-trending-up', 'i-lucide-trending-down',
  'i-lucide-activity', 'i-lucide-area-chart', 'i-lucide-hash', 'i-lucide-percent',
  // Priority & flags
  'i-lucide-flag', 'i-lucide-star', 'i-lucide-zap', 'i-lucide-flame',
  'i-lucide-alert-octagon', 'i-lucide-award', 'i-lucide-target', 'i-lucide-shield',
  // Location & org
  'i-lucide-map-pin', 'i-lucide-map', 'i-lucide-globe', 'i-lucide-building-2',
  'i-lucide-building', 'i-lucide-home', 'i-lucide-network', 'i-lucide-layers',
  // Communication
  'i-lucide-phone', 'i-lucide-mail', 'i-lucide-message-square', 'i-lucide-radio',
  'i-lucide-mic', 'i-lucide-send', 'i-lucide-link', 'i-lucide-external-link',
  // Misc
  'i-lucide-tag', 'i-lucide-tags', 'i-lucide-scale', 'i-lucide-gavel', 'i-lucide-eye',
  'i-lucide-heart', 'i-lucide-thumbs-up', 'i-lucide-calendar', 'i-lucide-download',
  'i-lucide-layout-dashboard', 'i-lucide-rows-3', 'i-lucide-table', 'i-lucide-square-dashed',
];

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase().replace(/^i-lucide-/, '');
  return q ? ICONS.filter((i) => i.replace('i-lucide-', '').includes(q)) : ICONS;
});

function pick(icon: string) {
  emit('update:modelValue', icon);
  open.value = false;
  search.value = '';
}

function clear(e: MouseEvent) {
  e.stopPropagation();
  emit('update:modelValue', '');
}
</script>

<template>
  <UPopover v-model:open="open" :content="{ align: 'start', side: 'bottom' }">
    <!-- UButton as trigger — properly wired with Reka UI's asChild -->
    <UButton
      color="neutral"
      variant="outline"
      class="w-full justify-start font-mono text-xs gap-2"
    >
      <UIcon
        :name="modelValue || placeholder || 'i-lucide-hash'"
        :class="['size-4 shrink-0', modelValue ? 'text-primary' : 'text-muted']"
      />
      <span class="flex-1 text-left truncate" :class="modelValue ? '' : 'text-muted'">
        {{ modelValue || 'Pick icon…' }}
      </span>
      <UIcon
        v-if="modelValue"
        name="i-lucide-x"
        class="size-3 text-muted hover:text-default"
        @click.stop="clear"
      />
      <UIcon name="i-lucide-chevron-down" class="size-3 text-muted shrink-0" />
    </UButton>

    <template #content>
      <div class="p-2 w-72">
        <UInput
          v-model="search"
          autofocus
          placeholder="Search icons…"
          icon="i-lucide-search"
          size="sm"
          class="mb-2"
        />
        <p v-if="filtered.length === 0" class="py-4 text-center text-xs text-muted">
          No icons match "{{ search }}"
        </p>
        <div v-else class="grid grid-cols-8 gap-0.5 max-h-56 overflow-y-auto">
          <button
            v-for="icon in filtered"
            :key="icon"
            type="button"
            :title="icon.replace('i-lucide-', '')"
            :class="[
              'flex items-center justify-center rounded p-1.5 transition-colors',
              modelValue === icon
                ? 'bg-primary/15 text-primary ring-1 ring-primary/40'
                : 'hover:bg-elevated text-muted hover:text-default',
            ]"
            @click="pick(icon)"
          >
            <UIcon :name="icon" class="size-4" />
          </button>
        </div>
      </div>
    </template>
  </UPopover>
</template>
