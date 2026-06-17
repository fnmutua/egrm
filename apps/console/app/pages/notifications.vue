<script setup lang="ts">
import { hasPermission } from '@egrm/core';
import type { StaffInboxNotification } from '~/composables/useNotificationInbox';

definePageMeta({ layout: 'shell' });

const { user, fetchMe } = useAuth();
const { listNotifications, updateNotification, markAllRead } = useNotificationInbox();
const toast = useToast();

const ready = ref(false);
const loading = ref(false);
const items = ref<StaffInboxNotification[]>([]);
const total = ref(0);
const unreadCount = ref(0);
const page = ref(1);
const pageSize = ref(30);
const statusFilter = ref<'all' | 'unread' | 'dismissed'>('all');
const actingId = ref<string | null>(null);

const canViewCases = computed(() => hasPermission(user.value?.permissions ?? [], 'case:read'));

const filterItems = [
  { value: 'all' as const, label: 'Active' },
  { value: 'unread' as const, label: 'Unread' },
  { value: 'dismissed' as const, label: 'Dismissed' },
];

function formatEventKind(kind: string): string {
  return kind.replaceAll('.', ' · ').replaceAll('_', ' ');
}

function isUnread(n: StaffInboxNotification): boolean {
  return !n.read_at && !n.dismissed_at;
}

async function load() {
  loading.value = true;
  try {
    const res = await listNotifications({ status: statusFilter.value, page: page.value });
    items.value = res.notifications;
    total.value = res.total;
    unreadCount.value = res.unread_count;
    pageSize.value = res.page_size;
  } finally {
    loading.value = false;
  }
}

async function runAction(n: StaffInboxNotification, action: 'read' | 'unread' | 'dismiss') {
  actingId.value = n.id;
  try {
    await updateNotification(n.id, action);
    await load();
    if (action === 'dismiss') {
      toast.add({ title: 'Notification dismissed', color: 'neutral' });
    }
  } catch {
    toast.add({ title: 'Could not update notification', color: 'error' });
  } finally {
    actingId.value = null;
  }
}

async function onMarkAllRead() {
  try {
    await markAllRead();
    await load();
    toast.add({ title: 'All notifications marked as read', color: 'success' });
  } catch {
    toast.add({ title: 'Could not mark all as read', color: 'error' });
  }
}

watch(statusFilter, () => {
  page.value = 1;
  void load();
});

onMounted(async () => {
  if (!(await fetchMe())) {
    await navigateTo('/login');
    return;
  }
  ready.value = true;
  await load();
});

function openCase(n: StaffInboxNotification) {
  if (n.case_id && canViewCases.value) {
    navigateTo(`/cases/${n.case_id}`);
  }
}

watch(page, () => void load());
</script>

