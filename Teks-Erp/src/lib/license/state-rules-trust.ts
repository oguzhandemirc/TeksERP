// Lisans durumunun GÜVEN kuralları: geri alınmış kira/HAK (durum kaydının son kabulüne göre),
// okunamayan depo dosyası ve satıcı saati sapması. Her biri bulgu listesine satır ekleyen saf
// değerlendirici; birleştirme `state.ts`te.
import { CLOCK_SKEW_MS, isoToMs, type VerifiedEntitlement, type VerifiedLease } from "./protocol";
import type { EntitlementPin } from "./saat";
import { UNMEASURED_BANNER, type Finding, type LicenseStateInput } from "./state-rules";

/** Pin ters mi: başka HAK, daha eski sürüm ya da başka sınıf. */
export function entitlementPinBroken(entitlement: VerifiedEntitlement, pin: EntitlementPin): string | null {
  const d = entitlement.document;
  if (d.hakId !== pin.hakId) return "HAK";
  if (d.surum < pin.surum) return "HAK_SURUM";
  if (d.sinif !== pin.sinif) return "SINIF";
  return null;
}

/**
 * Geri alma: diskteki kira durum kaydının bildiği son kabulden ESKİYSE ya da HAK pini ters düşüyorsa
 * kira kullanılmaz (sunucu kararları ve kip durum kaydından sürer). Kayıt yoksa denetim yoktur —
 * kira + durum kaydını BİRLİKTE geri almak bilinen sınırdır (protokol §11).
 */
export function evaluateRollback(
  g: LicenseStateInput,
  entitlement: VerifiedEntitlement | null,
  lease: VerifiedLease | null,
  out: Finding[],
): VerifiedLease | null {
  const last = g.sonKira ?? null;
  const pin = g.sonHak ?? null;
  let detail: string | null = null;
  if (lease && last && lease.document.kiraId !== last.kiraId && isoToMs(lease.document.verilis) < last.verilisMs) detail = "KIRA";
  else if (entitlement && pin) detail = entitlementPinBroken(entitlement, pin);
  if (detail === null) return lease;
  out.push({ code: "KIRA_GERI_ALINDI", detail, tier: "UYARI", banner: UNMEASURED_BANNER });
  return null;
}

/** Var olan ama okunamayan depo dosyası: yok sayılmaz (silmekle eşit değil), ölçülemedi sayılır. */
export function evaluateStore(g: LicenseStateInput, out: Finding[]): void {
  const files = g.depoOkunamadi ?? [];
  if (files.length > 0) out.push({ code: "DEPO_OKUNAMADI", detail: files.join(","), tier: "UYARI", banner: UNMEASURED_BANNER });
}

/** Satıcı saati İMZASIZDIR: kayma yalnız bilgi olarak raporlanır, geçerlilik ve kademe değişmez. */
export function evaluateVendorClock(g: LicenseStateInput, out: Finding[]): void {
  const skew = g.saticiSapmaMs ?? null;
  if (skew !== null && Math.abs(skew) > CLOCK_SKEW_MS) out.push({ code: "SAAT_KAYIK", detail: String(Math.round(skew / 1000)) });
}
