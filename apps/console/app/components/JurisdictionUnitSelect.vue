<script setup lang="ts">
const NONE_VALUE = '__none__';

const model = defineModel<string | null>();

const props = withDefaults(
  defineProps<{
    allowNone?: boolean;
    noneLabel?: string;
    placeholder?: string;
  }>(),
  {
    allowNone: true,
    noneLabel: '(no jurisdiction)',
    placeholder: 'Select jurisdiction unit…',
  },
);

const { searchAssignableUnits } = useAssignableUnits();

const searchTerm = ref('');
const results = ref<{ value: string; label: string; description: string }[]>([]);
const selected = ref<{ value: string; label: string; description: string } | null>(null);
const loading = ref(false);
const initialLoaded = ref(false);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

const internalValue = computed({
  get: () => (model.value ? model.value : props.allowNone ? NONE_VALUE : undefined),
  set: (value: string | undefined) => {
    model.value = !value || value === NONE_VALUE ? null : value;
  },
});

const items = computed(() => {
  const list = [...results.value];
  if (props.allowNone) {
    list.unshift({ value: NONE_VALUE, label: props.noneLabel, description: '' });
  }
  if (selected.value && !list.some((i) => i.value === selected.value!.value)) {
    list.splice(props.allowNone ? 1 : 0, 0, selected.value);
  }
  return list;
});

const emptyMessage = computed(() => {
  if (loading.value) return 'Loading units…';
  if (!initialLoaded.value) return 'Loading units…';
  const term = searchTerm.value.trim();
  if (term.length >= 2) return `No units match "${term}".`;
  return 'No jurisdiction units found. Import units under Admin → Configuration → Administrative hierarchy.';
});

async function resolveSelection(id: string | null | undefined) {
  if (!id) {
    selected.value = null;
    return;
  }
  if (selected.value?.value === id) return;
  try {
    const rows = await searchAssignableUnits({ id });
    selected.value = rows[0] ?? null;
  } catch {
    selected.value = null;
  }
}

async function loadBrowseList() {
  loading.value = true;
  try {
    results.value = await searchAssignableUnits({ limit: 40 });
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
      results.value = await searchAssignableUnits({ q: term });
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
  internalValue.value = value;
  if (value !== NONE_VALUE) {
    selected.value = items.value.find((i) => i.value === value) ?? selected.value;
  }
}
</script>

<template>
  <div class="w-full min-w-0 max-w-full [&_button]:max-w-full [&_button]:truncate">
    <USelectMenu
      :model-value="internalValue"
      v-model:search-term="searchTerm"
      :items="items"
      value-key="value"
      label-key="label"
      description-key="description"
      ignore-filter
      :search-input="{
        placeholder: 'Search unit name…',
        loading,
      }"
      :placeholder="placeholder"
      class="w-full max-w-full"
      @update:model-value="onSelect"
    >
      <template #empty>
        <div class="px-3 py-2 text-sm text-muted text-center">{{ emptyMessage }}</div>
      </template>
    </USelectMenu>
  </div>
</template>
