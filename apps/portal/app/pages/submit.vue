<script setup lang="ts">
const { meta, loadMeta, fieldOptions, submit } = useIntake();
const { p: identity, t: tIdentity } = usePortalIdentity();

await loadMeta();

const locale = computed(() => meta.value?.locales.default ?? 'en');
const anonymous = ref(false);
const consent = ref(false);
const values = reactive<Record<string, unknown>>({});
const notificationChannels = ref<string[]>([]);
const pendingFiles = ref<{ id: string; file: File; kind: string }[]>([]);
const defaultAttachmentKind = ref('evidence');
const attachmentInput = ref<HTMLInputElement | null>(null);
const step = ref(0);
const error = ref('');
const submitting = ref(false);
const result = ref<{ reference: string; tracking_pin?: string } | null>(null);

const configuredChannels = computed(() => meta.value?.notification_channels ?? []);

const attachmentsEnabled = computed(() => meta.value?.attachments?.enabled && (meta.value?.attachments?.kinds?.length ?? 0) > 0);
const attachmentKinds = computed(() => meta.value?.attachments?.kinds ?? []);
const maxAttachmentFiles = computed(() => meta.value?.attachments?.max_files ?? 5);

const attachmentKindItems = computed(() =>
  attachmentKinds.value.map((k) => ({
    value: k.code,
    label: k.label[locale.value] ?? k.label.en ?? k.code,
  })),
);

watch(attachmentKinds, (kinds) => {
  if (kinds.length && !kinds.some((k) => k.code === defaultAttachmentKind.value)) {
    defaultAttachmentKind.value = kinds[0]!.code;
  }
}, { immediate: true });

function attachmentKindLabel(code: string) {
  const k = attachmentKinds.value.find((x) => x.code === code);
  return k?.label[locale.value] ?? k?.label.en ?? code;
}

function onAttachmentFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const selected = [...(input.files ?? [])];
  input.value = '';
  if (!selected.length) return;

  const room = maxAttachmentFiles.value - pendingFiles.value.length;
  if (room <= 0) {
    error.value = `You can attach at most ${maxAttachmentFiles.value} file(s).`;
    return;
  }

  for (const file of selected.slice(0, room)) {
    pendingFiles.value.push({
      id: crypto.randomUUID(),
      file,
      kind: defaultAttachmentKind.value,
    });
  }
}

function removePendingFile(id: string) {
  pendingFiles.value = pendingFiles.value.filter((f) => f.id !== id);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function channelLabel(ch: { label: Record<string, string>; value: string }) {
  return ch.label[locale.value] ?? ch.label.en ?? ch.value;
}

function channelDisabled(ch: { requires: 'phone' | 'email' }): boolean {
  if (ch.requires === 'phone') return !String(values.phone ?? '').trim();
  return !String(values.email ?? '').trim();
}

function toggleChannel(value: string, on: boolean) {
  if (on) {
    if (!notificationChannels.value.includes(value)) {
      notificationChannels.value = [...notificationChannels.value, value];
    }
  } else {
    notificationChannels.value = notificationChannels.value.filter((v) => v !== value);
  }
}

function validateNotificationChannels(): boolean {
  if (anonymous.value || configuredChannels.value.length === 0) return true;
  if (notificationChannels.value.length > 0) return true;
  error.value = 'Please choose at least one way to receive updates.';
  return false;
}

watch(
  () => [values.phone, values.email, anonymous.value] as const,
  () => {
    notificationChannels.value = notificationChannels.value.filter((picked) => {
      const ch = configuredChannels.value.find((c) => c.value === picked);
      return ch && !channelDisabled(ch);
    });
  },
);

const sections = computed(() => {
  const all = [
    { key: 'complainant', title: 'Your details', skip: anonymous.value },
    { key: 'grievance', title: 'The grievance', skip: false },
    { key: 'documents', title: 'Supporting documents', skip: !attachmentsEnabled.value },
    { key: 'outcome', title: 'Expected outcome & consent', skip: false },
  ] as const;
  return all.filter((s) => !s.skip);
});

const currentSection = computed(() => sections.value[step.value]);
const fieldsFor = (section: string) => meta.value?.fields.filter((f) => f.section === section) ?? [];

function validateStep(): boolean {
  error.value = '';
  const key = currentSection.value!.key;
  if (key === 'documents') return true;
  for (const f of fieldsFor(key)) {
    if (!f.required) continue;
    const v = values[f.key];
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) {
      error.value = `Please fill in: ${f.label[locale.value] ?? f.key}`;
      return false;
    }
  }
  return true;
}

function next() {
  if (validateStep()) step.value++;
}

