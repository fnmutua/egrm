<script setup lang="ts">
definePageMeta({ layout: 'admin' });

const { api } = useApi();
const { downloadTemplate, downloadExport, importFile, resetAll } = useUnitsImport();
const { user, fetchMe } = useAuth();
const toast = useToast();

interface Unit {
  id: string;
  levelCode: string;
  parentId: string | null;
  name: string;
  code: string;
  active: boolean;
  childCount?: number;
}
interface Level {
  code: string;
  label: string;
  allows_intake?: boolean;
  is_intake_default?: boolean;
}
interface UnitsSummary {
  total: number;
  roots: number;
  by_level: Record<string, number>;
}

const summary = ref<UnitsSummary | null>(null);
const unitIndex = ref(new Map<string, Unit>());
/** Cached children by parent id ('root' = top level). */
const childrenCache = ref(new Map<string, Unit[]>());
/** Ordered lowest-first (platform convention from CD-02). */
const levels = ref<Level[]>([]);
const loadingChildren = ref<Set<string>>(new Set());

async function loadHierarchy() {
  const h = await api<{ payload: { levels: Level[] } }>('/api/v1/config/cd02_hierarchy');
  levels.value = h.payload.levels;
}

async function loadSummary() {
  summary.value = await api<UnitsSummary>('/api/v1/units/summary');
}

async function fetchChildren(parentId: string | null, force = false) {
  const key = parentId ?? 'root';
  if (!force && childrenCache.value.has(key)) {
    return childrenCache.value.get(key)!;
  }
  const query = parentId ? `?parent_id=${parentId}` : '?roots=1';
  const { units: rows } = await api<{ units: Unit[] }>(`/api/v1/units${query}`);
  const next = new Map(childrenCache.value);
  next.set(key, rows);
  childrenCache.value = next;
  const idx = new Map(unitIndex.value);
  for (const u of rows) idx.set(u.id, u);
  unitIndex.value = idx;
  return rows;
}

function invalidateBranch(parentId: string | null) {
  const next = new Map(childrenCache.value);
  next.delete(parentId ?? 'root');
  childrenCache.value = next;
}

async function refreshTree() {
  childrenCache.value = new Map();
  unitIndex.value = new Map();
  expanded.value = new Set();
  await Promise.all([loadSummary(), loadHierarchy()]);
  await fetchChildren(null, true);
}

async function load() {
  await refreshTree();
}

// Level codes are matched case-insensitively: they are admin-entered and may
// drift in casing between the hierarchy config and stored unit rows.
const levelLabel = (code: string) =>
  levels.value.find((l) => l.code.toLowerCase() === code.toLowerCase())?.label ?? code;
const levelIndex = (code: string) =>
  levels.value.findIndex((l) => l.code.toLowerCase() === code.toLowerCase());
/** Child level of a given level (one step down the hierarchy), if any. */
const childLevelOf = (code: string): Level | undefined => {
  const idx = levelIndex(code);
  return idx > 0 ? levels.value[idx - 1] : undefined;
};
const topLevel = computed(() => levels.value[levels.value.length - 1]);

const childrenOf = (parentId: string | null) => childrenCache.value.get(parentId ?? 'root') ?? [];

// --- expandable tree table ---
const expanded = ref<Set<string>>(new Set());
async function toggleExpand(id: string) {
  if (expanded.value.has(id)) {
    expanded.value.delete(id);
  } else {
    loadingChildren.value.add(id);
    try {
      await fetchChildren(id);
      expanded.value.add(id);
    } finally {
      loadingChildren.value.delete(id);
    }
  }
  expanded.value = new Set(expanded.value);
}
function expandAll() {
  toast.add({
    title: 'Expand all disabled for large trees',
    description: 'Expand counties or wards individually to load children on demand.',
    color: 'neutral',
  });
}
function collapseAll() {
  expanded.value = new Set();
}

