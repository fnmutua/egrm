<script setup lang="ts">
const { track } = useIntake();

const reference = ref('');
const verifier = ref('');
const loading = ref(false);
const error = ref('');
const result = ref<Awaited<ReturnType<typeof track>> | null>(null);

const tagColor: Record<string, string> = {
  open: 'info',
  in_progress: 'warning',
  resolved: 'success',
  closed: 'neutral',
  rejected: 'error',
  on_hold: 'neutral',
  appeal: 'warning',
};

async function doTrack() {
  loading.value = true;
  error.value = '';
  result.value = null;
  try {
    result.value = await track(reference.value, verifier.value);
  } catch {
    error.value = 'No case found for that reference and verification detail.';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen bg-elevated/50 py-10 px-4">
    <div class="max-w-xl mx-auto">
      <NuxtLink to="/" class="text-sm text-muted hover:underline">&larr; Back to home</NuxtLink>
      <h1 class="text-2xl font-bold mt-2 mb-6">Track your case</h1>

      <UCard>
        <form class="space-y-4" @submit.prevent="doTrack">
          <UFormField label="Reference number" required>
            <UInput v-model="reference" placeholder="GRM-2026-0001" class="w-full font-mono" />
          </UFormField>
          <UFormField label="Phone, email or tracking PIN" required help="The phone/email you submitted with, or the PIN issued for anonymous cases.">
            <UInput v-model="verifier" class="w-full" />
          </UFormField>
          <UAlert v-if="error" color="error" :title="error" />
          <UButton type="submit" block :loading="loading">Check status</UButton>
        </form>
      </UCard>

      <UCard v-if="result" class="mt-6">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-mono font-semibold">{{ result.reference }}</span>
            <UBadge :color="(tagColor[result.status_tag] as any) ?? 'neutral'" variant="subtle">{{ result.status }}</UBadge>
          </div>
        </template>
        <div class="space-y-3">
          <div class="text-sm text-muted">
            Submitted {{ new Date(result.submitted_at).toLocaleDateString() }} — currently handled at
            <span class="font-medium">{{ result.level }}</span> level.
          </div>
          <div>
            <div class="text-sm font-medium mb-2">Timeline</div>
            <ol class="space-y-2">
              <li v-for="(ev, i) in result.timeline" :key="i" class="flex gap-3 text-sm">
                <UIcon name="i-lucide-circle-dot" class="mt-0.5 text-primary shrink-0" />
                <div>
                  <span class="font-medium capitalize">{{ ev.kind.replaceAll('_', ' ') }}</span>
                  <span class="text-muted"> — {{ new Date(ev.createdAt).toLocaleString() }}</span>
                </div>
              </li>
            </ol>
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
