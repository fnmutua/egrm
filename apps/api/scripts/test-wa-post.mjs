import pg from 'pg';

const META_VERSION = 'v23.0';
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:Admin%402011@localhost:5432/egrm',
});

const cfgRes = await pool.query(`
  SELECT cv.payload->'senders'->'whatsapp' as wa
  FROM config_version cv
  JOIN tenant t ON t.id = cv.tenant_id
  WHERE t.code = 'kisip' AND cv.domain = 'cd09_notifications' AND cv.status = 'active'
  LIMIT 1
`);
const wa = cfgRes.rows[0]?.wa;
if (!wa) {
  console.error('No active WhatsApp config');
  process.exit(1);
}

const authRow = (wa.headers ?? []).find((h) => h.key?.toLowerCase() === 'authorization');
const token = (process.env.WA_TOKEN ?? authRow?.value ?? '').trim();
const auth = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
const phoneNumberId = String(wa.phone_number_id ?? '').trim();
const mode = wa.mode ?? 'test';
const templateName = mode === 'test' ? 'hello_world' : (wa.template_name ?? 'hello_world');
const templateLanguage = mode === 'test' ? 'en_US' : (wa.template_language ?? 'en_US');

// Recipient from latest case with WhatsApp attempt
const caseRes = await pool.query(`
  SELECT c.reference, p.phone_enc
  FROM grm_case c
  LEFT JOIN party p ON p.id = c.party_id
  WHERE c.reference = 'GRM-2026-0016'
  LIMIT 1
`);

const url = `https://graph.facebook.com/${META_VERSION}/${phoneNumberId}/messages`;
const to = process.argv[2] ?? '25471770339';

const isLive = (wa.mode ?? 'test') === 'live';
const bodyText = isLive
  ? 'KISIP GRM: your grievance GRM-TEST is registered. Track: http://localhost:3000/track?ref=GRM-TEST'
  : undefined;

const body = isLive
  ? {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: bodyText },
    }
  : {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: templateLanguage },
      },
    };

console.log('=== WhatsApp test POST ===');
console.log('URL:', url);
console.log('Mode:', mode);
console.log('Phone number ID:', phoneNumberId);
console.log('Display number:', wa.display_number);
console.log('Template:', templateName, templateLanguage);
console.log('To:', to);
console.log('Auth token length:', token.length);
console.log('Request body:', JSON.stringify(body, null, 2));

const res = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: auth,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});

const text = await res.text();
let data;
try {
  data = JSON.parse(text);
} catch {
  data = { raw: text };
}

console.log('\n=== Response ===');
console.log('HTTP status:', res.status);
console.log(JSON.stringify(data, null, 2));

// Also probe phone number object
const probeUrl = `https://graph.facebook.com/${META_VERSION}/${phoneNumberId}?fields=display_phone_number,verified_name`;
const probe = await fetch(probeUrl, { headers: { Authorization: auth } });
const probeText = await probe.text();
console.log('\n=== Phone number ID probe GET ===');
console.log('URL:', probeUrl);
console.log('HTTP status:', probe.status);
try {
  console.log(JSON.stringify(JSON.parse(probeText), null, 2));
} catch {
  console.log(probeText);
}

await pool.end();

// Compare with sandbox ID that previously worked
async function testId(id, label, authHeader) {
  const url2 = `https://graph.facebook.com/${META_VERSION}/${id}/messages`;
  const res2 = await fetch(url2, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: '25471770339',
      type: 'template',
      template: { name: 'hello_world', language: { code: 'en_US' } },
    }),
  });
  console.log(`\n=== ${label} (${id}) ===`);
  console.log('HTTP status:', res2.status);
  console.log(await res2.text());
}

await testId('1107744639097239', 'Sandbox phone number ID (previously worked)', auth);
