<script setup lang="ts">
/**
 * CD-06 Intake forms: form settings + field catalogue grouped by section.
 * Replaces the recursive JSON editor for a friendlier field-by-field UX.
 */
type FieldSection = 'complainant' | 'grievance' | 'outcome';
type FieldType = 'text' | 'textarea' | 'select' | 'multiselect' | 'date' | 'phone' | 'email' | 'number';

interface IntakeField {
  key: string;
  type: FieldType;
  section: FieldSection;
  enabled: boolean;
  required: boolean;
  label: Record<string, string>;
  help?: Record<string, string>;
  options?: { value: string; label: Record<string, string> }[];
  options_ref?: string;
}

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'select', label: 'Single choice' },
  { value: 'multiselect', label: 'Multiple choice' },
  { value: 'date', label: 'Date' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'number', label: 'Number' },
];

const OPTIONS_REFS = [
  { value: '', label: 'Custom options (defined below)' },
  { value: 'units', label: 'Jurisdiction units (from unit tree)' },
  { value: 'taxonomy:categories', label: 'Grievance categories (from taxonomy)' },
];

/** Standard fields from spec 05 §3 — quick-add presets. */
const FIELD_PRESETS: Omit<IntakeField, 'enabled'>[] = [
  { key: 'name', type: 'text', section: 'complainant', required: true, label: { en: 'Full name', sw: 'Jina kamili' } },
  { key: 'phone', type: 'phone', section: 'complainant', required: true, label: { en: 'Phone number', sw: 'Nambari ya simu' } },
  { key: 'email', type: 'email', section: 'complainant', required: false, label: { en: 'Email (optional)', sw: 'Barua pepe (hiari)' } },
  { key: 'gender', type: 'select', section: 'complainant', required: false, label: { en: 'Gender', sw: 'Jinsia' }, options: [
    { value: 'female', label: { en: 'Female', sw: 'Mwanamke' } },
    { value: 'male', label: { en: 'Male', sw: 'Mwanaume' } },
    { value: 'prefer_not_say', label: { en: 'Prefer not to say', sw: 'Sipendi kusema' } },
  ] },
  { key: 'unit_id', type: 'select', section: 'grievance', required: true, label: { en: 'Settlement / location', sw: 'Makazi / eneo' }, options_ref: 'units' },
  { key: 'categories', type: 'multiselect', section: 'grievance', required: true, label: { en: 'Category', sw: 'Aina' }, options_ref: 'taxonomy:categories' },
  { key: 'date_occurred', type: 'date', section: 'grievance', required: false, label: { en: 'When did it occur?', sw: 'Ilitokea lini?' } },
  { key: 'summary', type: 'text', section: 'grievance', required: true, label: { en: 'Summary', sw: 'Muhtasari' } },
  { key: 'description', type: 'textarea', section: 'grievance', required: true, label: { en: 'Describe your grievance', sw: 'Eleza malalamiko yako' } },
  { key: 'expected_outcome', type: 'textarea', section: 'outcome', required: false, label: { en: 'What outcome do you expect?', sw: 'Unatarajia matokeo gani?' } },
];

const SECTION_META: Record<FieldSection, { title: string; hint: string }> = {
  complainant: {
    title: 'Complainant',
    hint: 'Contact and identity. All fields can be optional when anonymous intake is allowed.',
  },
  grievance: {
    title: 'Grievance details',
    hint: 'What happened, where, and how it is classified.',
  },
  outcome: {
    title: 'Expected outcome',
    hint: 'What the complainant wants resolved.',
  },
};

const props = defineProps<{ payload: Record<string, any>; section?: string }>();
const { api } = useApi();

const show = (id: string) => !props.section || props.section === id;

const locales = ref<string[]>(['en']);

onMounted(async () => {
  try {
    const res = await api<{ payload?: { locales?: { enabled?: string[] } } }>('/api/v1/config/cd01_identity');
    if (res.payload?.locales?.enabled?.length) locales.value = res.payload.locales.enabled;
  } catch {
    /* en only */
  }
  ensure();
});

