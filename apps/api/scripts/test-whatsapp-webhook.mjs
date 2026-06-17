/**
 * Simulate Meta WhatsApp inbound webhook (Check status quick-reply).
 *
 * Usage:
 *   node apps/api/scripts/test-whatsapp-webhook.mjs [phone_number_id] [from_phone]
 *
 * Requires API running on API_PORT (default 4100) and WHATSAPP_WEBHOOK_VERIFY_TOKEN in apps/api/.env
 * for GET verify test. POST works without META_APP_SECRET (signature skipped when secret unset).
 */
import pg from 'pg';

const API = `http://127.0.0.1:${process.env.API_PORT ?? 4100}`;
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/egrm',
});

const cfgRes = await pool.query(`
  SELECT cv.payload as cfg
  FROM config_version cv
  JOIN tenant t ON t.id = cv.tenant_id
  WHERE t.code = 'kisip' AND cv.domain = 'cd09_notifications' AND cv.status = 'active'
  LIMIT 1
`);
const phoneNumberId =
  process.argv[2] ??
  String(cfgRes.rows[0]?.cfg?.senders?.whatsapp?.phone_number_id ?? '1150176101510853').trim();
const fromPhone = process.argv[3] ?? '25471770339';

const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? 'change-me-webhook-verify';

console.log('=== GET webhook verify ===');
const verifyUrl = `${API}/api/v1/webhooks/whatsapp/meta?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=12345`;
const verifyRes = await fetch(verifyUrl);
console.log('Status:', verifyRes.status);
console.log('Body:', await verifyRes.text());

const payload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA_ID',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '15550001111',
              phone_number_id: phoneNumberId,
            },
            contacts: [{ profile: { name: 'Test User' }, wa_id: fromPhone }],
            messages: [
              {
                from: fromPhone,
                id: `wamid.test-${Date.now()}`,
                timestamp: String(Math.floor(Date.now() / 1000)),
                type: 'button',
                button: {
                  payload: 'Check status',
                  text: 'Check status',
                },
              },
            ],
          },
        },
      ],
    },
  ],
};

console.log('\n=== POST status check (button tap) ===');
console.log('phone_number_id:', phoneNumberId);
console.log('from:', fromPhone);

const postRes = await fetch(`${API}/api/v1/webhooks/whatsapp/meta`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
console.log('Status:', postRes.status);
console.log('Body:', await postRes.text());
console.log('\nCheck API logs for [whatsapp-webhook:dev] reply if NOTIFICATIONS_DEV_LOG_ONLY=1');

await pool.end();
