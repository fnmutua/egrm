<script setup lang="ts">
const locale = useCookie<string>('egrm_locale', { default: () => 'en' });

const open = ref(false);
const draft = ref('');

const {
  meta,
  messages,
  loading,
  readback,
  handoff,
  submitResult,
  error,
  loadMeta,
  startSession,
  sendMessage,
  submitGrievance,
  reset,
} = useChatbot();

onMounted(() => {
  loadMeta();
});

const enabled = computed(() => meta.value?.enabled === true);
const persona = computed(() => meta.value?.persona ?? 'Assistant');

const messagesEl = ref<HTMLElement | null>(null);

function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
  nextTick(() => {
    const el = messagesEl.value;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  });
}

watch(
  () => [messages.value.length, messages.value.at(-1)?.text, loading.value, error.value, submitResult.value],
  () => scrollToBottom(),
);

watch(open, async (isOpen) => {
  if (isOpen && !messages.value.length) {
    await startSession(locale.value);
  }
  if (isOpen) scrollToBottom('instant');
});

async function onSend() {
  const text = draft.value.trim();
  if (!text) return;
  draft.value = '';
  await sendMessage(text, locale.value);
}

async function onSubmit() {
  await submitGrievance();
}

function onClose() {
  open.value = false;
  reset();
}
</script>

<template>
  <div v-if="enabled" class="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 translate-y-2 scale-95"
      enter-to-class="opacity-100 translate-y-0 scale-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0 scale-100"
      leave-to-class="opacity-0 translate-y-2 scale-95"
    >
      <div
        v-if="open"
        class="w-[min(100vw-2rem,24rem)] h-[min(70vh,32rem)] flex flex-col rounded-2xl border border-default bg-default shadow-xl overflow-hidden"
        role="dialog"
        aria-label="Chat assistant"
      >
        <div class="flex items-center justify-between gap-2 px-4 py-3 border-b border-default bg-primary/10">
          <div class="flex items-center gap-2 min-w-0">
            <UIcon name="i-lucide-bot" class="size-5 text-primary shrink-0" />
            <span class="font-medium truncate">{{ persona }}</span>
          </div>
          <UButton
            icon="i-lucide-x"
            variant="ghost"
            color="neutral"
            size="xs"
            aria-label="Close chat"
            @click="onClose"
          />
        </div>

        <div ref="messagesEl" class="flex-1 overflow-y-auto p-4 space-y-3" aria-live="polite">
          <div
            v-for="(msg, i) in messages"
            :key="i"
            class="flex"
            :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
          >
            <div
              class="max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap"
              :class="
                msg.role === 'user'
                  ? 'bg-primary text-inverted rounded-br-md'
                  : 'bg-muted text-default rounded-bl-md'
              "
            >
              {{ msg.text }}
            </div>
          </div>
          <p v-if="loading" class="text-xs text-muted">Thinking…</p>
          <p v-if="error" class="text-xs text-error">{{ error }}</p>
        </div>

        <div v-if="submitResult" class="px-4 py-2 border-t border-default bg-success/10 text-sm">
          Reference <strong>{{ submitResult.reference }}</strong>
          <span v-if="submitResult.tracking_pin"> · PIN <strong>{{ submitResult.tracking_pin }}</strong></span>
        </div>

        <div v-else-if="readback && !handoff" class="px-4 py-2 border-t border-default">
          <UButton block color="primary" :loading="loading" @click="onSubmit">
            Submit grievance
          </UButton>
        </div>

        <form v-if="!submitResult && !handoff" class="p-3 border-t border-default flex gap-2" @submit.prevent="onSend">
          <UInput
            v-model="draft"
            class="flex-1"
            placeholder="Type a message…"
            :disabled="loading"
            aria-label="Chat message"
          />
          <UButton type="submit" icon="i-lucide-send" :loading="loading" :disabled="!draft.trim()" aria-label="Send" />
        </form>
      </div>
    </Transition>

    <UButton
      v-if="!open"
      icon="i-lucide-message-circle"
      color="primary"
      size="lg"
      class="rounded-full shadow-lg"
      :aria-label="`Open ${persona}`"
      @click="open = true"
    >
      Chat
    </UButton>
  </div>
</template>
