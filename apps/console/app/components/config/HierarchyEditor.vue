<script setup lang="ts">
/**
 * Dedicated form for CD-02 Administrative hierarchy.
 * Levels are collapsible cards, ordered top level first, reorderable by
 * drag & drop or arrow buttons. The stored payload keeps the platform
 * convention: array ordered lowest (intake) level first.
 */
interface Level {
  code: string;
  label: string;
  parent_code?: string | null;
  is_intake_default: boolean;
  is_confirmation_authority: boolean;
  can_be_assigned: boolean;
}

const props = defineProps<{ payload: Record<string, any> }>();

/**
 * Parent links are the source of truth shown to the admin; the stored array
 * order must always agree with them (levels[i] is parented by levels[i+1]).
 */
function relink() {
  const list: Level[] = props.payload.levels;
  list.forEach((l, i) => {
    l.parent_code = list[i + 1]?.code ?? null;
  });
}

function ensure() {
  if (!Array.isArray(props.payload.levels) || props.payload.levels.length === 0) {
    props.payload.levels = [
      { code: 'unit', label: 'Unit', is_intake_default: true, is_confirmation_authority: false, can_be_assigned: true },
    ];
  }
  for (const l of props.payload.levels) {
    l.is_intake_default ??= false;
    l.is_confirmation_authority ??= false;
    l.can_be_assigned ??= true;
  }
  relink();
}
ensure();
watch(() => props.payload, ensure, { deep: false });

const levels = computed<Level[]>(() => props.payload.levels);
/** Display order: top level first (stored order is lowest-first). */
const displayed = computed<Level[]>(() => [...levels.value].reverse());

const expanded = ref<Set<Level>>(new Set());
function toggle(level: Level) {
  if (expanded.value.has(level)) expanded.value.delete(level);
  else expanded.value.add(level);
  expanded.value = new Set(expanded.value);
}

/** Reorder in display space, then persist in storage order. */
function moveDisplayed(from: number, to: number) {
  if (to < 0 || to >= displayed.value.length || from === to) return;
  const list = [...displayed.value];
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item!);
  props.payload.levels = list.reverse();
  relink();
}

// --- explicit parent selection ---
const TOP = '__top__';
const parentItems = (level: Level) => [
  { value: TOP, label: 'None — top level' },
  ...levels.value
    .filter((l) => l !== level)
    .map((l) => ({ value: l.code, label: `${l.label || '(unnamed)'} (${l.code || '?'})` })),
];

/** Re-seats the level directly below its chosen parent (or at the top), then relinks the chain. */
function setParent(level: Level, value: string) {
  const list = displayed.value.filter((l) => l !== level);
  if (value === TOP) {
    list.unshift(level);
  } else {
    const pi = list.findIndex((l) => l.code === value);
    if (pi < 0) return;
    list.splice(pi + 1, 0, level);
  }
  props.payload.levels = list.reverse();
  relink();
}

const parentLabel = (level: Level) => {
  const p = levels.value.find((l) => l.code === level.parent_code);
  return p ? p.label || p.code : null;
};

// --- drag & drop ---
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
  if (dragIndex.value !== null) moveDisplayed(dragIndex.value, i);
  dragIndex.value = null;
  dragOverIndex.value = null;
}

function addLevel() {
  // New level is added as the lowest level (start of the stored array, bottom of the display).
  props.payload.levels.unshift({
    code: '',
    label: '',
    is_intake_default: false,
    is_confirmation_authority: false,
    can_be_assigned: true,
  });
  relink();
}
function removeLevel(level: Level) {
  if (levels.value.length <= 1) return;
  props.payload.levels = levels.value.filter((l) => l !== level);
  relink();
}

/** Exactly one intake default: turning one on turns the others off. */
function setIntakeDefault(level: Level, on: boolean) {
  if (on) for (const l of levels.value) l.is_intake_default = l === level;
  else level.is_intake_default = false;
}
</script>

