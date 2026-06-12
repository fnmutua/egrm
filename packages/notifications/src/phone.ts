/** Match plus-admin formatPhoneNumber: digits only, 254… without leading +. */
export function formatMobileNumber(phoneNumber: string): string | null {
  if (!phoneNumber) return null;
  const cleaned = String(phoneNumber).replace(/\D/g, '');
  if (!cleaned) return null;
  if (cleaned.startsWith('254')) return cleaned;
  if (cleaned.startsWith('0')) return `254${cleaned.slice(1)}`;
  if (cleaned.startsWith('7') && cleaned.length === 9) return `254${cleaned}`;
  if (cleaned.length === 9) return `254${cleaned}`;
  return cleaned;
}
