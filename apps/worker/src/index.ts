/**
 * Worker service scaffold (Phase 0).
 * Phase 2 adds: notification outbox dispatcher, SLA scheduler, escalation rules.
 * Phase 3+: retention jobs, report generation, AI calls.
 */
import 'dotenv/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const QUEUES = {
  heartbeat: 'heartbeat',
  // outbox: 'notification-outbox',   (Phase 2)
  // slaTick: 'sla-tick',             (Phase 2)
} as const;

const heartbeatQueue = new Queue(QUEUES.heartbeat, { connection });

const heartbeatWorker = new Worker(
  QUEUES.heartbeat,
  async (job) => {
    console.log(`[worker] heartbeat #${job.id} at ${new Date().toISOString()}`);
  },
  { connection },
);

heartbeatWorker.on('failed', (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err);
});

// Repeatable heartbeat proves the scheduler is alive (observability baseline, GEN-NFR-06).
await heartbeatQueue.upsertJobScheduler('heartbeat-every-minute', { every: 60_000 });

console.log('[worker] started — heartbeat scheduled every 60s');
