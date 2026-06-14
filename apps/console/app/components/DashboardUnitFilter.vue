<script setup lang="ts">
import { useDashboardUnitFilter } from '~/composables/useDashboardUnitFilter';

const props = withDefaults(defineProps<{
  /** Isolated cascade state — e.g. `cases` vs default `dashboard`. */
  scope?: string;
  /** When set, first visible level starts here (dashboard config). */
  startLevel?: string | null;
  /** Default for case list: skip hierarchy top and start at the level below. */
  autoSkipTop?: boolean;
}>(), {
  scope: 'dashboard',
  startLevel: undefined,
  autoSkipTop: false,
});

const {
  allLevels,
  levels,
  selections,
  loading,
  initialized,
  hasActiveFilter,
  ALL_VALUE,
  initFilter,
  resetFilter,
  setStartLevel,
  onLevelChange,
  selectItems,
} = useDashboardUnitFilter(props.scope);

function applyStartLevel() {
  if (props.startLevel !== undefined) {
    setStartLevel(props.startLevel);
    return;
  }
  if (props.autoSkipTop && allLevels.value.length > 1) {
    setStartLevel(allLevels.value[1]!.code);
  }
}

/** Progressive cascade — only show the next level after a specific unit is chosen. */
const visibleLevels = computed(() => {
  const result: { level: (typeof levels.value)[number]; idx: number }[] = [];
  for (let i = 0; i < levels.value.length; i++) {
    if (i > 0) {
      const prev = levels.value[i - 1]!;
      const prevSel = selections.value[prev.code];
      if (!prevSel || prevSel === ALL_VALUE) break;
    }
    result.push({ level: levels.value[i]!, idx: i });
  }
  return result;
});

onMounted(async () => {
  if (!initialized.value) await initFilter();
  applyStartLevel();
});

watch(() => props.startLevel, () => applyStartLevel());

watch(allLevels, () => {
  if (props.autoSkipTop && props.startLevel === undefined) applyStartLevel();
}, { deep: true });

defineExpose({ resetFilter });
</script>

<template>
  <div v-if="levels.length" class="flex items-center gap-2 flex-wrap">
    <UIcon v-if="loading" name="i-lucide-loader-2" class="size-4 animate-spin text-muted" />
    <template v-for="{ level, idx } in visibleLevels" :key="level.code">
      <USelectMenu
        :model-value="selections[level.code]"
        :items="selectItems(level.code)"
        value-key="value"
        label-key="label"
        :placeholder="level.label"
        size="sm"
        class="w-full sm:w-44"
        @update:model-value="onLevelChange(level.code, $event as string)"
      />
    </template>
    <UButton
      v-if="hasActiveFilter"
      size="xs"
      variant="ghost"
      icon="i-lucide-x"
      @click="resetFilter"
    >
      Clear unit filter
    </UButton>
  </div>
</template>
