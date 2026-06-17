<script setup lang="ts">
const model = defineModel<string>();

const { searchIntakeUnits } = useAssistedIntake();

const searchTerm = ref('');
const results = ref<{ value: string; label: string; description: string }[]>([]);
const selected = ref<{ value: string; label: string; description: string } | null>(null);
const loading = ref(false);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

const items = computed(() => {
  const list = [...results.value];
  if (selected.value && !list.some((i) => i.value === selected.value!.value)) {
    list.unshift(selected.value);
  }
  return list;
});

async function resolveSelection(id: string | null | undefined) {
  if (!id) {
    selected.value = null;
    return;
  }
  if (selected.value?.value === id) return;
  const rows = await searchIntakeUnits({ id });
  selected.value = rows[0] ?? null;
}

watch(searchTerm, (q) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const term = q.trim();
    if (term.length < 2) {
      results.value = [];
      return;
    }
    loading.value = true;
    try {
      results.value = await searchIntakeUnits({ q: term });
    } finally {
      loading.value = false;
    }
  }, 300);
});

watch(model, (id) => void resolveSelection(id), { immediate: true });

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
        placeholder: 'Type at least 2 characters…',
        loading,
      }"
      placeholder="Search settlement or location…"
      class="w-full max-w-full"
      @update:model-value="onSelect"
    />
  </div>
</template>
