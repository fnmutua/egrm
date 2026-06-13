<script setup lang="ts">
/**
 * CD-06 document types & upload policy (spec 14 §3).
 */
import {
  ATTACHMENT_VISIBILITY,
  DEFAULT_ATTACHMENT_KINDS,
  DEFAULT_ATTACHMENT_POLICY,
  mergeDefaultAttachmentKinds,
} from '@egrm/config-schemas';

interface AttachmentKind {
  code: string;
  label: Record<string, string>;
  default_visibility: string;
  allowed_mime?: string[];
  max_size_mb?: number;
  active: boolean;
  console_allowed?: boolean;
  intake_allowed?: boolean;
}

const MIME_PRESETS = [
  { value: 'application/pdf', label: 'PDF' },
  { value: 'image/jpeg', label: 'JPEG' },
  { value: 'image/png', label: 'PNG' },
  { value: 'image/webp', label: 'WebP' },
  { value: 'application/msword', label: 'Word (.doc)' },
  {
    value: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    label: 'Word (.docx)',
  },
];

const VISIBILITY_ITEMS = [
  { value: 'public', label: 'Public (track portal)' },
  { value: 'staff', label: 'Staff only' },
  { value: 'restricted', label: 'Restricted clearance' },
];

const DUPLICATE_ITEMS = [
  { value: 'off', label: 'Off' },
  { value: 'warn', label: 'Warn' },
  { value: 'block', label: 'Block duplicate' },
];

const props = defineProps<{ payload: Record<string, any>; section?: string }>();
const { api } = useApi();

const show = (id: string) => !props.section || props.section === id;
const locales = ref<string[]>(['en', 'sw']);

onMounted(async () => {
  try {
    const res = await api<{ payload?: { locales?: { enabled?: string[] } } }>('/api/v1/config/cd01_identity');
    if (res.payload?.locales?.enabled?.length) locales.value = res.payload.locales.enabled;
  } catch {
    /* defaults */
  }
  ensure();
});

function localized(): Record<string, string> {
  const o: Record<string, string> = {};
  for (const loc of locales.value) o[loc] = '';
  return o;
}

function ensureKind(k: AttachmentKind) {
  k.label ??= localized();
  for (const loc of locales.value) k.label[loc] ??= '';
  k.default_visibility ??= 'staff';
  k.active ??= true;
  k.console_allowed ??= true;
  k.intake_allowed ??= false;
}

function ensure() {
  const p = props.payload;
  p.attachment_kinds = mergeDefaultAttachmentKinds(p.attachment_kinds as AttachmentKind[] | undefined);
  for (const k of p.attachment_kinds as AttachmentKind[]) ensureKind(k);

  const pol = p.attachment_policy ?? {};
  p.attachment_policy = {
    ...DEFAULT_ATTACHMENT_POLICY,
    ...pol,
    allowed_mime_default:
      pol.allowed_mime_default?.length > 0
        ? pol.allowed_mime_default
        : [...DEFAULT_ATTACHMENT_POLICY.allowed_mime_default],
  };
}

ensure();
watch(() => props.payload, ensure, { deep: false });

const kinds = computed<AttachmentKind[]>(() => props.payload.attachment_kinds ?? []);
const policy = computed(() => props.payload.attachment_policy as Record<string, unknown>);

const kindSelectItems = computed(() =>
  kinds.value
    .filter((k) => k.active !== false)
    .map((k) => ({ value: k.code, label: displayLabel(k) })),
);

const usedCodes = computed(() => new Set(kinds.value.map((k) => k.code)));

function displayLabel(k: AttachmentKind) {
  return k.label?.[locales.value[0] ?? 'en'] || k.label?.en || k.code;
}

function addKind() {
  const k: AttachmentKind = {
    code: '',
    label: localized(),
    default_visibility: 'staff',
    active: true,
  };
  props.payload.attachment_kinds.push(k);
}

function addPreset(code: string) {
  const preset = DEFAULT_ATTACHMENT_KINDS.find((d) => d.code === code);
  if (!preset || usedCodes.value.has(code)) return;
  props.payload.attachment_kinds.push({ ...preset });
}

function removeKind(k: AttachmentKind) {
  if (kinds.value.length <= 1) return;
  props.payload.attachment_kinds = kinds.value.filter((x) => x !== k);
}

const presetOptions = computed(() =>
  DEFAULT_ATTACHMENT_KINDS.filter((d) => !usedCodes.value.has(d.code)).map((d) => ({
    value: d.code,
    label: d.label.en ?? d.code,
  })),
);
</script>

