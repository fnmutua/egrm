export interface StaffInboxNotification {
  id: string;
  case_id: string | null;
  case_reference: string | null;
  event_kind: string;
  title: string;
  body: string;
  read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
}

/** Personal in-app notification inbox for the signed-in user. */
export function useNotificationInbox() {
  const { api } = useApi();
  const unreadCount = useState<number | null>('staff_inbox_unread', () => null);

  async function loadUnreadCount() {
    try {
      const res = await api<{ unread_count: number }>('/api/v1/me/notifications/unread-count');
      unreadCount.value = res.unread_count;
    } catch {
      unreadCount.value = null;
    }
  }

  async function listNotifications(opts: { status?: 'all' | 'unread' | 'dismissed'; page?: number } = {}) {
    return api<{
      notifications: StaffInboxNotification[];
      total: number;
      unread_count: number;
      page: number;
      page_size: number;
    }>('/api/v1/me/notifications', {
      query: {
        status: opts.status ?? 'all',
        page: opts.page ?? 1,
      },
    });
  }

  async function updateNotification(id: string, action: 'read' | 'unread' | 'dismiss') {
    await api(`/api/v1/me/notifications/${id}`, {
      method: 'PATCH',
      body: { action },
    });
    await loadUnreadCount();
  }

  async function markAllRead() {
    await api('/api/v1/me/notifications/mark-all-read', { method: 'POST' });
    unreadCount.value = 0;
  }

  return {
    unreadCount,
    loadUnreadCount,
    listNotifications,
    updateNotification,
    markAllRead,
  };
}
