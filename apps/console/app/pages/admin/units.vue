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
/** Ordered lowest-first (platform convention from CD-02). */
const levels = ref<Level[]>([]);

async function load() {
  const [u, h] = await Promise.all([
    api<{ units: Unit[] }>('/api/v1/units'),
    api<{ payload: { levels: Level[] } }>('/api/v1/config/cd02_hierarchy'),
  ]);
  units.value = u.units;
  levels.value = h.payload.levels;
}

const levelLabel = (code: string) => levels.value.find((l) => l.code === code)?.label ?? code;
const levelIndex = (code: string) => levels.value.findIndex((l) => l.code === code);
/** Child level of a given level (one step down the hierarchy), if any. */
const childLevelOf = (code: string): Level | undefined => {
  const idx = levelIndex(code);
  return idx > 0 ? levels.value[idx - 1] : undefined;
};
const topLevel = computed(() => levels.value[levels.value.length - 1]);

const childrenOf = (parentId: string | null) => units.value.filter((u) => u.parentId === parentId);

// --- expandable tree table ---
const expanded = ref<Set<string>>(new Set());
function toggleExpand(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id);
  else expanded.value.add(id);
  expanded.value = new Set(expanded.value);
}
function expandAll() {
  expanded.value = new Set(units.value.map((u) => u.id));
}
function collapseAll() {
  expanded.value = new Set();
}