<template>
  <div>
    <p class="text-xs text-muted mb-3">
      Top level first. Each level is explicitly tied to its <b>parent level</b> — pick the parent
      inside a card, or drag to rearrange (links update automatically). Cases route from the
      <b>intake default</b> level upward; exactly one level must carry that flag.
    </p>

    <div class="space-y-2">
      <div
        v-for="(level, i) in displayed"
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
        <!-- Collapsed header -->
        <div class="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none" @click="toggle(level)">
          <UIcon name="i-lucide-grip-vertical" class="text-muted cursor-grab shrink-0" />
          <span class="text-xs text-muted w-5 shrink-0">{{ i + 1 }}.</span>
          <span class="font-medium truncate">{{ level.label || '(unnamed level)' }}</span>
          <UBadge v-if="level.code" size="sm" variant="subtle" color="neutral" class="font-mono">{{ level.code }}</UBadge>
          <span v-if="parentLabel(level)" class="hidden sm:inline text-xs text-muted truncate">
            under {{ parentLabel(level) }}
          </span>
          <div class="hidden sm:flex items-center gap-1">
            <UBadge v-if="level.is_intake_default" size="sm" variant="subtle" color="primary">intake default</UBadge>
            <UBadge v-if="level.is_confirmation_authority" size="sm" variant="subtle" color="warning">confirms closure</UBadge>
            <UBadge v-if="level.can_be_assigned" size="sm" variant="subtle" color="neutral">assignable</UBadge>
          </div>
          <div class="ml-auto flex items-center gap-0.5 shrink-0">
            <UButton size="xs" variant="ghost" icon="i-lucide-chevron-up" :disabled="i === 0" title="Move up" @click.stop="moveDisplayed(i, i - 1)" />
            <UButton size="xs" variant="ghost" icon="i-lucide-chevron-down" :disabled="i === displayed.length - 1" title="Move down" @click.stop="moveDisplayed(i, i + 1)" />
            <UButton
              size="xs" variant="ghost" color="error" icon="i-lucide-trash-2"
              :disabled="displayed.length <= 1"
              :title="displayed.length <= 1 ? 'At least one level must remain' : 'Remove level'"
              @click.stop="removeLevel(level)"
            />
            <UIcon :name="expanded.has(level) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="text-muted ml-1" />
          </div>
        </div>

        <!-- Expanded details -->
        <div v-if="expanded.has(level)" class="border-t border-default px-4 py-3 space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <UFormField label="Label" required help="Shown to staff and the public, e.g. County.">
              <UInput v-model="level.label" class="w-full" />
            </UFormField>
            <UFormField label="Code" required help="Stable identifier used by units and workflow rules.">
              <UInput
                v-model="level.code"
                class="w-full font-mono"
                placeholder="e.g. county"
                @update:model-value="relink()"
              />
            </UFormField>
          </div>
          <UFormField
            label="Parent level"
            help="The level this one reports to. Changing it moves the level directly below its parent."
          >
            <USelectMenu
              :model-value="level.parent_code ?? TOP"
              :items="parentItems(level)"
              value-key="value"
              label-key="label"
              class="w-full sm:w-72"
              @update:model-value="setParent(level, $event as string)"
            />
          </UFormField>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div class="flex items-center justify-between gap-2 text-sm">
              <span>Intake default</span>
              <USwitch :model-value="level.is_intake_default" @update:model-value="setIntakeDefault(level, $event)" />
            </div>
            <div class="flex items-center justify-between gap-2 text-sm">
              <span>Confirms closure</span>
              <USwitch v-model="level.is_confirmation_authority" />
            </div>
            <div class="flex items-center justify-between gap-2 text-sm">
              <span>Can be assigned</span>
              <USwitch v-model="level.can_be_assigned" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <UButton size="xs" variant="soft" icon="i-lucide-plus" class="mt-3" @click="addLevel">Add level (lowest)</UButton>
  </div>
</template>