<template>
  <div v-if="user && ready" class="p-4 sm:p-6">
    <div class="flex flex-wrap items-center justify-between mb-6 gap-3">
      <div>
        <h1 class="text-xl font-semibold">Notifications</h1>
        <p class="text-muted text-sm">
          {{ total }} in-app alert(s) for you<span v-if="unreadCount > 0"> · {{ unreadCount }} unread</span>
        </p>
      </div>
      <UButton
        v-if="unreadCount > 0 && statusFilter !== 'dismissed'"
        variant="outline"
        size="sm"
        icon="i-lucide-check-check"
        @click="onMarkAllRead"
      >
        Mark all read
      </UButton>
    </div>

    <div class="flex flex-wrap gap-2 mb-4">
      <UButton
        v-for="f in filterItems"
        :key="f.value"
        size="sm"
        :variant="statusFilter === f.value ? 'soft' : 'outline'"
        @click="statusFilter = f.value"
      >
        {{ f.label }}
        <UBadge v-if="f.value === 'unread' && unreadCount > 0" size="xs" class="ml-1.5">{{ unreadCount }}</UBadge>
      </UButton>
    </div>

    <div class="border border-default rounded-lg overflow-hidden">
      <div v-if="loading" class="py-16 text-center text-sm text-muted">Loading…</div>
      <div v-else-if="items.length === 0" class="py-16 text-center text-sm text-muted">
        {{ statusFilter === 'unread' ? 'No unread notifications.' : statusFilter === 'dismissed' ? 'No dismissed notifications.' : 'No notifications yet.' }}
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[900px] text-sm">
          <thead class="bg-elevated/50">
            <tr class="border-b border-default">
              <th class="py-3 px-4 text-left text-xs font-medium text-muted uppercase tracking-wide">Title</th>
              <th class="py-3 px-4 text-left text-xs font-medium text-muted uppercase tracking-wide">Message</th>
              <th class="py-3 px-4 text-left text-xs font-medium text-muted uppercase tracking-wide">Event</th>
              <th class="py-3 px-4 text-left text-xs font-medium text-muted uppercase tracking-wide">Case</th>
              <th class="py-3 px-4 text-left text-xs font-medium text-muted uppercase tracking-wide">Received</th>
              <th class="py-3 px-4 text-right text-xs font-medium text-muted uppercase tracking-wide w-36">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr
              v-for="n in items"
              :key="n.id"
              class="transition-colors"
              :class="n.case_id && canViewCases ? 'hover:bg-elevated/50 cursor-pointer' : 'hover:bg-elevated/30'"
              @click="openCase(n)"
            >
              <td class="py-3.5 px-4 font-medium whitespace-nowrap">
                <span :class="isUnread(n) ? 'text-default' : 'text-muted'">{{ n.title }}</span>
                <UBadge v-if="isUnread(n)" size="xs" color="primary" variant="subtle" class="ml-1.5">Unread</UBadge>
              </td>
              <td class="py-3.5 px-4 max-w-sm truncate text-muted" :title="n.body">{{ n.body }}</td>
              <td class="py-3.5 px-4 whitespace-nowrap">
                <UBadge size="xs" color="neutral" variant="subtle">{{ formatEventKind(n.event_kind) }}</UBadge>
              </td>
              <td class="py-3.5 px-4 font-mono text-muted whitespace-nowrap">
                {{ n.case_reference ?? '—' }}
              </td>
              <td class="py-3.5 px-4 text-muted whitespace-nowrap">
                {{ new Date(n.created_at).toLocaleString() }}
              </td>
              <td class="py-3.5 px-4 whitespace-nowrap" @click.stop>
                <div class="flex items-center justify-end gap-0.5">
                  <UButton
                    v-if="n.case_id && canViewCases"
                    size="xs"
                    variant="ghost"
                    icon="i-lucide-folder-open"
                    aria-label="View case"
                    :to="`/cases/${n.case_id}`"
                  />
                  <UButton
                    v-if="!n.dismissed_at && !n.read_at"
                    size="xs"
                    variant="ghost"
                    icon="i-lucide-check"
                    aria-label="Mark read"
                    :loading="actingId === n.id"
                    @click="runAction(n, 'read')"
                  />
                  <UButton
                    v-else-if="!n.dismissed_at && n.read_at"
                    size="xs"
                    variant="ghost"
                    icon="i-lucide-mail"
                    aria-label="Mark unread"
                    :loading="actingId === n.id"
                    @click="runAction(n, 'unread')"
                  />
                  <UButton
                    v-if="!n.dismissed_at"
                    size="xs"
                    variant="ghost"
                    color="error"
                    icon="i-lucide-x"
                    aria-label="Dismiss"
                    :loading="actingId === n.id"
                    @click="runAction(n, 'dismiss')"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="items.length > 0" class="flex items-center justify-between mt-4 text-sm text-muted">
      <span>{{ (page - 1) * pageSize + 1 }}–{{ Math.min(page * pageSize, total) }} of {{ total }}</span>
      <UPagination v-model:page="page" :total="total" :items-per-page="pageSize" />
    </div>
  </div>
  <div v-else class="p-6 text-sm text-muted">Loading…</div>
</template>