function localized(): Record<string, string> {
  const o: Record<string, string> = {};
  for (const loc of locales.value) o[loc] = '';
  return o;
}

function ensureField(f: IntakeField) {
  f.enabled ??= true;
  f.required ??= false;
  f.label ??= {};
  for (const loc of locales.value) f.label[loc] ??= '';
  if (f.help) for (const loc of locales.value) f.help[loc] ??= '';
  if (f.options) {
    for (const opt of f.options) {
      opt.label ??= {};
      for (const loc of locales.value) opt.label[loc] ??= '';
    }
  }
}

function ensure() {
  const p = props.payload;
  p.case_type ??= 'grievance';
  p.anonymous_allowed ??= true;
  p.consent_text ??= localized();
  for (const loc of locales.value) p.consent_text[loc] ??= '';
  if (!Array.isArray(p.fields) || p.fields.length === 0) {
    p.fields = FIELD_PRESETS.map((preset) => ({ ...preset, enabled: true }));
  }
  for (const f of p.fields as IntakeField[]) ensureField(f);
}

ensure();
watch(() => props.payload, ensure, { deep: false });

const fields = computed<IntakeField[]>(() => props.payload.fields ?? []);

function fieldsIn(section: FieldSection) {
  return fields.value.filter((f) => f.section === section);
}

function displayLabel(f: IntakeField) {
  return f.label?.[locales.value[0] ?? 'en'] || f.label?.en || f.key || '(unnamed field)';
}

const usedKeys = computed(() => new Set(fields.value.map((f) => f.key)));

const expanded = ref<Set<IntakeField>>(new Set());
function toggle(f: IntakeField) {
  if (expanded.value.has(f)) expanded.value.delete(f);
  else expanded.value.add(f);
  expanded.value = new Set(expanded.value);
}

function rebuildFields(order: FieldSection[]) {
  props.payload.fields = order.flatMap((sec) => fields.value.filter((f) => f.section === sec));
}

function moveField(section: FieldSection, from: number, to: number) {
  const list = [...fieldsIn(section)];
  if (to < 0 || to >= list.length || from === to) return;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item!);
  const order: FieldSection[] = ['complainant', 'grievance', 'outcome'];
  const bySection = Object.fromEntries(order.map((s) => [s, s === section ? list : fieldsIn(s)])) as Record<FieldSection, IntakeField[]>;
  props.payload.fields = order.flatMap((s) => bySection[s]);
}

function addPreset(section: FieldSection, key: string) {
  const preset = FIELD_PRESETS.find((p) => p.key === key);
  if (!preset || usedKeys.value.has(key)) return;
  const f: IntakeField = { ...structuredClone(preset), enabled: true };
  ensureField(f);
  props.payload.fields.push(f);
  expanded.value = new Set([...expanded.value, f]);
}

function addBlank(section: FieldSection) {
  const f: IntakeField = {
    key: '',
    type: 'text',
    section,
    enabled: true,
    required: false,
    label: localized(),
  };
  props.payload.fields.push(f);
  expanded.value = new Set([...expanded.value, f]);
}

function removeField(f: IntakeField) {
  if (fields.value.length <= 1) return;
  props.payload.fields = fields.value.filter((x) => x !== f);
}

function onSectionChange(f: IntakeField, newSection: FieldSection) {
  f.section = newSection;
  rebuildFields(['complainant', 'grievance', 'outcome']);
}

function setHelp(f: IntakeField, loc: string, value: string) {
  f.help ??= localized();
  f.help[loc] = value;
}

function hasOptionsEditor(f: IntakeField) {
  return f.type === 'select' || f.type === 'multiselect';
}

function useLinkedList(f: IntakeField) {
  return Boolean(f.options_ref);
}

function setDataSource(f: IntakeField, ref: string) {
  if (ref) {
    f.options_ref = ref;
    delete f.options;
  } else {
    delete f.options_ref;
    f.options ??= [{ value: '', label: localized() }];
  }
}

function addOption(f: IntakeField) {
  f.options ??= [];
  f.options.push({ value: '', label: localized() });
}

