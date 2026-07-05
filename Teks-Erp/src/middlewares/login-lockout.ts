// =============================================================================
// TeksERP - Login Deneme Kilidi (hızlı PIN + kart) — bellek-içi throttle
// =============================================================================
// Salt hızlı-PIN (6 hane, sistem-genelinde benzersiz) + QR kart girişleri
// LAN'da parola sormadan tek istekte kimlik belirler → throttle olmadan
// brute-force ile hesap düşürülebilir. Bu modül IP (yoksa cihaz kimliği)
// başına ardışık yanlış denemeleri sayar, eşik aşılınca artan ceza uygular.
//
// auth.middleware.ts:11-43 `lastSeenWrites` desenini aynalar: modül-seviye Map,
// tek-process invariant (yerel tek-sunucu kurulum), restart'ta sıfırlanır
// (kalıcı defter değil — LAN brute-force'a karşı yeterli). Boyut-cap sweep ile
// sınırsız büyüme engellenir. Ayarlar readPinLockout* ile CANLI okunur (cache'siz).
// =============================================================================

import type { Request } from "express";
import {
  readPinLockoutEnabled,
  readPinLockoutAttempts,
  readPinLockoutPenaltySec,
  readPinLockoutEscalateAfter,
  readPinLockoutLongPenaltyMin,
} from "../services/system-setting.service";
import "../types/express-augment";

/** Anahtar başına deneme durumu: ardışık yanlış (fails), toplam ceza turu
 *  (penaltyRounds — escalate için) ve blok bitiş zamanı (epoch ms). */
type FailEntry = { fails: number; penaltyRounds: number; blockedUntil: number };

const failCounts = new Map<string, FailEntry>();
/** Bellek tavanı — bu sayının üstünde sweep ile bayat girişler budanır. */
const MAX_ENTRIES = 5000;

/**
 * Login isteğinden kilit anahtarını çöz: IP öncelikli (LAN brute-force'a karşı
 * device-id'den daha sağlam — device-id spoof edilebilir). IP yoksa cihaz
 * kimliği (eşleşmiş cihaz ya da ham x-device-id), o da yoksa "unknown".
 */
export function resolveLoginLockoutKey(req: Request): string {
  const ip = req.ip;
  if (typeof ip === "string" && ip.trim()) return ip.trim();
  if (req.device?.deviceId) return `dev:${req.device.deviceId}`;
  const h = req.headers["x-device-id"];
  const v = Array.isArray(h) ? h[0] : h;
  if (typeof v === "string" && v.trim()) return `dev:${v.trim().slice(0, 64)}`;
  return "unknown";
}

/**
 * Anahtar bloklu mu? Kilit KAPALIYSA (pinLockoutEnabled=false) her zaman
 * {blocked:false}. Bloktaysa kalan süreyi (saniye, yukarı yuvarlanmış) döner.
 */
export async function checkLoginLockout(
  key: string,
): Promise<{ blocked: boolean; retryAfterSec: number }> {
  const enabled = await readPinLockoutEnabled();
  if (!enabled) return { blocked: false, retryAfterSec: 0 };
  const entry = failCounts.get(key);
  if (!entry) return { blocked: false, retryAfterSec: 0 };
  const now = Date.now();
  if (entry.blockedUntil > now) {
    return { blocked: true, retryAfterSec: Math.ceil((entry.blockedUntil - now) / 1000) };
  }
  return { blocked: false, retryAfterSec: 0 };
}

/**
 * Yanlış giriş kaydı: fails++. Eşiğe (attempts) ulaşınca ceza turu artar, fails
 * sıfırlanır ve blok kurulur — turun escalateAfter'a varması UZUN cezaya
 * (longPenaltyMin) yükseltir, aksi halde KISA ceza (penaltySec). Kilit
 * kapalıysa hiçbir şey yapmaz.
 */
export async function recordLoginFailure(key: string): Promise<void> {
  const enabled = await readPinLockoutEnabled();
  if (!enabled) return;
  const attempts = await readPinLockoutAttempts();
  const penaltySec = await readPinLockoutPenaltySec();
  const escalateAfter = await readPinLockoutEscalateAfter();
  const longPenaltyMin = await readPinLockoutLongPenaltyMin();

  const now = Date.now();
  const entry = failCounts.get(key) ?? { fails: 0, penaltyRounds: 0, blockedUntil: 0 };
  entry.fails += 1;
  if (entry.fails >= attempts) {
    entry.penaltyRounds += 1;
    entry.fails = 0;
    entry.blockedUntil =
      entry.penaltyRounds >= escalateAfter
        ? now + longPenaltyMin * 60 * 1000
        : now + penaltySec * 1000;
  }
  failCounts.set(key, entry);

  // Sınırsız büyümeyi önle: tavan aşılınca aktif olmayan (blok bitmiş + fails=0)
  // bayat girişleri buda.
  if (failCounts.size > MAX_ENTRIES) {
    for (const [k, e] of failCounts) {
      if (e.blockedUntil < now && e.fails === 0) failCounts.delete(k);
    }
  }
}

/** Başarılı girişte anahtarı temizle — sayaç sıfırdan başlar. */
export function resetLoginLockout(key: string): void {
  failCounts.delete(key);
}
