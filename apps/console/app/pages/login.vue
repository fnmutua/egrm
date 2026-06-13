<script setup lang="ts">
const config = useRuntimeConfig();
const { login } = useAuth();
const email = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);
const registrationEnabled = ref(false);

onMounted(async () => {
  try {
    const meta = await $fetch<{ enabled: boolean }>('/api/v1/public/staff-register-meta', {
      baseURL: config.public.apiBase,
      headers: { 'x-tenant': config.public.tenant },
    });
    registrationEnabled.value = meta.enabled;
  } catch {
    registrationEnabled.value = false;
  }
});

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    await login(email.value, password.value);
    await navigateTo('/');
  } catch (e: unknown) {
    const data = (e as { data?: { error?: string; message?: string } })?.data;
    const code = data?.error;
    if (code === 'account_locked') error.value = 'Account temporarily locked — try again later';
    else if (code === 'ip_not_allowed') error.value = 'Sign-in not allowed from this network';
    else if (code === 'local_login_disabled') error.value = 'Local login disabled — use SSO';
    else if (code === 'password_expired') error.value = 'Password expired — contact an administrator';
    else if (code === 'mfa_enrollment_required') error.value = 'MFA enrollment required — contact an administrator';
    else if (code === 'registration_pending') error.value = data?.message ?? 'Your account is pending approval';
    else if (code === 'registration_rejected') error.value = data?.message ?? 'Your registration was not approved';
    else error.value = data?.message ?? 'Invalid email or password';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-elevated">
    <UCard class="w-full max-w-sm">
      <template #header>
        <div class="text-center">
          <h1 class="text-xl font-semibold">eGRM Console</h1>
          <p class="text-sm text-muted">Sign in to continue</p>
        </div>
      </template>

      <form class="space-y-4" @submit.prevent="submit">
        <UFormField label="Email">
          <UInput v-model="email" type="email" placeholder="you@example.org" class="w-full" required />
        </UFormField>
        <UFormField label="Password">
          <PasswordInput
            id="login-password"
            v-model="password"
            autocomplete="current-password"
            :required="true"
          />
        </UFormField>
        <UAlert v-if="error" color="error" :title="error" />
        <UButton type="submit" block :loading="loading">Sign in</UButton>
        <p v-if="registrationEnabled" class="text-center text-sm text-muted">
          No account yet?
          <NuxtLink to="/register" class="text-primary hover:underline">Create one</NuxtLink>
        </p>
      </form>
    </UCard>
  </div>
</template>
