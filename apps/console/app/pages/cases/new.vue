<script setup lang="ts">
import { hasPermission } from '@egrm/core';
import { apiErrorData, apiErrorMessage } from '~/utils/api-errors';
import { coerceIntakeString } from '~/utils/intake-values';

definePageMeta({ layout: 'shell' });

const { user, fetchMe } = useAuth();
const { loadCaseCount } = useCaseCount();
const toast = useToast();
const { meta, sourceChannels, loadMeta, loadSourceChannels, fieldOptions, submitAssisted } = useAssistedIntake();

const ready = ref(false);
const sourceChannel = ref<string | null>(null);
const anonymous = ref(false);
const consent = ref(false);
const values = reactive<Record<string, unknown>>({});
const notificationChannels = ref<string[]>([]);
const submitting = ref(false);
const error = ref('');

const locale = computed(() => meta.value?.locales.default ?? 'en');
const canFile = computed(() => hasPermission(user.value?.permissions ?? [], 'case:create_assisted'));
const configuredNotifyChannels = computed(() => meta.value?.notification_channels ?? []);

function channelLabel(ch: { label: Record<string, string>; value: string }) {
  return ch.label[locale.value] ?? ch.label.en ?? ch.value;
}

function channelDisabled(ch: { requires: 'phone' | 'email' }): boolean {
  if (ch.requires === 'phone') return !String(values.phone ?? '').trim();
  return !String(values.email ?? '').trim();
}

function toggleNotifyChannel(value: string, on: boolean) {
  if (on) {
    if (!notificationChannels.value.includes(value)) {
      notificationChannels.value = [...notificationChannels.value, value];
    }
  } else {
    notificationChannels.value = notificationChannels.value.filter((v) => v !== value);
  }
}

/** Enable every notification channel the complainant contact details support. */
function applyDefaultNotificationChannels() {
  if (anonymous.value) {
    notificationChannels.value = [];
    return;
  }
  const enabled = configuredNotifyChannels.value
    .filter((ch) => !channelDisabled(ch))
    .map((ch) => ch.value);
  notificationChannels.value = enabled;
}

watch(
  () => [values.phone, values.email, anonymous.value, configuredNotifyChannels.value.length] as const,
  () => applyDefaultNotificationChannels(),
);

const sectionDefs = [
  { key: 'complainant', title: 'Complainant' },
  { key: 'grievance', title: 'Grievance' },
  { key: 'outcome', title: 'Expected outcome & consent' },
] as const;

const visibleSections = computed(() =>
  sectionDefs.filter((s) => s.key !== 'complainant' || !anonymous.value),
);

function fieldsFor(section: string) {
  return meta.value?.fields.filter((f) => f.section === section) ?? [];
}

function fieldFullWidth(f: { type: string }) {
  return f.type === 'textarea';
}

function resolvedSourceChannel(): string | null {
  return (
    coerceIntakeString(sourceChannel.value)
    ?? (sourceChannel.value && typeof sourceChannel.value === 'object' && 'value' in sourceChannel.value
      ? coerceIntakeString((sourceChannel.value as { value: unknown }).value)
      : null)
  );
}

function validate(): boolean {
  error.value = '';
  if (!resolvedSourceChannel()) {
    error.value = 'Select how the grievance was received (source channel).';
    return false;
  }
  for (const section of visibleSections.value) {
    for (const f of fieldsFor(section.key)) {
      if (!f.required) continue;
      const v = values[f.key];
      if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) {
        error.value = `Please fill in: ${f.label[locale.value] ?? f.key}`;
        return false;
      }
    }
  }
  if (!anonymous.value && !consent.value) {
    error.value = 'Consent is required when recording complainant personal data.';
    return false;
  }
  return true;
}