function submitErrorMessage(e: unknown): string {
  const err = e as {
    data?: { error?: string; message?: string; details?: { fields?: string[] } };
    statusMessage?: string;
    message?: string;
  };
  const code = err.data?.error;
  const messages: Record<string, string> = {
    notification_channels_required: 'Please choose at least one way to receive updates.',
    notification_channel_requires_phone: 'SMS/WhatsApp requires a phone number.',
    notification_channel_requires_email: 'Email notifications require an email address.',
    invalid_notification_channel: 'One of the selected notification channels is invalid.',
    notification_channel_not_configured: 'A selected notification channel is not available.',
    unit_not_at_intake_level: 'That location cannot accept grievances. Choose a different settlement or county.',
    unknown_unit: 'The selected location is not valid. Choose again from the list.',
    missing_required_fields: `Please complete: ${(err.data?.details?.fields ?? []).join(', ') || 'required fields'}.`,
    consent_required: 'Consent is required to process your personal data.',
    anonymous_not_allowed: 'Anonymous submissions are not allowed for this programme.',
    intake_attachments_disabled: 'Document uploads are not enabled for this programme.',
    attachment_kind_not_allowed: 'That document type is not allowed.',
    attachment_policy_violation: 'One or more files exceed size or type limits.',
    tenant_not_configured: 'This programme is not fully configured yet. Try again later.',
  };
  if (code && messages[code]) return messages[code];
  if (err.data?.message) return err.data.message;
  if (err.statusMessage) return err.statusMessage;
  if (err.message?.includes('fetch') || err.message?.includes('Failed to fetch')) {
    return 'Cannot reach the server. Check your connection or try again shortly.';
  }
  return err.message ?? 'Submission failed. Please check your entries and try again.';
}

