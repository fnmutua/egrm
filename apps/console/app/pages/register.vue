<script setup lang="ts">
interface RegisterField {
  key: string;
  type: string;
  required: boolean;
  label: Record<string, string>;
  storage?: string;
}

interface RegisterMeta {
  enabled: boolean;
  approval_required?: boolean;
  pending_message?: string;
  fields?: {
    required: RegisterField[];
    optional: RegisterField[];
    optional_required: RegisterField[];
  };
}

const config = useRuntimeConfig();

const meta = ref<RegisterMeta | null>(null);
const loadingMeta = ref(true);
const email = ref('');
const displayName = ref('');
const phone = ref('');
const password = ref('');
const passwordConfirm = ref('');
const profile = reactive<Record<string, string>>({});
const error = ref('');
const submitting = ref(false);
const done = ref<{ status: string; message: string } | null>(null);

const locale = 'en';

function fieldLabel(field: RegisterField): string {
  return field.label[locale] ?? field.label.en ?? field.key;
}

const extraFields = computed(() => {
  const f = meta.value?.fields;
  if (!f) return [];
  return [...f.optional_required, ...f.optional];
});

onMounted(async () => {
  try {
    meta.value = await $fetch<RegisterMeta>('/api/v1/public/staff-register-meta', {
      baseURL: config.public.apiBase,
      headers: { 'x-tenant': config.public.tenant },
    });
    if (!meta.value?.enabled) await navigateTo('/login');
  } catch {
    await navigateTo('/login');
  } finally {
    loadingMeta.value = false;
  }
});

function validateClient(): string | null {
  if (!email.value.trim()) return 'Email is required';
  if (!displayName.value.trim()) return 'Full name is required';
  if (!phone.value.trim()) return 'Mobile number is required';
  if (!password.value) return 'Password is required';
  if (password.value !== passwordConfirm.value) return 'Passwords do not match';
  for (const field of extraFields.value) {
    if (!field.required) continue;
    if (!profile[field.key]?.trim()) return `${fieldLabel(field)} is required`;
  }
  return null;
}

async function submit() {
  error.value = '';
  const clientError = validateClient();
  if (clientError) {
    error.value = clientError;
    return;
  }

  submitting.value = true;
  try {
    const profilePayload: Record<string, string> = {};
    for (const field of extraFields.value) {
      const v = profile[field.key]?.trim();
      if (v) profilePayload[field.key] = v;
    }

    const res = await $fetch<{ status: string; message: string }>('/api/v1/public/staff-register', {
      baseURL: config.public.apiBase,
      method: 'POST',
      headers: { 'x-tenant': config.public.tenant },
      body: {
        email: email.value.trim(),
        display_name: displayName.value.trim(),
        phone: phone.value.trim(),
        password: password.value,
        profile: Object.keys(profilePayload).length ? profilePayload : undefined,
      },
    });
    done.value = res;
  } catch (e: unknown) {
    const data = (e as { data?: { error?: string; message?: string } })?.data;
    const code = data?.error;
    if (code === 'weak_password') error.value = data?.message ?? 'Password does not meet policy';
    else if (code === 'email_domain_not_allowed') error.value = data?.message ?? 'Email domain not allowed';
    else if (code === 'invalid_identity' || code === 'invalid_profile') error.value = data?.message ?? 'Check your details and try again';
    else if (code === 'email_taken') error.value = 'An account with this email already exists';
    else if (code === 'self_registration_disabled' || code === 'local_login_disabled') {
      await navigateTo('/login');
    } else error.value = data?.message ?? 'Registration failed — try again';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-elevated px-4 py-8">
    <UCard class="w-full max-w-md">
      <template #header>
        <div class="text-center">
          <h1 class="text-xl font-semibold">Create staff account</h1>
          <p class="text-sm text-muted">Register for eGRM Console access</p>
        </div>
      </template>

      <div v-if="loadingMeta" class="flex justify-center py-8">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-muted" />
      </div>

      <div v-else-if="done" class="space-y-4 text-center py-2">
        <UIcon
          :name="done.status === 'pending' ? 'i-lucide-clock' : 'i-lucide-check-circle'"
          class="size-10 mx-auto"
          :class="done.status === 'pending' ? 'text-warning' : 'text-success'"
        />
        <p class="text-sm">{{ done.message }}</p>
        <UButton to="/login" block>Go to sign in</UButton>
      </div>

      <form v-else class="space-y-4" @submit.prevent="submit">
        <UFormField label="Email" required>
          <UInput v-model="email" type="email" placeholder="you@agency.go.ke" class="w-full" autocomplete="email" />
        </UFormField>
        <UFormField label="Full name" required>
          <UInput v-model="displayName" type="text" placeholder="Jane Officer" class="w-full" autocomplete="name" />
        </UFormField>
        <UFormField label="Mobile number" required>
          <UInput v-model="phone" type="tel" placeholder="0712345678" class="w-full" autocomplete="tel" />
        </UFormField>

        <UFormField
          v-for="field in extraFields"
          :key="field.key"
          :label="fieldLabel(field)"
          :required="field.required"
        >
          <UInput
            v-model="profile[field.key]"
            :type="field.type === 'phone' ? 'tel' : 'text'"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Password" required>
          <PasswordInput v-model="password" id="register-password" autocomplete="new-password" required />
        </UFormField>
        <UFormField label="Confirm password" required>
          <PasswordInput v-model="passwordConfirm" id="register-password-confirm" autocomplete="new-password" required />
        </UFormField>

        <UAlert v-if="error" color="error" :title="error" />
        <UButton type="submit" block :loading="submitting">Create account</UButton>
        <p class="text-center text-sm text-muted">
          Already have an account?
          <NuxtLink to="/login" class="text-primary hover:underline">Sign in</NuxtLink>
        </p>
      </form>
    </UCard>
  </div>
</template>
