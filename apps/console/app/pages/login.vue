<script setup lang="ts">
const config = useRuntimeConfig();
const route = useRoute();
const { login } = useAuth();
const email = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);
const registrationEnabled = ref(false);

function isMisconfiguredApiBase(): boolean {
  const base = config.public.apiBase;
  if (!base) return true;
  if (typeof window === 'undefined') return false;
  const onLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  return !onLocalHost && (base.includes('localhost') || base.includes('127.0.0.1'));
}

function apiFetchErrorMessage(e: unknown): string {
  const err = e as {
    data?: { error?: string; message?: string };
    statusCode?: number;
    statusMessage?: string;
    message?: string;
  };
  const code = err.data?.error;
  if (code === 'unknown_tenant') return 'Tenant not found on API — run database seed on the API service';
  if (code === 'invalid_credentials') return 'Invalid email or password';
  if (code === 'account_locked') return 'Account temporarily locked — try again later';
  if (code === 'ip_not_allowed') return 'Sign-in not allowed from this network';
  if (code === 'local_login_disabled') return 'Local login disabled — use SSO';
  if (code === 'password_expired') return 'Password expired — contact an administrator';
  if (code === 'mfa_enrollment_required') return 'MFA enrollment required — contact an administrator';
  if (code === 'registration_pending') return err.data?.message ?? 'Your account is pending approval';
  if (code === 'registration_rejected') return err.data?.message ?? 'Your registration was not approved';
  if (err.data?.message) return err.data.message;
  if (err.statusCode === 0 || err.message?.includes('fetch')) {
    return `Cannot reach API at ${config.public.apiBase}. Check NUXT_PUBLIC_API_BASE and redeploy the console.`;
  }
  return err.statusMessage ?? err.message ?? 'Sign-in failed — check browser devtools Network tab';
}

onMounted(async () => {
  if (route.query.reason === 'session_expired') {
    error.value = 'Your session could not be verified. Sign in again.';
  } else if (isMisconfiguredApiBase()) {
    error.value = `Console API URL is misconfigured (${config.public.apiBase}). Set NUXT_PUBLIC_API_BASE on Railway and redeploy.`;
  }

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
  if (isMisconfiguredApiBase()) {
    error.value = `Console API URL is misconfigured (${config.public.apiBase}). Set NUXT_PUBLIC_API_BASE on Railway and redeploy.`;
    return;
  }

  error.value = '';
  loading.value = true;
  try {
    await login(email.value, password.value);
    await navigateTo('/');
  } catch (e: unknown) {
    error.value = apiFetchErrorMessage(e);
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
