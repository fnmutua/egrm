<script setup lang="ts">
import { kindsForChannel } from '@egrm/config-schemas';
import { hasPermission } from '@egrm/core';

const route = useRoute();
const { api } = useApi();
const { user, fetchMe } = useAuth();
const caseId = computed(() => String(route.params.id));
const { stageFile, removeStaged, downloadFile } = useCaseAttachmentUpload(caseId.value);

interface AttachmentKindOption {
  code: string;
  label: string;
}

interface StagedAttachment {
  id: string;
  kind: string;
  filename: string;
}

interface CaseAttachment {
  id: string;
  kind: string;
  kind_label: string;
  filename: string;
  mime: string;
  size_bytes: number;
  visibility: string;
  uploaded_by_name: string | null;
  created_at: string;
}

interface CaseAssignee {
  id: string;
  name: string;
  email: string;
}

interface ThreadEntry {
  id: string;
  direction: string;
  message_kind: string;
  channel: string;
  body: string;
  body_display: string;
  visibility: string;
  author_name: string | null;
  attachments: { id: string; filename: string; kind: string; kind_label: string }[];
  created_at: string;
}

interface CaseDetail {
  case: {
    id: string; reference: string; case_type: string; status: string; status_tag: string;
    level: string; unit: string | null; assignee: CaseAssignee | null; anonymous: boolean; channel: string;
    categories: string[]; sensitivity: string; priority: string; summary: string;
    description: string | null; expected_outcome: string | null;
    date_occurred: string | null; consent: boolean; created_at: string;
  };
  complainant: {
    name: string | null; phone: string | null; email: string | null;
    gender: string | null; age_band: string | null; preferred_language: string | null;
  } | null;
  events: { id: string; kind: string; actorType: string; visibility: string; data: Record<string, unknown>; createdAt: string }[];
}

interface AvailableTransition {
  type: 'transition';
  to_status: string;
  requires?: {
    note?: boolean;
    fields?: string[];
    attachments?: { kind: string; label: string; min_count: number }[];
  };
  allows?: {
    attachments?: { kind: string; label: string }[];
  };
}

interface AvailableAssign {
  type: 'assign';
}

type AvailableAction = AvailableTransition | AvailableAssign;

