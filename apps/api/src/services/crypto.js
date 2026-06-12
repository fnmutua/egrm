/**
 * App-layer PII encryption (GEN-SEC-05): AES-256-GCM for storage,
 * HMAC-SHA256 digests for equality lookups (phone/email search without decryption).
 * Keys are derived per purpose from PII_SECRET via scrypt; per-tenant KMS envelope keys
 * replace this derivation in the production hardening pass (Phase 3).
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from 'node:crypto';
import { env } from '../env.js';
const encKey = scryptSync(env.PII_SECRET, 'egrm-pii-enc', 32);
const macKey = scryptSync(env.PII_SECRET, 'egrm-pii-mac', 32);
export function encryptPII(plain) {
    if (!plain)
        return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encKey, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}
export function decryptPII(stored) {
    if (!stored)
        return null;
    const [version, ivB64, tagB64, dataB64] = stored.split(':');
    if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64)
        return null;
    try {
        const decipher = createDecipheriv('aes-256-gcm', encKey, Buffer.from(ivB64, 'base64'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
    }
    catch {
        return null;
    }
}
/** Normalized HMAC digest for equality lookup. */
export function piiLookupHash(value) {
    if (!value)
        return null;
    const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
    if (!normalized)
        return null;
    return createHmac('sha256', macKey).update(normalized).digest('hex');
}
//# sourceMappingURL=crypto.js.map