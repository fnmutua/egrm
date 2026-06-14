/** Poll until the API health endpoint responds (local dev bootstrap). */
const API_HEALTH_URL = process.env.API_HEALTH_URL ?? 'http://localhost:4100/health';
const MAX_WAIT_MS = Number(process.env.API_WAIT_MS ?? 120_000);
const INTERVAL_MS = 500;

async function healthy() {
  try {
    const res = await fetch(API_HEALTH_URL, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

const start = Date.now();
process.stdout.write(`[dev] waiting for API at ${API_HEALTH_URL}`);

while (Date.now() - start < MAX_WAIT_MS) {
  if (await healthy()) {
    console.log(' — ready');
    process.exit(0);
  }
  process.stdout.write('.');
  await new Promise((r) => setTimeout(r, INTERVAL_MS));
}

console.error(`\n[dev] API not reachable at ${API_HEALTH_URL} after ${MAX_WAIT_MS / 1000}s`);
console.error('[dev] Check @egrm/api logs in the terminal (port 4100, postgres running).');
process.exit(1);