/** Rows currently visible: roots plus children of expanded rows. */
const visibleRows = computed(() => {
  const rows: { unit: Unit; depth: number; childCount: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const u of childrenOf(parentId)) {
      const childCount = u.childCount ?? 0;
      rows.push({ unit: u, depth, childCount });
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
    invalidateBranch(modalParent.value?.id ?? null);
    await loadSummary();
    if (modalParent.value) await fetchChildren(modalParent.value.id, true);
    else await fetchChildren(null, true);
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
  invalidateBranch(u.parentId);
  if (u.parentId) await fetchChildren(u.parentId, true);
  else await fetchChildren(null, true);
}

/** Only one top-level unit may exist (single-root rule). */
const hasRoot = computed(() => (summary.value?.roots ?? 0) > 0);

const canPromote = (u: Unit) => {
  if (levelIndex(u.levelCode) >= levels.value.length - 1) return false;
  const parent = u.parentId ? unitIndex.value.get(u.parentId) : undefined;
  const newParentId = parent?.parentId ?? null;
  if (newParentId !== null) return true;
  return (summary.value?.roots ?? 0) === 0;
};
const promoteTooltip = (u: Unit) => {
  if (levelIndex(u.levelCode) >= levels.value.length - 1) return 'Already at the top level';
  if (!canPromote(u)) return 'Cannot promote: only one top-level unit is allowed';
  return `Promote to ${levels.value[levelIndex(u.levelCode) + 1]?.label} (subtree moves with it)`;
};
/** Demotion shifts the whole subtree down one level. */
const canDemote = (u: Unit) => levelIndex(u.levelCode) > 0;

const demoteParentOptions = ref<Unit[]>([]);

async function loadDemoteParents(u: Unit) {
  const { units: candidates } = await api<{ units: Unit[] }>(
    `/api/v1/units?level_code=${encodeURIComponent(u.levelCode)}`,
  );
  demoteParentOptions.value = candidates.filter((c) => c.id !== u.id && c.active);
}

async function promote(u: Unit) {
  try {
    await api(`/api/v1/units/${u.id}/promote`, { method: 'POST', body: {} });
    toast.add({ title: `"${u.name}" promoted to ${levelLabel(levels.value[levelIndex(u.levelCode) + 1]!.code)}`, color: 'success' });
    await refreshTree();
  } catch (e: unknown) {
    const data = (e as { data?: { error?: string } }).data;
    toast.add({ title: data?.error ?? 'Promote failed', color: 'error' });
  }
}

// --- delete (leaf units only) ---
const deleteOpen = ref(false);
const deleteUnit = ref<Unit | null>(null);
const deleting = ref(false);

function openDelete(u: Unit) {
  deleteUnit.value = u;
  deleteOpen.value = true;
}

async function confirmDelete() {
  if (!deleteUnit.value) return;
  deleting.value = true;
  try {
    await api(`/api/v1/units/${deleteUnit.value.id}`, { method: 'DELETE' });
    toast.add({ title: `"${deleteUnit.value.name}" deleted`, color: 'success' });
    deleteOpen.value = false;
    invalidateBranch(deleteUnit.value.parentId);
    await loadSummary();
    if (deleteUnit.value.parentId) await fetchChildren(deleteUnit.value.parentId, true);
    else await fetchChildren(null, true);
  } catch (e: unknown) {
    const data = (e as { data?: { error?: string } }).data;
    const reasons: Record<string, string> = {
      has_children: 'This unit still has child units.',
      has_cases: 'Cases are attached to this unit. Deactivate it instead.',
      has_role_assignments: 'Staff roles are scoped to this unit. Deactivate it instead.',
    };
    toast.add({ title: 'Cannot delete', description: reasons[data?.error ?? ''] ?? data?.error ?? 'Delete failed', color: 'error' });
  } finally {
    deleting.value = false;
  }
}

const demoteOpen = ref(false);
const demoteUnit = ref<Unit | null>(null);
const demoteParentId = ref<string | null>(null);
const demoting = ref(false);

const importInput = ref<HTMLInputElement | null>(null);
const importing = ref(false);
const importResultOpen = ref(false);
const importResult = ref<{ created: number; skipped: number; errors: { row: number; message: string }[] } | null>(null);

const resetOpen = ref(false);
const resetting = ref(false);

async function confirmReset() {
  resetting.value = true;
  try {
    const result = await resetAll();
    resetOpen.value = false;
    expanded.value = new Set();
    await refreshTree();
    const parts = [`${result.units} unit(s) removed`];
    if (result.casesUnlinked > 0) parts.push(`${result.casesUnlinked} case(s) unlinked`);
    if (result.rolesCleared > 0) parts.push(`${result.rolesCleared} role scope(s) cleared`);
    toast.add({
      title: 'Units reset',
      description: parts.join(' · '),
      color: 'success',
    });
  } catch (e: unknown) {
    const data = (e as { data?: { error?: string; message?: string } }).data;
    toast.add({ title: data?.error ?? 'Reset failed', description: data?.message, color: 'error' });
  } finally {
    resetting.value = false;
  }
}

function openImportPicker() {
  importInput.value?.click();
}

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  importing.value = true;
  try {
    const result = await importFile(file);
    importResult.value = result;
    importResultOpen.value = true;
    if (result.created > 0) {
      toast.add({
        title: `Imported ${result.created} unit(s)`,
        description: result.skipped > 0 ? `${result.skipped} existing path(s) reused` : undefined,
        color: 'success',
      });
      await refreshTree();
    } else if (result.errors.length === 0) {
      toast.add({ title: 'No new units to import', color: 'neutral' });
    }
  } catch (e: unknown) {
    const data = (e as { data?: { error?: string; errors?: { row: number; message: string }[]; message?: string } }).data;
    importResult.value = {
      created: 0,
      skipped: 0,
      errors: data?.errors ?? [{ row: 0, message: data?.message ?? data?.error ?? 'Import failed' }],
    };
    importResultOpen.value = true;
    toast.add({ title: data?.error ?? 'Import failed', color: 'error' });
  } finally {
    importing.value = false;
  }
}

async function downloadTemplateFile() {
  try {
    await downloadTemplate();
  } catch {
    toast.add({ title: 'Could not download template', color: 'error' });
  }
}

async function exportUnitsFile() {
  try {
    await downloadExport();
  } catch {
    toast.add({ title: 'Could not export units', color: 'error' });
  }
}

function openDemote(u: Unit) {
  demoteUnit.value = u;
  demoteParentId.value = null;
  demoteParentOptions.value = [];
  demoteOpen.value = true;
  void loadDemoteParents(u);
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
    await refreshTree();
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
  await refreshTree();
});
</script>