<template>
  <div class="space-y-6">
    <section v-if="show('sec-document-types')" id="sec-document-types" class="space-y-4">
      <div>
        <h3 class="text-lg font-semibold">Document types</h3>
        <p class="text-sm text-muted">
          Kinds used when officers upload files on status updates, investigations, and resolution.
          Workflow transitions reference these codes (CD-04 → required attachments).
        </p>
      </div>

      <div v-if="presetOptions.length" class="flex flex-wrap items-center gap-2">
        <span class="text-xs text-muted">Add preset:</span>
        <UButton
          v-for="opt in presetOptions"
          :key="opt.value"
          size="xs"
          variant="soft"
          color="neutral"
          @click="addPreset(opt.value)"
        >
          {{ opt.label }}
        </UButton>
      </div>

      <div class="space-y-3">
        <UCard v-for="(k, i) in kinds" :key="i" :ui="{ body: 'p-4 space-y-3' }">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="font-medium">{{ displayLabel(k) || '(new type)' }}</div>
            <div class="flex items-center gap-2">
              <label class="flex items-center gap-1.5 text-xs text-muted">
                <UCheckbox v-model="k.active" />
                Active
              </label>
              <label class="flex items-center gap-1.5 text-xs text-muted">
                <UCheckbox v-model="k.console_allowed" />
                Staff console
              </label>
              <label class="flex items-center gap-1.5 text-xs text-muted">
                <UCheckbox v-model="k.intake_allowed" />
                Public intake
              </label>
              <UButton
                v-if="kinds.length > 1"
                size="xs"
                variant="ghost"
                color="error"
                icon="i-lucide-trash-2"
                aria-label="Remove"
                @click="removeKind(k)"
              />
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <UFormField label="Code" required help="Lowercase snake_case — used in workflow config">
              <UInput v-model="k.code" class="w-full font-mono" placeholder="signed_resolution_form" />
            </UFormField>
            <UFormField label="Default visibility">
              <USelectMenu
                v-model="k.default_visibility"
                :items="VISIBILITY_ITEMS"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <UFormField
              v-for="loc in locales"
              :key="loc"
              :label="`Label (${loc})`"
              required
            >
              <UInput v-model="k.label[loc]" class="w-full" />
            </UFormField>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <UFormField label="Allowed file types" help="Leave empty to use global defaults">
              <USelectMenu
                v-model="k.allowed_mime"
                :items="MIME_PRESETS"
                value-key="value"
                label-key="label"
                multiple
                class="w-full"
                placeholder="All default types…"
              />
            </UFormField>
            <UFormField label="Max size (MB)" help="Per file; empty = use global case limit">
              <UInput v-model.number="k.max_size_mb" type="number" min="1" class="w-full" />
            </UFormField>
          </div>
        </UCard>
      </div>

      <UButton variant="soft" icon="i-lucide-plus" @click="addKind">Add document type</UButton>
    </section>

    <section v-if="show('sec-upload-policy')" id="sec-upload-policy" class="space-y-4">
      <div>
        <h3 class="text-lg font-semibold">Upload policy</h3>
        <p class="text-sm text-muted">
          Global limits for attachments at intake, status updates, and standalone uploads.
        </p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <UFormField label="Max files per action">
          <UInput v-model.number="policy.max_files_per_action" type="number" min="1" class="w-full" />
        </UFormField>
        <UFormField label="Max files per case">
          <UInput v-model.number="policy.max_files_per_case" type="number" min="1" class="w-full" />
        </UFormField>
        <UFormField label="Max total case size (MB)">
          <UInput v-model.number="policy.max_total_case_size_mb" type="number" min="1" class="w-full" />
        </UFormField>
        <UFormField label="Duplicate detection">
          <USelectMenu
            v-model="policy.duplicate_detection"
            :items="DUPLICATE_ITEMS"
            value-key="value"
            label-key="label"
            class="w-full"
          />
        </UFormField>
      </div>

      <UFormField label="Default allowed file types">
        <USelectMenu
          v-model="policy.allowed_mime_default"
          :items="MIME_PRESETS"
          value-key="value"
          label-key="label"
          multiple
          class="w-full"
        />
      </UFormField>

      <UFormField
        label="Limit document types in staff console"
        help="Optional whitelist. Leave empty to allow all active types marked for staff console."
      >
        <USelectMenu
          v-model="policy.console_kind_codes"
          :items="kindSelectItems"
          value-key="value"
          label-key="label"
          multiple
          class="w-full"
          placeholder="All staff-console types…"
        />
      </UFormField>

      <UFormField
        v-if="policy.intake_enabled"
        label="Limit document types at intake"
        help="Optional whitelist. Leave empty to allow all active types marked for public intake."
      >
        <USelectMenu
          v-model="policy.intake_kind_codes"
          :items="kindSelectItems"
          value-key="value"
          label-key="label"
          multiple
          class="w-full"
          placeholder="All intake types…"
        />
      </UFormField>

      <div class="flex flex-col gap-3">
        <label class="flex items-center gap-2 text-sm">
          <UCheckbox v-model="policy.block_executable" />
          Block executable and script file types
        </label>
        <label class="flex items-center gap-2 text-sm">
          <UCheckbox v-model="policy.malware_scan" />
          Run malware scan on upload (when scanner is configured)
        </label>
        <label class="flex items-center gap-2 text-sm">
          <UCheckbox v-model="policy.intake_enabled" />
          Allow attachments on public intake form
        </label>
      </div>

      <UFormField v-if="policy.intake_enabled" label="Max files at intake">
        <UInput v-model.number="policy.intake_max_files" type="number" min="1" class="w-full sm:w-48" />
      </UFormField>
    </section>
  </div>
</template>
