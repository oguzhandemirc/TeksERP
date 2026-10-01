// Lisans durumunun ZAMAN kuralları: süre çapası (v2 ödenmiş tarih P, yoksa v1 eski çapa), P'ye
// yaklaşırken bilgi bandı (K1) ve zamanın getirdiği KISITLI'nın ikinci anahtarı (K3). Her biri saf
// değerlendirici; birleştirme `state.ts`te. Tasarım: docs/design/LISANS-V2-CEVRIMDISI-KIRA.md §1.
import {
  CLOCK_SKEW_MS,
  DAY_MS,
  isoToMs,
  msToIso,
  offlineHorizonCeilingDays,
  type LeaseDoc,
  type VerifiedEntitlement,
} from "./protocol";
import {
  DEFAULT_GRACE_DAYS,
  UNMEASURED_BANNER,
  dangerBanner,
  remainingDays,
  warnBanner,
  type Finding,
  type LicenseStateInput,
  type ReasonCode,
} from "./state-rules";
import type { RememberedAnchor } from "./saat";

/** K3: "internet VAR" = son kabul edilen imzalı kiranın sunucu saati güvenilir saate göre bu süreden yeni. */
export const ONLINE_WINDOW_MS = DAY_MS;
/** K1: bilgi bandı internetsiz kurulumda çıkar — son başarılı alışveriş bu süreden eski ya da hiç yok. */
export const OFFLINE_REMINDER_AFTER_MS = 7 * DAY_MS;
/** P'den bu kadar gün önce bilgi bandı (uyarı kademesi DEĞİL). */
export const PAYMENT_REMINDER_DAYS = 30;

/**
 * Satıcıyla son BAŞARILI kira alışverişi. Kaynak imzalı ve kalıcıdır (kira ya da durum kaydının son
 * kirası); bellekteki yoklama sinyali yeniden başlatmada sıfırlanır ve adresi kapalı kurulumda hiç dolmaz.
 */
export interface ExchangeStatus {
  readonly sonAlisverisMs: number | null;
  /** Son 24 saatte başarılı alışveriş VAR: zamanın getirdiği KISITLI'yı yalnız bunun YOKLUĞU açar. */
  readonly internetVar: boolean;
  /** Son başarılı alışveriş 7 günden eski ya da hiç yok (bilgi bandının "internetsiz" ölçüsü). */
  readonly uzunSureCevrimdisi: boolean;
}

export function evaluateExchange(g: Pick<LicenseStateInput, "sonKira" | "imzaYok">, lease: LeaseDoc | null, nowMs: number): ExchangeStatus {
  // Durum kaydı kiranın verilişini tutar; satıcı verilişi ve sunucu saatini aynı anda basar.
  // Güvenilir saatin ötesindeki değer (kurcalı kayıt) "internet var" diye sayılmaz.
  const known = [lease ? isoToMs(lease.sunucuSaati) : null, g.sonKira?.verilisMs ?? null].filter(
    (ms): ms is number => ms !== null && Number.isFinite(ms) && ms <= nowMs + CLOCK_SKEW_MS,
  );
  const last = known.length > 0 ? Math.max(...known) : null;
  const age = last === null ? Number.POSITIVE_INFINITY : nowMs - last;
  // İmza durduysa (anahtar okunamıyor) satıcıyla alışveriş imkânsızdır: son kira taze olsa da internet YOK sayılır (Z9).
  return { sonAlisverisMs: last, internetVar: g.imzaYok !== true && age <= ONLINE_WINDOW_MS, uzunSureCevrimdisi: age > OFFLINE_REMINDER_AFTER_MS };
}

/** v2 süre çapası: ödenmiş tarih P. */
export interface PaidThrough {
  /** P (ms); `null` = süresiz (ödeme beyanı da ufuk da süresiz). */
  readonly tarihMs: number | null;
  /** P'yi hangisi belirledi: kiradaki ödeme beyanı mı, HAK'ın çevrimdışı ufku mu. */
  readonly kaynak: "ODEME" | "UFUK" | "SURESIZ";
  /** P sözleşme sonudur (taksit değil): ödeme beyanı kiradaki eski vadeyi (`gecerlilikBitis`) aşmıyor. */
  readonly sozlesmeSonu: boolean;
}

