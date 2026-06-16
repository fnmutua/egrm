import { META_WHATSAPP_API_VERSION } from '@egrm/config-schemas';

export interface MetaWhatsAppTemplate {
  name: string;
  language: string;
  status: string;
  category?: string;
  bodyPreview?: string;
  bodyParamCount: number;
}

export interface DiscoveredWaba {
  id: string;
  name?: string;
  phone_number_ids: string[];
  source: string;
}

export interface FetchMetaWhatsAppTemplatesResult {
  templates: MetaWhatsAppTemplate[];
  resolvedWabaId: string;
  discovered_wabas?: DiscoveredWaba[];
}

type GraphErrorBody = {
  error?: { message?: string; code?: number; type?: string; error_subcode?: number };
};

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly discoveredWabas?: DiscoveredWaba[],
  ) {
    super(message);
    this.name = 'MetaApiError';
  }
}

function normalizeBearerToken(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'Bearer') return '';
  return trimmed.replace(/^Bearer\s+/i, '');
}

async function graphGet<T>(url: string, auth: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers: auth });
  const data = (await res.json()) as T & GraphErrorBody;
  if (!res.ok) {
    const msg = data.error?.message ?? `Meta API HTTP ${res.status}`;
    throw new MetaApiError(msg, data.error?.code);
  }
  return data;
}

async function graphGetSafe<T>(url: string, auth: Record<string, string>): Promise<T | null> {
  try {
    return await graphGet<T>(url, auth);
  } catch {
    return null;
  }
}

async function phoneIdsForWaba(
  base: string,
  auth: Record<string, string>,
  wabaId: string,
): Promise<string[]> {
  const phones = await graphGetSafe<{ data?: Array<{ id: string }> }>(
    `${base}/${wabaId}/phone_numbers?fields=id&limit=50`,
    auth,
  );
  return (phones?.data ?? []).map((p) => p.id);
}

async function wabasUnderBusinessId(
  base: string,
  auth: Record<string, string>,
  businessId: string,
): Promise<DiscoveredWaba[]> {
  const out: DiscoveredWaba[] = [];
  for (const edge of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts'] as const) {
    let url: string | null = `${base}/${businessId}/${edge}?fields=id,name&limit=50`;
    while (url) {
      const page: {
        data?: Array<{ id: string; name?: string }>;
        paging?: { next?: string };
      } | null = await graphGetSafe(url, auth);
      if (!page) break;
      for (const waba of page.data ?? []) {
        const phone_number_ids = await phoneIdsForWaba(base, auth, waba.id);
        out.push({
          id: waba.id,
          name: waba.name,
          phone_number_ids,
          source: edge,
        });
      }
      url = page.paging?.next ?? null;
    }
  }
  return out;
}

