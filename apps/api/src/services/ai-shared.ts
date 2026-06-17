import type { AiCapability, Cd14Features, Cd16Ai, Cd08Channels } from '@egrm/config-schemas';
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

export async function loadAiAssistanceConfig(tenantId: string): Promise<{
  ready: boolean;
  reason?: 'cd14_off' | 'cd16_off';
  cd16: Cd16Ai | null;
}> {
  const [cd14, cd16] = await Promise.all([
    getActiveConfig<Cd14Features>(tenantId, 'cd14_features'),
    getActiveConfig<Cd16Ai>(tenantId, 'cd16_ai'),
  ]);
  if (!cd14?.ai_assistance) return { ready: false, reason: 'cd14_off', cd16: cd16 ?? null };
  if (!cd16?.enabled) return { ready: false, reason: 'cd16_off', cd16 };
  return { ready: true, cd16 };
}

export async function loadChatbotConfig(tenantId: string): Promise<{
  ready: boolean;
  reason?: 'cd14_off' | 'cd16_off' | 'chatbot_off' | 'channel_off';
  cd16: Cd16Ai | null;
}> {
  const [cd14, cd16, cd08] = await Promise.all([
    getActiveConfig<Cd14Features>(tenantId, 'cd14_features'),
    getActiveConfig<Cd16Ai>(tenantId, 'cd16_ai'),
    getActiveConfig<Cd08Channels>(tenantId, 'cd08_channels'),
  ]);
  if (!cd14?.chatbot_intake) return { ready: false, reason: 'cd14_off', cd16: cd16 ?? null };
  if (!cd16?.enabled || !cd16.chatbot.enabled) return { ready: false, reason: 'cd16_off', cd16: cd16 ?? null };
  if (!cd08?.modules?.chatbot?.enabled) return { ready: false, reason: 'channel_off', cd16 };
  return { ready: true, cd16 };
}