const INTAKE_ERROR_MESSAGES: Record<string, string> = {
  missing_required_fields: 'Please complete all required fields.',
  consent_required: 'Consent is required to process personal data.',
  anonymous_not_allowed: 'Anonymous submissions are not allowed for this programme.',
  unit_not_at_intake_level: 'That location cannot accept grievances. Choose a different settlement.',
  unknown_unit: 'The selected location is not valid.',
  tenant_not_configured: 'Programme intake is not fully configured yet.',
  notification_channels_required: 'Choose at least one notification channel for the complainant.',
  notification_channel_requires_phone: 'SMS/WhatsApp requires a phone number.',
  notification_channel_requires_email: 'Email notifications require an email address.',
  invalid_notification_channel: 'Invalid notification channel selected.',
  notification_channel_not_configured: 'That notification channel is not available.',
  source_channel_required: 'Select how the grievance was received.',
  invalid_body: 'Invalid submission — check all fields and try again.',
};

function submitErrorMessage(e: unknown): string {
  const data = apiErrorData(e);
  const fields = (data?.details as { fields?: string[] } | undefined)?.fields;
  const code = typeof data?.error === 'string' ? data.error : undefined;
  if (code === 'missing_required_fields' && fields?.length) {
    return `Please complete: ${fields.join(', ')}.`;
  }
  return apiErrorMessage(e, INTAKE_ERROR_MESSAGES);
}