/** HAK'ın beyan ettiği ufuk, sınıf/imzacı tavanıyla kırpılır (doğrulayıcı reddeder; burası savunma derinliği). */
function horizonDays(entitlement: VerifiedEntitlement): number | null {
  const declared = entitlement.document.cevrimdisiUfukGun ?? null;
  const ceiling = offlineHorizonCeilingDays(entitlement.document.sinif, entitlement.signer.kind);
  if (ceiling === null) return declared;
  return declared === null ? ceiling : Math.min(declared, ceiling);
}

/**
 * P = min(kiradaki `odenmisTarih`, kira verilişi + HAK'ın `cevrimdisiUfukGun`ü). Kullanılabilir kira ve ona
 * bağlı kullanılabilir HAK iki alanı da taşımıyorsa `null`: eski çapa aynen işler (v1 belgeyle sıfır fark).
 * Ufuk kirada değil HAK'tadır — kirayı imzalayan alt anahtar onu uzatamaz; HAK silinirse P de düşer.
 */
export function paidThrough(entitlement: VerifiedEntitlement | null, lease: LeaseDoc | null): PaidThrough | null {
  if (!entitlement || !lease || lease.odenmisTarih === undefined || entitlement.document.cevrimdisiUfukGun === undefined) return null;
  const days = horizonDays(entitlement);
  const horizonEnd = days === null ? Number.POSITIVE_INFINITY : isoToMs(lease.verilis) + days * DAY_MS;
  const paid = lease.odenmisTarih === null ? Number.POSITIVE_INFINITY : isoToMs(lease.odenmisTarih);
  const until = Math.min(paid, horizonEnd);
  if (Number.isNaN(until)) return null;
  if (until === Number.POSITIVE_INFINITY) return { tarihMs: null, kaynak: "SURESIZ", sozlesmeSonu: false };
  const fromPayment = paid <= horizonEnd;
  const legacyEnd = lease.gecerlilikBitis === null ? null : isoToMs(lease.gecerlilikBitis);
  return { tarihMs: until, kaynak: fromPayment ? "ODEME" : "UFUK", sozlesmeSonu: fromPayment && legacyEnd !== null && legacyEnd <= paid };
}

interface TimeAnchor {
  readonly anchorMs: number;
  readonly graceDays: number;
  readonly code: ReasonCode;
  readonly text: string;
}

const ANCHOR_TEXT: Readonly<Record<RememberedAnchor["eskiNeden"] | "ODENMIS_TARIH_DOLDU", string>> = {
  ODENMIS_TARIH_DOLDU: "Ödenmiş lisans süresi doldu",
  VADE_DOLDU: "Lisans vadesi doldu",
  KIRA_SURESI_DOLDU: "Lisans süresi doldu",
};

/** v1 çapası: min(kira bitişi, vade). */
function legacyAnchor(lease: LeaseDoc): { readonly ms: number; readonly code: RememberedAnchor["eskiNeden"] } {
  const end = isoToMs(lease.bitis);
  const due = lease.gecerlilikBitis === null ? Number.POSITIVE_INFINITY : isoToMs(lease.gecerlilikBitis);
  return due < end ? { ms: due, code: "VADE_DOLDU" } : { ms: end, code: "KIRA_SURESI_DOLDU" };
}

/**
 * Kabul edilen kiranın süre çapası, ayakta kalan izlere (durum kaydı · DB izi) yazılmak üzere: P (işliyorsa) ve v1
 * çapası birlikte — kira silinince HAK doğrulanabiliyorsa P, doğrulanamıyorsa eski çapa okunur (HAK silmek P'yi uzatmaz).
 */
export function rememberAnchor(entitlement: VerifiedEntitlement | null, lease: LeaseDoc): RememberedAnchor {
  const paid = paidThrough(entitlement, lease);
  const legacy = legacyAnchor(lease);
  return {
    kiraId: lease.kiraId,
    ...(paid ? { odenmis: paid.tarihMs === null ? null : msToIso(paid.tarihMs) } : {}),
    eski: msToIso(legacy.ms),
    eskiNeden: legacy.code,
    ekSureGun: lease.ekSureGun,
  };
}

