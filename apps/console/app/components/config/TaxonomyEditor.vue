<script setup lang="ts">
/**
 * Dedicated form for CD-03 Case taxonomy: categories (collapsible, reorderable
 * cards), sensitivity classes, and the priority ladder. Mutates the payload in
 * place. When `section` is set, only that panel is shown.
 */
interface Category {
  code: string;
  label: Record<string, string>;
  description?: Record<string, string>;
  sensitivity_class?: string;
  active: boolean;
}
interface SensClass {
  code: string;
  label: Record<string, string>;
  description?: Record<string, string>;
  restricted: boolean;
}
interface Priority {
  code: string;
  label: Record<string, string>;
  sla_multiplier: number;
  is_default: boolean;
}

const props = defineProps<{ payload: Record<string, any>; section?: string }>();
const { api } = useApi();

const show = (id: string) => !props.section || props.section === id;

// Locales come from the tenant identity config (CD-01), not this payload.
const locales = ref<string[]>(['en']);
onMounted(async () => {
  try {
    const res = await api<{ payload?: { locales?: { enabled?: string[] } } }>('/api/v1/config/cd01_identity');
    if (res.payload?.locales?.enabled?.length) locales.value = res.payload.locales.enabled;
  } catch {
    /* fall back to en */
  }
  ensure();
});

function localized(): Record<string, string> {
  const o: Record<string, string> = {};
  for (const loc of locales.value) o[loc] = '';
  return o;
}

function ensure() {
  const p = props.payload;
  if (!Array.isArray(p.categories) || p.categories.length === 0) {
    p.categories = [{ code: 'other', label: localized(), active: true }];
  }
  for (const c of p.categories) {
    c.label ??= {};
    c.active ??= true;
    for (const loc of locales.value) c.label[loc] ??= '';
  }
  p.sensitivity_classes ??= [];
  for (const s of p.sensitivity_classes) {
    s.label ??= {};
    s.restricted ??= false;
    for (const loc of locales.value) s.label[loc] ??= '';
  }
  p.priorities ??= [];
  for (const pr of p.priorities) {
    pr.label ??= {};
    pr.sla_multiplier ??= 1;
    pr.is_default ??= false;
    for (const loc of locales.value) pr.label[loc] ??= '';
  }
}
ensure();
watch(() => props.payload, ensure, { deep: false });

const categories = computed<Category[]>(() => props.payload.categories);
const classes = computed<SensClass[]>(() => props.payload.sensitivity_classes);
const priorities = computed<Priority[]>(() => props.payload.priorities);

const display = (label: Record<string, string> | undefined, code: string) =>
  label?.[locales.value[0] ?? 'en'] || label?.en || code || '(unnamed)';

// --- categories: expand / reorder / drag ---
const expanded = ref<Set<Category>>(new Set());
function toggle(c: Category) {
  if (expanded.value.has(c)) expanded.value.delete(c);
  else expanded.value.add(c);
  expanded.value = new Set(expanded.value);
}

function moveCategory(from: number, to: number) {
  if (to < 0 || to >= categories.value.length || from === to) return;
  const list = [...categories.value];
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item!);
  props.payload.categories = list;
}

const dragIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);
function onDragStart(i: number, e: DragEvent) {
  dragIndex.value = i;
  e.dataTransfer!.effectAllowed = 'move';
}
function onDragOver(i: number, e: DragEvent) {
  e.preventDefault();
  dragOverIndex.value = i;
}
function onDrop(i: number) {
  if (dragIndex.value !== null) moveCategory(dragIndex.value, i);
  dragIndex.value = null;
  dragOverIndex.value = null;
}

function addCategory() {
  const c: Category = { code: '', label: localized(), active: true };
  props.payload.categories.push(c);
  expanded.value = new Set([...expanded.value, c]);
}
function removeCategory(c: Category) {
  if (categories.value.length <= 1) return;
  props.payload.categories = categories.value.filter((x) => x !== c);
}

const NONE = '__none__';
const classItems = computed(() => [
  { value: NONE, label: 'Standard (no special handling)' },
  ...classes.value.map((s) => ({ value: s.code, label: `${display(s.label, s.code)}${s.restricted ? ' — restricted' : ''}` })),
]);

