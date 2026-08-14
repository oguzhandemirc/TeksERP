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
import { readPinLockoutConfig } from "../services/system-setting.service";
import { readWebHardeningConfig, resolveClientIp } from "./web-hardening";
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
export function resolveLoginLockoutKey(
  req: Request,
  /** Gerçek istemci IP'sini taşıyan güvenilen başlık — bkz. resolveClientIp. */
  clientIpHeader: string | null = null,
): string {
  const ip = resolveClientIp(req, clientIpHeader);
  if (ip) return ip;
  if (req.device?.deviceId) return `dev:${req.device.deviceId}`;
  const h = req.headers["x-device-id"];
  const v = Array.isArray(h) ? h[0] : h;
  if (typeof v === "string" && v.trim()) return `dev:${v.trim().slice(0, 64)}`;
  return "unknown";
}

// =============================================================================
// TERS VEKİL ARKASINDA ANAHTAR: iki katman (2026-08-14, internete açma)
// =============================================================================
// Yukarıdaki tek-anahtar (=IP) modeli fabrika LAN'ında DOĞRUDUR ve gerekçesi
// `auth.controller.ts`te yazılı: her cihaz kendi IP'sini taşır, dolayısıyla
// kullanıcı adını anahtara katmamak password-spraying'i kapatır.
//
// ⚠️ İnternete açılınca aynı model TERSİNE DÖNER. nginx/Cloudflare arkasında
// `req.ip` bütün ziyaretçiler için AYNI kenar IP'sidir; şifresini yanlış giren
// İLK ziyaretçi 5 denemede TÜM kurulumu kilitler — kimlik doğrulama gerektirmeyen,
// tek kişilik bir hizmet kesintisi. (`trust proxy` set edilirse `req.ip` yeniden
// gerçek istemci IP'si olur ve bu senaryo büyük ölçüde kapanır; ama kurumsal
// NAT arkasındaki ofis hâlâ tek IP'dir — yani "tek kişi hepsini kilitler"
// riski tamamen bitmez.)
//
// ÇÖZÜM: kimliği anahtara KATMAK ama IP katmanını da BIRAKMAK — iki kova:
//   • DAR  (`ip|kimlik`, bütçe ×1)  → hesabı brute-force'tan korur.
//   • GENİŞ(`ip`,        bütçe ×N)  → aynı kaynaktan çok hesap denemesini
//                                     (password spraying) yakalar.
// Yalnız dar kova olsaydı saldırgan kullanıcı adını değiştirerek kilidi
// atlardı (mevcut yorumun haklı olarak korktuğu şey). Yalnız geniş kova
// olsaydı bugünkü demo-kilitleme sorunu sürerdi. İkisi birlikte, meşru
// kullanıcının komşusunu kilitlemeden saldırganı durdurur.
//
// Bu davranış `LOGIN_LOCKOUT_SCOPE`/`TRUST_PROXY` ile açılır; ortam değişkeni
// YOKKEN `resolveLoginLockoutKeys` tek elemanlı bir liste döner ve aşağıdaki
// rezervasyon mantığı bugünküyle BİREBİR aynı yolu koşar (tek kod yolu — iki
// ayrı dal yazılsaydı zamanla ayrışırlardı).
// =============================================================================

/** Bir kilit kovası: anahtar + eşik çarpanı (1 = bugünkü eşik). */
export type LockoutKeySpec = { key: string; budgetMultiplier: number };

/**
 * GENİŞ (IP) kovanın bütçe çarpanı. 5 seçildi: varsayılan eşik 5 deneme →
 * IP başına 25 hatalı deneme. Meşru bir ofis (tek NAT IP'si) gün içinde bu
 * kadar yanlış şifre üretmez; buna karşılık 25 farklı hesabı deneyen bir
 * spray tam da bu sınıra takılır.
 */
export const WIDE_KEY_BUDGET_MULTIPLIER = 5;

/** Kimlik parçasını normalize et — anahtar patlamasını ve büyük/küçük harf
 *  ayrışmasını önler ("Admin" ile "admin" AYNI kova olmalı). */
function normalizeIdentity(identity: string | null | undefined): string {
  const v = (identity ?? "").trim().toLowerCase();
  return v ? v.slice(0, 80) : "-";
}

/**
 * Bu giriş denemesinin sayılacağı kovalar.
 *
 * `identity` ÇAĞIRANIN sorumluluğundadır ve **sır olmamalıdır**: şifre yolunda
 * kullanıcı adı, kart/PIN yolunda cihaz kimliği kullanılır. Kart kodunu ya da
 * PIN'i kimlik olarak vermek onları bellek-içi bir haritanın anahtarına yazmak
 * olurdu; ayrıca sır her denemede değişeceği için kova hiç dolmaz, yani koruma
 * sessizce kaybolurdu.
 */
export function resolveLoginLockoutKeys(
  req: Request,
  identity?: string | null,
  /** Yalnız bekçi için: `process.env`i mutasyona uğratıp geri almak paralel
   *  koşumda sızdıran bir desendir; kapsam kararı buradan enjekte edilebilir. */
  env: NodeJS.ProcessEnv = process.env,
): LockoutKeySpec[] {
  // Uyarılar boot'ta app.ts tarafından basılıyor — her giriş denemesinde
  // tekrarlamak log'u boğar, o yüzden burada sessiz okunur.
  const { loginLockoutScope, clientIpHeader } = readWebHardeningConfig(env, () => {});
  const ipKey = resolveLoginLockoutKey(req, clientIpHeader);
  if (loginLockoutScope === "ip") return [{ key: ipKey, budgetMultiplier: 1 }];
  return [
    { key: `${ipKey}|${normalizeIdentity(identity)}`, budgetMultiplier: 1 },
    { key: ipKey, budgetMultiplier: WIDE_KEY_BUDGET_MULTIPLIER },
  ];
}

