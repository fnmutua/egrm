import pg from 'pg';

const META_VERSION = 'v23.0';
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:Admin%402011@localhost:5432/egrm',
});

const cfgRes = await pool.query(`
  SELECT cv.payload as cfg
  FROM config_version cv
  JOIN tenant t ON t.id = cv.tenant_id
  WHERE t.code = 'kisip' AND cv.domain = 'cd09_notifications' AND cv.status = 'active'
  LIMIT 1
`);
const cfg = cfgRes.rows[0]?.cfg;
const wa = cfg?.senders?.whatsapp;
if (!wa) {
  console.error('No active WhatsApp config');
  process.exit(1);
}

const authRow = (wa.headers ?? []).find((h) => h.key?.toLowerCase() === 'authorization');
const token = (process.env.WA_TOKEN ?? authRow?.value ?? '').trim();
const auth = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
const phoneNumberId = String(wa.phone_number_id ?? '').trim();

const url = `https://graph.facebook.com/${META_VERSION}/${phoneNumberId}/messages`;
const to = process.argv[2] ?? '25471770339';

const templateName = process.argv[3] ?? wa.template_name ?? 'kisip_case_registered';
const templateLanguage = wa.template_language ?? 'en_US';
const paramKeys = wa.template_body_param_keys ?? ['party.name', 'case.reference', 'tenant.name', 'tracking.url'];
const sampleVars = {
  'party.name': 'Jane',
  'tenant.name': 'KISIP GRM',
  'case.reference': 'GRM-TEST',
  'tracking.url': 'https://grm.example.go.ke/track?ref=GRM-TEST',
  'case.status_label': 'Registered',
};
const templateParams = paramKeys.map((key) => sampleVars[key] ?? key);

const useTemplate = process.argv.includes('--text') ? false : Boolean(templateName?.trim());

const body = useTemplate
  ? {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: templateLanguage },
        components: [
          {
            type: 'body',
            parameters: templateParams.map((text) => ({ type: 'text', text: String(text) })),
          },
        ],
      },
    }
  : {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: {
        body:
          process.argv[4] ??
          'KISIP GRM: your grievance GRM-TEST is registered. Track: https://grm.example.go.ke/track?ref=GRM-TEST',
      },
    };

console.log(`=== WhatsApp test POST (${useTemplate ? 'template' : 'plain text'}) ===`);
console.log('URL:', url);
console.log('Phone number ID:', phoneNumberId);
console.log('Display number:', wa.display_number);
console.log('To:', to);
if (useTemplate) {
  console.log('Template:', templateName, templateLanguage);
  console.log('Param keys:', paramKeys.join(', '));
  console.log('Param values:', templateParams.join(' | '));
}
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

await pool.end();