// --- sensitivity classes ---
function addClass() {
  props.payload.sensitivity_classes.push({ code: '', label: localized(), restricted: true });
}
function removeClass(s: SensClass) {
  props.payload.sensitivity_classes = classes.value.filter((x) => x !== s);
  // Unbind categories that pointed at the removed class.
  for (const c of categories.value) if (c.sensitivity_class === s.code) delete c.sensitivity_class;
}

// --- priorities ---
function addPriority() {
  props.payload.priorities.push({ code: '', label: localized(), sla_multiplier: 1, is_default: priorities.value.length === 0 });
}
function removePriority(p: Priority) {
  props.payload.priorities = priorities.value.filter((x) => x !== p);
}
function movePriority(from: number, to: number) {
  if (to < 0 || to >= priorities.value.length || from === to) return;
  const list = [...priorities.value];
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item!);
  props.payload.priorities = list;
}
/** At most one default: turning one on turns the others off. */
function setDefaultPriority(p: Priority, on: boolean) {
  if (on) for (const x of priorities.value) x.is_default = x === p;
  else p.is_default = false;
}
</script>

<template>
  <div class="space-y-8">
    <!-- Categories -->
    <section v-show="show('sec-categories')">
      <p class="text-xs text-muted mb-3">
        Categories complainants pick from at intake, in display order — drag to reorder.
        Inactive categories are hidden from the public form but kept for historical cases.
      </p>
      <div class="space-y-2">
        <div
          v-for="(c, i) in categories"
          :key="i"
          class="rounded-lg border border-default bg-default transition"
          :class="{ 'opacity-50': dragIndex === i, 'ring-2 ring-primary/50': dragOverIndex === i && dragIndex !== i }"
          draggable="true"
          @dragstart="onDragStart(i, $event)"
          @dragover="onDragOver(i, $event)"
          @dragleave="dragOverIndex === i && (dragOverIndex = null)"
          @drop="onDrop(i)"
          @dragend="dragIndex = null; dragOverIndex = null"
        >
          <div class="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none" @click="toggle(c)">
            <UIcon name="i-lucide-grip-vertical" class="text-muted cursor-grab shrink-0" />
            <span class="font-medium truncate" :class="{ 'opacity-50 line-through': !c.active }">
              {{ display(c.label, c.code) }}
            </span>
            <UBadge v-if="c.code" size="sm" variant="subtle" color="neutral" class="font-mono">{{ c.code }}</UBadge>
            <UBadge v-if="c.sensitivity_class" size="sm" variant="subtle" color="warning" class="hidden sm:inline-flex">
              {{ c.sensitivity_class }}
            </UBadge>
            <div class="ml-auto flex items-center gap-0.5 shrink-0">
              <UButton size="xs" variant="ghost" icon="i-lucide-chevron-up" :disabled="i === 0" title="Move up" @click.stop="moveCategory(i, i - 1)" />
              <UButton size="xs" variant="ghost" icon="i-lucide-chevron-down" :disabled="i === categories.length - 1" title="Move down" @click.stop="moveCategory(i, i + 1)" />
              <UButton
                size="xs" variant="ghost" color="error" icon="i-lucide-trash-2"
                :disabled="categories.length <= 1"
                :title="categories.length <= 1 ? 'At least one category must remain' : 'Remove category'"
                @click.stop="removeCategory(c)"
              />
              <UIcon :name="expanded.has(c) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="text-muted ml-1" />
            </div>
          </div>

          <div v-if="expanded.has(c)" class="border-t border-default px-4 py-3 space-y-3">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <UFormField
                v-for="loc in locales" :key="loc"
                :label="`Label (${loc})`" :required="loc === locales[0]"
              >
                <UInput v-model="c.label[loc]" class="w-full" />
              </UFormField>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <UFormField label="Code" required help="Stable identifier stored on cases.">
                <UInput v-model="c.code" class="w-full font-mono" placeholder="e.g. land_compensation" />
              </UFormField>
              <UFormField label="Sensitivity class" help="Restricted classes limit who can see case details.">
                <USelectMenu
                  :model-value="c.sensitivity_class ?? NONE"
                  :items="classItems"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                  @update:model-value="$event === NONE ? delete c.sensitivity_class : (c.sensitivity_class = $event as string)"
                />
              </UFormField>
            </div>
            <div class="flex items-center justify-between gap-2 text-sm sm:w-64">
              <span>Active (shown at intake)</span>
              <USwitch v-model="c.active" />
            </div>
          </div>
        </div>
      </div>
      <UButton size="xs" variant="soft" icon="i-lucide-plus" class="mt-3" @click="addCategory">Add category</UButton>
    </section>

    <!-- Sensitivity classes -->
    <section v-show="show('sec-classes')">
      <p class="text-xs text-muted mb-3">
        Named handling policies categories can bind to (e.g. GBV/SEAH, corruption).
        <b>Restricted</b> classes hide complainant details from staff without sensitive-data permissions.
      </p>
      <div class="space-y-2">
        <div v-for="(s, i) in classes" :key="i" class="rounded-lg border border-default px-4 py-3 space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <UFormField
              v-for="loc in locales" :key="loc"
              :label="`Label (${loc})`" :required="loc === locales[0]"
            >
              <UInput v-model="s.label[loc]" class="w-full" />
            </UFormField>
          </div>
          <div class="flex flex-wrap items-end gap-3">
            <UFormField label="Code" required class="grow sm:grow-0 sm:w-56">
              <UInput v-model="s.code" class="w-full font-mono" placeholder="e.g. gbv_seah" />
            </UFormField>
            <div class="flex items-center gap-2 text-sm pb-1.5">
              <span>Restricted handling</span>
              <USwitch v-model="s.restricted" />
            </div>
            <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" class="ml-auto mb-1.5" title="Remove class" @click="removeClass(s)" />
          </div>
        </div>
        <div v-if="classes.length === 0" class="text-sm text-muted">No sensitivity classes defined — all categories use standard handling.</div>
      </div>
      <UButton size="xs" variant="soft" icon="i-lucide-plus" class="mt-3" @click="addClass">Add sensitivity class</UButton>
    </section>

    <!-- Priorities -->
    <section v-show="show('sec-priorities')">
      <p class="text-xs text-muted mb-3">
        Ordered priority ladder (lowest first). The <b>SLA multiplier</b> scales resolution targets —
        0.5 halves the allowed time, 2 doubles it. One priority can be the default for new cases.
      </p>
      <div class="space-y-2">
        <div v-for="(p, i) in priorities" :key="i" class="rounded-lg border border-default px-4 py-3">
          <div class="flex flex-wrap items-end gap-3">
            <UFormField
              v-for="loc in locales" :key="loc"
              :label="`Label (${loc})`" class="grow sm:grow-0 sm:w-44"
            >
              <UInput v-model="p.label[loc]" class="w-full" />
            </UFormField>
            <UFormField label="Code" required class="grow sm:grow-0 sm:w-40">
              <UInput v-model="p.code" class="w-full font-mono" placeholder="e.g. high" />
            </UFormField>
            <UFormField label="SLA ×" class="w-24">
              <UInput v-model.number="p.sla_multiplier" type="number" step="0.1" min="0.1" class="w-full" />
            </UFormField>
            <div class="flex items-center gap-2 text-sm pb-1.5">
              <span>Default</span>
              <USwitch :model-value="p.is_default" @update:model-value="setDefaultPriority(p, $event)" />
            </div>
            <div class="ml-auto flex items-center gap-0.5 pb-1">
              <UButton size="xs" variant="ghost" icon="i-lucide-chevron-up" :disabled="i === 0" title="Move up" @click="movePriority(i, i - 1)" />
              <UButton size="xs" variant="ghost" icon="i-lucide-chevron-down" :disabled="i === priorities.length - 1" title="Move down" @click="movePriority(i, i + 1)" />
              <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" title="Remove priority" @click="removePriority(p)" />
            </div>
          </div>
        </div>
        <div v-if="priorities.length === 0" class="text-sm text-muted">No priorities defined — all cases share the same SLA plan.</div>
      </div>
      <UButton size="xs" variant="soft" icon="i-lucide-plus" class="mt-3" @click="addPriority">Add priority</UButton>
    </section>
  </div>
</template>
