import type { AiCapability, Cd08Channels, Cd14Features, Cd16Ai } from '@egrm/config-schemas';
import { getActiveConfig } from './config.js';

export function parseJsonFromModel(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]!.trim() : trimmed;
  return JSON.parse(body) as unknown;
}

export function resolveProfileForCapability(
  ai: Cd16Ai,
  capKey: AiCapability,
): { key: string; profile: Cd16Ai['provider_profiles'][string] } | null {
  const cap = ai.capabilities[capKey];
  if (!cap?.enabled) return null;
  const key =
    cap.profile ??
    Object.entries(ai.provider_profiles).find(([, profile]) => profile.enabled)?.[0];
  if (!key) return null;
  const profile = ai.provider_profiles[key];
  if (!profile?.enabled) return null;
  return { key, profile };
}

/** Active CD-16 payload; merges legacy CD-14/CD-08 AI flags when CD-16 toggles are still off. */
export async function loadCd16Ai(tenantId: string): Promise<Cd16Ai | null> {
  const [cd16, cd14, cd08] = await Promise.all([
    getActiveConfig<Cd16Ai>(tenantId, 'cd16_ai'),
    getActiveConfig<Cd14Features>(tenantId, 'cd14_features'),
    getActiveConfig<Cd08Channels>(tenantId, 'cd08_channels'),
  ]);
  if (!cd16) return null;

  const legacyStaff = Boolean(cd14?.ai_assistance);
  const legacyChatbot = Boolean(cd14?.chatbot_intake) || Boolean(cd08?.modules?.chatbot?.enabled);
  if (!legacyStaff && !legacyChatbot) return cd16;

  return {
    ...cd16,
    enabled: cd16.enabled || legacyStaff || legacyChatbot,
    chatbot: {
      ...cd16.chatbot,
      enabled: cd16.chatbot.enabled || legacyChatbot,
    },
  };
}

export async function loadAiAssistanceConfig(tenantId: string): Promise<{
  ready: boolean;
  reason?: 'cd16_off';
  cd16: Cd16Ai | null;
}> {
  const cd16 = await loadCd16Ai(tenantId);
  if (!cd16?.enabled) return { ready: false, reason: 'cd16_off', cd16: cd16 ?? null };
  return { ready: true, cd16 };
}

export async function loadChatbotConfig(tenantId: string): Promise<{
  ready: boolean;
  reason?: 'cd16_off' | 'chatbot_off';
  cd16: Cd16Ai | null;
}> {
  const cd16 = await loadCd16Ai(tenantId);
  if (!cd16?.enabled) return { ready: false, reason: 'cd16_off', cd16: cd16 ?? null };
  if (!cd16.chatbot.enabled) return { ready: false, reason: 'chatbot_off', cd16 };
  return { ready: true, cd16 };
}
