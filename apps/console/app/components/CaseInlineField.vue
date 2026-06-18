<script setup lang="ts">
type FieldType = 'text' | 'textarea' | 'select' | 'multiselect' | 'date' | 'unit';

const props = withDefaults(
  defineProps<{
    label: string;
    display: string;
    value: unknown;
    type?: FieldType;
    options?: { value: string; label: string }[];
    canEdit?: boolean;
    saving?: boolean;
    fullWidth?: boolean;
  }>(),
  {
    type: 'text',
    options: () => [],
    canEdit: false,
    saving: false,
    fullWidth: false,
  },
);

const emit = defineEmits<{ save: [value: unknown] }>();

const editing = ref(false);
const draftText = ref('');
const draftMulti = ref<string[]>([]);
const draftSelect = ref<string | null>(null);
const editRoot = ref<HTMLElement | null>(null);

const selectItems = computed(() => props.options.map((o) => ({ value: o.value, label: o.label })));

const usesSelectSave = computed(() => props.type === 'select' || props.type === 'unit');

let blurTimer: ReturnType<typeof setTimeout> | null = null;

function toDateInput(val: unknown): string {
  if (!val) return '';
  const d = new Date(String(val));
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function getDraftValue(): unknown {
  if (props.type === 'multiselect') return [...draftMulti.value];
  if (props.type === 'select' || props.type === 'unit') return draftSelect.value || null;
  if (props.type === 'date') return draftText.value.trim() || null;
  return draftText.value.trim() || null;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (props.type === 'multiselect') {
    const left = Array.isArray(a) ? [...a].sort().join(',') : '';
    const right = Array.isArray(b) ? [...b].sort().join(',') : '';
    return left === right;
  }
  return String(a ?? '') === String(b ?? '');
}

function syncDraftFromValue() {
  if (props.type === 'multiselect') {
    draftMulti.value = Array.isArray(props.value) ? [...(props.value as string[])] : [];
  } else if (props.type === 'select' || props.type === 'unit') {
    draftSelect.value = props.value ? String(props.value) : null;
  } else if (props.type === 'date') {
    draftText.value = toDateInput(props.value);
  } else {
    draftText.value = props.value == null ? '' : String(props.value);
  }
}

function startEdit() {
  if (!props.canEdit || props.saving) return;
  syncDraftFromValue();
  editing.value = true;
  nextTick(() => {
    const el = editRoot.value?.querySelector('input, textarea, button');
    (el as HTMLElement | null)?.focus();
  });
}

function cancelEdit() {
  editing.value = false;
  syncDraftFromValue();
}

function saveIfChanged() {
  if (!editing.value || props.saving) return;
  const next = getDraftValue();
  if (valuesEqual(next, props.value)) {
    editing.value = false;
    return;
  }
  emit('save', next);
  editing.value = false;
}

function onFieldBlur() {
  if (usesSelectSave.value || props.type === 'multiselect') return;
  saveIfChanged();
}

function onSelectUpdate() {
  if (!usesSelectSave.value) return;
  nextTick(() => saveIfChanged());
}

function onEditFocusIn() {
  if (blurTimer) {
    clearTimeout(blurTimer);
    blurTimer = null;
  }
}

function onEditFocusOut(event: FocusEvent) {
  if (props.type !== 'multiselect') return;
  const root = editRoot.value;
  const related = event.relatedTarget as Node | null;
  if (root && related && root.contains(related)) return;
  blurTimer = setTimeout(() => {
    blurTimer = null;
    saveIfChanged();
  }, 200);
}

function onEditKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    cancelEdit();
  }
}

watch(
  () => props.value,
  () => {
    if (!editing.value) syncDraftFromValue();
  },
);

onBeforeUnmount(() => {
  if (blurTimer) clearTimeout(blurTimer);
});
</script>

<template>
  <div :class="fullWidth ? 'sm:col-span-2' : ''">
    <dt class="text-muted text-xs">{{ label }}</dt>
    <dd class="mt-0.5">
      <div
        v-if="!editing"
        class="group flex items-start gap-2 min-w-0"
        :class="canEdit ? 'cursor-pointer rounded-md -mx-1 px-1 hover:bg-elevated/50' : ''"
        @click="canEdit && !saving ? startEdit() : undefined"
      >
        <span :class="['min-w-0 break-words', type === 'textarea' ? 'whitespace-pre-wrap' : '']">
          {{ display || '—' }}
        </span>
        <UButton
          v-if="canEdit"
          icon="i-lucide-pencil"
          size="xs"
          variant="ghost"
          color="neutral"
          class="shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          :aria-label="`Edit ${label}`"
          :disabled="saving"
          @click.stop="startEdit"
        />
      </div>

      <div
        v-else
        ref="editRoot"
        class="max-w-xl"
        @keydown="onEditKeydown"
        @focusin="onEditFocusIn"
        @focusout="onEditFocusOut"
      >
        <UTextarea
          v-if="type === 'textarea'"
          v-model="draftText"
          :rows="4"
          autoresize
          class="w-full"
          :disabled="saving"
          @blur="onFieldBlur"
        />
        <UInput
          v-else-if="type === 'text'"
          v-model="draftText"
          class="w-full"
          :disabled="saving"
          @blur="onFieldBlur"
          @keyup.enter="saveIfChanged"
        />
        <UInput
          v-else-if="type === 'date'"
          v-model="draftText"
          type="date"
          class="w-full"
          :disabled="saving"
          @blur="onFieldBlur"
        />
        <USelectMenu
          v-else-if="type === 'select'"
          v-model="draftSelect"
          :items="selectItems"
          value-key="value"
          label-key="label"
          class="w-full"
          :disabled="saving"
          @update:model-value="onSelectUpdate"
        />
        <USelectMenu
          v-else-if="type === 'multiselect'"
          v-model="draftMulti"
          :items="selectItems"
          value-key="value"
          label-key="label"
          multiple
          class="w-full"
          :disabled="saving"
        />
        <IntakeUnitSelect
          v-else-if="type === 'unit'"
          v-model="draftSelect"
          @update:model-value="onSelectUpdate"
        />
        <p v-if="saving" class="text-xs text-muted mt-1">Saving…</p>
      </div>
    </dd>
  </div>
</template>
