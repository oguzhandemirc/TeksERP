// =============================================================================
// JWT `exp` çözümü — SAF mantık (imza DOĞRULANMAZ, sadece payload decode)
// =============================================================================
// Token süresi dolunca otomatik logout için `exp` claim'ini okuruz. İmza
// doğrulaması BACKEND'in işi — client yalnız "bu token ne zaman geçersiz olur"
// sorusunu yanıtlar (base64url payload decode). Kriptografik güven amacı YOK.
//
// base64 decode ortamdan bağımsız: jest/node → Buffer, RN/Hermes → atob.
// JWT payload'ı ASCII/UTF-8 JSON olduğu için ikisi de `exp` sayısını doğru verir.
// =============================================================================

function decodeBase64(b64: string): string {
  // Node / jest ortamı
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('utf8');
  }
  // React Native / Hermes (atob RN 0.74+ built-in)
  if (typeof atob === 'function') {
    return atob(b64);
  }
  throw new Error('base64 decoder yok');
}

/**
 * JWT'nin `exp` claim'ini MİLİSANİYE (epoch) olarak döner. İmza doğrulanmaz.
 * Çözülemeyen/eksik token → null.
 */
export function decodeJwtExpMs(token: string | null | undefined): number | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = decodeBase64(b64);
    const obj = JSON.parse(payload) as { exp?: unknown };
    if (typeof obj.exp !== 'number' || !Number.isFinite(obj.exp)) return null;
    return obj.exp * 1000;
  } catch {
    return null;
  }
}

/** Token süresine kalan ms. exp yoksa null (süresiz kabul → logout etme). */
export function msUntilExpiry(
  token: string | null | undefined,
  now: number,
): number | null {
  const expMs = decodeJwtExpMs(token);
  return expMs == null ? null : expMs - now;
}

/**
 * Ayar açıksa VE token süresi dolmuşsa otomatik logout edilmeli mi?
 * - `enabled=false` → asla (kullanıcı kapatmış).
 * - exp yoksa → false (belirsiz süreyi zorla düşürme).
 * - now >= exp → true.
 */
export function shouldAutoLogout(
  token: string | null | undefined,
  now: number,
  enabled: boolean,
): boolean {
  if (!enabled) return false;
  const expMs = decodeJwtExpMs(token);
  if (expMs == null) return false;
  return now >= expMs;
}