interface CaseNotification {
  id: string;
  event_kind: string;
  rule_id: string | null;
  recipient_kind: string;
  channel: string;
  template_id: string;
  locale: string;
  status: string;
  rendered_preview: string | null;
  provider_message_id: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

const detail = ref<CaseDetail | null>(null);
const actions = ref<AvailableAction[]>([]);
const assignees = ref<CaseAssignee[]>([]);
const actionLoading = ref(false);
const actionError = ref('');
const assignLoading = ref(false);
const assignError = ref('');
const selectedToStatus = ref<string | null>(null);
const actionTaken = ref('');
const updateSummary = ref('');
const transitionFields = ref<Record<string, string>>({});
const selectedAssigneeId = ref<string | null>(null);
const notifications = ref<CaseNotification[]>([]);
const notificationsLoading = ref(false);
const notificationsLoaded = ref(false);
const activeTab = ref('overview');
const attachments = ref<CaseAttachment[]>([]);
const attachmentsLoading = ref(false);
const attachmentsLoaded = ref(false);
const attachmentKinds = ref<AttachmentKindOption[]>([]);
const stagedAttachments = ref<StagedAttachment[]>([]);
const stagingUpload = ref(false);
const docUploadKind = ref('evidence');
const docUploadNote = ref('');
const docFileInput = ref<HTMLInputElement | null>(null);

const threadEntries = ref<ThreadEntry[]>([]);
const threadLoading = ref(false);
const threadLoaded = ref(false);
const composeMode = ref<'outbound' | 'logged_contact' | 'internal'>('outbound');
const composeBody = ref('');
const composeKind = ref('free_text');
const composeChannel = ref('phone');
const composeSending = ref(false);
const composeError = ref('');
const composeStaged = ref<StagedAttachment[]>([]);
const composeFileInput = ref<HTMLInputElement | null>(null);

const canReadThread = computed(() => hasPermission(user.value?.permissions ?? [], 'thread:read'));
const canReplyExternal = computed(() => hasPermission(user.value?.permissions ?? [], 'thread:reply_external'));
const canNoteInternal = computed(() => hasPermission(user.value?.permissions ?? [], 'thread:note_internal'));
const canComposeThread = computed(() => canReplyExternal.value || canNoteInternal.value);

const composeModeItems = computed(() => {
  const items: { value: typeof composeMode.value; label: string }[] = [];
  if (canReplyExternal.value) {
    items.push({ value: 'outbound', label: 'Message to complainant' });
    items.push({ value: 'logged_contact', label: 'Log offline contact' });
  }
  if (canNoteInternal.value) items.push({ value: 'internal', label: 'Internal note' });
  return items;
});

const outboundKindItems = [
  { value: 'free_text', label: 'Free text' },
  { value: 'request_info', label: 'Request information' },
  { value: 'acknowledgement', label: 'Acknowledgement' },
  { value: 'resolution_notice', label: 'Resolution notice' },
];

const contactChannelItems = [
  { value: 'phone', label: 'Phone' },
  { value: 'visit', label: 'Visit' },
  { value: 'letter', label: 'Letter' },
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Email' },
];

const tabItems = computed(() => {
  const items = [
    { label: 'Overview', value: 'overview', icon: 'i-lucide-layout-dashboard' },
    { label: 'Actions', value: 'actions', icon: 'i-lucide-play' },
    { label: 'Documents', value: 'documents', icon: 'i-lucide-paperclip' },
  ];
  if (canReadThread.value) {
    items.push({ label: 'Correspondence', value: 'correspondence', icon: 'i-lucide-messages-square' });
  }
  items.push(
    { label: 'Assignment', value: 'assignment', icon: 'i-lucide-user-check' },
    { label: 'Notifications', value: 'notifications', icon: 'i-lucide-bell' },
    { label: 'Timeline', value: 'timeline', icon: 'i-lucide-history' },
  );
  return items;
});

const tagColor: Record<string, string> = {
  open: 'info', in_progress: 'warning', resolved: 'success',
  closed: 'neutral', rejected: 'error', on_hold: 'neutral', appeal: 'warning',
};

function notificationStatusColor(status: string): string {
  if (status === 'sent') return 'success';
  if (status.startsWith('sent:')) return 'warning';
  if (status === 'queued') return 'info';
  if (status.startsWith('suppressed:')) return 'neutral';
  if (status.startsWith('failed')) return 'error';
  return 'neutral';
}

function formatNotificationStatus(status: string): string {
  if (status.startsWith('suppressed:')) return `Suppressed (${status.slice('suppressed:'.length).replaceAll('_', ' ')})`;
  if (status.startsWith('failed:')) return `Failed (${status.slice('failed:'.length).replaceAll('_', ' ')})`;
  return status.replaceAll('_', ' ').replaceAll(':', ' — ');
}

function channelLabel(channel: string): string {
  if (channel === 'in_app') return 'In-app';
  return channel.toUpperCase();
}

function workflowErrorMessage(code: string, fallback?: string): string {
  const messages: Record<string, string> = {
    action_taken_required: 'Describe the action taken.',
    update_summary_required: 'Describe what was updated.',
    required_field_missing: 'Please complete all required fields.',
    transition_not_allowed: 'This transition is not allowed from the current status.',
    confirmation_authority_required: 'National confirmation authority is required.',
    unknown_assignee: 'Selected assignee is not valid.',
    assignee_id_required: 'Select an assignee first.',
    forbidden: 'You do not have permission for this action.',
    required_attachment_missing: 'Attach the required document type(s) before updating status.',
    attachment_kind_not_allowed: 'That document type is not allowed for this transition.',
    attachment_policy_violation: 'File upload violates attachment policy.',
    unknown_attachment_kind: 'Unknown document type.',
    duplicate_attachment: 'This file was already uploaded.',
  };
  return messages[code] ?? fallback ?? code.replaceAll('_', ' ');
}

const transitionActions = computed(() => actions.value.filter((a): a is AvailableTransition => a.type === 'transition'));
const canAssign = computed(() => actions.value.some((a) => a.type === 'assign'));
const statusItems = computed(() =>
  transitionActions.value.map((t) => ({ value: t.to_status, label: t.to_status })),
);
const selectedTransition = computed(() =>
  transitionActions.value.find((t) => t.to_status === selectedToStatus.value) ?? null,
);

const requiredAttachmentKinds = computed(() => selectedTransition.value?.requires?.attachments ?? []);

const optionalTransitionKinds = computed(() => {
  const allows = selectedTransition.value?.allows?.attachments ?? [];
  if (!allows.length) return [];
  const required = new Set(requiredAttachmentKinds.value.map((r) => r.kind));
  return allows.filter((a) => !required.has(a.kind));
});

const stagedKindCodes = computed(() => new Set(stagedAttachments.value.map((a) => a.kind)));

const attachmentsRequirementMet = computed(() =>
  requiredAttachmentKinds.value.every((r) => stagedKindCodes.value.has(r.kind)),
);

const canSubmitTransition = computed(() =>
  Boolean(
    selectedToStatus.value
    && actionTaken.value.trim()
    && updateSummary.value.trim()
    && attachmentsRequirementMet.value,
  ),
);

const kindSelectItems = computed(() =>
  attachmentKinds.value.map((k) => ({ value: k.code, label: k.label })),
);

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const assigneeById = computed(() => {
  const map = new Map(assignees.value.map((a) => [a.id, a]));
  const cur = detail.value?.case.assignee;
  if (cur) map.set(cur.id, cur);
  return map;
});

const assignmentHistory = computed(() =>
  (detail.value?.events ?? [])
    .filter((ev) => ev.kind === 'assigned')
    .slice()
    .reverse(),
);

function assigneeLabel(id: unknown): string {
  if (typeof id !== 'string' || !id) return 'Unassigned';
  return assigneeById.value.get(id)?.name ?? 'Officer';
}

watch(selectedToStatus, (status) => {
  const t = transitionActions.value.find((a) => a.to_status === status);
  transitionFields.value = {};
  for (const field of t?.requires?.fields ?? []) {
    transitionFields.value[field] = '';
  }
  stagedAttachments.value = [];
});

async function loadAttachmentKinds() {
  try {
    const res = await api<{
      payload?: {
        attachment_kinds?: { code: string; label?: Record<string, string>; active?: boolean; console_allowed?: boolean }[];
        attachment_policy?: { console_kind_codes?: string[] };
      };
    }>('/api/v1/config/cd06_intake_forms');
    const allowed = kindsForChannel(
      {
        attachment_kinds: res.payload?.attachment_kinds ?? [],
        attachment_policy: res.payload?.attachment_policy,
      },
      'console',
    );
    attachmentKinds.value = allowed.map((k) => ({ code: k.code, label: k.label?.en ?? k.code }));
    if (attachmentKinds.value.length && !attachmentKinds.value.some((k) => k.code === docUploadKind.value)) {
      docUploadKind.value = attachmentKinds.value[0]!.code;
    }
  } catch {
    attachmentKinds.value = [{ code: 'evidence', label: 'Evidence' }];
  }
}

async function loadAttachments() {
  attachmentsLoading.value = true;
  try {
    const res = await api<{ attachments: CaseAttachment[] }>(`/api/v1/cases/${route.params.id}/attachments`);
    attachments.value = res.attachments;
    attachmentsLoaded.value = true;
  } finally {
    attachmentsLoading.value = false;
  }
}

async function onStageFile(file: File, kind: string) {
  stagingUpload.value = true;
  try {
    const res = await stageFile(file, kind);
    stagedAttachments.value.push({ id: res.attachment_id, kind, filename: file.name });
  } finally {
    stagingUpload.value = false;
  }
}

async function onTransitionFileInput(kind: string, event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  await onStageFile(file, kind);
  input.value = '';
}

async function removeStagedAttachment(item: StagedAttachment) {
  await removeStaged(item.id);
  stagedAttachments.value = stagedAttachments.value.filter((a) => a.id !== item.id);
}

async function onDocFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = input.files;
  if (!files?.length) return;
  stagingUpload.value = true;
  try {
    const ids: string[] = [];
    for (const file of files) {
      const res = await stageFile(file, docUploadKind.value);
      ids.push(res.attachment_id);
    }
    if (ids.length) {
      await api(`/api/v1/cases/${route.params.id}/attachments`, {
        method: 'POST',
        body: { attachment_ids: ids, note: docUploadNote.value.trim() || undefined },
      });
      docUploadNote.value = '';
      await loadAttachments();
      if (detail.value) await loadCase();
    }
  } finally {
    stagingUpload.value = false;
    input.value = '';
  }
}

