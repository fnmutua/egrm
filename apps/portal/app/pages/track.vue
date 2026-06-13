<script setup lang="ts">
import { buildThreadTree } from '@egrm/core';

const { track, reply, loadMeta, meta } = useIntake();

const reference = ref('');
const verifier = ref('');
const loading = ref(false);
const error = ref('');
const result = ref<Awaited<ReturnType<typeof track>> | null>(null);

const replyBody = ref('');
const replyFiles = ref<{ id: string; file: File; kind: string }[]>([]);
const replyKind = ref('evidence');
const replyLoading = ref(false);
const replyError = ref('');
const replyInput = ref<HTMLInputElement | null>(null);

const messageTree = computed(() => {
  const messages = result.value?.messages ?? [];
  return buildThreadTree(messages, { order: 'desc' });
});

const messageById = computed(() =>
  Object.fromEntries((result.value?.messages ?? []).map((m) => [m.id, m])),
);

onMounted(() => loadMeta().catch(() => {}));

const correspondence = computed(() => meta.value?.correspondence);
const replyAttachmentsEnabled = computed(
  () => correspondence.value?.reply_attachments_enabled && (correspondence.value?.reply_kinds?.length ?? 0) > 0,
);
const maxReplyFiles = computed(() => correspondence.value?.max_reply_files ?? 3);
const replyKindItems = computed(() =>
  (correspondence.value?.reply_kinds ?? []).map((k) => ({
    value: k.code,
    label: k.label.en ?? k.code,
  })),
);

watch(replyKindItems, (items) => {
  if (items.length && !items.some((i) => i.value === replyKind.value)) {
    replyKind.value = items[0]!.value;
  }
}, { immediate: true });

const tagColor: Record<string, string> = {
  open: 'info',
  in_progress: 'warning',
  resolved: 'success',
  closed: 'neutral',
  rejected: 'error',
  on_hold: 'neutral',
  appeal: 'warning',
};

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function onReplyFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (replyFiles.value.length >= maxReplyFiles.value) {
    replyError.value = `You can attach at most ${maxReplyFiles.value} file(s).`;
    return;
  }
  replyFiles.value.push({ id: crypto.randomUUID(), file, kind: replyKind.value });
}

function removeReplyFile(id: string) {
  replyFiles.value = replyFiles.value.filter((f) => f.id !== id);
}

async function doTrack() {
  loading.value = true;
  error.value = '';
  result.value = null;
  replyBody.value = '';
  replyFiles.value = [];
  replyError.value = '';
  try {
    result.value = await track(reference.value, verifier.value);
  } catch {
    error.value = 'No case found for that reference and verification detail.';
  } finally {
    loading.value = false;
  }
}

async function doReply() {
  if (!result.value || !replyBody.value.trim()) return;
  replyLoading.value = true;
  replyError.value = '';
  try {
    await reply({
      reference: reference.value,
      verifier: verifier.value,
      body: replyBody.value.trim(),
      files: replyFiles.value.length ? replyFiles.value.map((f) => ({ file: f.file, kind: f.kind })) : undefined,
    });
    replyBody.value = '';
    replyFiles.value = [];
    result.value = await track(reference.value, verifier.value);
  } catch (e: unknown) {
    const err = e as { data?: { error?: string; message?: string } };
    const code = err.data?.error ?? '';
    const messages: Record<string, string> = {
      reply_not_allowed: 'Replies are not allowed for this case.',
      thread_body_required: 'Please enter a message.',
      thread_body_too_long: 'Message is too long.',
      case_closed: 'This case is closed — replies are no longer accepted.',
      reply_rate_limited: 'Too many replies today. Try again tomorrow.',
      reply_attachments_disabled: 'Attachments are not allowed on replies.',
      attachment_kind_not_allowed: 'That document type is not allowed.',
      attachment_policy_violation: err.data?.message ?? 'File upload not allowed.',
    };
    replyError.value = messages[code] ?? err.data?.message ?? 'Could not send your reply.';
  } finally {
    replyLoading.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen bg-elevated/50 py-6 sm:py-10 px-4">
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
        <div class="space-y-6">
          <div class="text-sm text-muted">
            Submitted {{ new Date(result.submitted_at).toLocaleDateString() }} — currently handled at
            <span class="font-medium">{{ result.level }}</span> level.
          </div>

          <div v-if="result.messages?.length">
            <div class="text-sm font-medium mb-2">Messages</div>
            <p class="text-xs text-muted mb-3">Tap a message to read the full text.</p>
            <PortalThreadTree :nodes="messageTree" :entry-by-id="messageById" />
          </div>

          <div v-if="result.reply_allowed" class="pt-4 border-t border-default space-y-3">
            <div class="text-sm font-medium">Send a reply</div>
            <UFormField label="Your message">
              <UTextarea
                v-model="replyBody"
                :rows="4"
                class="w-full"
                :maxlength="correspondence?.max_body_length"
                placeholder="Add information or respond to a request from the GRM office…"
              />
            </UFormField>
            <div v-if="replyAttachmentsEnabled" class="space-y-2">
              <div class="flex flex-wrap items-center gap-2">
                <USelectMenu
                  v-if="replyKindItems.length > 1"
                  v-model="replyKind"
                  :items="replyKindItems"
                  value-key="value"
                  label-key="label"
                  size="sm"
                />
                <input
                  ref="replyInput"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
                  class="hidden"
                  @change="onReplyFileChange"
                />
                <UButton size="sm" variant="outline" icon="i-lucide-paperclip" @click="replyInput?.click()">
                  Attach file
                </UButton>
              </div>
              <ul v-if="replyFiles.length" class="text-sm space-y-1">
                <li v-for="f in replyFiles" :key="f.id" class="flex items-center justify-between gap-2">
                  <span class="truncate">{{ f.file.name }} ({{ formatFileSize(f.file.size) }})</span>
                  <UButton size="xs" variant="ghost" color="error" @click="removeReplyFile(f.id)">Remove</UButton>
                </li>
              </ul>
            </div>
            <UAlert v-if="replyError" color="error" :title="replyError" />
            <UButton :loading="replyLoading" :disabled="!replyBody.trim()" block @click="doReply">
              Send reply
            </UButton>
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
