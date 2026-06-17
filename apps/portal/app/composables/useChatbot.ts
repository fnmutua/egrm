export interface ChatbotMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatbotMeta {
  enabled: boolean;
  persona?: string;
  locales?: string[];
  disclosure_text?: string;
  reason?: string;
}

export interface ChatbotSession {
  session_id: string;
  disclosure_text: string;
  persona: string;
  intents: { id: string; label: string }[];
  replies: string[];
}

type ApiErrorBody = {
  error?: string;
  message?: string;
  details?: { fields?: string[] };
};

function formatChatbotApiError(e: unknown, fallback: string): string {
  const err = e as { data?: ApiErrorBody; message?: string };
  const data = err.data;
  if (data?.message) return data.message;
  if (data?.error === 'missing_required_fields' && data.details?.fields?.length) {
    return `Missing: ${data.details.fields.join(', ')}`;
  }
  if (data?.error) return data.error.replaceAll('_', ' ');
  return err.message || fallback;
}

export function useChatbot() {
  const apiBase = usePublicApiBase();
  const config = useRuntimeConfig();
  const headers = computed(() => ({ 'x-tenant': config.public.tenant as string }));

  const meta = ref<ChatbotMeta | null>(null);
  const sessionId = ref<string | null>(null);
  const messages = ref<ChatbotMessage[]>([]);
  const loading = ref(false);
  const readback = ref(false);
  const handoff = ref(false);
  const submitResult = ref<{ reference: string; tracking_pin?: string } | null>(null);
  const error = ref('');

  async function loadMeta() {
    try {
      meta.value = await $fetch<ChatbotMeta>('/api/v1/public/chatbot/meta', {
        baseURL: apiBase.value,
        headers: headers.value,
      });
    } catch (e: unknown) {
      meta.value = { enabled: false, reason: 'meta_fetch_failed' };
      if (import.meta.dev) {
        console.warn('[chatbot] meta fetch failed', e);
      }
    }
  }

  async function startSession(locale?: string) {
    loading.value = true;
    error.value = '';
    submitResult.value = null;
    readback.value = false;
    handoff.value = false;
    try {
      const res = await $fetch<ChatbotSession>('/api/v1/public/chatbot/sessions', {
        baseURL: apiBase.value,
        method: 'POST',
        headers: headers.value,
        body: locale ? { locale } : {},
      });
      sessionId.value = res.session_id;
      messages.value = res.replies.map((text) => ({ role: 'assistant' as const, text }));
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Could not start chat';
    } finally {
      loading.value = false;
    }
  }

  async function sendMessage(text: string, locale?: string) {
    if (!sessionId.value || !text.trim()) return;
    messages.value.push({ role: 'user', text: text.trim() });
    loading.value = true;
    error.value = '';
    try {
      const res = await $fetch<{
        replies: string[];
        handoff?: boolean;
        readback?: boolean;
      }>(`/api/v1/public/chatbot/sessions/${sessionId.value}/messages`, {
        baseURL: apiBase.value,
        method: 'POST',
        headers: headers.value,
        body: { text: text.trim(), locale },
      });
      for (const reply of res.replies) {
        messages.value.push({ role: 'assistant', text: reply });
      }
      if (res.handoff) handoff.value = true;
      readback.value = res.readback === true;
    } catch (e: unknown) {
      error.value = formatChatbotApiError(e, 'Message failed');
    } finally {
      loading.value = false;
    }
  }

  async function submitGrievance(locale?: string) {
    if (!sessionId.value) return;
    loading.value = true;
    error.value = '';
    try {
      const res = await $fetch<{
        reference?: string;
        tracking_pin?: string;
      }>(`/api/v1/public/chatbot/sessions/${sessionId.value}/confirm`, {
        baseURL: apiBase.value,
        method: 'POST',
        headers: headers.value,
        body: { submit: true },
      });
      if (res.reference) {
        submitResult.value = { reference: res.reference, tracking_pin: res.tracking_pin };
        readback.value = false;
        const ack = res.tracking_pin
          ? `Submitted! Reference: ${res.reference}. Your tracking PIN (save it now): ${res.tracking_pin}`
          : `Submitted! Your reference is ${res.reference}.`;
        messages.value.push({ role: 'assistant', text: ack });
      }
    } catch (e: unknown) {
      error.value = formatChatbotApiError(e, 'Submit failed');
    } finally {
      loading.value = false;
    }
  }

  function reset() {
    sessionId.value = null;
    messages.value = [];
    readback.value = false;
    handoff.value = false;
    submitResult.value = null;
    error.value = '';
  }

  return {
    meta,
    sessionId,
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
  };
}