async function doSubmit() {
  if (!validateStep()) return;
  if (!validateNotificationChannels()) return;
  const needsConsent = !anonymous.value;
  if (needsConsent && !consent.value) {
    error.value = 'Consent is required to process your personal data.';
    return;
  }
  submitting.value = true;
  error.value = '';
  try {
    result.value = await submit({
      anonymous: anonymous.value,
      consent: consent.value,
      values: {
        ...values,
        notification_channels: anonymous.value ? [] : notificationChannels.value,
      },
      files: pendingFiles.value.length
        ? pendingFiles.value.map((f) => ({ file: f.file, kind: f.kind }))
        : undefined,
    });
  } catch (e: unknown) {
    error.value = submitErrorMessage(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen flex flex-col bg-elevated/30">
    <PortalPageHeader />

    <!-- Page intro band -->
    <div class="border-b border-default bg-default">
      <div class="max-w-2xl mx-auto px-4 py-4">
        <div class="flex items-center gap-2.5">
          <UIcon name="i-lucide-file-text" class="text-xl text-primary shrink-0" />
          <h1 class="text-xl font-bold">Submit a grievance</h1>
        </div>
        <p class="text-muted text-sm mt-1 ml-8">
          Free, confidential, and no retaliation.
        </p>
      </div>
    </div>

    <main class="flex-1 py-6 px-4">
      <div class="max-w-2xl mx-auto">

        <!-- Confirmation -->
        <UCard v-if="result">
          <div class="text-center space-y-5 py-6">
            <div class="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto">
              <UIcon name="i-lucide-check-circle" class="text-4xl text-success" />
            </div>
            <div>
              <h2 class="text-xl font-bold mb-1">Grievance received</h2>
              <p class="text-muted text-sm">Your case has been logged and assigned a reference number.</p>
            </div>
            <div class="bg-elevated rounded-xl px-6 py-4 inline-block">
              <div class="text-xs text-muted mb-1 uppercase tracking-wide">Reference number</div>
              <div class="text-3xl font-mono font-bold tracking-widest text-primary">{{ result.reference }}</div>
            </div>
            <UAlert
              v-if="result.tracking_pin"
              color="warning"
              title="Save your tracking PIN now"
              :description="`PIN: ${result.tracking_pin} — shown only once. You need it with your reference number to check the status of this anonymous case.`"
            />
            <p class="text-sm text-muted">
              Save this reference number. Use it on the
              <NuxtLink to="/track" class="underline text-primary">Track status</NuxtLink> page to follow your case.
            </p>
            <div class="flex flex-col sm:flex-row gap-3 justify-center pt-2">
              <UButton to="/track" size="lg">Track this case</UButton>
              <UButton to="/" size="lg" variant="outline">Back to home</UButton>
            </div>
          </div>
        </UCard>

        <!-- Wizard -->
        <template v-else>
          <!-- Anonymous toggle -->
          <div v-if="meta?.anonymous_allowed" class="mb-5">
            <UCard :ui="{ body: 'p-4' }">
              <label class="flex items-center gap-3 cursor-pointer">
                <USwitch v-model="anonymous" @update:model-value="step = 0" />
                <div>
                  <div class="text-sm font-semibold">Submit anonymously</div>
                  <div class="text-xs text-muted mt-0.5">No personal details collected. You'll receive a one-time tracking PIN instead.</div>
                </div>
              </label>
            </UCard>
          </div>

          <!-- Step indicator -->
          <div class="flex items-start mb-6">
            <template v-for="(s, i) in sections" :key="s.key">
              <div class="flex flex-col items-center gap-1.5">
                <div
                  class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors"
                  :class="i < step ? 'bg-success text-inverted' : i === step ? 'bg-primary text-inverted' : 'bg-elevated text-muted'"
                >
                  <UIcon v-if="i < step" name="i-lucide-check" class="text-sm" />
                  <span v-else>{{ i + 1 }}</span>
                </div>
                <span
                  class="text-xs hidden sm:block text-center max-w-20"
                  :class="i === step ? 'text-highlighted font-medium' : 'text-muted'"
                >
                  {{ s.title }}
                </span>
              </div>
              <div
                v-if="i < sections.length - 1"
                class="flex-1 h-0.5 mt-4 mx-2 transition-colors"
                :class="i < step ? 'bg-success' : 'bg-elevated'"
              />
            </template>
          </div>

          <!-- Form card -->
          <UCard>
            <div class="space-y-4">
              <IntakeFieldInput
                v-for="f in fieldsFor(currentSection!.key)"
                :key="f.key"
                v-model="values[f.key]"
                :field="f"
                :locale="locale"
                :options="fieldOptions(f, locale)"
              />

              <!-- Documents step -->
              <div v-if="currentSection?.key === 'documents'" class="space-y-4">
                <p class="text-sm text-muted">
                  Photos, PDFs, or scans that help explain your grievance. This step is optional — you can continue without attaching anything.
                  Up to {{ maxAttachmentFiles }} file(s).
                </p>
                <UFormField label="Document type for next file">
                  <USelectMenu
                    v-model="defaultAttachmentKind"
                    :items="attachmentKindItems"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                  />
                </UFormField>
                <div>
                  <input
                    ref="attachmentInput"
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    class="hidden"
                    :disabled="pendingFiles.length >= maxAttachmentFiles"
                    @change="onAttachmentFileChange"
                  />
                  <UButton
                    variant="soft"
                    icon="i-lucide-paperclip"
                    :disabled="pendingFiles.length >= maxAttachmentFiles"
                    @click="attachmentInput?.click()"
                  >
                    Add files
                  </UButton>
                </div>
                <ul v-if="pendingFiles.length" class="space-y-2">
                  <li
                    v-for="item in pendingFiles"
                    :key="item.id"
                    class="flex flex-wrap items-center justify-between gap-2 text-sm border border-default rounded-md px-3 py-2"
                  >
                    <div class="min-w-0">
                      <div class="truncate font-medium">{{ item.file.name }}</div>
                      <div class="text-xs text-muted">
                        {{ attachmentKindLabel(item.kind) }} · {{ formatFileSize(item.file.size) }}
                      </div>
                    </div>
                    <UButton size="xs" variant="ghost" color="error" @click="removePendingFile(item.id)">Remove</UButton>
                  </li>
                </ul>
                <p v-else class="text-sm text-muted">No files added yet.</p>
              </div>

              <!-- Consent + notification channels on final step -->
              <div v-if="step === sections.length - 1 && !anonymous" class="pt-2 border-t border-default space-y-3">
                <label class="flex items-start gap-2.5 cursor-pointer">
                  <UCheckbox v-model="consent" class="mt-0.5 shrink-0" />
                  <span class="text-sm leading-snug">
                    {{ meta?.consent_text[locale] ?? meta?.consent_text.en }}
                    <NuxtLink to="/policy" class="text-primary hover:underline whitespace-nowrap" @click.stop>
                      ({{ tIdentity(identity?.privacy_policy?.footer_link_label) || (locale === 'sw' ? 'Sera ya faragha' : 'Privacy notice') }})
                    </NuxtLink>
                    ·
                    <NuxtLink to="/delete" class="text-primary hover:underline whitespace-nowrap" @click.stop>
                      ({{ tIdentity(identity?.data_deletion?.footer_link_label) || (locale === 'sw' ? 'Kufuta data' : 'Data deletion') }})
                    </NuxtLink>
                  </span>
                </label>
                <div v-if="configuredChannels.length > 0" class="space-y-2">
                  <div class="text-sm font-medium">How should we notify you?</div>
                  <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
                    <label
                      v-for="ch in configuredChannels"
                      :key="ch.value"
                      class="inline-flex items-center gap-2"
                      :class="channelDisabled(ch) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'"
                    >
                      <UCheckbox
                        :model-value="notificationChannels.includes(ch.value)"
                        :disabled="channelDisabled(ch)"
                        @update:model-value="(on: boolean | 'indeterminate') => toggleChannel(ch.value, on === true)"
                      />
                      <span class="text-sm">{{ channelLabel(ch) }}</span>
                    </label>
                  </div>
                  <p v-if="configuredChannels.some(channelDisabled)" class="text-xs text-muted">
                    Add your phone or email above to enable SMS, WhatsApp, or email notifications.
                  </p>
                </div>
              </div>

              <UAlert v-if="error" color="error" :title="error" />
            </div>

            <template #footer>
              <div class="flex justify-between">
                <UButton v-if="step > 0" variant="outline" @click="step--">Back</UButton>
                <span v-else />
                <UButton v-if="step < sections.length - 1" @click="next">Continue</UButton>
                <UButton v-else :loading="submitting" @click="doSubmit">Submit grievance</UButton>
              </div>
            </template>
          </UCard>

          <p class="text-xs text-muted mt-4 text-center">
            Submission is free of charge. Your information is handled confidentially and you will not face retaliation.
          </p>
        </template>
      </div>
    </main>
  </div>
</template>