async function onSubmit() {
  if (!validate()) return;
  submitting.value = true;
  error.value = '';
  try {
    const res = await submitAssisted({
      source_channel: sourceChannel.value,
      anonymous: anonymous.value,
      consent: consent.value,
      values: {
        ...values,
        notification_channels: anonymous.value ? [] : notificationChannels.value,
      },
    });
    loadCaseCount();
    const ch = resolvedSourceChannel();
    toast.add({
      title: `Case ${res.reference} filed`,
      description: res.possible_duplicates
        ? `Possible duplicate: ${res.possible_duplicates} recent case(s) with the same phone.`
        : ch ? `Channel: ${ch.replace(/_/g, ' ')}` : undefined,
      color: 'success',
    });
    if (res.tracking_pin) {
      toast.add({
        title: 'Anonymous tracking PIN',
        description: `${res.tracking_pin} — share with the complainant; shown once.`,
        color: 'warning',
      });
    }
    await navigateTo(`/cases/${res.case_id}`);
  } catch (e: unknown) {
    error.value = submitErrorMessage(e);
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => {
  if (!(await fetchMe())) {
    await navigateTo('/login');
    return;
  }
  if (!canFile.value) {
    await navigateTo('/cases');
    return;
  }
  await Promise.all([loadMeta(), loadSourceChannels()]);
  if (sourceChannels.value.length === 1) {
    sourceChannel.value = sourceChannels.value[0]!.value;
  }
  applyDefaultNotificationChannels();
  ready.value = true;
});

watch(anonymous, () => {
  consent.value = false;
  applyDefaultNotificationChannels();
});
</script>

<template>
  <div v-if="user && ready" class="relative flex flex-col h-[100dvh] max-h-[100dvh] overflow-hidden bg-default">
    <form class="flex flex-col flex-1 min-h-0" @submit.prevent="onSubmit">
      <div class="flex-1 overflow-y-auto overflow-x-hidden">
        <!-- Sticky title — content scrolls beneath -->
        <header class="sticky top-0 z-20 border-b border-default bg-default px-4 sm:px-6 py-4">
          <div class="flex items-start gap-3 max-w-6xl mx-auto w-full">
            <UButton to="/cases" variant="ghost" icon="i-lucide-arrow-left" size="sm" class="mt-0.5 shrink-0" />
            <div class="min-w-0 flex-1">
              <h1 class="text-xl font-semibold">File assisted case</h1>
              <p class="text-sm text-muted">
                Capture a grievance received in person, by phone, letter, or other assisted channel.
              </p>
            </div>
          </div>
        </header>

        <div class="px-4 sm:px-6 py-4 pb-24">
        <div class="max-w-6xl mx-auto w-full min-w-0">
          <div class="grid grid-cols-1 sm:grid-cols-[repeat(2,minmax(0,1fr))] gap-x-4 gap-y-4 w-full">
            <UAlert
              v-if="sourceChannels.length === 0"
              color="warning"
              title="Assisted intake disabled"
              description="Enable assisted intake and source channels in Admin → Channels."
              class="col-span-1 sm:col-span-2"
            />

            <div class="min-w-0 w-full max-w-full">
              <UFormField label="Submission channel" required help="Stored on the case record." class="w-full min-w-0">
                <USelectMenu
                  v-model="sourceChannel"
                  :items="sourceChannels"
                  value-key="value"
                  label-key="label"
                  placeholder="Select source channel…"
                  class="w-full max-w-full"
                />
              </UFormField>
            </div>

            <div v-if="meta?.anonymous_allowed" class="min-w-0 w-full flex items-end">
              <label class="flex items-center gap-3 cursor-pointer pb-1">
                <USwitch v-model="anonymous" />
                <div class="min-w-0">
                  <div class="text-sm font-medium">Anonymous submission</div>
                  <div class="text-xs text-muted">No PII — issue a one-time tracking PIN.</div>
                </div>
              </label>
            </div>
            <div v-else class="hidden sm:block" />

            <template v-for="section in visibleSections" :key="section.key">
              <h2
                class="col-span-1 sm:col-span-2 text-sm font-semibold uppercase tracking-wide text-muted pt-4 border-t border-default first:border-t-0 first:pt-2"
              >
                {{ section.title }}
              </h2>
              <div
                v-for="f in fieldsFor(section.key)"
                :key="f.key"
                class="min-w-0 w-full max-w-full"
                :class="fieldFullWidth(f) ? 'col-span-1 sm:col-span-2' : ''"
              >
                <IntakeFieldInput
                  v-model="values[f.key]"
                  :field="f"
                  :locale="locale"
                  :options="fieldOptions(f, locale)"
                />
              </div>
              <div v-if="section.key === 'outcome' && !anonymous" class="col-span-1 sm:col-span-2 min-w-0 w-full">
                <UFormField label="Consent" required class="w-full min-w-0">
                  <label class="flex items-start gap-2 text-sm cursor-pointer">
                    <UCheckbox v-model="consent" class="mt-0.5 shrink-0" />
                    <span class="min-w-0">{{ meta?.consent_text[locale] ?? meta?.consent_text.en }}</span>
                  </label>
                </UFormField>
              </div>
              <template v-if="section.key === 'outcome' && !anonymous && configuredNotifyChannels.length">
                <div class="col-span-1 sm:col-span-2 min-w-0 w-full">
                  <div class="text-sm font-medium">Notification channels</div>
                  <p class="text-xs text-muted mt-0.5 mb-2">
                    Enabled automatically when phone or email is entered. Uncheck any the complainant declines.
                  </p>
                </div>
                <label
                  v-for="ch in configuredNotifyChannels"
                  :key="ch.value"
                  class="min-w-0 flex items-center gap-2 text-sm rounded-md border border-default px-3 py-2"
                  :class="channelDisabled(ch) ? 'opacity-40' : 'cursor-pointer hover:bg-elevated/50'"
                >
                  <UCheckbox
                    :model-value="notificationChannels.includes(ch.value)"
                    :disabled="channelDisabled(ch)"
                    @update:model-value="toggleNotifyChannel(ch.value, $event as boolean)"
                  />
                  <span class="truncate">{{ channelLabel(ch) }}</span>
                </label>
              </template>
            </template>
          </div>
        </div>
        </div>
      </div>

      <footer class="absolute bottom-0 inset-x-0 z-20 border-t border-default bg-default px-4 sm:px-6 py-3 space-y-3">
        <UAlert v-if="error" color="error" :title="error" />
        <div class="max-w-6xl mx-auto flex flex-wrap gap-2">
          <UButton type="submit" icon="i-lucide-file-plus" :loading="submitting" :disabled="sourceChannels.length === 0">
            File case
          </UButton>
          <UButton to="/cases" variant="outline">Cancel</UButton>
        </div>
      </footer>
    </form>
  </div>
  <div v-else class="p-6 text-sm text-muted">Loading intake form…</div>
</template>
