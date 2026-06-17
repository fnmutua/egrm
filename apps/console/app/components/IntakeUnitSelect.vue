<script setup lang="ts">
const model = defineModel<string>();

const { searchIntakeUnits } = useAssistedIntake();

const searchTerm = ref('');
const results = ref<{ value: string; label: string; description: string }[]>([]);
const selected = ref<{ value: string; label: string; description: string } | null>(null);
const loading = ref(false);
const initialLoaded = ref(false);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

const items = computed(() => {
  const list = [...results.value];
  if (selected.value && !list.some((i) => i.value === selected.value!.value)) {
    list.unshift(selected.value);
  }
  return list;
});

const emptyMessage = computed(() => {
  if (loading.value) return 'Loading settlements…';
  if (!initialLoaded.value) return 'Loading settlements…';
  if (!items.value.length) {
    return 'No settlements at the configured intake level. Check Admin → Configuration → Administrative hierarchy (allows intake) matches your unit tree.';
  }
  const term = searchTerm.value.trim();
  if (term.length >= 2) return `No settlements match "${term}".`;
  return 'No settlements available.';
});

async function resolveSelection(id: string | null | undefined) {
  if (!id) {
    selected.value = null;
    return;
  }
  if (selected.value?.value === id) return;
  try {
    const rows = await searchIntakeUnits({ id });
    selected.value = rows[0] ?? null;
  } catch {
    selected.value = null;
  }
}

async function loadBrowseList() {
  loading.value = true;
  try {
    results.value = await searchIntakeUnits({ limit: 40 });
  } catch {
    results.value = [];
  } finally {
    loading.value = false;
    initialLoaded.value = true;
  }
}

watch(searchTerm, (q) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const term = q.trim();
    if (term.length < 2) {
      await loadBrowseList();
      return;
    }
    loading.value = true;
    try {
      results.value = await searchIntakeUnits({ q: term });
    } catch {
      results.value = [];
    } finally {
      loading.value = false;
      initialLoaded.value = true;
    }
  }, 300);
});

watch(model, (id) => void resolveSelection(id), { immediate: true });

onMounted(() => void loadBrowseList());

function onSelect(value: string) {
  model.value = value;
  selected.value = items.value.find((i) => i.value === value) ?? selected.value;
}
</script>

<template>
  <div class="w-full min-w-0 max-w-full [&_button]:max-w-full [&_button]:truncate">
    <USelectMenu
      :model-value="model"
      v-model:search-term="searchTerm"
      :items="items"
      value-key="value"
      label-key="label"
      description-key="description"
      ignore-filter
      :search-input="{
        placeholder: 'Search settlement or location…',
        loading,
      }"
      placeholder="Select settlement or location…"
      class="w-full max-w-full"
      @update:model-value="onSelect"
    >
      <template #empty>
        <div class="px-3 py-2 text-sm text-muted text-center">{{ emptyMessage }}</div>
      </template>
    </USelectMenu>
    <p v-if="initialLoaded && !items.length" class="text-xs text-warning mt-1.5">
      Ensure CD-02 intake levels match imported units, or complete the units import (Settlement sheet).
    </p>
  </div>
</template>
