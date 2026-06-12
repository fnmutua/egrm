<script setup lang="ts">
const { login } = useAuth();
const email = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    await login(email.value, password.value);
    await navigateTo('/');
  } catch {
    error.value = 'Invalid email or password';
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
          <UInput v-model="password" type="password" class="w-full" required />
        </UFormField>
        <UAlert v-if="error" color="error" :title="error" />
        <UButton type="submit" block :loading="loading">Sign in</UButton>
      </form>
    </UCard>
  </div>
</template>
