<script setup lang="ts">
import type { TimelineItem } from '@nuxt/ui';
import { kindsForChannel, threadChannelLabel } from '@egrm/config-schemas';
import { buildThreadTree, hasPermission } from '@egrm/core';
import { apiErrorMessage } from '~/utils/api-errors';
import { formatLocalDate } from '~/utils/intake-values';

definePageMeta({ layout: 'shell' });

const route = useRoute();
const { api } = useApi();
const { user, fetchMe } = useAuth();
const { setPageBreadcrumb, clearPageBreadcrumb } = usePageBreadcrumbs();
const toast = useToast();
const caseId = computed(() => String(route.params.id));
const { stageFile, removeStaged, downloadFile } = useCaseAttachmentUpload(caseId.value);
const {
  options: fieldOptions,
  savingField,
  canEditFields,
  canEditSensitivityValue,
  loadOptions: loadFieldOptions,
  saveField,
  saveComplainantField,
  formatCategoryList,
  formatNotificationChannels,
  labelFor,
} = useCaseFieldEdit(caseId);

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
  in_reply_to_id?: string | null;
  attachments: { id: string; filename: string; kind: string; kind_label: string }[];
  created_at: string;
}

interface CaseDetail {
  case: {
    id: string; reference: string; case_type: string; status: string; status_tag: string;
    level: string; unit_id: string | null; unit: string | null; assignee: CaseAssignee | null; anonymous: boolean; channel: string;
    categories: string[]; sensitivity: string; priority: string; summary: string;
    description: string | null; expected_outcome: string | null;
    date_occurred: string | null; consent: boolean; created_at: string;
  };
  complainant: {
    name: string | null; phone: string | null; email: string | null;
    gender: string | null; age_band: string | null; preferred_language: string | null;
    notification_channels?: string[];
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
  last_error: string | null;
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
const workflowBundleLoading = ref(false);
const transitionFields = ref<Record<string, string>>({});
const selectedAssigneeId = ref<string | null>(null);
const notifications = ref<CaseNotification[]>([]);
const notificationsLoading = ref(false);
const notificationsLoaded = ref(false);
const timelineRefreshing = ref(false);
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
const renamingId = ref<string | null>(null);
const renameValue = ref('');

const canUploadAttachment = computed(() => hasPermission(user.value?.permissions ?? [], 'attachment:upload'));
const canDownloadAttachment = computed(() => hasPermission(user.value?.permissions ?? [], 'attachment:download'));
const canRenameAttachment = computed(() => hasPermission(user.value?.permissions ?? [], 'attachment:rename'));
const canDeleteAttachment = computed(() => hasPermission(user.value?.permissions ?? [], 'attachment:delete_soft'));
const canRemoveStagedAttachment = computed(() => canUploadAttachment.value || canDeleteAttachment.value);

const threadEntries = ref<ThreadEntry[]>([]);
const threadLoading = ref(false);
const threadLoaded = ref(false);

const threadEntryById = computed(() =>
  Object.fromEntries(threadEntries.value.map((e) => [e.id, e])),
);

const threadTree = computed(() => buildThreadTree(threadEntries.value));
const composeMode = ref<'outbound' | 'logged_contact' | 'internal'>('outbound');
const composeBody = ref('');
const composeKind = ref('free_text');
const composeOutboundChannel = ref('portal');
const composeChannel = ref('phone');
const composeSending = ref(false);
const composeError = ref('');
const composeStaged = ref<StagedAttachment[]>([]);
const composeFileInput = ref<HTMLInputElement | null>(null);
const composeReplyTo = ref<ThreadEntry | null>(null);

const canReadThread = computed(() => hasPermission(user.value?.permissions ?? [], 'thread:read'));
const canReplyExternal = computed(() => hasPermission(user.value?.permissions ?? [], 'thread:reply_external'));
const canNoteInternal = computed(() => hasPermission(user.value?.permissions ?? [], 'thread:note_internal'));
const canComposeThread = computed(() => canReplyExternal.value || canNoteInternal.value);

const canHandleSensitive = computed(() => hasPermission(user.value?.permissions ?? [], 'sensitive:handle'));

const sensitivityEditOptions = computed(() => {
  const items = fieldOptions.value?.sensitivity ?? [];
  return items
    .filter((s) => !s.restricted || canHandleSensitive.value)
    .map((s) => ({ value: s.value, label: s.label }));
});

async function saveCaseField(field: string, value: unknown) {
  if (!detail.value) return;
  const updated = await saveField(field, value);
  if (!updated) return;
  detail.value.case = {
    ...detail.value.case,
    summary: updated.summary,
    description: updated.description,
    expected_outcome: updated.expected_outcome,
    date_occurred: updated.date_occurred,
    categories: updated.categories,
    priority: updated.priority,
    sensitivity: updated.sensitivity,
    unit_id: updated.unit_id,
    unit: updated.unit,
    level: updated.level,
  };
  await loadCase();
}

async function saveComplainant(field: string, value: unknown) {
  if (!detail.value?.complainant) return;
  const updated = await saveComplainantField(field, value);
  if (!updated) return;
  detail.value.complainant = updated;
}

const canEditComplainant = computed(
  () => canEditFields.value && Boolean(detail.value?.complainant) && !detail.value?.case.anonymous,
);

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
  { value: 'phone', label: 'Phone call' },
  { value: 'in_person', label: 'In person / field visit' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
];

const outboundDeliveryChannelItems = computed(() => {
  const c = detail.value?.complainant;
  return [
    {
      value: 'portal',
      label: 'Track portal only',
      description: 'Posted on the tracking page — no SMS/email alert',
      disabled: false,
    },
    {
      value: 'sms',
      label: 'SMS + track portal',
      description: c?.phone ? `Send pointer SMS to ${c.phone}` : 'No phone on file',
      disabled: !c?.phone,
    },
    {
      value: 'email',
      label: 'Email + track portal',
      description: c?.email ? `Send pointer email to ${c.email}` : 'No email on file',
      disabled: !c?.email,
    },
    {
      value: 'whatsapp',
      label: 'WhatsApp + track portal',
      description: c?.phone ? `Send pointer WhatsApp to ${c.phone}` : 'No phone on file',
      disabled: !c?.phone,
    },
  ];
});

const complainantChannelSummary = computed(() => {
  const channels = detail.value?.complainant?.notification_channels ?? [];
  if (!channels.length) return null;
  return channels.map((ch) => threadChannelLabel(ch)).join(', ');
});

function defaultOutboundChannel(): string {
  const c = detail.value?.complainant;
  const prefs = c?.notification_channels ?? [];
  for (const ch of prefs) {
    if ((ch === 'sms' || ch === 'whatsapp') && c?.phone) return ch;
    if (ch === 'email' && c?.email) return 'email';
  }
  if (c?.phone) return 'sms';
  if (c?.email) return 'email';
  return 'portal';
}

function formatThreadChannel(channel: string): string {
  return threadChannelLabel(channel);
}

const caseTabUi = {
  label: 'sr-only sm:not-sr-only sm:truncate',
  trigger: 'max-sm:px-2 max-sm:justify-center',
} as const;

function caseTab(label: string, value: string, icon: string) {
  return { label, value, icon, title: label, ui: caseTabUi };
}

const tabItems = computed(() => {
  const items = [
    caseTab('Overview', 'overview', 'i-lucide-layout-dashboard'),
    caseTab('Actions', 'actions', 'i-lucide-play'),
    caseTab('Documents', 'documents', 'i-lucide-paperclip'),
  ];
  if (canReadThread.value) {
    items.push(caseTab('Correspondence', 'correspondence', 'i-lucide-messages-square'));
  }
  items.push(
    caseTab('Assignment', 'assignment', 'i-lucide-user-check'),
    caseTab('Notifications', 'notifications', 'i-lucide-bell'),
    caseTab('Timeline', 'timeline', 'i-lucide-history'),
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

function notificationHasError(n: CaseNotification): boolean {
  return n.status.startsWith('failed') || Boolean(n.last_error);
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
    party_channel_unavailable: 'The complainant does not have contact details for that delivery channel.',
    invalid_thread_channel: 'That delivery channel is not allowed.',
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

function normalizedFilename(name: string): string {
  return name.trim().toLowerCase();
}

function isDuplicateDocument(filename: string): boolean {
  const key = normalizedFilename(filename);
  if (stagedAttachments.value.some((a) => normalizedFilename(a.filename) === key)) return true;
  if (attachments.value.some((a) => normalizedFilename(a.filename) === key)) return true;
  if (composeStaged.value.some((a) => normalizedFilename(a.filename) === key)) return true;
  return false;
}

function hasStagedKind(kind: string): boolean {
  return stagedAttachments.value.some((a) => a.kind === kind);
}

function notifyDuplicateDocument(filename: string) {
  toast.add({
    title: 'Duplicate document',
    description: `"${filename}" is already on this case or pending upload.`,
    color: 'warning',
  });
}

const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
  duplicate_attachment: 'This file was already uploaded to this case.',
  attachment_policy_violation: 'File upload violates attachment policy.',
  unknown_attachment_kind: 'Unknown document type.',
};

function notifyUploadError(e: unknown, fallback = 'Could not upload document.') {
  toast.add({
    title: 'Upload failed',
    description: apiErrorMessage(e, UPLOAD_ERROR_MESSAGES) || fallback,
    color: 'error',
  });
}

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
  if (isDuplicateDocument(file.name)) {
    notifyDuplicateDocument(file.name);
    return;
  }
  if (hasStagedKind(kind)) {
    toast.add({
      title: 'Document type already attached',
      description: 'Remove the existing file for this type before choosing another.',
      color: 'warning',
    });
    return;
  }
  stagingUpload.value = true;
  try {
    const res = await stageFile(file, kind);
    stagedAttachments.value.push({ id: res.attachment_id, kind, filename: file.name });
  } catch (e: unknown) {
    notifyUploadError(e);
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
  if (!canRemoveStagedAttachment.value) return;
  await removeStaged(item.id);
  stagedAttachments.value = stagedAttachments.value.filter((a) => a.id !== item.id);
}

function startRename(doc: CaseAttachment) {
  renamingId.value = doc.id;
  renameValue.value = doc.filename;
}

function cancelRename() {
  renamingId.value = null;
  renameValue.value = '';
}

async function renameDocument(id: string) {
  const filename = renameValue.value.trim();
  if (!filename) return;
  try {
    await api(`/api/v1/cases/${route.params.id}/attachments/${id}`, {
      method: 'PATCH',
      body: { filename },
    });
    cancelRename();
    attachmentsLoaded.value = false;
    await loadAttachments();
    toast.add({ title: 'File renamed', color: 'success' });
  } catch (e: unknown) {
    notifyUploadError(e, 'Could not rename file.');
  }
}

async function deleteDocument(doc: CaseAttachment) {
  try {
    await api(`/api/v1/cases/${route.params.id}/attachments/${doc.id}`, { method: 'DELETE' });
    attachmentsLoaded.value = false;
    await loadAttachments();
    toast.add({ title: 'Document removed', description: doc.filename, color: 'success' });
  } catch (e: unknown) {
    notifyUploadError(e, 'Could not delete document.');
  }
}

async function onDocFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = input.files;
  if (!files?.length) return;
  stagingUpload.value = true;
  try {
    const ids: string[] = [];
    let skipped = 0;
    for (const file of files) {
      if (isDuplicateDocument(file.name)) {
        skipped += 1;
        continue;
      }
      try {
        const res = await stageFile(file, docUploadKind.value);
        ids.push(res.attachment_id);
      } catch (e: unknown) {
        notifyUploadError(e);
      }
    }
    if (skipped > 0) {
      toast.add({
        title: 'Duplicate document',
        description: skipped === 1
          ? 'Skipped 1 file already on this case.'
          : `Skipped ${skipped} files already on this case.`,
        color: 'warning',
      });
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
  if (ev.kind === 'field_edited' && typeof d.field === 'string') {
    const field = d.field as string;
    return `${eventFieldLabel(field)}: ${formatEventFieldValue(field, d.from)} → ${formatEventFieldValue(field, d.to)}`;
  }
  return null;
}

interface FieldEditSummary {
  label: string;
  from: string;
  to: string;
}

function fieldEditSummary(ev: CaseDetail['events'][number]): FieldEditSummary | null {
  if (ev.kind !== 'field_edited') return null;
  const d = ev.data;
  if (typeof d.field !== 'string') return null;
  const field = d.field as string;
  return {
    label: eventFieldLabel(field),
    from: formatEventFieldValue(field, d.from),
    to: formatEventFieldValue(field, d.to),
  };
}

interface CaseTimelineItem extends TimelineItem {
  kind: string;
  actorType: string;
  visibility: string;
  fieldEdit?: FieldEditSummary;
}

const EVENT_ICONS: Record<string, string> = {
  created: 'i-lucide-file-plus',
  status_changed: 'i-lucide-git-compare-arrows',
  assigned: 'i-lucide-user-round-check',
  message_external: 'i-lucide-send',
  message_inbound: 'i-lucide-message-circle-reply',
  note_internal: 'i-lucide-sticky-note',
  attachment_added: 'i-lucide-paperclip',
  field_edited: 'i-lucide-pencil-line',
  level_moved: 'i-lucide-layers',
  referred_out: 'i-lucide-external-link',
  reopened: 'i-lucide-rotate-ccw',
  closed: 'i-lucide-archive',
  resolved: 'i-lucide-check-circle',
};

function eventKindLabel(kind: string): string {
  return kind.replaceAll('_', ' ');
}

function eventFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    summary: 'Summary',
    description: 'Description',
    expected_outcome: 'Expected outcome',
    date_occurred: 'Date occurred',
    categories: 'Categories',
    priority: 'Priority',
    sensitivity: 'Sensitivity',
    unit_id: 'Location',
    'complainant.name': 'Name',
    'complainant.phone': 'Phone',
    'complainant.email': 'Email',
    'complainant.gender': 'Gender',
    'complainant.age_band': 'Age band',
    'complainant.preferred_language': 'Preferred language',
    'complainant.notification_channels': 'Notification channels',
  };
  return labels[field] ?? field.replace(/^complainant\./, '').replaceAll('_', ' ');
}

function formatEventFieldValue(field: string, val: unknown): string {
  if (val === null || val === undefined || val === '') return '—';
  if (field === 'date_occurred' || field.endsWith('date_occurred')) {
    const formatted = formatLocalDate(val);
    if (formatted) return formatted;
  }
  if (Array.isArray(val)) {
    return val.length ? val.map(String).join(', ') : '—';
  }
  const s = String(val);
  if (s.length > 200) return `${s.slice(0, 197)}…`;
  return s;
}

function eventIcon(kind: string): string {
  return EVENT_ICONS[kind] ?? 'i-lucide-circle-dot';
}

const timelineItems = computed((): CaseTimelineItem[] =>
  [...(detail.value?.events ?? [])]
    .reverse()
    .map((ev) => {
      const fieldEdit = fieldEditSummary(ev);
      const summary = fieldEdit ? undefined : eventSummary(ev);
      return {
        value: ev.id,
        date: new Date(ev.createdAt).toLocaleString(),
        title: eventKindLabel(ev.kind),
        description: summary ?? undefined,
        icon: eventIcon(ev.kind),
        kind: ev.kind,
        actorType: ev.actorType,
        visibility: ev.visibility,
        fieldEdit,
      };
    }),
);

const timelineActive = computed(() => {
  const items = timelineItems.value;
  return items.length ? items[0]!.value : undefined;
});

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
  composeOutboundChannel.value = defaultOutboundChannel();
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

async function suggestWorkflowBundle() {
  if (!selectedToStatus.value) {
    toast.add({
      title: 'Select new status first',
      description: 'Choose the target status, then AI can draft the workflow fields.',
      color: 'warning',
    });
    return;
  }
  const extraFields = selectedTransition.value?.requires?.fields ?? [];
  workflowBundleLoading.value = true;
  try {
    const res = await api<{
      interaction_id: string;
      suggestion: { drafts?: Record<string, string> };
    }>(`/api/v1/cases/${caseId.value}/ai/suggest`, {
      method: 'POST',
      body: {
        capability: 'draft_response',
        params: {
          context: 'workflow_transition',
          bundle: true,
          to_status: selectedToStatus.value,
          extra_fields: extraFields.length ? extraFields : undefined,
        },
      },
    });
    const drafts = res.suggestion.drafts ?? {};
    if (drafts.action_taken) actionTaken.value = drafts.action_taken;
    if (drafts.update_summary) updateSummary.value = drafts.update_summary;
    for (const field of extraFields) {
      if (drafts[field]) transitionFields.value[field] = drafts[field]!;
    }
    await api(`/api/v1/ai/interactions/${res.interaction_id}/decide`, {
      method: 'POST',
      body: { decision: 'accepted' },
    });
    toast.add({
      title: 'AI drafts inserted',
      description: 'Review all fields before saving the workflow action.',
      color: 'success',
    });
  } catch (e: unknown) {
    toast.add({
      title: 'Could not generate drafts',
      description: apiErrorMessage(e),
      color: 'error',
    });
  } finally {
    workflowBundleLoading.value = false;
  }
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


function resetCompose() {
  composeBody.value = '';
  composeStaged.value = [];
  composeError.value = '';
  composeReplyTo.value = null;
  if (composeModeItems.value.length) composeMode.value = composeModeItems.value[0]!.value;
}

function startReply(entry?: ThreadEntry) {
  if (!canReplyExternal.value) return;
  composeMode.value = 'outbound';
  composeOutboundChannel.value = defaultOutboundChannel();
  composeReplyTo.value = entry ?? [...threadEntries.value].reverse().find((e) => e.direction === 'inbound') ?? null;
  composeError.value = '';
  nextTick(() => {
    document.getElementById('compose-correspondence')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function cancelReply() {
  composeReplyTo.value = null;
}

async function onComposeFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (isDuplicateDocument(file.name)) {
    notifyDuplicateDocument(file.name);
    input.value = '';
    return;
  }
  stagingUpload.value = true;
  try {
    const res = await stageFile(file, docUploadKind.value);
    composeStaged.value.push({ id: res.attachment_id, kind: docUploadKind.value, filename: file.name });
  } catch (e: unknown) {
    notifyUploadError(e);
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
        channel:
          composeMode.value === 'logged_contact'
            ? composeChannel.value
            : internal
              ? 'console'
              : composeOutboundChannel.value,
        visibility: internal ? 'staff' : 'public',
        attachment_ids: composeStaged.value.length ? composeStaged.value.map((a) => a.id) : undefined,
        in_reply_to_id: composeReplyTo.value?.id,
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

async function loadNotifications(force = false) {
  if (!detail.value || (notificationsLoaded.value && !force)) return;
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

function refreshNotifications() {
  void loadNotifications(true);
}

async function refreshTimeline() {
  timelineRefreshing.value = true;
  try {
    await loadCase();
  } finally {
    timelineRefreshing.value = false;
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
  if (canEditFields.value) await loadFieldOptions();
});

watch(
  () => detail.value?.case.reference,
  (reference) => {
    if (!reference) return;
    setPageBreadcrumb([
      { label: 'Cases', to: '/cases', icon: 'i-lucide-inbox' },
      { label: reference },
    ]);
  },
  { immediate: true },
);

onUnmounted(clearPageBreadcrumb);
</script>

<template>
  <div v-if="user && detail" class="relative flex flex-col h-[100dvh] max-h-[100dvh] overflow-hidden bg-default">
    <header class="shrink-0 z-20 border-b border-default bg-default px-4 sm:px-8 pt-4">
      <div class="flex items-start justify-between mb-4">
        <div class="min-w-0">
          <div class="flex items-center gap-3 flex-wrap">
            <h1 class="text-2xl font-semibold font-mono">{{ detail.case.reference }}</h1>
            <UBadge :color="(tagColor[detail.case.status_tag] as any) ?? 'neutral'">{{ detail.case.status }}</UBadge>
            <UBadge v-if="detail.case.anonymous" color="neutral" variant="subtle">anonymous</UBadge>
          </div>
          <p class="text-muted mt-1">{{ detail.case.summary }}</p>
        </div>
      </div>

      <UTabs
        v-model="activeTab"
        :items="tabItems"
        variant="link"
        size="sm"
        class="pb-0 w-full"
        :ui="{ list: 'w-full overflow-x-auto', trigger: 'shrink-0' }"
      />
    </header>

    <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 sm:px-8 py-4">
    <div v-if="activeTab === 'overview'" class="space-y-2 max-w-6xl w-full">
      <details open class="group rounded-lg border border-default bg-default w-full">
        <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium hover:bg-elevated/40 rounded-lg [&::-webkit-details-marker]:hidden">
          <div class="flex min-w-0 items-center gap-2">
            <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-muted transition-transform group-open:rotate-90" />
            <span>Grievance details</span>
          </div>
          <div id="grievance-details-header-actions" class="shrink-0" @click.stop />
        </summary>
        <div class="px-4 pb-4 pt-0 border-t border-default">
          <CaseGrievanceTriage
            :case-id="caseId"
            :categories="detail.case.categories"
            :priority="detail.case.priority"
            :sensitivity="detail.case.sensitivity"
            @applied="loadCase"
          />
          <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm pt-3 w-full">
            <CaseInlineField
              label="Categories"
              :display="formatCategoryList(detail.case.categories)"
              :value="detail.case.categories"
              type="multiselect"
              :options="fieldOptions?.categories ?? []"
              :can-edit="canEditFields"
              :saving="savingField === 'categories'"
              @save="saveCaseField('categories', $event)"
            />
            <div><dt class="text-muted text-xs">Channel</dt><dd class="capitalize">{{ detail.case.channel.replace(/_/g, ' ') }}</dd></div>
            <div><dt class="text-muted text-xs">Level</dt><dd class="capitalize">{{ detail.case.level }}</dd></div>
            <CaseInlineField
              label="Location"
              :display="detail.case.unit ?? '—'"
              :value="detail.case.unit_id"
              type="unit"
              :can-edit="canEditFields"
              :saving="savingField === 'unit_id'"
              @save="saveCaseField('unit_id', $event)"
            />
            <CaseInlineField
              label="Priority"
              :display="labelFor(fieldOptions?.priorities ?? [], detail.case.priority)"
              :value="detail.case.priority"
              type="select"
              :options="fieldOptions?.priorities ?? []"
              :can-edit="canEditFields"
              :saving="savingField === 'priority'"
              @save="saveCaseField('priority', $event)"
            />
            <CaseInlineField
              label="Sensitivity"
              :display="labelFor(fieldOptions?.sensitivity ?? [], detail.case.sensitivity)"
              :value="detail.case.sensitivity"
              type="select"
              :options="sensitivityEditOptions"
              :can-edit="canEditFields && canEditSensitivityValue(detail.case.sensitivity)"
              :saving="savingField === 'sensitivity'"
              @save="saveCaseField('sensitivity', $event)"
            />
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
            <CaseInlineField
              label="Occurred"
              :display="formatLocalDate(detail.case.date_occurred)"
              :value="detail.case.date_occurred"
              type="date"
              :can-edit="canEditFields"
              :saving="savingField === 'date_occurred'"
              @save="saveCaseField('date_occurred', $event)"
            />
            <div><dt class="text-muted text-xs">Received</dt><dd>{{ new Date(detail.case.created_at).toLocaleString() }}</dd></div>
            <CaseInlineField
              label="Summary"
              :display="detail.case.summary"
              :value="detail.case.summary"
              type="text"
              full-width
              :can-edit="canEditFields"
              :saving="savingField === 'summary'"
              @save="saveCaseField('summary', $event)"
            />
            <CaseInlineField
              label="Describe your grievance"
              :display="detail.case.description ?? '—'"
              :value="detail.case.description"
              type="textarea"
              full-width
              :can-edit="canEditFields"
              :saving="savingField === 'description'"
              @save="saveCaseField('description', $event)"
            />
            <CaseInlineField
              label="Expected outcome"
              :display="detail.case.expected_outcome ?? '—'"
              :value="detail.case.expected_outcome"
              type="textarea"
              full-width
              :can-edit="canEditFields"
              :saving="savingField === 'expected_outcome'"
              @save="saveCaseField('expected_outcome', $event)"
            />
          </dl>
        </div>
      </details>

      <details class="group rounded-lg border border-default bg-default w-full">
        <summary class="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-elevated/40 rounded-lg [&::-webkit-details-marker]:hidden">
          <UIcon name="i-lucide-chevron-right" class="size-4 text-muted transition-transform group-open:rotate-90" />
          Complainant
          <UBadge v-if="detail.case.anonymous" size="xs" color="neutral" variant="subtle" class="ml-1">anonymous</UBadge>
        </summary>
        <div class="px-4 pb-4 pt-0 border-t border-default">
          <div v-if="detail.case.anonymous" class="text-sm text-muted pt-3">Anonymous submission — no personal data collected.</div>
          <dl v-else-if="detail.complainant" class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm pt-3 w-full">
            <CaseInlineField
              label="Name"
              :display="detail.complainant.name ?? '—'"
              :value="detail.complainant.name"
              type="text"
              :can-edit="canEditComplainant"
              :saving="savingField === 'complainant.name'"
              @save="saveComplainant('name', $event)"
            />
            <CaseInlineField
              label="Phone"
              :display="detail.complainant.phone ?? '—'"
              :value="detail.complainant.phone"
              type="text"
              :can-edit="canEditComplainant"
              :saving="savingField === 'complainant.phone'"
              @save="saveComplainant('phone', $event)"
            />
            <CaseInlineField
              label="Email"
              :display="detail.complainant.email ?? '—'"
              :value="detail.complainant.email"
              type="text"
              :can-edit="canEditComplainant"
              :saving="savingField === 'complainant.email'"
              @save="saveComplainant('email', $event)"
            />
            <CaseInlineField
              v-if="(fieldOptions?.complainant?.gender?.length ?? 0) > 0 || detail.complainant.gender"
              label="Gender"
              :display="labelFor(fieldOptions?.complainant?.gender ?? [], detail.complainant.gender ?? '') || detail.complainant.gender || '—'"
              :value="detail.complainant.gender"
              :type="(fieldOptions?.complainant?.gender?.length ?? 0) > 0 ? 'select' : 'text'"
              :options="fieldOptions?.complainant?.gender ?? []"
              :can-edit="canEditComplainant"
              :saving="savingField === 'complainant.gender'"
              @save="saveComplainant('gender', $event)"
            />
            <CaseInlineField
              v-if="(fieldOptions?.complainant?.age_band?.length ?? 0) > 0 || detail.complainant.age_band"
              label="Age band"
              :display="labelFor(fieldOptions?.complainant?.age_band ?? [], detail.complainant.age_band ?? '') || detail.complainant.age_band || '—'"
              :value="detail.complainant.age_band"
              :type="(fieldOptions?.complainant?.age_band?.length ?? 0) > 0 ? 'select' : 'text'"
              :options="fieldOptions?.complainant?.age_band ?? []"
              :can-edit="canEditComplainant"
              :saving="savingField === 'complainant.age_band'"
              @save="saveComplainant('age_band', $event)"
            />
            <CaseInlineField
              v-if="(fieldOptions?.complainant?.preferred_language?.length ?? 0) > 0 || detail.complainant.preferred_language"
              label="Preferred language"
              :display="labelFor(fieldOptions?.complainant?.preferred_language ?? [], detail.complainant.preferred_language ?? '') || detail.complainant.preferred_language || '—'"
              :value="detail.complainant.preferred_language"
              :type="(fieldOptions?.complainant?.preferred_language?.length ?? 0) > 0 ? 'select' : 'text'"
              :options="fieldOptions?.complainant?.preferred_language ?? []"
              :can-edit="canEditComplainant"
              :saving="savingField === 'complainant.preferred_language'"
              @save="saveComplainant('preferred_language', $event)"
            />
            <CaseInlineField
              v-if="(fieldOptions?.complainant?.notification_channels?.length ?? 0) > 0 || (detail.complainant.notification_channels?.length ?? 0) > 0"
              label="Notification channels"
              :display="formatNotificationChannels(detail.complainant.notification_channels ?? [])"
              :value="detail.complainant.notification_channels ?? []"
              type="multiselect"
              :options="fieldOptions?.complainant?.notification_channels ?? []"
              :can-edit="canEditComplainant"
              :saving="savingField === 'complainant.notification_channels'"
              full-width
              @save="saveComplainant('notification_channels', $event)"
            />
          </dl>
          <div v-else class="text-sm text-muted pt-3">No party record.</div>
          <p v-if="!detail.case.anonymous" class="text-xs text-muted mt-3 pt-3 border-t border-default">PII access is logged in the audit trail.</p>
        </div>
      </details>
    </div>

    <div v-else-if="activeTab === 'actions'">
      <UCard class="max-w-6xl w-full">
        <template #header><span class="font-medium">Workflow actions</span></template>
        <div class="space-y-6">
          <div v-if="transitionActions.length" class="space-y-4">
            <div>
              <div class="text-xs text-muted uppercase tracking-wide mb-3">Update status</div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 w-full">
                <p class="col-span-1 sm:col-span-2 text-xs text-muted">
                  Current status: <span class="font-medium text-default">{{ detail.case.status }}</span>.
                  Jurisdiction officers and the complainant are notified when you save.
                </p>

                <p v-if="!selectedToStatus" class="col-span-1 sm:col-span-2 text-xs text-muted">
                  Select <span class="font-medium text-default">new status</span> first — AI uses it to draft workflow text.
                </p>

                <div class="col-span-1 sm:col-span-2 min-w-0 w-full max-w-full">
                  <div class="flex flex-wrap items-end gap-3">
                    <UFormField label="New status" required class="flex-1 min-w-[12rem]">
                      <USelectMenu
                        v-model="selectedToStatus"
                        :items="statusItems"
                        value-key="value"
                        label-key="label"
                        placeholder="Select new status…"
                        class="w-full max-w-full"
                      />
                    </UFormField>
                    <UButton
                      type="button"
                      size="sm"
                      variant="soft"
                      color="primary"
                      icon="i-lucide-sparkles"
                      class="shrink-0"
                      :loading="workflowBundleLoading"
                      :disabled="!selectedToStatus"
                      :title="selectedToStatus ? 'Draft workflow fields for this transition' : 'Select new status first'"
                      @click="suggestWorkflowBundle"
                    >
                      Suggest with AI
                    </UButton>
                  </div>
                </div>

                <div class="col-span-1 sm:col-span-2 min-w-0 w-full max-w-full space-y-1.5">
                  <span class="text-sm font-medium">Action taken <span class="text-error">*</span></span>
                  <p class="text-xs text-muted">What you did to move this case forward.</p>
                  <UTextarea v-model="actionTaken" class="w-full max-w-full" :rows="3" placeholder="e.g. Reviewed intake details and opened investigation" />
                </div>

                <div class="col-span-1 sm:col-span-2 min-w-0 w-full max-w-full space-y-1.5">
                  <span class="text-sm font-medium">What was updated <span class="text-error">*</span></span>
                  <p class="text-xs text-muted">Summary of changes for the timeline and records.</p>
                  <UTextarea v-model="updateSummary" class="w-full max-w-full" :rows="3" placeholder="e.g. Status set to Investigation; assigned for field visit" />
                </div>

                <div
                  v-for="field in selectedTransition?.requires?.fields ?? []"
                  :key="field"
                  class="col-span-1 sm:col-span-2 min-w-0 w-full max-w-full space-y-1.5"
                >
                  <span class="text-sm font-medium capitalize">{{ field.replaceAll('_', ' ') }} <span class="text-error">*</span></span>
                  <UTextarea v-model="transitionFields[field]" class="w-full max-w-full" :rows="field === 'resolution_summary' ? 4 : 2" />
                </div>

                <div v-if="requiredAttachmentKinds.length || selectedToStatus" class="col-span-1 sm:col-span-2 space-y-3 pt-1 border-t border-default">
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
                    <label class="cursor-pointer" :class="hasStagedKind(req.kind) ? 'pointer-events-none opacity-60' : ''">
                      <input
                        type="file"
                        class="hidden"
                        accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
                        @change="onTransitionFileInput(req.kind, $event)"
                      />
                      <UButton size="xs" variant="soft" :loading="stagingUpload" :disabled="hasStagedKind(req.kind)" as="span">
                        {{ hasStagedKind(req.kind) ? 'Attached' : 'Choose file' }}
                      </UButton>
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
                      <UButton
                        v-if="canRemoveStagedAttachment"
                        size="xs"
                        variant="ghost"
                        color="error"
                        @click="removeStagedAttachment(item)"
                      >
                        Remove
                      </UButton>
                    </div>
                  </div>
                </div>

                <div class="col-span-1 sm:col-span-2 flex flex-wrap gap-2 pt-1">
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
          <div v-if="canUploadAttachment" class="grid sm:grid-cols-2 gap-3">
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
          <div v-if="canUploadAttachment">
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
          <p v-else-if="!canRenameAttachment && !canDeleteAttachment" class="text-sm text-muted">
            You can view documents on this case but cannot upload or manage them.
          </p>

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
                  <th class="py-2 w-28" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="doc in attachments" :key="doc.id" class="border-b border-default">
                  <td class="py-2 pr-3">{{ doc.kind_label }}</td>
                  <td class="py-2 pr-3 min-w-0">
                    <div v-if="renamingId === doc.id" class="flex items-center gap-1 min-w-0 max-w-md">
                      <UInput
                        v-model="renameValue"
                        size="xs"
                        class="flex-1 min-w-0"
                        @keyup.enter="renameDocument(doc.id)"
                      />
                      <UButton size="xs" icon="i-lucide-check" aria-label="Save file name" @click="renameDocument(doc.id)" />
                      <UButton size="xs" variant="ghost" icon="i-lucide-x" aria-label="Cancel rename" @click="cancelRename" />
                    </div>
                    <span v-else class="truncate block max-w-xs">{{ doc.filename }}</span>
                  </td>
                  <td class="py-2 pr-3 text-muted">{{ formatBytes(doc.size_bytes) }}</td>
                  <td class="py-2 pr-3 text-muted text-xs">
                    {{ doc.uploaded_by_name ?? '—' }} · {{ new Date(doc.created_at).toLocaleDateString() }}
                  </td>
                  <td class="py-2">
                    <div class="flex items-center gap-0.5">
                      <UButton
                        v-if="canDownloadAttachment"
                        size="xs"
                        variant="ghost"
                        icon="i-lucide-download"
                        aria-label="Download"
                        @click="downloadFile(doc.id, doc.filename)"
                      />
                      <UButton
                        v-if="canRenameAttachment"
                        size="xs"
                        variant="ghost"
                        icon="i-lucide-pencil"
                        aria-label="Rename"
                        @click="startRename(doc)"
                      />
                      <UButton
                        v-if="canDeleteAttachment"
                        size="xs"
                        variant="ghost"
                        color="error"
                        icon="i-lucide-trash-2"
                        aria-label="Delete"
                        @click="deleteDocument(doc)"
                      />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </UCard>
    </div>

    <div v-else-if="activeTab === 'correspondence'" class="space-y-6">
      <UAlert
        v-if="complainantChannelSummary"
        color="info"
        variant="subtle"
        icon="i-lucide-bell"
        title="Complainant notification preferences"
        :description="`Opted in at intake: ${complainantChannelSummary}. Choose the delivery channel when sending outbound messages.`"
      />

      <UCard v-if="canComposeThread" id="compose-correspondence">
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <span class="font-medium">{{ composeReplyTo ? 'Reply' : 'Compose' }}</span>
            <UButton
              v-if="!composeReplyTo && canReplyExternal && threadEntries.some((e) => e.direction === 'inbound')"
              size="sm"
              variant="soft"
              icon="i-lucide-reply"
              @click="startReply()"
            >
              Reply to latest
            </UButton>
          </div>
        </template>
        <div class="space-y-4">
          <div
            v-if="composeReplyTo"
            class="rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <span class="font-medium">Replying to {{ composeReplyTo.author_name ?? 'complainant' }}</span>
                <span class="text-muted"> · {{ formatThreadChannel(composeReplyTo.channel) }} · {{ new Date(composeReplyTo.created_at).toLocaleString() }}</span>
              </div>
              <UButton size="xs" variant="ghost" color="neutral" @click="cancelReply">Cancel</UButton>
            </div>
            <p class="text-muted line-clamp-3 whitespace-pre-wrap mt-1">{{ composeReplyTo.body_display }}</p>
          </div>
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
            <UFormField
              label="Delivery channel"
              help="Where the complainant is alerted. Full message always appears on the track portal."
            >
              <USelectMenu
                v-model="composeOutboundChannel"
                :items="outboundDeliveryChannelItems"
                value-key="value"
                label-key="label"
                class="w-full"
              />
              <p v-if="outboundDeliveryChannelItems.find((i) => i.value === composeOutboundChannel)?.description" class="text-xs text-muted mt-1">
                {{ outboundDeliveryChannelItems.find((i) => i.value === composeOutboundChannel)?.description }}
              </p>
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
            {{ composeReplyTo ? 'Send reply' : 'Send' }}
          </UButton>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <span class="font-medium">Thread</span>
            <UButton
              v-if="canReplyExternal"
              size="sm"
              variant="outline"
              icon="i-lucide-reply"
              @click="startReply()"
            >
              Reply
            </UButton>
          </div>
        </template>
        <div v-if="threadLoading" class="text-sm text-muted py-4">Loading…</div>
        <div v-else-if="threadEntries.length === 0" class="text-sm text-muted py-4">No messages yet.</div>
        <CaseThreadTree
          v-else
          :nodes="threadTree"
          :entry-by-id="threadEntryById"
          :can-reply="canReplyExternal"
          @reply="startReply"
          @download="downloadFile"
        />
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
            <div>
              <span class="font-medium">Notification delivery log</span>
              <p class="text-xs text-muted font-normal mt-0.5">
                All channels for this case. Your personal in-app alerts are under Notifications in the sidebar.
              </p>
            </div>
            <UButton
              variant="outline"
              icon="i-lucide-refresh-cw"
              size="sm"
              aria-label="Refresh notifications"
              :loading="notificationsLoading"
              class="shrink-0"
              @click="refreshNotifications"
            />
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
                <th class="px-4 py-3 font-medium">Error / debug</th>
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
                <td class="px-4 py-3 text-xs text-muted max-w-md">
                  <p class="whitespace-pre-wrap break-words">{{ n.rendered_preview ?? '—' }}</p>
                </td>
                <td class="px-4 py-3 text-xs max-w-md">
                  <p
                    v-if="n.last_error"
                    class="whitespace-pre-wrap break-words font-mono text-error bg-error/5 border border-error/20 rounded p-2"
                  >
                    {{ n.last_error }}
                  </p>
                  <p v-else-if="notificationHasError(n)" class="text-muted">No error detail recorded</p>
                  <span v-else class="text-muted">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </div>

    <div v-else-if="activeTab === 'timeline'">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <span class="font-medium">Timeline</span>
            <UButton
              variant="outline"
              icon="i-lucide-refresh-cw"
              size="sm"
              aria-label="Refresh timeline"
              :loading="timelineRefreshing"
              class="shrink-0"
              @click="refreshTimeline"
            />
          </div>
        </template>
        <div v-if="timelineRefreshing && !detail.events.length" class="text-sm text-muted py-4 text-center">
          Loading…
        </div>
        <div v-else-if="detail.events.length === 0" class="text-sm text-muted py-4 text-center">
          No events recorded yet.
        </div>
        <UTimeline
          v-else
          :items="timelineItems"
          :default-value="timelineActive"
          size="sm"
          color="primary"
          class="max-w-2xl"
          :ui="{
            description: 'px-3 py-2 ring ring-default mt-1.5 rounded-md text-default text-sm',
          }"
        >
          <template #title="{ item }">
            <div class="flex items-center flex-wrap gap-2">
              <span class="capitalize">{{ item.title }}</span>
              <UBadge size="sm" variant="subtle" color="neutral">{{ item.actorType }}</UBadge>
              <UBadge v-if="item.visibility === 'internal'" size="sm" variant="subtle" color="warning">internal</UBadge>
            </div>
          </template>
          <template #description="{ item }">
            <div v-if="item.fieldEdit" class="space-y-1.5">
              <p class="text-xs font-medium text-muted">{{ item.fieldEdit.label }}</p>
              <div class="grid grid-cols-1 gap-1 text-sm">
                <p><span class="text-muted">Before:</span> {{ item.fieldEdit.from }}</p>
                <p><span class="text-muted">After:</span> {{ item.fieldEdit.to }}</p>
              </div>
            </div>
            <span v-else-if="item.description">{{ item.description }}</span>
          </template>
        </UTimeline>
      </UCard>
    </div>
    </div>
  </div>
</template>
