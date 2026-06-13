import { dispatchNotificationOutbox } from './notification-dispatch.js';

/** Dispatch notification outbox inline in the API process (no BullMQ/Redis queue). */
export async function scheduleOutboxDispatch(outboxId: string): Promise<void> {
  await dispatchNotificationOutbox(outboxId);
}
