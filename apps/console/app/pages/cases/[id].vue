<script setup lang="ts">
const route = useRoute();
const { api } = useApi();
const { user, fetchMe } = useAuth();

interface CaseDetail {
  case: {
    id: string; reference: string; case_type: string; status: string; status_tag: string;
    level: string; unit: string | null; anonymous: boolean; channel: string;
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
const notifications = ref<CaseNotification[]>([]);
const notificationsLoading = ref(false);
const notificationsLoaded = ref(false);
const activeTab = ref('overview');

const tabItems = [
  { label: 'Overview', value: 'overview', icon: 'i-lucide-layout-dashboard' },
  { label: 'Notifications', value: 'notifications', icon: 'i-lucide-bell' },
];

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
});

onMounted(async () => {
  if (!(await fetchMe())) return navigateTo('/login');
  detail.value = await api<CaseDetail>(`/api/v1/cases/${route.params.id}`);
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

    <div v-if="activeTab === 'overview'" class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 space-y-6">
        <UCard>
          <template #header><span class="font-medium">Details</span></template>
          <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div><dt class="text-muted">Categories</dt><dd>{{ detail.case.categories.join(', ') || '—' }}</dd></div>
            <div><dt class="text-muted">Channel</dt><dd class="capitalize">{{ detail.case.channel }}</dd></div>
            <div><dt class="text-muted">Level</dt><dd class="capitalize">{{ detail.case.level }}</dd></div>
            <div><dt class="text-muted">Location</dt><dd>{{ detail.case.unit ?? '—' }}</dd></div>
            <div><dt class="text-muted">Priority</dt><dd class="capitalize">{{ detail.case.priority }}</dd></div>
            <div><dt class="text-muted">Sensitivity</dt><dd class="capitalize">{{ detail.case.sensitivity }}</dd></div>
            <div><dt class="text-muted">Occurred</dt><dd>{{ detail.case.date_occurred ? new Date(detail.case.date_occurred).toLocaleDateString() : '—' }}</dd></div>
            <div><dt class="text-muted">Received</dt><dd>{{ new Date(detail.case.created_at).toLocaleString() }}</dd></div>
          </dl>
          <div v-if="detail.case.description" class="mt-4 pt-4 border-t border-default text-sm">
            <div class="text-muted mb-1">Description</div>
            <p class="whitespace-pre-wrap">{{ detail.case.description }}</p>
          </div>
          <div v-if="detail.case.expected_outcome" class="mt-4 pt-4 border-t border-default text-sm">
            <div class="text-muted mb-1">Expected outcome</div>
            <p class="whitespace-pre-wrap">{{ detail.case.expected_outcome }}</p>
          </div>
        </UCard>

        <UCard>
          <template #header><span class="font-medium">Timeline</span></template>
          <ol class="space-y-3">
            <li v-for="ev in detail.events" :key="ev.id" class="flex gap-3 text-sm">
              <UIcon name="i-lucide-circle-dot" class="mt-0.5 text-primary shrink-0" />
              <div>
                <span class="font-medium capitalize">{{ ev.kind.replaceAll('_', ' ') }}</span>
                <UBadge size="sm" variant="subtle" color="neutral" class="ml-2">{{ ev.actorType }}</UBadge>
                <UBadge v-if="ev.visibility === 'internal'" size="sm" variant="subtle" color="warning" class="ml-1">internal</UBadge>
                <div class="text-muted text-xs">{{ new Date(ev.createdAt).toLocaleString() }}</div>
              </div>
            </li>
          </ol>
        </UCard>
      </div>

      <div class="space-y-6">
        <UCard>
          <template #header><span class="font-medium">Complainant</span></template>
          <div v-if="detail.case.anonymous" class="text-sm text-muted">Anonymous submission — no personal data collected.</div>
          <dl v-else-if="detail.complainant" class="space-y-2 text-sm">
            <div><dt class="text-muted">Name</dt><dd class="font-medium">{{ detail.complainant.name ?? '—' }}</dd></div>
            <div><dt class="text-muted">Phone</dt><dd>{{ detail.complainant.phone ?? '—' }}</dd></div>
            <div><dt class="text-muted">Email</dt><dd>{{ detail.complainant.email ?? '—' }}</dd></div>
            <div><dt class="text-muted">Gender</dt><dd class="capitalize">{{ detail.complainant.gender ?? '—' }}</dd></div>
          </dl>
          <div v-else class="text-sm text-muted">No party record.</div>
          <template v-if="!detail.case.anonymous" #footer>
            <div class="text-xs text-muted">PII access is logged in the audit trail.</div>
          </template>
        </UCard>

        <UCard>
          <template #header><span class="font-medium">Actions</span></template>
          <p class="text-sm text-muted">Status transitions, assignment and the reply thread arrive with the workflow engine (Phase 2).</p>
        </UCard>
      </div>
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
  </div>
</template>
