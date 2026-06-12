<script setup lang="ts">
definePageMeta({ layout: 'admin' });

const { api } = useApi();
const { user, fetchMe } = useAuth();
const toast = useToast();

interface Unit {
  id: string;
  levelCode: string;
  parentId: string | null;
  name: string;
  code: string;
  active: boolean;
}
interface Level {
  code: string;
  label: string;
  is_intake_default: boolean;
}

const units = ref<Unit[]>([]);
const levels = ref<Level[]>([]);
const creating = ref(false);
const form = reactive({ level_code: '', parent_id: null as string | null, name: '', code: '' });

async function load() {
  const [u, h] = await Promise.all([
    api<{ units: Unit[] }>('/api/v1/units'),
    api<{ payload: { levels: Level[] } }>('/api/v1/config/cd02_hierarchy'),
  ]);
  units.value = u.units;
  levels.value = h.payload.levels;
}

/** Levels ordered top-down for display (config stores them lowest-first). */
const levelsTopDown = computed(() => [...levels.value].reverse());

const childrenOf = (parentId: string | null) => units.value.filter((u) => u.parentId === parentId);

/** Parent candidates for the level being created = units one level above. */
const parentOptions = computed(() => {
  const idx = levels.value.findIndex((l) => l.code === form.level_code);
  const parentLevel = levels.value[idx + 1]?.code;
  if (!parentLevel) return [];
  return units.value.filter((u) => u.levelCode === parentLevel).map((u) => ({ value: u.id, label: u.name }));
});

const needsParent = computed(() => {
  const idx = levels.value.findIndex((l) => l.code === form.level_code);
  return idx >= 0 && idx < levels.value.length - 1;
});

async function createUnit() {
  creating.value = true;
  try {
    await api('/api/v1/units', {
      method: 'POST',
      body: {
        level_code: form.level_code,
        parent_id: needsParent.value ? form.parent_id : null,
        name: form.name,
        code: form.code,
      },
    });
    toast.add({ title: `Unit "${form.name}" created`, color: 'success' });
    form.name = '';
    form.code = '';
    await load();
  } catch (e: unknown) {
    const data = (e as { data?: { error?: string; details?: unknown } }).data;
    toast.add({ title: data?.error ?? 'Create failed', description: JSON.stringify(data?.details ?? ''), color: 'error' });
  } finally {
    creating.value = false;
  }
}

async function toggleActive(u: Unit) {
  await api(`/api/v1/units/${u.id}`, { method: 'PATCH', body: { active: !u.active } });
  await load();
}

/** Flattened tree rows for rendering with indentation. */
const treeRows = computed(() => {
  const rows: { unit: Unit; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const u of childrenOf(parentId)) {
      rows.push({ unit: u, depth });
      walk(u.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
});

onMounted(async () => {
  const me = await fetchMe();
  if (!me) return navigateTo('/login');
  await load();
});
</script>

<template>
  <div v-if="user" class="p-8 max-w-5xl">
    <h1 class="text-2xl font-semibold mb-1">Jurisdiction units</h1>
    <p class="text-muted mb-6">
      Instances of the configured hierarchy levels
      ({{ levelsTopDown.map((l) => l.label).join(' → ') }}). Cases route and escalate along this tree.
    </p>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <UCard class="lg:col-span-2">
        <template #header><span class="font-medium">Unit tree</span></template>
        <div v-if="treeRows.length === 0" class="text-sm text-muted p-4">No units yet.</div>
        <ul class="space-y-1">
          <li
            v-for="row in treeRows"
            :key="row.unit.id"
            class="flex items-center justify-between rounded px-2 py-1.5 hover:bg-elevated"
            :style="{ paddingLeft: `${row.depth * 1.5 + 0.5}rem` }"
          >
            <div class="flex items-center gap-2 min-w-0">
              <UIcon :name="row.depth === 0 ? 'i-lucide-globe' : row.depth === 1 ? 'i-lucide-map' : 'i-lucide-map-pin'" class="text-primary shrink-0" />
              <span class="font-medium truncate" :class="{ 'opacity-50 line-through': !row.unit.active }">{{ row.unit.name }}</span>
              <UBadge size="sm" variant="subtle" color="neutral">{{ row.unit.levelCode }}</UBadge>
              <span class="text-xs text-muted font-mono">{{ row.unit.code }}</span>
            </div>
            <UButton
              size="xs" variant="ghost"
              :icon="row.unit.active ? 'i-lucide-eye-off' : 'i-lucide-eye'"
              :title="row.unit.active ? 'Deactivate' : 'Reactivate'"
              @click="toggleActive(row.unit)"
            />
          </li>
        </ul>
      </UCard>

      <UCard>
        <template #header><span class="font-medium">Add unit</span></template>
        <form class="space-y-3" @submit.prevent="createUnit">
          <UFormField label="Level" required>
            <USelectMenu
              v-model="form.level_code"
              :items="levelsTopDown.map((l) => ({ value: l.code, label: l.label }))"
              value-key="value" label-key="label" class="w-full" placeholder="Select level…"
            />
          </UFormField>
          <UFormField v-if="needsParent" label="Parent unit" required>
            <USelectMenu
              v-model="form.parent_id"
              :items="parentOptions"
              value-key="value" label-key="label" class="w-full" placeholder="Select parent…"
            />
          </UFormField>
          <UFormField label="Name" required>
            <UInput v-model="form.name" class="w-full" placeholder="e.g. Kisumu" />
          </UFormField>
          <UFormField label="Code" required help="Unique within the tenant, e.g. KE-042">
            <UInput v-model="form.code" class="w-full font-mono" />
          </UFormField>
          <UButton type="submit" block :loading="creating" :disabled="!form.level_code || !form.name || !form.code">
            Create unit
          </UButton>
        </form>
      </UCard>
    </div>
  </div>
</template>
