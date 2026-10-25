// =============================================================================
// Donanım özeti (cihaz eşleme v2) — YALNIZ TANIMA, kimlik doğrulama değil.
// Kaldır-kur yerel kimliği (SecureStore UUID) siler; ANDROID_ID aynı mühürle kurulan
// pakette kalır. Sunucu yeni yerel kimlikle gelen bilinen donanımı aynı satıra bağlar.
// Ham değer cihazdan ÇIKMAZ: kurulum kimliğiyle tuzlanmış HMAC gönderilir (iki fabrika
// aynı tableti ilişkilendiremez). Biçim backend `computeHwDigest` ile BAYT-EŞİT.
// =============================================================================

import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { hmacSha256Hex } from '../lib/device-proof';
import { utf8Bytes } from '../lib/qr-parca';

export const HW_DIGEST_DOMAIN = 'tekserp/cihaz-donanim/v1';
export type HwSource = 'ANDROID_ID';

export interface HwClaim {
  v: 1;
  kaynak: HwSource;
  ozet: string;
}

/** Saf: HMAC-SHA256(anahtar = installationId, domain\nkaynak\nham) küçük harf hex. */
export function computeHwDigest(installationId: string, kaynak: HwSource, ham: string): string {
  return hmacSha256Hex(utf8Bytes(installationId), `${HW_DIGEST_DOMAIN}\n${kaynak}\n${ham}`);
}

/** Ham ANDROID_ID — yalnız bu dosyada okunur; okunamazsa null (özet gönderilmez). */
function readAndroidId(): string | null {
  if (Platform.OS !== 'android') return null;
  try {
    const v = Application.getAndroidId();
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Announce'a eklenecek `hw`. Kurulum kimliği yoksa null: anahtarsız özet başka fabrikayla
 * ilişkilendirilebilir olurdu. Dönüşte yalnız özet bulunur, ham değer bulunmaz.
 */
export function getHardwareDigest(installationId: string | null | undefined): HwClaim | null {
  const iid = (installationId ?? '').trim();
  if (!iid) return null;
  const ham = readAndroidId();
  if (!ham) return null;
  return { v: 1, kaynak: 'ANDROID_ID', ozet: computeHwDigest(iid, 'ANDROID_ID', ham) };
}

/** Panelde görünür ad ("samsung SM-X200"); paket gerekmez. Sunucu tavanı 120. */
export function getDeviceModel(): string | undefined {
  if (Platform.OS !== 'android') return undefined;
  const c = (Platform.constants ?? {}) as { Model?: unknown; Manufacturer?: unknown };
  const parts = [c.Manufacturer, c.Model].filter((p): p is string => typeof p === 'string' && !!p.trim());
  const s = parts.map((p) => p.trim()).join(' ');
  return s ? s.slice(0, 120) : undefined;
}