function eventSummary(ev: CaseDetail['events'][number]): string | null {
  const d = ev.data;
  if (ev.kind === 'status_changed') {
    const parts: string[] = [];
    if (d.from_status && d.to_status) parts.push(`${d.from_status} → ${d.to_status}`);
    if (typeof d.action_taken === 'string' && d.action_taken) parts.push(`Action: ${d.action_taken}`);
    if (typeof d.update_summary === 'string' && d.update_summary) parts.push(`Updated: ${d.update_summary}`);
    if (Array.isArray(d.attachment_summary)) {
      const names = (d.attachment_summary as { filename?: string }[]).map((a) => a.filename).filter(Boolean);
      if (names.length) parts.push(`Files: ${names.join(', ')}`);
    }
    return parts.length ? parts.join(' · ') : null;
  }
  if (ev.kind === 'assigned') {
    const from = assigneeLabel(d.from_assignee_id);
    const to = assigneeLabel(d.to_assignee_id);
    if (d.from_assignee_id && d.to_assignee_id) return `${from} → ${to}`;
    if (d.to_assignee_id) return `Assigned to ${to}`;
    return 'Assignee cleared';
  }
  if (ev.kind === 'note_internal' && typeof d.body === 'string') return d.body as string;
  if (ev.kind === 'attachment_added' && Array.isArray(d.attachment_summary)) {
    const names = (d.attachment_summary as { filename?: string }[]).map((a) => a.filename).filter(Boolean);
    return names.length ? `Documents added: ${names.join(', ')}` : 'Documents added';
  }
  if ((ev.kind === 'message_external' || ev.kind === 'message_inbound') && typeof d.preview === 'string') {
    return d.preview as string;
  }
  return null;
}

async function loadAssignees() {
  if (!canAssign.value) return;
  const res = await api<{ assignees: CaseAssignee[]; suggested_assignee_id?: string | null }>(
    `/api/v1/cases/${route.params.id}/assignees`,
  ).catch(() => ({ assignees: [], suggested_assignee_id: null }));
  assignees.value = res.assignees;
  selectedAssigneeId.value =
    detail.value?.case.assignee?.id ?? res.suggested_assignee_id ?? null;
}

function goToTab(tab: string) {
  activeTab.value = tab;
}

async function loadCase() {
  detail.value = await api<CaseDetail>(`/api/v1/cases/${route.params.id}`);
  const actionsRes = await api<{ actions: AvailableAction[] }>(`/api/v1/cases/${route.params.id}/available-actions`);
  actions.value = actionsRes.actions;
  if (actionsRes.actions.some((a) => a.type === 'assign')) await loadAssignees();
}

function resetTransitionForm() {
  selectedToStatus.value = null;
  actionTaken.value = '';
  updateSummary.value = '';
  transitionFields.value = {};
  stagedAttachments.value = [];
  actionError.value = '';
}

async function runTransition() {
  if (!selectedToStatus.value || !canSubmitTransition.value) return;
  actionLoading.value = true;
  actionError.value = '';
  try {
    await api(`/api/v1/cases/${route.params.id}/actions`, {
      method: 'POST',
      body: {
        action: 'transition',
        to_status: selectedToStatus.value,
        action_taken: actionTaken.value.trim(),
        update_summary: updateSummary.value.trim(),
        fields: Object.keys(transitionFields.value).length ? transitionFields.value : undefined,
        attachment_ids: stagedAttachments.value.length ? stagedAttachments.value.map((a) => a.id) : undefined,
      },
    });
    resetTransitionForm();
    attachmentsLoaded.value = false;
    notificationsLoaded.value = false;
    await loadCase();
  } catch (e: unknown) {
    const err = e as { data?: { error?: string; message?: string } };
    actionError.value = workflowErrorMessage(err.data?.error ?? '', err.data?.message);
  } finally {
    actionLoading.value = false;
  }
}