function removeOption(f: IntakeField, opt: { value: string }) {
  if (!f.options || f.options.length <= 1) return;
  f.options = f.options.filter((o) => o !== opt);
}

const presetItems = (section: FieldSection) =>
  FIELD_PRESETS.filter((p) => p.section === section && !usedKeys.value.has(p.key)).map((p) => ({
    value: p.key,
    label: p.label.en ?? p.key,
  }));
</script>

<template>
  <div class="space-y-6">
    <!-- General settings -->
    <section v-if="show('sec-general')" id="sec-general" class="space-y-4">
      <div>
        <h2 class="text-sm font-semibold">Form settings</h2>
        <p class="text-xs text-muted mt-0.5">Case type binding, anonymity, and consent copy shown when PII is collected.</p>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
        <UFormField label="Case type" required help="Must match workflow and numbering (e.g. grievance).">
          <UInput v-model="payload.case_type" class="w-full font-mono" />
        </UFormField>
        <div class="flex items-center justify-between gap-3 sm:pt-6 text-sm">
          <div>
            <span class="font-medium">Allow anonymous intake</span>
            <p class="text-xs text-muted">Complainant section fields become optional on the portal.</p>
          </div>
          <USwitch v-model="payload.anonymous_allowed" />
        </div>
      </div>
      <UFormField label="Consent text" help="Shown when name, phone, or email is collected.">
        <div class="space-y-2 max-w-2xl">
          <div v-for="loc in locales" :key="loc" class="flex items-start gap-2">
            <UBadge size="sm" variant="subtle" color="neutral" class="font-mono mt-2 shrink-0">{{ loc }}</UBadge>
            <UTextarea v-model="payload.consent_text[loc]" class="w-full" :rows="2" />
          </div>
        </div>
      </UFormField>
    </section>

    <!-- Field sections -->
    <section
      v-for="sec in (['complainant', 'grievance', 'outcome'] as FieldSection[])"
      v-show="show(`sec-${sec}`)"
      :id="`sec-${sec}`"
      :key="sec"
      class="space-y-3"
    >
      <div>
        <h2 class="text-sm font-semibold">{{ SECTION_META[sec].title }}</h2>
        <p class="text-xs text-muted mt-0.5">{{ SECTION_META[sec].hint }}</p>
      </div>

      <div class="space-y-2">
        <div
          v-for="(field, i) in fieldsIn(sec)"
          :key="field.key || i"
          class="rounded-lg border border-default bg-default"
        >
          <div class="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none" @click="toggle(field)">
            <span class="font-medium truncate">{{ displayLabel(field) }}</span>
            <UBadge v-if="field.key" size="sm" variant="subtle" color="neutral" class="font-mono shrink-0">{{ field.key }}</UBadge>
            <UBadge size="sm" variant="subtle" color="neutral" class="shrink-0">{{ field.type }}</UBadge>
            <UBadge v-if="!field.enabled" size="sm" variant="subtle" color="warning">hidden</UBadge>
            <UBadge v-if="field.required" size="sm" variant="subtle" color="primary">required</UBadge>
            <div class="ml-auto flex items-center gap-0.5 shrink-0">
              <UButton size="xs" variant="ghost" icon="i-lucide-chevron-up" :disabled="i === 0" @click.stop="moveField(sec, i, i - 1)" />
              <UButton size="xs" variant="ghost" icon="i-lucide-chevron-down" :disabled="i === fieldsIn(sec).length - 1" @click.stop="moveField(sec, i, i + 1)" />
              <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" :disabled="fields.length <= 1" @click.stop="removeField(field)" />
              <UIcon :name="expanded.has(field) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="text-muted" />
            </div>
          </div>

          <div v-if="expanded.has(field)" class="border-t border-default px-4 py-3 space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <UFormField label="Field key" required help="Stable id stored on the case, e.g. summary">
                <UInput v-model="field.key" class="w-full font-mono" placeholder="summary" />
              </UFormField>
              <UFormField label="Input type">
                <USelectMenu v-model="field.type" :items="FIELD_TYPES" value-key="value" label-key="label" class="w-full" />
              </UFormField>
              <UFormField label="Form section">
                <USelectMenu
                  :model-value="field.section"
                  :items="[
                    { value: 'complainant', label: 'Complainant' },
                    { value: 'grievance', label: 'Grievance' },
                    { value: 'outcome', label: 'Expected outcome' },
                  ]"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                  @update:model-value="onSectionChange(field, $event as FieldSection)"
                />
              </UFormField>
            </div>

            <div class="flex flex-wrap gap-6 text-sm">
              <div class="flex items-center gap-2">
                <span>Shown on form</span>
                <USwitch v-model="field.enabled" />
              </div>
              <div class="flex items-center gap-2">
                <span>Required</span>
                <USwitch v-model="field.required" />
              </div>
            </div>

            <div class="space-y-2">
              <p class="text-xs font-medium text-muted uppercase tracking-wide">Labels</p>
              <div v-for="loc in locales" :key="`${field.key}-label-${loc}`" class="grid grid-cols-[3rem_1fr] gap-2 items-center">
                <UBadge size="sm" variant="subtle" color="neutral" class="font-mono justify-center">{{ loc }}</UBadge>
                <UInput v-model="field.label[loc]" class="w-full" />
              </div>
            </div>

            <div class="space-y-2">
              <p class="text-xs font-medium text-muted uppercase tracking-wide">Help text (optional)</p>
              <div v-for="loc in locales" :key="`${field.key}-help-${loc}`" class="grid grid-cols-[3rem_1fr] gap-2 items-center">
                <UBadge size="sm" variant="subtle" color="neutral" class="font-mono justify-center">{{ loc }}</UBadge>
                <UInput :model-value="field.help?.[loc] ?? ''" class="w-full" placeholder="Hint shown below the field" @update:model-value="setHelp(field, loc, $event as string)" />
              </div>
            </div>

            <template v-if="hasOptionsEditor(field)">
              <UFormField label="Choices" help="Link to tenant data or define a fixed list.">
                <USelectMenu
                  :model-value="field.options_ref ?? ''"
                  :items="OPTIONS_REFS"
                  value-key="value"
                  label-key="label"
                  class="w-full max-w-md"
                  @update:model-value="setDataSource(field, $event as string)"
                />
              </UFormField>
              <UAlert
                v-if="useLinkedList(field)"
                color="info"
                variant="subtle"
                :title="field.options_ref === 'units' ? 'Linked to jurisdiction units' : 'Linked to grievance categories'"
                :description="field.options_ref === 'units'
                  ? 'Options are built from the unit tree (Admin → Jurisdiction units).'
                  : 'Options are the active categories in Case taxonomy (CD-03).'"
              />
              <div v-else class="space-y-2">
                <p class="text-xs font-medium text-muted">Custom options</p>
                <div v-for="(opt, oi) in field.options" :key="oi" class="flex flex-wrap items-end gap-2 p-2 rounded border border-default">
                  <UFormField label="Value" class="min-w-28">
                    <UInput v-model="opt.value" class="font-mono w-full" />
                  </UFormField>
                  <UFormField v-for="loc in locales" :key="loc" :label="`Label (${loc})`" class="flex-1 min-w-32">
                    <UInput v-model="opt.label[loc]" class="w-full" />
                  </UFormField>
                  <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="removeOption(field, opt)" />
                </div>
                <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addOption(field)">Add option</UButton>
              </div>
            </template>
          </div>
        </div>
      </div>

      <div v-if="fieldsIn(sec).length === 0" class="text-sm text-muted py-4 text-center border border-dashed border-default rounded-lg">
        No fields in this section yet.
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <UButton
          v-for="preset in presetItems(sec)"
          :key="preset.value"
          size="xs"
          variant="outline"
          icon="i-lucide-plus"
          @click="addPreset(sec, preset.value)"
        >
          {{ preset.label }}
        </UButton>
        <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addBlank(sec)">Custom field</UButton>
      </div>
    </section>
  </div>
</template>
