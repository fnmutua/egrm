import { Queue } from 'bullmq';
import { env } from '../env.js';
import { dispatchNotificationOutbox } from './notification-dispatch.js';
export const NOTIFICATION_OUTBOX_QUEUE = 'notification-outbox';
let queue = null;
function getQueue() {
    if (!queue) {
        queue = new Queue(NOTIFICATION_OUTBOX_QUEUE, {
            connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
        });
    }
    return queue;
}
/** Enqueue async delivery, or run inline when sync/dev mode is on. */
export async function scheduleOutboxDispatch(outboxId) {
    if (env.NOTIFICATIONS_DEV_LOG_ONLY || env.NOTIFICATIONS_SYNC_DISPATCH) {
        await dispatchNotificationOutbox(outboxId);
        return;
    }
    try {
        await getQueue().add('dispatch', { outboxId }, {
            attempts: 5,
            backoff: { type: 'exponential', delay: 3000 },
            removeOnComplete: 100,
            removeOnFail: 500,
        });
    }
    catch (err) {
        console.warn('[notifications] Redis queue unavailable — dispatching inline:', err);
        await dispatchNotificationOutbox(outboxId);
    }
}
//# sourceMappingURL=notification-queue.js.map