/** Rows currently visible: roots plus children of expanded rows. */
const visibleRows = computed(() => {
  const rows: { unit: Unit; depth: number; childCount: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const u of childrenOf(parentId)) {
      const kids = childrenOf(u.id);
      rows.push({ unit: u, depth, childCount: kids.length });
      if (expanded.value.has(u.id)) walk(u.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
});

// --- create / edit modal ---
const modalOpen = ref(false);
const modalMode = ref<'create' | 'edit'>('create');
const modalParent = ref<Unit | null>(null);
const modalUnit = ref<Unit | null>(null);
const form = reactive({ name: '', code: '' });
const saving = ref(false);

const modalLevel = computed(() => {
  if (modalMode.value === 'edit') return modalUnit.value ? levelLabel(modalUnit.value.levelCode) : '';
  const lvl = modalParent.value ? childLevelOf(modalParent.value.levelCode) : topLevel.value;
  return lvl?.label ?? '';
});

function openCreate(parent: Unit | null) {
  modalMode.value = 'create';
  modalParent.value = parent;
  modalUnit.value = null;
  form.name = '';
  form.code = '';
  modalOpen.value = true;
}
function openEdit(unit: Unit) {
  modalMode.value = 'edit';
  modalUnit.value = unit;
  modalParent.value = null;
  form.name = unit.name;
  form.code = unit.code;
  modalOpen.value = true;
}

async function save() {
  saving.value = true;
  try {
    if (modalMode.value === 'create') {
      const lvl = modalParent.value ? childLevelOf(modalParent.value.levelCode) : topLevel.value;
      await api('/api/v1/units', {
        method: 'POST',
        body: {
          level_code: lvl!.code,
          parent_id: modalParent.value?.id ?? null,
          name: form.name,
          code: form.code,
        },
      });
      if (modalParent.value) {
        expanded.value.add(modalParent.value.id);
        expanded.value = new Set(expanded.value);
      }
      toast.add({ title: `Unit "${form.name}" created`, color: 'success' });
    } else if (modalUnit.value) {
      await api(`/api/v1/units/${modalUnit.value.id}`, {
        method: 'PATCH',
        body: { name: form.name, code: form.code },
      });
      toast.add({ title: 'Unit updated', color: 'success' });
    }
    modalOpen.value = false;
    await load();
  } catch (e: unknown) {
    const data = (e as { data?: { error?: string; details?: unknown } }).data;
    toast.add({
      title: data?.error ?? 'Save failed',
      description: data?.details ? JSON.stringify(data.details) : undefined,
      color: 'error',
    });
  } finally {
    saving.value = false;
  }
}

async function toggleActive(u: Unit) {
  await api(`/api/v1/units/${u.id}`, { method: 'PATCH', body: { active: !u.active } });
  await load();
}

// --- promote / demote ---
const subtreeOf = (id: string): Unit[] => {
  const out: Unit[] = [];
  const walk = (pid: string) => {
    for (const c of childrenOf(pid)) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(id);
  return out;
};

const canPromote = (u: Unit) => levelIndex(u.levelCode) < levels.value.length - 1;
/** Demotion shifts the whole subtree down: blocked if anything would drop below the lowest level. */
const canDemote = (u: Unit) => {
  const minIdx = Math.min(levelIndex(u.levelCode), ...subtreeOf(u.id).map((d) => levelIndex(d.levelCode)));
  return minIdx > 0 && demoteParents(u).length > 0;
};
/** Candidate new parents: units at the unit's current level, outside its own subtree. */
const demoteParents = (u: Unit) => {
  const subtreeIds = new Set(subtreeOf(u.id).map((d) => d.id));
  return units.value.filter(
    (c) => c.id !== u.id && !subtreeIds.has(c.id) && c.levelCode === u.levelCode && c.active,
  );
};

async function promote(u: Unit) {
  try {
    await api(`/api/v1/units/${u.id}/promote`, { method: 'POST', body: {} });
    toast.add({ title: `"${u.name}" promoted to ${levelLabel(levels.value[levelIndex(u.levelCode) + 1]!.code)}`, color: 'success' });
    await load();
  } catch (e: unknown) {
    const data = (e as { data?: { error?: string } }).data;
    toast.add({ title: data?.error ?? 'Promote failed', color: 'error' });
  }
}

const demoteOpen = ref(false);
const demoteUnit = ref<Unit | null>(null);
const demoteParentId = ref<string | null>(null);
const demoting = ref(false);

function openDemote(u: Unit) {
  demoteUnit.value = u;
  demoteParentId.value = null;
  demoteOpen.value = true;
}

async function confirmDemote() {
  if (!demoteUnit.value || !demoteParentId.value) return;
  demoting.value = true;
  try {
    await api(`/api/v1/units/${demoteUnit.value.id}/demote`, {
      method: 'POST',
      body: { parent_id: demoteParentId.value },
    });
    toast.add({ title: `"${demoteUnit.value.name}" demoted`, color: 'success' });
    demoteOpen.value = false;
    await load();
  } catch (e: unknown) {
    const data = (e as { data?: { error?: string; details?: unknown } }).data;
    toast.add({ title: data?.error ?? 'Demote failed', description: data?.details ? JSON.stringify(data.details) : undefined, color: 'error' });
  } finally {
    demoting.value = false;
  }
}

onMounted(async () => {
  const me = await fetchMe();
  if (!me) return navigateTo('/login');
  await load();
  // Open the first level by default so the table isn't a single row.
  for (const u of childrenOf(null)) expanded.value.add(u.id);
  expanded.value = new Set(expanded.value);
});
</script>

<template>
  <div v-if="user" class="p-4 sm:p-8 max-w-5xl">
    <div class="flex items-start justify-between gap-3 mb-1 flex-wrap">
      <h1 class="text-2xl font-semibold">Jurisdiction units</h1>
      <UButton v-if="topLevel" icon="i-lucide-plus" @click="openCreate(null)">
        Add {{ topLevel.label }}
      </UButton>
    </div>
    <p class="text-muted mb-6">
      Instances of the configured hierarchy levels
      ({{ [...levels].reverse().map((l) => l.label).join(' → ') }}). Cases route and escalate along this tree.
    </p>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="flex items-center justify-end gap-1 px-4 pt-3">
        <UButton size="xs" variant="ghost" color="neutral" @click="expandAll">Expand all</UButton>
        <UButton size="xs" variant="ghost" color="neutral" @click="collapseAll">Collapse all</UButton>
      </div>
      <div class="overflow-x-auto p-4 pt-2">
        <table class="w-full min-w-[640px] text-sm">
          <thead>
            <tr class="text-left text-muted border-b border-default">
              <th class="py-2 pr-4">Unit</th>
              <th class="py-2 pr-4">Level</th>
              <th class="py-2 pr-4">Code</th>
              <th class="py-2 pr-4">Status</th>
              <th class="py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="visibleRows.length === 0">
              <td colspan="5" class="py-8 text-center text-muted">No units yet — add one to get started.</td>
            </tr>
            <tr
              v-for="row in visibleRows"
              :key="row.unit.id"
              class="border-b border-default last:border-0 hover:bg-elevated/50"
            >
              <td class="py-2 pr-4">
                <div class="flex items-center gap-1" :style="{ paddingLeft: `${row.depth * 1.5}rem` }">
                  <UButton
                    v-if="row.childCount > 0"
                    size="xs" variant="ghost" color="neutral"
                    :icon="expanded.has(row.unit.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                    :title="`${row.childCount} child unit(s)`"
                    @click="toggleExpand(row.unit.id)"
                  />
                  <span v-else class="inline-block w-6" />
                  <span class="font-medium" :class="{ 'opacity-50 line-through': !row.unit.active }">
                    {{ row.unit.name }}
                  </span>
                  <UBadge v-if="row.childCount > 0" size="sm" variant="subtle" color="neutral" class="ml-1">
                    {{ row.childCount }}
                  </UBadge>
                </div>
              </td>
              <td class="py-2 pr-4 capitalize">{{ levelLabel(row.unit.levelCode) }}</td>
              <td class="py-2 pr-4 font-mono text-xs">{{ row.unit.code }}</td>
              <td class="py-2 pr-4">
                <UBadge size="sm" variant="subtle" :color="row.unit.active ? 'success' : 'neutral'">
                  {{ row.unit.active ? 'active' : 'inactive' }}
                </UBadge>
              </td>
              <td class="py-2">
                <div class="flex items-center justify-end gap-0.5">
                  <UButton
                    v-if="childLevelOf(row.unit.levelCode)"
                    size="xs" variant="soft" icon="i-lucide-plus"
                    :title="`Add ${childLevelOf(row.unit.levelCode)!.label} under ${row.unit.name}`"
                    @click="openCreate(row.unit)"
                  >
                    <span class="hidden md:inline">{{ childLevelOf(row.unit.levelCode)!.label }}</span>
                  </UButton>
                  <UButton size="xs" variant="ghost" icon="i-lucide-pencil" title="Edit" @click="openEdit(row.unit)" />
                  <UButton
                    size="xs" variant="ghost" icon="i-lucide-arrow-big-up"
                    :disabled="!canPromote(row.unit)"
                    :title="canPromote(row.unit) ? `Promote to ${levels[levelIndex(row.unit.levelCode) + 1]?.label} (subtree moves with it)` : 'Already at the top level'"
                    @click="promote(row.unit)"
                  />
                  <UButton
                    size="xs" variant="ghost" icon="i-lucide-arrow-big-down"
                    :disabled="!canDemote(row.unit)"
                    :title="canDemote(row.unit) ? `Demote to ${levels[levelIndex(row.unit.levelCode) - 1]?.label} under a new parent` : 'Cannot demote: would fall below the lowest level or no parent available'"
                    @click="openDemote(row.unit)"
                  />
                  <UButton
                    size="xs" variant="ghost"
                    :icon="row.unit.active ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                    :title="row.unit.active ? 'Deactivate' : 'Reactivate'"
                    @click="toggleActive(row.unit)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>

    <!-- Demote modal -->
    <UModal
      v-model:open="demoteOpen"
      :title="demoteUnit ? `Demote ${demoteUnit.name}` : 'Demote'"
      :description="demoteUnit ? `Becomes a ${levels[levelIndex(demoteUnit.levelCode) - 1]?.label} — its whole subtree shifts down one level too.` : undefined"
    >
      <template #body>
        <UFormField :label="demoteUnit ? `New parent (${levelLabel(demoteUnit.levelCode)})` : 'New parent'" required>
          <USelectMenu
            v-model="demoteParentId"
            :items="demoteUnit ? demoteParents(demoteUnit).map((u) => ({ value: u.id, label: u.name })) : []"
            value-key="value"
            label-key="label"
            class="w-full"
            placeholder="Select new parent…"
          />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton variant="ghost" color="neutral" @click="demoteOpen = false">Cancel</UButton>
          <UButton :loading="demoting" :disabled="!demoteParentId" color="warning" @click="confirmDemote">Demote</UButton>
        </div>
      </template>
    </UModal>

    <!-- Create / edit modal -->
    <UModal
      v-model:open="modalOpen"
      :title="modalMode === 'create' ? `Add ${modalLevel}` : `Edit ${modalUnit?.name}`"
      :description="modalMode === 'create' && modalParent ? `Under ${modalParent.name}` : undefined"
    >
      <template #body>
        <form class="space-y-3" @submit.prevent="save">
          <UFormField label="Name" required>
            <UInput v-model="form.name" class="w-full" autofocus />
          </UFormField>
          <UFormField label="Code" required help="Unique within the tenant, e.g. KE-042">
            <UInput v-model="form.code" class="w-full font-mono" />
          </UFormField>
        </form>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton variant="ghost" color="neutral" @click="modalOpen = false">Cancel</UButton>
          <UButton :loading="saving" :disabled="!form.name || !form.code" @click="save">
            {{ modalMode === 'create' ? 'Create' : 'Save' }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
