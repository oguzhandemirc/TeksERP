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
 *  (penaltyRounds — escalate için), blok bitiş zamanı (epoch ms) ve son deneme
 *  anı (lastFailAt — F48 idle-decay için). */
type FailEntry = { fails: number; penaltyRounds: number; blockedUntil: number; lastFailAt: number };

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
 * F20: Login denemesini ATOMİK rezerve et — blok kontrolü + sayaç artışı tek
 * çağrıda, get→mutate→set arasında AWAIT YOK. Node tek-thread olduğundan ayar
 * okumaları bittikten sonraki senkron bölge, N paralel isteği seri işletir; her
 * biri kendi fails++'ını görür → eşik tam sayıda denemede kurulur (eski
 * check→verify→record akışında N istek record'dan önce check'i geçip
 * brute-force penceresi açıyordu).
 *
 * Deneme başarısız VARSAYIMIYLA sayılır; başarılı giriş `resetLoginLockout` ile
 * geri alır (net sıfır). Eşiği kuran deneme yine doğrulamaya geçer, SONRAKİ
 * denemeler bloklanır (orijinal "N deneme sonra kilit" semantiği korunur). Kilit
 * kapalıysa (pinLockoutEnabled=false) her zaman {blocked:false}.
 */
export async function reserveLoginAttempt(
  key: string,
): Promise<{ blocked: boolean; retryAfterSec: number }> {
  const enabled = await readPinLockoutEnabled();
  if (!enabled) return { blocked: false, retryAfterSec: 0 };
  const [attempts, penaltySec, escalateAfter, longPenaltyMin] = await Promise.all([
    readPinLockoutAttempts(),
    readPinLockoutPenaltySec(),
    readPinLockoutEscalateAfter(),
    readPinLockoutLongPenaltyMin(),
  ]);

  // --- SENKRON BÖLGE: buradan sonra await YOK → paralel N istek seri işlenir. ---
  const now = Date.now();
  const entry = failCounts.get(key) ?? { fails: 0, penaltyRounds: 0, blockedUntil: 0, lastFailAt: 0 };
  if (entry.blockedUntil > now) {
    return { blocked: true, retryAfterSec: Math.ceil((entry.blockedUntil - now) / 1000) };
  }
  // F48: escalation ladder (penaltyRounds) idle sürede çürür — meşru kullanıcı
  // kalıcı olarak uzun-cezaya yapışmasın. Pencere = longPenaltyMin (yeni ayar YOK).
  const decayMs = Math.max(1, longPenaltyMin) * 60_000;
  if (entry.lastFailAt > 0 && now - entry.lastFailAt > decayMs) {
    const drop = Math.floor((now - entry.lastFailAt) / decayMs);
    entry.penaltyRounds = Math.max(0, entry.penaltyRounds - drop);
  }
  entry.lastFailAt = now;
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

  // Sınırsız büyümeyi önle: tavan aşılınca aktif olmayan (blok bitmiş + fails=0 +
  // escalation yok) bayat girişleri buda. F48: penaltyRounds>0 olan escalation
  // state'i erken budanmasın (başarı sonrası fails=0 kalabilir).
  if (failCounts.size > MAX_ENTRIES) {
    for (const [k, e] of failCounts) {
      if (e.blockedUntil < now && e.fails === 0 && e.penaltyRounds === 0) failCounts.delete(k);
    }
  }

  return { blocked: false, retryAfterSec: 0 }; // bu deneme doğrulamaya geçer
}

/**
 * Başarılı giriş / brute-force olmayan hata (F49): bu denemenin rezervasyonunu
 * geri al — ardışık sayacı (fails) ve aktif bloğu (blockedUntil) sıfırla.
 * F48: escalation ladder'ı (penaltyRounds) SİLME; başarılı giriş turlar-arası
 * cezayı bypass etmesin (aksi halde araya bir geçerli giriş sokan saldırgan
 * escalation'ı süresiz sıfırlar). penaltyRounds idle-decay ile zamanla çürür.
 */
export function resetLoginLockout(key: string): void {
  const e = failCounts.get(key);
  if (!e) return;
  e.fails = 0;
  e.blockedUntil = 0;
}

/**
 * F49: brute-force OLMAYAN sonuç (409 SESSION_EXISTS, 403 yöntem-kapalı) sonrası
 * bu denemenin assume-fail rezervasyonunu TEK adım geri al (fails--). resetLoginLockout'tan
 * farkı: birikmiş gerçek 401 hatalarını SİLMEZ — yalnız kendi artışını düşer; böylece
 * saldırgan araya 403/409 sokarak lockout'u sıfırlayamaz. (Nadir durum: bu deneme eşiği
 * tetiklediyse fails zaten 0 + blok kuruldu → güvenli tarafta blok bırakılır.)
 */
export function releaseLoginAttempt(key: string): void {
  const e = failCounts.get(key);
  if (!e) return;
  if (e.fails > 0) e.fails -= 1;
}