/** List WhatsApp Business accounts visible to this token (for config UI). */
export async function discoverMetaWhatsAppAccounts(bearerToken: string): Promise<DiscoveredWaba[]> {
  const token = normalizeBearerToken(bearerToken);
  if (!token) throw new Error('Bearer token required');

  const base = `https://graph.facebook.com/${META_WHATSAPP_API_VERSION}`;
  const auth = { Authorization: `Bearer ${token}` };
  const byId = new Map<string, DiscoveredWaba>();

  const businesses = await graphGetSafe<{ data?: Array<{ id: string; name?: string }> }>(
    `${base}/me/businesses?fields=id,name&limit=50`,
    auth,
  );

  for (const biz of businesses?.data ?? []) {
    const wabas = await wabasUnderBusinessId(base, auth, biz.id);
    for (const waba of wabas) {
      byId.set(waba.id, {
        ...waba,
        name: waba.name ?? biz.name,
      });
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function canListTemplates(
  base: string,
  auth: Record<string, string>,
  wabaId: string,
): Promise<boolean> {
  const probe = await graphGetSafe<{ data?: unknown[] }>(
    `${base}/${wabaId}/message_templates?limit=1&fields=name`,
    auth,
  );
  return probe != null;
}

type TemplatePage = {
  data?: Array<{
    name: string;
    status: string;
    language: string;
    category?: string;
    components?: Array<{ type: string; text?: string }>;
  }>;
  paging?: { next?: string };
};

async function listTemplates(
  base: string,
  auth: Record<string, string>,
  wabaId: string,
): Promise<MetaWhatsAppTemplate[]> {
  const templates: MetaWhatsAppTemplate[] = [];
  let url: string | null =
    `${base}/${wabaId}/message_templates?limit=100&fields=name,status,language,category,components`;

  while (url) {
    const page: TemplatePage = await graphGet<TemplatePage>(url, auth);

    for (const row of page.data ?? []) {
      const bodyText = row.components?.find((c) => c.type === 'BODY')?.text ?? '';
      const paramCount = (bodyText.match(/\{\{\d+\}\}/g) ?? []).length;
      templates.push({
        name: row.name,
        language: row.language,
        status: row.status,
        category: row.category,
        bodyPreview: bodyText,
        bodyParamCount: paramCount,
      });
    }

    url = page.paging?.next ?? null;
  }

  return templates.sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language));
}

function pickWaba(
  candidates: DiscoveredWaba[],
  phoneNumberId?: string,
): DiscoveredWaba | undefined {
  if (candidates.length === 0) return undefined;
  if (phoneNumberId) {
    const match = candidates.find((w) => w.phone_number_ids.includes(phoneNumberId));
    if (match) return match;
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

function formatDiscoveryHint(wabas: DiscoveredWaba[]): string {
  if (wabas.length === 0) {
    return 'No WhatsApp Business accounts found for this token. Regenerate the token with whatsapp_business_management permission in Meta → System users → Generate token.';
  }
  const lines = wabas.map((w) => {
    const phones = w.phone_number_ids.length ? ` phones: ${w.phone_number_ids.join(', ')}` : '';
    const label = w.name ? `${w.name} — ` : '';
    return `${label}${w.id}${phones}`;
  });
  return `Accessible WhatsApp Business Account IDs:\n${lines.join('\n')}`;
}

function tokenFromAuth(auth: Record<string, string>): string {
  return (auth.Authorization ?? '').replace(/^Bearer\s+/i, '');
}

async function resolveWabaId(
  base: string,
  auth: Record<string, string>,
  phoneNumberId: string | undefined,
  explicitWabaId?: string,
  discovered?: DiscoveredWaba[],
): Promise<string> {
  const wabaHint = explicitWabaId?.trim();
  const phoneId = phoneNumberId?.trim();

  if (wabaHint) {
    if (await canListTemplates(base, auth, wabaHint)) return wabaHint;

    // User may have pasted a Business Portfolio ID instead of WABA ID.
    const underBiz = await wabasUnderBusinessId(base, auth, wabaHint);
    const picked = pickWaba(underBiz, phoneId);
    if (picked && (await canListTemplates(base, auth, picked.id))) return picked.id;

    const all = discovered ?? (await discoverMetaWhatsAppAccounts(tokenFromAuth(auth)));
    const fromDiscovery = pickWaba(all, phoneId);
    if (fromDiscovery && (await canListTemplates(base, auth, fromDiscovery.id))) {
      return fromDiscovery.id;
    }

    if (underBiz.length > 1) {
      throw new MetaApiError(
        `ID "${wabaHint}" looks like a Business Portfolio ID with ${underBiz.length} WhatsApp accounts — pick the WABA ID:\n${formatDiscoveryHint(underBiz)}`,
        undefined,
        underBiz,
      );
    }

    throw new MetaApiError(
      `Cannot list templates for ID "${wabaHint}". Use the WhatsApp Business Account ID (not Business Portfolio ID or Phone number ID).\n\n${formatDiscoveryHint(all)}`,
      undefined,
      all,
    );
  }

  if (phoneId) {
    const all = discovered ?? (await discoverMetaWhatsAppAccounts(tokenFromAuth(auth)));
    const picked = pickWaba(all, phoneId);
    if (picked) return picked.id;
  }

  throw new MetaApiError(
    `Could not resolve WhatsApp Business Account ID.${phoneId ? ` No account owns phone number ID ${phoneId}.` : ''}\n\n${formatDiscoveryHint(discovered ?? [])}`,
    undefined,
    discovered,
  );
}

/** List Meta message templates for a WhatsApp Business account. */
export async function fetchMetaWhatsAppTemplates(
  phoneNumberId: string | undefined,
  bearerToken: string,
  opts?: { wabaId?: string },
): Promise<FetchMetaWhatsAppTemplatesResult> {
  const token = normalizeBearerToken(bearerToken);
  if (!token) throw new Error('Bearer token required');

  const phoneId = phoneNumberId?.trim();
  if (phoneId && (phoneId.startsWith('+') || !/^\d+$/.test(phoneId))) {
    throw new Error('phone_number_id must be the numeric Meta API ID (not the +254 display number)');
  }

  const wabaId = opts?.wabaId?.trim();
  if (!wabaId && !phoneId) {
    throw new Error('waba_id or phone_number_id required');
  }

  const base = `https://graph.facebook.com/${META_WHATSAPP_API_VERSION}`;
  const auth = { Authorization: `Bearer ${token}` };

  const discovered = await discoverMetaWhatsAppAccounts(token);
  const resolvedWabaId = await resolveWabaId(base, auth, phoneId, wabaId, discovered);
  const templates = await listTemplates(base, auth, resolvedWabaId);

  return { templates, resolvedWabaId, discovered_wabas: discovered };
}
