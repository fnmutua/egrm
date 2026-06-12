<script setup lang="ts">
const { meta, loadMeta, fieldOptions, submit } = useIntake();

await loadMeta();

const locale = computed(() => meta.value?.locales.default ?? 'en');
const anonymous = ref(false);
const consent = ref(false);
const values = reactive<Record<string, unknown>>({});
const step = ref(0);
const error = ref('');
const submitting = ref(false);
const result = ref<{ reference: string; tracking_pin?: string } | null>(null);

const sections = computed(() => {
  const all = [
    { key: 'complainant', title: 'Your details', skip: anonymous.value },
    { key: 'grievance', title: 'The grievance', skip: false },
    { key: 'outcome', title: 'Expected outcome & consent', skip: false },
  ] as const;
  return all.filter((s) => !s.skip);
});

const currentSection = computed(() => sections.value[step.value]);
const fieldsFor = (section: string) => meta.value?.fields.filter((f) => f.section === section) ?? [];

function validateStep(): boolean {
  error.value = '';
  for (const f of fieldsFor(currentSection.value!.key)) {
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

async function doSubmit() {
  if (!validateStep()) return;
  const needsConsent = !anonymous.value;
  if (needsConsent && !consent.value) {
    error.value = 'Consent is required to process your personal data.';
    return;
  }
  submitting.value = true;
  error.value = '';
  try {
    result.value = await submit({ anonymous: anonymous.value, consent: consent.value, values });
  } catch (e: unknown) {
    error.value = 'Submission failed. Please check your entries and try again.';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen bg-elevated/50 py-6 sm:py-10 px-4">
    <div class="max-w-2xl mx-auto">
      <NuxtLink to="/" class="text-sm text-muted hover:underline">&larr; Back to home</NuxtLink>
      <h1 class="text-2xl font-bold mt-2 mb-6">Submit a grievance</h1>

      <!-- Confirmation -->
      <UCard v-if="result">
        <div class="text-center space-y-3 py-4">
          <UIcon name="i-lucide-check-circle" class="text-4xl text-success" />
          <h2 class="text-xl font-semibold">Grievance received</h2>
          <p class="text-muted">Your reference number is</p>
          <div class="text-2xl font-mono font-bold tracking-wider">{{ result.reference }}</div>
          <UAlert
            v-if="result.tracking_pin"
            color="warning"
            title="Save your tracking PIN now"
            :description="`PIN: ${result.tracking_pin} — shown only once. You need it with your reference number to check the status of this anonymous case.`"
          />
          <p class="text-sm text-muted">
            Keep the reference number safe. Use it on the
            <NuxtLink to="/track" class="underline">Track status</NuxtLink> page at any time.
          </p>
        </div>
      </UCard>

      <!-- Wizard -->
      <UCard v-else>
        <template #header>
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <template v-for="(s, i) in sections" :key="s.key">
                <UBadge :color="i === step ? 'primary' : i < step ? 'success' : 'neutral'" variant="subtle">
                  {{ i + 1 }}. {{ s.title }}
                </UBadge>
              </template>
            </div>
          </div>
        </template>

        <div class="space-y-4">
          <!-- Anonymous toggle on first step -->
          <div v-if="step === 0 && meta?.anonymous_allowed" class="flex items-center gap-3 pb-2 border-b border-default">
            <USwitch v-model="anonymous" @update:model-value="step = 0" />
            <div>
              <div class="text-sm font-medium">Submit anonymously</div>
              <div class="text-xs text-muted">No personal details collected; you receive a one-time tracking PIN.</div>
            </div>
          </div>

          <IntakeFieldInput
            v-for="f in fieldsFor(currentSection!.key)"
            :key="f.key"
            v-model="values[f.key]"
            :field="f"
            :locale="locale"
            :options="fieldOptions(f, locale)"
          />

          <!-- Consent on final step -->
          <div v-if="step === sections.length - 1 && !anonymous" class="pt-2 border-t border-default">
            <UCheckbox v-model="consent" :label="meta?.consent_text[locale] ?? meta?.consent_text.en" />
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
    </div>
  </div>
</template>