<template>
  <div v-if="user" class="p-4 sm:p-8">
    <div class="flex items-start justify-between gap-3 mb-1 flex-wrap">
      <h1 class="text-2xl font-semibold">Jurisdiction units</h1>
      <div class="flex flex-wrap items-center gap-2">
        <UButton variant="outline" color="neutral" icon="i-lucide-download" @click="downloadTemplateFile">
          Download template
        </UButton>
        <UButton
          v-if="(summary?.total ?? 0) > 0"
          variant="outline"
          color="neutral"
          icon="i-lucide-sheet"
          @click="exportUnitsFile"
        >
          Export Excel
        </UButton>
        <UButton
          variant="outline"
          color="neutral"
          icon="i-lucide-upload"
          :loading="importing"
          @click="openImportPicker"
        >
          Import Excel
        </UButton>
        <input
          ref="importInput"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          class="hidden"
          @change="onImportFile"
        />
        <UButton
          v-if="(summary?.total ?? 0) > 0"
          variant="outline"
          color="error"
          icon="i-lucide-rotate-ccw"
          @click="resetOpen = true"
        >
          Reset all units
        </UButton>
        <UButton v-if="topLevel && !hasRoot" icon="i-lucide-plus" @click="openCreate(null)">
          Add {{ topLevel.label }}
        </UButton>
      </div>
    </div>
    <p class="text-muted mb-2">
      Instances of the configured hierarchy levels
      ({{ [...levels].reverse().map((l) => l.label).join(' → ') }}). Cases route and escalate along this tree.
    </p>
    <p class="text-sm text-muted mb-6">
      Bulk load via Excel only (not seeded). Download template uses your CD-02 hierarchy (one sheet per level).
      KISIP tenants get the full pre-filled workbook from <code class="text-xs">specs/adminunits</code>
      (47 counties, 290 sub-counties, 1,450 wards, 1,034 settlements).
    </p>

    <p v-if="summary && summary.total > 0" class="text-sm text-muted mb-4">
      {{ summary.total.toLocaleString() }} units loaded —
      expand a row to fetch children on demand (faster for large imports).
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
                    v-if="row.childCount > 0 || levelIndex(row.unit.levelCode) > 0"
                    size="xs" variant="ghost" color="neutral"
                    :icon="expanded.has(row.unit.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                    :loading="loadingChildren.has(row.unit.id)"
                    :title="row.childCount > 0 ? `${row.childCount} child unit(s)` : 'Expand to load children'"
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
                    :title="promoteTooltip(row.unit)"
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
                  <UButton
                    size="xs" variant="ghost" color="error" icon="i-lucide-trash-2"
                    :disabled="row.childCount > 0"
                    :title="row.childCount > 0 ? 'Cannot delete: has child units' : 'Delete'"
                    @click="openDelete(row.unit)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>

    <!-- Reset all units modal -->
    <UModal
      v-model:open="resetOpen"
      title="Reset all jurisdiction units?"
      description="Permanently deletes the entire unit tree for this tenant. Cases are kept but lose their unit link; staff role unit scoping is cleared. Re-import from Excel afterward."
    >
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton variant="ghost" color="neutral" @click="resetOpen = false">Cancel</UButton>
          <UButton :loading="resetting" color="error" @click="confirmReset">Reset all units</UButton>
        </div>
      </template>
    </UModal>

    <!-- Delete modal -->
    <UModal
      v-model:open="deleteOpen"
      :title="deleteUnit ? `Delete ${deleteUnit.name}?` : 'Delete unit'"
      description="This permanently removes the unit. Units with cases or role assignments cannot be deleted — deactivate those instead."
    >
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton variant="ghost" color="neutral" @click="deleteOpen = false">Cancel</UButton>
          <UButton :loading="deleting" color="error" @click="confirmDelete">Delete</UButton>
        </div>
      </template>
    </UModal>

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
            :items="demoteUnit ? demoteParentOptions.map((u) => ({ value: u.id, label: u.name })) : []"
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

    <!-- Import result modal -->
    <UModal
      v-model:open="importResultOpen"
      title="Import result"
      :description="importResult && importResult.created > 0 ? `${importResult.created} unit(s) created` : undefined"
    >
      <template #body>
        <div v-if="importResult" class="space-y-3 text-sm">
          <p v-if="importResult.skipped > 0" class="text-muted">
            {{ importResult.skipped }} existing location(s) in the file were already in the tree.
          </p>
          <div v-if="importResult.errors.length > 0">
            <p class="font-medium text-error mb-2">Issues ({{ importResult.errors.length }})</p>
            <ul class="max-h-48 overflow-y-auto space-y-1 text-muted font-mono text-xs">
              <li v-for="(err, i) in importResult.errors" :key="i">
                <span v-if="err.row > 0">Row {{ err.row }}:</span> {{ err.message }}
              </li>
            </ul>
          </div>
          <p v-else-if="importResult.created === 0" class="text-muted">No new units were created.</p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end w-full">
          <UButton @click="importResultOpen = false">Close</UButton>
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
