// Patron bulutu ÖN KOŞULU (tek kaynak; `PATRON-BULUTU-ESITLEME.md` §1.4) — FAIL-CLOSED: belirsizlik GÖNDERMEZ ve
// ÇEKMEZ. Modül tavanının fail-open'ının bilinçli tersi: tavan bugünkü davranışı korur, bulut ise yeni bir dış kanal.
import { getLicenseSnapshot, type LicenseSnapshot } from "../lib/license/runtime";
import { isOpenInTier } from "../constants/license-routes";

export const PATRON_CLOUD_MODULE = "patron-bulut";

export type CloudIneligibleReason =
  | "HAZIR_DEGIL"
  | "HAK_YOK"
  | "KIRA_YOK"
  | "SINIF_GONDEREMEZ"
  | "MODUL_YOK"
  | "ABONELIK_BITTI"
  | "DEVREDILDI"
  | "ARALIK_YOK";

export type CloudEligibility =
  | { readonly ok: true; readonly intervalMinutes: number; readonly snap: LicenseSnapshot }
  | { readonly ok: false; readonly reason: CloudIneligibleReason };

/** Dördü birden: HAK `URETIM` ∧ HAK ∋ `patron-bulut` ∧ kira `patronBulutBitis > şimdi` ∧ `devredildi = false`; aralık kiradan. */
export function cloudEligibility(nowMs: number = Date.now()): CloudEligibility {
  let snap: LicenseSnapshot;
  try {
    snap = getLicenseSnapshot(nowMs);
  } catch {
    return { ok: false, reason: "HAZIR_DEGIL" };
  }
  if (!snap.hazir) return { ok: false, reason: "HAZIR_DEGIL" };
  const hak = snap.entitlement?.document;
  if (!hak) return { ok: false, reason: "HAK_YOK" };
  const kira = snap.lease?.document;
  if (!kira) return { ok: false, reason: "KIRA_YOK" };
  if (hak.sinif !== "URETIM") return { ok: false, reason: "SINIF_GONDEREMEZ" };
  if (!hak.moduller.includes(PATRON_CLOUD_MODULE)) return { ok: false, reason: "MODUL_YOK" };
  const bitis = kira.patronBulutBitis === null ? Number.NaN : Date.parse(kira.patronBulutBitis);
  if (!(bitis > nowMs)) return { ok: false, reason: "ABONELIK_BITTI" };
  if (kira.devredildi || snap.state.devredildi) return { ok: false, reason: "DEVREDILDI" };
  if (kira.esitlemeAraligiDk === null) return { ok: false, reason: "ARALIK_YOK" };
  return { ok: true, intervalMinutes: kira.esitlemeAraligiDk, snap };
}

/**
 * Gelen kutusu YAZMADIR: işleyici HTTP kapısından geçmez, `licenseGate`in yazma yüklemini (aynı yol listesi) doğrudan
 * sorar. Uygulanan kademede sipariş VE cari yaratma açık değilse kayıtlar bulutta BEKLIYOR kalır (`al` çağrılmaz).
 */
export function inboxWritesAllowed(snap: LicenseSnapshot): boolean {
  const tier = snap.state.uygulananKademe;
  return isOpenInTier(tier, "POST", "/api/orders") && isOpenInTier(tier, "POST", "/api/customers");
}