/** Hatırlanan çapanın bugünkü okuması: P yalnız HAK doğrulanabiliyorsa (yoksa eski çapa). */
function fromRemembered(r: RememberedAnchor, hakGecerli: boolean): TimeAnchor {
  if (hakGecerli && r.odenmis !== undefined) {
    const anchorMs = r.odenmis === null ? Number.POSITIVE_INFINITY : isoToMs(r.odenmis);
    return { anchorMs, graceDays: r.ekSureGun, code: "ODENMIS_TARIH_DOLDU", text: ANCHOR_TEXT.ODENMIS_TARIH_DOLDU };
  }
  return { anchorMs: isoToMs(r.eski), graceDays: r.ekSureGun, code: r.eskiNeden, text: ANCHOR_TEXT[r.eskiNeden] };
}

/** En kısıtlayıcı (en erken BİTEN: çapa + ek süre) çapa; eşitlikte ilk. */
function earliest(list: readonly TimeAnchor[]): TimeAnchor | null {
  let best: TimeAnchor | null = null;
  for (const a of list) if (!best || a.anchorMs + a.graceDays * DAY_MS < best.anchorMs + best.graceDays * DAY_MS) best = a;
  return best;
}

/**
 * Kira kullanılamıyorsa ayakta kalan izlerin çapaları: en ERKENİ geçerlidir (silmek süreyi uzatmaz) ve izler farklı
 * çapa taşıyorsa çelişkinin kendisi bulgudur (ÖLÇÜLEMEDİ, merdivene girer). Kira varken aynı kiraya ait izler de
 * kira çapasıyla birlikte değerlendirilir; başka kiraya ait iz eskimiş kopyadır (bir sonraki yazımda tazelenir).
 */
export function rememberedAnchors(g: LicenseStateInput, ctx: GraceContext, out: Finding[]): TimeAnchor[] {
  const all = g.sonCapalar ?? [];
  const usable = ctx.lease ? all.filter((r) => r.kiraId === ctx.lease?.kiraId) : all;
  const anchors = usable.map((r) => fromRemembered(r, ctx.hakGecerli));
  const ends = new Set(anchors.map((a) => a.anchorMs + a.graceDays * DAY_MS));
  if (ends.size > 1) out.push({ code: "LISANS_IZI_CELISKI", detail: String(ends.size), tier: "UYARI", banner: UNMEASURED_BANNER });
  return anchors;
}

/** Ek süre İMZALI tarihten türer: P → kira (bitiş/vade) → izlerin hatırladığı çapa → HAK veriliş → (hiç etkinleşmemişse) DB'deki ilk açılış. */
function timeAnchor(g: LicenseStateInput, ctx: GraceContext, remembered: readonly TimeAnchor[]): TimeAnchor | null {
  const lease = ctx.lease;
  if (lease && ctx.paid) {
    const anchorMs = ctx.paid.tarihMs ?? Number.POSITIVE_INFINITY;
    return earliest([{ anchorMs, graceDays: lease.ekSureGun, code: "ODENMIS_TARIH_DOLDU", text: ANCHOR_TEXT.ODENMIS_TARIH_DOLDU }, ...remembered]);
  }
  if (lease) {
    const legacy = legacyAnchor(lease);
    return earliest([{ anchorMs: legacy.ms, graceDays: lease.ekSureGun, code: legacy.code, text: ANCHOR_TEXT[legacy.code] }, ...remembered]);
  }
  if (remembered.length > 0) return earliest(remembered);
  if (ctx.ucIzKaybi) return null;
  if (ctx.entitlement) {
    return { anchorMs: isoToMs(ctx.entitlement.document.verilis), graceDays: DEFAULT_GRACE_DAYS, code: "KIRASIZ_EK_SURE", text: "Lisans kirası bulunamadı" };
  }
  if (g.ilkAcilisMs === null) return null;
  return { anchorMs: g.ilkAcilisMs, graceDays: DEFAULT_GRACE_DAYS, code: "ETKINLESTIRME_EK_SURESI", text: "Lisans etkinleştirilmedi" };
}