async function runAssign() {
  if (!selectedAssigneeId.value) return;
  assignLoading.value = true;
  assignError.value = '';
  try {
    await api(`/api/v1/cases/${route.params.id}/actions`, {
      method: 'POST',
      body: { action: 'assign', assignee_id: selectedAssigneeId.value },
    });
    notificationsLoaded.value = false;
    await loadCase();
  } catch (e: unknown) {
    const err = e as { data?: { error?: string; message?: string } };
    assignError.value = workflowErrorMessage(err.data?.error ?? '', err.data?.message);
  } finally {
    assignLoading.value = false;
  }
}

async function loadThread() {
  if (!canReadThread.value) return;
  threadLoading.value = true;
  try {
    const res = await api<{ entries: ThreadEntry[] }>(`/api/v1/cases/${route.params.id}/thread`);
    threadEntries.value = res.entries;
    threadLoaded.value = true;
  } finally {
    threadLoading.value = false;
  }
}

function threadDirectionLabel(entry: ThreadEntry): string {
  if (entry.direction === 'inbound') return 'Complainant';
  if (entry.direction === 'internal_note') return 'Internal note';
  if (entry.message_kind === 'logged_contact') return `Logged (${entry.channel})`;
  return 'Staff';
}

function threadDirectionColor(entry: ThreadEntry): string {
  if (entry.direction === 'inbound') return 'info';
  if (entry.direction === 'internal_note') return 'warning';
  if (entry.message_kind === 'logged_contact') return 'neutral';
  return 'primary';
}

function resetCompose() {
  composeBody.value = '';
  composeStaged.value = [];
  composeError.value = '';
  if (composeModeItems.value.length) composeMode.value = composeModeItems.value[0]!.value;
}

async function onComposeFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  stagingUpload.value = true;
  try {
    const res = await stageFile(file, docUploadKind.value);
    composeStaged.value.push({ id: res.attachment_id, kind: docUploadKind.value, filename: file.name });
  } finally {
    stagingUpload.value = false;
    input.value = '';
  }
}

async function sendThreadMessage() {
  if (!composeBody.value.trim()) return;
  composeSending.value = true;
  composeError.value = '';
  try {
    const internal = composeMode.value === 'internal';
    await api(`/api/v1/cases/${route.params.id}/thread`, {
      method: 'POST',
      body: {
        body: composeBody.value.trim(),
        internal,
        message_kind: composeMode.value === 'logged_contact' ? 'logged_contact' : internal ? 'free_text' : composeKind.value,
        channel: composeMode.value === 'logged_contact' ? composeChannel.value : 'console',
        visibility: internal ? 'staff' : 'public',
        attachment_ids: composeStaged.value.length ? composeStaged.value.map((a) => a.id) : undefined,
      },
    });
    resetCompose();
    threadLoaded.value = false;
    notificationsLoaded.value = false;
    await Promise.all([loadThread(), loadCase()]);
  } catch (e: unknown) {
    const err = e as { data?: { error?: string; message?: string } };
    composeError.value = workflowErrorMessage(err.data?.error ?? '', err.data?.message);
  } finally {
    composeSending.value = false;
  }
}

async function loadNotifications() {
  if (!detail.value || notificationsLoaded.value) return;
  notificationsLoading.value = true;
  try {
    const res = await api<{ notifications: CaseNotification[] }>(
      `/api/v1/cases/${route.params.id}/notifications`,
    );
    notifications.value = res.notifications;
    notificationsLoaded.value = true;
  } finally {
    notificationsLoading.value = false;
  }
}

watch(activeTab, (tab) => {
  if (tab === 'notifications') loadNotifications();
  if (tab === 'documents' && !attachmentsLoaded.value) loadAttachments();
  if (tab === 'correspondence' && !threadLoaded.value) loadThread();
  if (tab === 'assignment' && canAssign.value && assignees.value.length === 0) loadAssignees();
});

watch(composeModeItems, (items) => {
  if (items.length && !items.some((i) => i.value === composeMode.value)) {
    composeMode.value = items[0]!.value;
  }
}, { immediate: true });

onMounted(async () => {
  if (!(await fetchMe())) return navigateTo('/login');
  await Promise.all([loadCase(), loadAttachmentKinds()]);
});
</script>