/** `string` (eski sözleşme) ya da kova listesi → kova listesi. */
function toSpecs(key: string | LockoutKeySpec[]): LockoutKeySpec[] {
  return typeof key === "string" ? [{ key, budgetMultiplier: 1 }] : key;
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
  key: string | LockoutKeySpec[],
): Promise<{ blocked: boolean; retryAfterSec: number }> {
  // Beş ayar TEK sorguda (readPinLockoutConfig). Önbellek YOK — her denemede canlı
  // DB okunur, yani "middleware tazeliği" garantisi aynen korunur; yalnız
  // round-trip 5→1 iner. Ayrıca bu, aşağıdaki SENKRON BÖLGE invariant'ını
  // GÜÇLENDİRİR: iki await aşaması (enabled, sonra Promise.all) yerine tek
  // interleaving noktası kalır.
  const { enabled, attempts, penaltySec, escalateAfter, longPenaltyMin } = await readPinLockoutConfig();
  if (!enabled) return { blocked: false, retryAfterSec: 0 };

  // --- SENKRON BÖLGE: buradan sonra await YOK → paralel N istek seri işlenir. ---
  const now = Date.now();
  const specs = toSpecs(key);

  // 1) BLOK KONTROLÜ — hiçbir sayaç ARTMADAN, TÜM kovalar için. Kontrol ile
  //    rezervasyon ayrı turlarda: tek turda yapılsaydı ilk kova bloklu iken
  //    ikinci kovanın sayacı artmış olurdu, yani bloklu bir istemci geniş kovayı
  //    doldurmaya devam eder ve cezayı sonsuza uzatırdı.
  let blockedForMs = 0;
  for (const spec of specs) {
    const e = failCounts.get(spec.key);
    if (e && e.blockedUntil > now) blockedForMs = Math.max(blockedForMs, e.blockedUntil - now);
  }
  if (blockedForMs > 0) {
    return { blocked: true, retryAfterSec: Math.ceil(blockedForMs / 1000) };
  }

  // 2) REZERVASYON — her kova kendi eşiğiyle (çarpan 1 = bugünkü eşik).
  for (const spec of specs) {
    const entry = failCounts.get(spec.key)
      ?? { fails: 0, penaltyRounds: 0, blockedUntil: 0, lastFailAt: 0 };
    // F48: escalation ladder (penaltyRounds) idle sürede çürür — meşru kullanıcı
    // kalıcı olarak uzun-cezaya yapışmasın. Pencere = longPenaltyMin (yeni ayar YOK).
    const decayMs = Math.max(1, longPenaltyMin) * 60_000;
    if (entry.lastFailAt > 0 && now - entry.lastFailAt > decayMs) {
      const drop = Math.floor((now - entry.lastFailAt) / decayMs);
      entry.penaltyRounds = Math.max(0, entry.penaltyRounds - drop);
    }
    entry.lastFailAt = now;
    entry.fails += 1;
    // Eşik kovanın bütçesiyle ölçeklenir: dar kova ×1 (hesabı korur), geniş
    // (IP) kova ×N (spraying'i yakalar ama tek meşru kullanıcıyı kilitlemez).
    const budget = Math.max(1, attempts * spec.budgetMultiplier);
    if (entry.fails >= budget) {
      entry.penaltyRounds += 1;
      entry.fails = 0;
      entry.blockedUntil =
        entry.penaltyRounds >= escalateAfter
          ? now + longPenaltyMin * 60 * 1000
          : now + penaltySec * 1000;
    }
    failCounts.set(spec.key, entry);
  }

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
export function resetLoginLockout(key: string | LockoutKeySpec[]): void {
  // ⚠️ GENİŞ (IP) kova da sıfırlanır ve bu BİLİNÇLİ. Sıfırlanmasaydı ortak
  // NAT'taki ofis gün boyunca hatalarını biriktirir (fails yalnız eşikte ya da
  // burada sıfırlanıyor, kendiliğinden çürümüyor) ve akşama doğru tüm ofis
  // kilitlenirdi. Bedeli: geçerli bir kimlik bilgisi ELE GEÇİRMİŞ saldırgan araya
  // başarılı bir giriş sokarak IP bütçesini sıfırlayabilir — ama o noktada zaten
  // içeridedir. Bu, `penaltyRounds`ın bilinçli olarak SIFIRLANMAMASI kuralıyla
  // (aşağıdaki F48 notu) aynı dengeye dayanır.
  for (const spec of toSpecs(key)) {
    const e = failCounts.get(spec.key);
    if (!e) continue;
    e.fails = 0;
    e.blockedUntil = 0;
  }
}

/**
 * F49: brute-force OLMAYAN sonuç (409 SESSION_EXISTS, 403 yöntem-kapalı) sonrası
 * bu denemenin assume-fail rezervasyonunu TEK adım geri al (fails--). resetLoginLockout'tan
 * farkı: birikmiş gerçek 401 hatalarını SİLMEZ — yalnız kendi artışını düşer; böylece
 * saldırgan araya 403/409 sokarak lockout'u sıfırlayamaz. (Nadir durum: bu deneme eşiği
 * tetiklediyse fails zaten 0 + blok kuruldu → güvenli tarafta blok bırakılır.)
 */
export function releaseLoginAttempt(key: string | LockoutKeySpec[]): void {
  for (const spec of toSpecs(key)) {
    const e = failCounts.get(spec.key);
    if (!e) continue;
    if (e.fails > 0) e.fails -= 1;
  }
}
