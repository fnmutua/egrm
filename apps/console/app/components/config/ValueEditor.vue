<script setup lang="ts">
import ConfigValueEditor from './ValueEditor.vue';

/**
 * Recursive form editor for any JSON config payload.
 * Renders typed inputs (switch, number, color, text, lists) so admins
 * never have to hand-edit JSON. Objects and arrays are mutated in place;
 * primitive changes are emitted upward.
 */
const props = withDefaults(
  defineProps<{
    modelValue: unknown;
    fieldKey?: string;
    depth?: number;
  }>(),
  { depth: 0, fieldKey: '' },
);

const emit = defineEmits<{ (e: 'update:modelValue', v: unknown): void }>();

const label = computed(() => {
  if (!props.fieldKey) return '';
  const s = props.fieldKey.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
});

type Kind = 'boolean' | 'number' | 'string' | 'null' | 'primitive-array' | 'object-array' | 'object';

const kind = computed<Kind>(() => {
  const v = props.modelValue;
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'string';
  if (Array.isArray(v)) {
    return v.length === 0 || v.every((x) => typeof x === 'string' || typeof x === 'number')
      ? 'primitive-array'
      : 'object-array';
  }
  return 'object';
});

const isColor = computed(
  () =>
    kind.value === 'string' &&
    (/^#[0-9a-fA-F]{6}$/.test(props.modelValue as string) || /(^|_)colou?r/.test(props.fieldKey)),
);
const isLongText = computed(
  () => kind.value === 'string' && ((props.modelValue as string).length > 64 || (props.modelValue as string).includes('\n')),
);

const obj = computed(() => props.modelValue as Record<string, unknown>);
const arr = computed(() => props.modelValue as unknown[]);

function setChild(key: string | number, v: unknown) {
  if (Array.isArray(props.modelValue)) (props.modelValue as unknown[])[key as number] = v;
  else (props.modelValue as Record<string, unknown>)[key as string] = v;
}

// --- object field management (useful for record-like configs, e.g. localized text) ---
const newKey = ref('');
function addField() {
  const k = newKey.value.trim();
  if (!k || k in obj.value) return;
  obj.value[k] = '';
  newKey.value = '';
}
function removeField(key: string) {
  delete obj.value[key];
}

// --- array item management ---
function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
function addArrayItem() {
  if (kind.value === 'primitive-array') arr.value.push('');
  else if (arr.value.length > 0) arr.value.push(deepClone(arr.value[arr.value.length - 1]));
  else arr.value.push({});
}
function removeArrayItem(i: number) {
  arr.value.splice(i, 1);
}
function moveArrayItem(i: number, dir: -1 | 1) {
  const j = i + dir;
  if (j < 0 || j >= arr.value.length) return;
  const tmp = arr.value[i];
  arr.value[i] = arr.value[j]!;
  arr.value[j] = tmp!;
}
</script>

<template>
  <!-- boolean -->
  <div v-if="kind === 'boolean'" class="flex items-center justify-between gap-3 py-1.5">
    <span class="text-sm">{{ label }}</span>
    <USwitch :model-value="modelValue as boolean" @update:model-value="emit('update:modelValue', $event)" />
  </div>

  <!-- number -->
  <UFormField v-else-if="kind === 'number'" :label="label" class="py-1">
    <UInput
      type="number"
      :model-value="modelValue as number"
      class="w-40"
      @update:model-value="emit('update:modelValue', Number($event))"
    />
  </UFormField>

  <!-- color string -->
  <UFormField v-else-if="isColor" :label="label" class="py-1">
    <div class="flex items-center gap-2">
      <input
        type="color"
        :value="modelValue"
        class="h-8 w-10 rounded border border-default cursor-pointer bg-transparent"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <UInput
        :model-value="modelValue as string"
        class="w-32 font-mono"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </div>
  </UFormField>

  <!-- long text -->
  <UFormField v-else-if="isLongText" :label="label" class="py-1">
    <UTextarea
      :model-value="modelValue as string"
      :rows="3"
      autoresize
      class="w-full"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </UFormField>

  <!-- short string / null -->
  <UFormField v-else-if="kind === 'string' || kind === 'null'" :label="label" class="py-1">
    <UInput
      :model-value="(modelValue as string) ?? ''"
      :placeholder="kind === 'null' ? '(empty)' : undefined"
      class="w-full"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </UFormField>

  <!-- array of strings/numbers -->
  <UFormField v-else-if="kind === 'primitive-array'" :label="label" class="py-1">
    <div class="space-y-1.5">
      <div v-for="(item, i) in arr" :key="i" class="flex items-center gap-1.5">
        <UInput
          :model-value="item as string"
          class="flex-1"
          @update:model-value="setChild(i, typeof item === 'number' ? Number($event) : $event)"
        />
        <UButton size="xs" variant="ghost" color="error" icon="i-lucide-x" @click="removeArrayItem(i)" />
      </div>
      <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addArrayItem">Add</UButton>
    </div>
  </UFormField>

  <!-- array of objects -->
  <div v-else-if="kind === 'object-array'" class="py-1">
    <div class="text-sm font-medium mb-2">{{ label }}</div>
    <div class="space-y-3">
      <div v-for="(item, i) in arr" :key="i" class="rounded-lg border border-default p-3 relative">
        <div class="absolute right-2 top-2 flex gap-0.5">
          <UButton size="xs" variant="ghost" icon="i-lucide-chevron-up" :disabled="i === 0" @click="moveArrayItem(i, -1)" />
          <UButton size="xs" variant="ghost" icon="i-lucide-chevron-down" :disabled="i === arr.length - 1" @click="moveArrayItem(i, 1)" />
          <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="removeArrayItem(i)" />
        </div>
        <div class="text-xs text-muted mb-2">#{{ i + 1 }}</div>
        <ConfigValueEditor :model-value="item" :depth="depth + 1" @update:model-value="setChild(i, $event)" />
      </div>
      <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addArrayItem">Add item</UButton>
    </div>
  </div>

  <!-- object -->
  <div v-else :class="depth > 0 ? 'border-l-2 border-default pl-4 py-1' : ''">
    <div v-if="label" class="text-sm font-medium mb-1.5">{{ label }}</div>
    <div v-if="Object.keys(obj).length === 0" class="text-xs text-muted italic mb-2">No fields yet.</div>
    <div class="space-y-1">
      <div v-for="(v, k) in obj" :key="k" class="group relative">
        <ConfigValueEditor :model-value="v" :field-key="String(k)" :depth="depth + 1" @update:model-value="setChild(String(k), $event)" />
        <UButton
          size="xs" variant="ghost" color="error" icon="i-lucide-x"
          class="absolute -right-1 top-1 opacity-0 group-hover:opacity-100 transition"
          :title="`Remove field '${k}'`"
          @click="removeField(String(k))"
        />
      </div>
    </div>
    <div class="flex items-center gap-1.5 mt-2">
      <UInput v-model="newKey" size="xs" placeholder="new_field_key" class="w-40 font-mono" @keydown.enter.prevent="addField" />
      <UButton size="xs" variant="ghost" icon="i-lucide-plus" :disabled="!newKey.trim()" @click="addField">Add field</UButton>
    </div>
  </div>
</template>
