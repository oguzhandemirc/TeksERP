// Lisans durumunun ZAMAN kuralları: süre çapası (v2 ödenmiş tarih P, yoksa v1 eski çapa), P'ye
// yaklaşırken bilgi bandı (K1) ve zamanın getirdiği KISITLI'nın ikinci anahtarı (K3). Her biri saf
// değerlendirici; birleştirme `state.ts`te. Tasarım: docs/design/LISANS-V2-CEVRIMDISI-KIRA.md §1.
import {
  CLOCK_SKEW_MS,
  DAY_MS,
  isoToMs,
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

export function evaluateExchange(g: Pick<LicenseStateInput, "sonKira">, lease: LeaseDoc | null, nowMs: number): ExchangeStatus {
  // Durum kaydı kiranın verilişini tutar; satıcı verilişi ve sunucu saatini aynı anda basar.
  // Güvenilir saatin ötesindeki değer (kurcalı kayıt) "internet var" diye sayılmaz.
  const known = [lease ? isoToMs(lease.sunucuSaati) : null, g.sonKira?.verilisMs ?? null].filter(
    (ms): ms is number => ms !== null && Number.isFinite(ms) && ms <= nowMs + CLOCK_SKEW_MS,
  );
  const last = known.length > 0 ? Math.max(...known) : null;
  const age = last === null ? Number.POSITIVE_INFINITY : nowMs - last;
  return { sonAlisverisMs: last, internetVar: age <= ONLINE_WINDOW_MS, uzunSureCevrimdisi: age > OFFLINE_REMINDER_AFTER_MS };
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

/** Ek süre İMZALI tarihten türer: P → kira (bitiş/vade) → HAK veriliş → (hiç etkinleşmemişse) DB'deki ilk açılış. */
function timeAnchor(g: LicenseStateInput, ctx: GraceContext): TimeAnchor | null {
  const lease = ctx.lease;
  if (lease && ctx.paid) {
    const anchorMs = ctx.paid.tarihMs ?? Number.POSITIVE_INFINITY;
    return { anchorMs, graceDays: lease.ekSureGun, code: "ODENMIS_TARIH_DOLDU", text: "Ödenmiş lisans süresi doldu" };
  }
  if (lease) {
    const end = isoToMs(lease.bitis);
    const due = lease.gecerlilikBitis === null ? Number.POSITIVE_INFINITY : isoToMs(lease.gecerlilikBitis);
    return due < end
      ? { anchorMs: due, graceDays: lease.ekSureGun, code: "VADE_DOLDU", text: "Lisans vadesi doldu" }
      : { anchorMs: end, graceDays: lease.ekSureGun, code: "KIRA_SURESI_DOLDU", text: "Lisans süresi doldu" };
  }
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
}

/**
 * Zamanın getirdiği KISITLI iki anahtarlıdır: çapa + ek süre geçmiş VE son 24 saatte başarılı kira
 * alışverişi YOK. İnternet varken kademeyi yalnız satıcı kararı düşürür (EK_SURE 0 gün).
 */
export function evaluateGrace(g: LicenseStateInput, ctx: GraceContext, nowMs: number, out: Finding[]): void {
  const anchor = timeAnchor(g, ctx);
  if (!anchor) {
    out.push({ code: "ILK_ACILIS_BILINMIYOR", tier: "UYARI", banner: UNMEASURED_BANNER });
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