/**
 * K1: P − 30 gün ≤ T < P iken kademe NORMAL kalır, yalnız BİLGİ bandı çıkar — o da internetsizken ya da P
 * sözleşme sonuyken (internetli taksitli müşteri her ay görmez; ödeme gelince süre kendiliğinden uzar).
 */
function evaluatePaymentReminder(paid: PaidThrough, exchange: ExchangeStatus, nowMs: number, out: Finding[]): void {
  const until = paid.tarihMs;
  if (until === null || nowMs >= until || nowMs < until - PAYMENT_REMINDER_DAYS * DAY_MS) return;
  if (!exchange.uzunSureCevrimdisi && !paid.sozlesmeSonu) return;
  const left = remainingDays(until, nowMs);
  const metin = exchange.uzunSureCevrimdisi
    ? `Ödenmiş lisans süresi ${left} gün sonra doluyor — Lisans ekranından QR ya da lisans dosyasıyla yenileyin.`
    : `Lisans sözleşmesi ${left} gün sonra bitiyor — yenilendiğinde süre bağlantıyla kendiliğinden uzar.`;
  out.push({ code: "ODEME_YAKLASIYOR", detail: String(left), banner: { metin, ton: "bilgi" } });
}

export interface GraceContext {
  readonly entitlement: VerifiedEntitlement | null;
  readonly lease: LeaseDoc | null;
  readonly paid: PaidThrough | null;
  readonly exchange: ExchangeStatus;
  /** HAK doğrulandı ve durum kaydının pinine ters düşmüyor (geri alınmış HAK P'yi uzatamaz). */
  readonly hakGecerli: boolean;
  /**
   * Üç iz birden kayıp (K7: şimdi ya da kayıttaki tespit anı): kira ve izlerin çapası yoksa süre çapası TESPİT ANIdır
   * ve belirsizlik merdiveni (birikim ≥ 14 gün → EK_SURE) yönetir — HAK verilişi / ilk açılış çapası uygulanmaz.
   */
  readonly ucIzKaybi: boolean;
}

/**
 * Zamanın getirdiği KISITLI iki anahtarlıdır: çapa + ek süre geçmiş VE son 24 saatte başarılı kira
 * alışverişi YOK. İnternet varken kademeyi yalnız satıcı kararı düşürür (EK_SURE 0 gün).
 */
export function evaluateGrace(g: LicenseStateInput, ctx: GraceContext, nowMs: number, out: Finding[]): void {
  const anchor = timeAnchor(g, ctx, rememberedAnchors(g, ctx, out));
  if (!anchor) {
    if (!ctx.ucIzKaybi) out.push({ code: "ILK_ACILIS_BILINMIYOR", tier: "UYARI", banner: UNMEASURED_BANNER });
    return;
  }
  if (ctx.paid) evaluatePaymentReminder(ctx.paid, ctx.exchange, nowMs, out);
  if (nowMs < anchor.anchorMs) return;
  const end = anchor.anchorMs + anchor.graceDays * DAY_MS;
  if (nowMs < end) {
    const left = remainingDays(end, nowMs);
    const banner = warnBanner(`${anchor.text} — ${left} gün içinde yenilenmezse program kısıtlı kipe geçecek.`);
    out.push({ code: anchor.code, tier: "EK_SURE", banner, daysLeft: left });
    return;
  }
  out.push({ code: anchor.code });
  if (!ctx.exchange.internetVar) {
    out.push({ code: "EK_SURE_BITTI", tier: "KISITLI", banner: dangerBanner(`${anchor.text} ve ek süre bitti: program kısıtlı kipte (okuma, rapor, yedek açık).`) });
  } else {
    out.push({ code: "EK_SURE_BITTI", tier: "EK_SURE", daysLeft: 0, banner: warnBanner(`${anchor.text}; lisans sunucusuyla bağlantı sürdükçe kısıtlama uygulanmaz.`) });
  }
}