<template>
  <div v-if="user && detail" class="p-4 sm:p-8 max-w-5xl mx-auto">
    <UButton to="/cases" variant="ghost" icon="i-lucide-arrow-left" class="mb-4">All cases</UButton>

    <div class="flex items-start justify-between mb-4">
      <div>
        <div class="flex items-center gap-3 flex-wrap">
          <h1 class="text-2xl font-semibold font-mono">{{ detail.case.reference }}</h1>
          <UBadge :color="(tagColor[detail.case.status_tag] as any) ?? 'neutral'">{{ detail.case.status }}</UBadge>
          <UBadge v-if="detail.case.anonymous" color="neutral" variant="subtle">anonymous</UBadge>
        </div>
        <p class="text-muted mt-1">{{ detail.case.summary }}</p>
      </div>
    </div>

    <UTabs v-model="activeTab" :items="tabItems" class="mb-6" />

    <div v-if="activeTab === 'overview'" class="space-y-2 max-w-3xl">
      <details open class="group rounded-lg border border-default bg-default">
        <summary class="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-elevated/40 rounded-lg [&::-webkit-details-marker]:hidden">
          <UIcon name="i-lucide-chevron-right" class="size-4 text-muted transition-transform group-open:rotate-90" />
          Case details
        </summary>
        <div class="px-4 pb-4 pt-0 border-t border-default">
          <dl class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm pt-3">
            <div><dt class="text-muted text-xs">Categories</dt><dd>{{ detail.case.categories.join(', ') || '—' }}</dd></div>
            <div><dt class="text-muted text-xs">Channel</dt><dd class="capitalize">{{ detail.case.channel }}</dd></div>
            <div><dt class="text-muted text-xs">Level</dt><dd class="capitalize">{{ detail.case.level }}</dd></div>
            <div><dt class="text-muted text-xs">Location</dt><dd>{{ detail.case.unit ?? '—' }}</dd></div>
            <div><dt class="text-muted text-xs">Priority</dt><dd class="capitalize">{{ detail.case.priority }}</dd></div>
            <div>
              <dt class="text-muted text-xs">Assignee</dt>
              <dd>
                <button
                  v-if="detail.case.assignee"
                  type="button"
                  class="text-primary hover:underline text-left"
                  @click="goToTab('assignment')"
                >
                  {{ detail.case.assignee.name }}
                </button>
                <button
                  v-else
                  type="button"
                  class="text-primary hover:underline"
                  @click="goToTab('assignment')"
                >
                  Assign officer
                </button>
              </dd>
            </div>
            <div>
              <dt class="text-muted text-xs">Status</dt>
              <dd>
                <button type="button" class="text-primary hover:underline capitalize" @click="goToTab('actions')">
                  {{ detail.case.status }}
                </button>
              </dd>
            </div>
            <div><dt class="text-muted text-xs">Sensitivity</dt><dd class="capitalize">{{ detail.case.sensitivity }}</dd></div>
            <div><dt class="text-muted text-xs">Occurred</dt><dd>{{ detail.case.date_occurred ? new Date(detail.case.date_occurred).toLocaleDateString() : '—' }}</dd></div>
            <div><dt class="text-muted text-xs">Received</dt><dd>{{ new Date(detail.case.created_at).toLocaleString() }}</dd></div>
          </dl>
        </div>
      </details>

      <details v-if="detail.case.description" class="group rounded-lg border border-default bg-default">
        <summary class="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-elevated/40 rounded-lg [&::-webkit-details-marker]:hidden">
          <UIcon name="i-lucide-chevron-right" class="size-4 text-muted transition-transform group-open:rotate-90" />
          Description
        </summary>
        <div class="px-4 pb-4 pt-0 border-t border-default">
          <p class="text-sm whitespace-pre-wrap pt-3">{{ detail.case.description }}</p>
        </div>
      </details>

      <details v-if="detail.case.expected_outcome" class="group rounded-lg border border-default bg-default">
        <summary class="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-elevated/40 rounded-lg [&::-webkit-details-marker]:hidden">
          <UIcon name="i-lucide-chevron-right" class="size-4 text-muted transition-transform group-open:rotate-90" />
          Expected outcome
        </summary>
        <div class="px-4 pb-4 pt-0 border-t border-default">
          <p class="text-sm whitespace-pre-wrap pt-3">{{ detail.case.expected_outcome }}</p>
        </div>
      </details>

      <details class="group rounded-lg border border-default bg-default">
        <summary class="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-elevated/40 rounded-lg [&::-webkit-details-marker]:hidden">
          <UIcon name="i-lucide-chevron-right" class="size-4 text-muted transition-transform group-open:rotate-90" />
          Complainant
          <UBadge v-if="detail.case.anonymous" size="xs" color="neutral" variant="subtle" class="ml-1">anonymous</UBadge>
        </summary>
        <div class="px-4 pb-4 pt-0 border-t border-default">
          <div v-if="detail.case.anonymous" class="text-sm text-muted pt-3">Anonymous submission — no personal data collected.</div>
          <dl v-else-if="detail.complainant" class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm pt-3">
            <div><dt class="text-muted text-xs">Name</dt><dd class="font-medium">{{ detail.complainant.name ?? '—' }}</dd></div>
            <div><dt class="text-muted text-xs">Phone</dt><dd>{{ detail.complainant.phone ?? '—' }}</dd></div>
            <div><dt class="text-muted text-xs">Email</dt><dd>{{ detail.complainant.email ?? '—' }}</dd></div>
            <div><dt class="text-muted text-xs">Gender</dt><dd class="capitalize">{{ detail.complainant.gender ?? '—' }}</dd></div>
          </dl>
          <div v-else class="text-sm text-muted pt-3">No party record.</div>
          <p v-if="!detail.case.anonymous" class="text-xs text-muted mt-3 pt-3 border-t border-default">PII access is logged in the audit trail.</p>
        </div>
      </details>
    </div>

    <div v-else-if="activeTab === 'actions'">
      <UCard class="max-w-2xl">
        <template #header><span class="font-medium">Workflow actions</span></template>
        <div class="space-y-6">
          <div v-if="transitionActions.length" class="space-y-4">
            <div>
              <div class="text-xs text-muted uppercase tracking-wide mb-3">Update status</div>
              <p class="text-xs text-muted mb-4">
                Current status: <span class="font-medium text-default">{{ detail.case.status }}</span>.
                Jurisdiction officers and the complainant are notified when you save.
              </p>
              <div class="space-y-4">
                <UFormField label="New status" required>
                  <USelectMenu
                    v-model="selectedToStatus"
                    :items="statusItems"
                    value-key="value"
                    label-key="label"
                    placeholder="Select new status…"
                    class="w-full"
                  />
                </UFormField>

                <UFormField label="Action taken" required help="What you did to move this case forward.">
                  <UTextarea v-model="actionTaken" class="w-full" :rows="3" placeholder="e.g. Reviewed intake details and opened investigation" />
                </UFormField>

                <UFormField label="What was updated" required help="Summary of changes for the timeline and records.">
                  <UTextarea v-model="updateSummary" class="w-full" :rows="3" placeholder="e.g. Status set to Investigation; assigned for field visit" />
                </UFormField>

                <UFormField
                  v-for="field in selectedTransition?.requires?.fields ?? []"
                  :key="field"
                  :label="field.replaceAll('_', ' ')"
                  required
                >
                  <UTextarea v-model="transitionFields[field]" class="w-full" :rows="field === 'resolution_summary' ? 4 : 2" />
                </UFormField>

                <div v-if="requiredAttachmentKinds.length || selectedToStatus" class="space-y-3 pt-1 border-t border-default">
                  <p class="text-sm font-medium">Documents</p>
                  <p v-if="requiredAttachmentKinds.length" class="text-xs text-muted">
                    Required for this transition:
                    <span v-for="(req, i) in requiredAttachmentKinds" :key="req.kind">
                      {{ req.label }}<span v-if="stagedKindCodes.has(req.kind)" class="text-success"> ✓</span><span v-if="i < requiredAttachmentKinds.length - 1">, </span>
                    </span>
                  </p>
                  <div
                    v-for="req in requiredAttachmentKinds"
                    :key="req.kind"
                    class="flex flex-wrap items-center gap-2"
                  >
                    <span class="text-sm min-w-40">{{ req.label }}</span>
                    <label class="cursor-pointer">
                      <input
                        type="file"
                        class="hidden"
                        accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
                        @change="onTransitionFileInput(req.kind, $event)"
                      />
                      <UButton size="xs" variant="soft" :loading="stagingUpload" as="span">Choose file</UButton>
                    </label>
                  </div>
                  <div
                    v-for="opt in optionalTransitionKinds"
                    :key="opt.kind"
                    class="flex flex-wrap items-center gap-2"
                  >
                    <span class="text-sm min-w-40 text-muted">{{ opt.label }} (optional)</span>
                    <label class="cursor-pointer">
                      <input
                        type="file"
                        class="hidden"
                        accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
                        @change="onTransitionFileInput(opt.kind, $event)"
                      />
                      <UButton size="xs" variant="ghost" :loading="stagingUpload" as="span">Choose file</UButton>
                    </label>
                  </div>
                  <div v-if="stagedAttachments.length" class="space-y-1">
                    <div
                      v-for="item in stagedAttachments"
                      :key="item.id"
                      class="flex items-center justify-between text-sm gap-2 py-1"
                    >
                      <span class="truncate">{{ item.filename }} <span class="text-muted">({{ item.kind }})</span></span>
                      <UButton size="xs" variant="ghost" color="error" @click="removeStagedAttachment(item)">Remove</UButton>
                    </div>
                  </div>
                </div>

                <div class="flex flex-wrap gap-2 pt-1">
                  <UButton :loading="actionLoading" :disabled="!canSubmitTransition" @click="runTransition">
                    Update status
                  </UButton>
                  <UButton variant="outline" :disabled="actionLoading" @click="resetTransitionForm">
                    Clear
                  </UButton>
                </div>
              </div>
            </div>
          </div>

          <p v-if="!transitionActions.length" class="text-sm text-muted">
            No status updates available for your role on this case.
          </p>

          <UAlert v-if="actionError" color="error" :title="actionError" />
        </div>
      </UCard>
    </div>

    <div v-else-if="activeTab === 'documents'">
      <UCard>
        <template #header><span class="font-medium">Case documents</span></template>
        <div class="space-y-6">
          <div class="grid sm:grid-cols-2 gap-3">
            <UFormField label="Document type">
              <USelectMenu
                v-model="docUploadKind"
                :items="kindSelectItems"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Note (optional)">
              <UInput v-model="docUploadNote" class="w-full" placeholder="e.g. Site visit photos" />
            </UFormField>
          </div>
          <div>
            <input
              ref="docFileInput"
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
              class="hidden"
              @change="onDocFileChange"
            />
            <UButton icon="i-lucide-upload" :loading="stagingUpload" @click="docFileInput?.click()">
              Upload documents
            </UButton>
          </div>

          <div v-if="attachmentsLoading" class="text-sm text-muted">Loading…</div>
          <div v-else-if="attachments.length === 0" class="text-sm text-muted">No documents yet.</div>
          <div v-else class="overflow-x-auto">
            <table class="w-full text-sm min-w-[520px]">
              <thead>
                <tr class="text-left text-muted border-b border-default">
                  <th class="py-2 pr-3">Type</th>
                  <th class="py-2 pr-3">File</th>
                  <th class="py-2 pr-3">Size</th>
                  <th class="py-2 pr-3">Uploaded</th>
                  <th class="py-2 w-20" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="doc in attachments" :key="doc.id" class="border-b border-default">
                  <td class="py-2 pr-3">{{ doc.kind_label }}</td>
                  <td class="py-2 pr-3 truncate max-w-xs">{{ doc.filename }}</td>
                  <td class="py-2 pr-3 text-muted">{{ formatBytes(doc.size_bytes) }}</td>
                  <td class="py-2 pr-3 text-muted text-xs">
                    {{ doc.uploaded_by_name ?? '—' }} · {{ new Date(doc.created_at).toLocaleDateString() }}
                  </td>
                  <td class="py-2">
                    <UButton size="xs" variant="ghost" icon="i-lucide-download" @click="downloadFile(doc.id, doc.filename)" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </UCard>
    </div>

    <div v-else-if="activeTab === 'correspondence'" class="space-y-6">
      <UCard v-if="canComposeThread">
        <template #header><span class="font-medium">Compose</span></template>
        <div class="space-y-4">
          <UFormField v-if="composeModeItems.length > 1" label="Type">
            <USelectMenu
              v-model="composeMode"
              :items="composeModeItems"
              value-key="value"
              label-key="label"
              class="w-full"
            />
          </UFormField>
          <div v-if="composeMode === 'outbound'" class="grid sm:grid-cols-2 gap-4">
            <UFormField label="Message kind">
              <USelectMenu
                v-model="composeKind"
                :items="outboundKindItems"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>
          </div>
          <UFormField v-if="composeMode === 'logged_contact'" label="Contact channel">
            <USelectMenu
              v-model="composeChannel"
              :items="contactChannelItems"
              value-key="value"
              label-key="label"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Message">
            <UTextarea v-model="composeBody" :rows="5" class="w-full" placeholder="Write your message…" />
          </UFormField>
          <div v-if="composeMode !== 'internal'" class="flex flex-wrap items-center gap-3">
            <input
              ref="composeFileInput"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
              class="hidden"
              @change="onComposeFileChange"
            />
            <UButton size="sm" variant="outline" icon="i-lucide-paperclip" :loading="stagingUpload" @click="composeFileInput?.click()">
              Attach file
            </UButton>
            <ul v-if="composeStaged.length" class="text-sm text-muted space-y-1">
              <li v-for="f in composeStaged" :key="f.id">{{ f.filename }}</li>
            </ul>
          </div>
          <UAlert v-if="composeError" color="error" :title="composeError" />
          <UButton :loading="composeSending" :disabled="!composeBody.trim()" icon="i-lucide-send" @click="sendThreadMessage">
            Send
          </UButton>
        </div>
      </UCard>

      <UCard>
        <template #header><span class="font-medium">Thread</span></template>
        <div v-if="threadLoading" class="text-sm text-muted py-4">Loading…</div>
        <div v-else-if="threadEntries.length === 0" class="text-sm text-muted py-4">No messages yet.</div>
        <ol v-else class="space-y-4">
          <li
            v-for="entry in threadEntries"
            :key="entry.id"
            class="rounded-lg border border-default p-4"
            :class="entry.direction === 'internal_note' ? 'bg-warning/5' : ''"
          >
            <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <div class="flex items-center gap-2">
                <UBadge :color="(threadDirectionColor(entry) as any)" variant="subtle" size="sm">
                  {{ threadDirectionLabel(entry) }}
                </UBadge>
                <span class="text-sm font-medium">{{ entry.author_name ?? '—' }}</span>
              </div>
              <time class="text-xs text-muted">{{ new Date(entry.created_at).toLocaleString() }}</time>
            </div>
            <p class="text-sm whitespace-pre-wrap">{{ entry.body_display }}</p>
            <ul v-if="entry.attachments.length" class="mt-2 text-xs text-muted space-y-1">
              <li v-for="att in entry.attachments" :key="att.id">
                <button type="button" class="text-primary hover:underline" @click="downloadFile(att.id, att.filename)">
                  {{ att.kind_label }}: {{ att.filename }}
                </button>
              </li>
            </ul>
          </li>
        </ol>
      </UCard>
    </div>

    <div v-else-if="activeTab === 'assignment'" class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 space-y-6">
        <UCard>
          <template #header><span class="font-medium">Current officer</span></template>
          <div v-if="detail.case.assignee" class="flex items-start gap-4">
            <UAvatar :alt="detail.case.assignee.name" size="lg" />
            <div class="min-w-0">
              <div class="font-medium text-lg">{{ detail.case.assignee.name }}</div>
              <div class="text-sm text-muted">{{ detail.case.assignee.email }}</div>
              <div class="flex flex-wrap gap-2 mt-3">
                <UBadge color="success" variant="subtle">Handling case</UBadge>
                <UBadge color="neutral" variant="subtle" class="capitalize">{{ detail.case.status }}</UBadge>
              </div>
            </div>
          </div>
          <div v-else class="text-sm text-muted py-2">
            No officer assigned yet. This case is in the queue for {{ detail.case.unit ?? detail.case.level }}.
          </div>
        </UCard>

        <UCard>
          <template #header><span class="font-medium">Assignment history</span></template>
          <div v-if="assignmentHistory.length === 0" class="text-sm text-muted py-4 text-center">
            No assignment changes recorded yet.
          </div>
          <ol v-else class="space-y-3">
            <li v-for="ev in assignmentHistory" :key="ev.id" class="flex gap-3 text-sm">
              <UIcon name="i-lucide-user-round" class="mt-0.5 text-primary shrink-0" />
              <div>
                <span class="font-medium">{{ eventSummary(ev) }}</span>
                <div class="text-muted text-xs mt-1">{{ new Date(ev.createdAt).toLocaleString() }}</div>
              </div>
            </li>
          </ol>
        </UCard>
      </div>

      <UCard>
        <template #header><span class="font-medium">Assign officer</span></template>
        <div v-if="canAssign" class="space-y-4">
          <p class="text-xs text-muted">
            Officers assigned to {{ detail.case.unit ?? detail.case.level }} or parent jurisdictions.
            The assignee is notified by email and in-app.
          </p>
          <p v-if="!detail.case.assignee && selectedAssigneeId" class="text-xs text-muted">
            Suggested officer for this unit pre-selected when available.
          </p>
          <UFormField v-if="assignees.length" label="Officer">
            <USelectMenu
              v-model="selectedAssigneeId"
              :items="assignees.map((a) => ({ value: a.id, label: `${a.name} (${a.email})` }))"
              value-key="value"
              label-key="label"
              placeholder="Select officer…"
              class="w-full"
            />
          </UFormField>
          <p v-else class="text-sm text-muted">
            No officers are role-assigned to this jurisdiction. Add assignments under Admin → Users.
          </p>
          <UButton
            v-if="assignees.length"
            class="w-full justify-center"
            :loading="assignLoading"
            :disabled="!selectedAssigneeId || selectedAssigneeId === detail.case.assignee?.id"
            @click="runAssign"
          >
            {{ detail.case.assignee ? 'Reassign case' : 'Assign case' }}
          </UButton>
          <UAlert v-if="assignError" color="error" :title="assignError" />
        </div>
        <p v-else class="text-sm text-muted">
          You do not have permission to assign officers on this case.
        </p>
      </UCard>
    </div>

    <div v-else-if="activeTab === 'notifications'">
      <UCard :ui="{ body: 'p-0' }">
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <span class="font-medium">Notifications</span>
            <UButton
              size="xs"
              variant="ghost"
              icon="i-lucide-refresh-cw"
              :loading="notificationsLoading"
              @click="notificationsLoaded = false; loadNotifications()"
            >
              Refresh
            </UButton>
          </div>
        </template>

        <div v-if="notificationsLoading" class="p-8 text-center text-sm text-muted">
          Loading notifications…
        </div>

        <div v-else-if="notifications.length === 0" class="p-8 text-center text-sm text-muted">
          No notifications recorded for this case yet.
        </div>

        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-default text-left text-xs text-muted">
                <th class="px-4 py-3 font-medium">Sent</th>
                <th class="px-4 py-3 font-medium">Event</th>
                <th class="px-4 py-3 font-medium">Recipient</th>
                <th class="px-4 py-3 font-medium">Channel</th>
                <th class="px-4 py-3 font-medium">Template</th>
                <th class="px-4 py-3 font-medium">Status</th>
                <th class="px-4 py-3 font-medium">Preview</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="n in notifications"
                :key="n.id"
                class="border-b border-default/60 align-top hover:bg-elevated/30"
              >
                <td class="px-4 py-3 whitespace-nowrap text-xs text-muted">
                  {{ new Date(n.created_at).toLocaleString() }}
                </td>
                <td class="px-4 py-3 font-mono text-xs">{{ n.event_kind }}</td>
                <td class="px-4 py-3 text-xs">{{ n.recipient_kind.replaceAll(':', ' · ') }}</td>
                <td class="px-4 py-3">
                  <UBadge size="sm" variant="subtle" color="neutral">{{ channelLabel(n.channel) }}</UBadge>
                </td>
                <td class="px-4 py-3 font-mono text-xs">{{ n.template_id }}</td>
                <td class="px-4 py-3">
                  <UBadge
                    size="sm"
                    variant="subtle"
                    :color="(notificationStatusColor(n.status) as any)"
                    class="capitalize"
                  >
                    {{ formatNotificationStatus(n.status) }}
                  </UBadge>
                  <div v-if="n.attempts > 1" class="text-[11px] text-muted mt-1">{{ n.attempts }} attempts</div>
                  <div v-if="n.provider_message_id" class="text-[11px] text-muted mt-1 font-mono truncate max-w-[10rem]" :title="n.provider_message_id">
                    {{ n.provider_message_id }}
                  </div>
                </td>
                <td class="px-4 py-3 text-xs text-muted max-w-xs">
                  <p class="line-clamp-3 whitespace-pre-wrap">{{ n.rendered_preview ?? '—' }}</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </div>

    <div v-else-if="activeTab === 'timeline'">
      <UCard>
        <template #header><span class="font-medium">Timeline</span></template>
        <div v-if="detail.events.length === 0" class="text-sm text-muted py-4 text-center">
          No events recorded yet.
        </div>
        <ol v-else class="space-y-4">
          <li v-for="ev in detail.events" :key="ev.id" class="flex gap-3 text-sm">
            <UIcon name="i-lucide-circle-dot" class="mt-0.5 text-primary shrink-0" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center flex-wrap gap-2">
                <span class="font-medium capitalize">{{ ev.kind.replaceAll('_', ' ') }}</span>
                <UBadge size="sm" variant="subtle" color="neutral">{{ ev.actorType }}</UBadge>
                <UBadge v-if="ev.visibility === 'internal'" size="sm" variant="subtle" color="warning">internal</UBadge>
              </div>
              <p v-if="eventSummary(ev)" class="text-muted mt-0.5">{{ eventSummary(ev) }}</p>
              <div class="text-muted text-xs mt-1">{{ new Date(ev.createdAt).toLocaleString() }}</div>
            </div>
          </li>
        </ol>
      </UCard>
    </div>
  </div>
</template>
