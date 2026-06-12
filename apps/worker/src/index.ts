/**
 * Background worker: notification outbox dispatch, SLA scheduler (Phase 2+).
 */
import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'bullmq';
import { dispatchNotificationOutbox } from '@egrm/api/dispatch';
import { NOTIFICATION_OUTBOX_QUEUE } from '@egrm/api/notification-queue';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../.env') });
loadEnv({ path: resolve(__dirname, '../../api/.env') });

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

const outboxWorker = new Worker(
  NOTIFICATION_OUTBOX_QUEUE,
  async (job) => {
    const outboxId = job.data?.outboxId as string;
    if (!outboxId) throw new Error('missing outboxId');
    console.log(`[worker] dispatch outbox ${outboxId}`);
    await dispatchNotificationOutbox(outboxId);
  },
  {
    connection: { url: redisUrl, maxRetriesPerRequest: null },
    concurrency: 5,
  },
);

outboxWorker.on('failed', (job, err) => {
  console.error(`[worker] outbox job ${job?.id} failed:`, err);
});

console.log('[worker] notification outbox consumer started');
