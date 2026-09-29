// Patron bulutu ÖN KOŞULU (§1.4) — TEK kaynak: eşitleme, rapor isteği ve gelen kutusu aynı fonksiyonu çağırır.
// FAIL-CLOSED: belirsizlik GÖNDERMEZ ve ÇEKMEZ — modül tavanının fail-open'ının bilinçli tersi (yeni dış kanal).
// Lisans kademesi (KISITLI · DURDURULMUS) eşitlemeyi DURDURMAZ (§1.6); gelen kutusu yazmadır, `inboxWritesAllowed` sorar.
import { getLicenseInstallationId, getLicenseSnapshot, type LicenseSnapshot } from "../lib/license/runtime";
import { isoToMs } from "../lib/license/protocol";
import { isOpenInTier } from "../constants/license-routes";
import { getCloudUrl } from "./cloud-url";

/** HAK'taki satın alınabilir hak anahtarı (`MODULE_SETTING_KEYS` dışı; protokol listeyi bilmez). */
export const PATRON_CLOUD_ENTITLEMENT = "patron-bulut";

export const CLOUD_BLOCK_REASONS = [
  "HAZIR_DEGIL",
  "HAK_YOK",
  "KIRA_YOK",
  "LISANS_GECERSIZ",
  "LISANS_OLCULEMEDI",
  "SINIF_URETIM_DEGIL",
  "PATRON_BULUT_HAKKI_YOK",
  "ABONELIK_YOK",
  "DEVREDILDI",
  "ARALIK_YOK",
  "BULUT_ADRESI_YOK",
] as const;
export type CloudBlockReason = (typeof CLOUD_BLOCK_REASONS)[number];

export type CloudEligibility =
  | {
      readonly ok: true;
      /** Lisans kimliği — imzalı isteklerle AYNI okuyucudan (`getLicenseInstallationId`). */
      readonly installationId: string;
      readonly baseUrl: string;
      readonly intervalMinutes: number;
      readonly subscriptionEndsAtMs: number;
      readonly snap: LicenseSnapshot;
    }
  | { readonly ok: false; readonly reason: CloudBlockReason };

/** SAF — girdi lisans anlık görüntüsü + zaman + bulut adresi + lisans kimliği, çıktı karar. */
export function evaluateCloudEligibility(
  snap: LicenseSnapshot,
  nowMs: number,
  cloudUrl: string | null,
  installationId: string | null,
): CloudEligibility {
  if (!snap.hazir || !installationId) return { ok: false, reason: "HAZIR_DEGIL" };
  const hak = snap.entitlement?.document;
  if (!hak) return { ok: false, reason: "HAK_YOK" };
  const kira = snap.lease?.document;
  if (!kira) return { ok: false, reason: "KIRA_YOK" };
  // Belirsizlik de geçersizlik de göndermez: kopyalanmış bir LICENSE_DIR (parmak izi
  // uyuşmaz) aslının verisini buluta taşıyamaz.
  if (snap.state.gecerlilik === "OLCULEMEDI") return { ok: false, reason: "LISANS_OLCULEMEDI" };
  if (snap.state.gecerlilik !== "GECERLI" || hak.kurulumId !== installationId) return { ok: false, reason: "LISANS_GECERSIZ" };
  if (hak.sinif !== "URETIM") return { ok: false, reason: "SINIF_URETIM_DEGIL" };
  if (!hak.moduller.includes(PATRON_CLOUD_ENTITLEMENT)) return { ok: false, reason: "PATRON_BULUT_HAKKI_YOK" };
  if (kira.devredildi || snap.state.devredildi) return { ok: false, reason: "DEVREDILDI" };
  const ends = kira.patronBulutBitis === null ? null : isoToMs(kira.patronBulutBitis);
  if (ends === null || !(ends > nowMs)) return { ok: false, reason: "ABONELIK_YOK" };
  if (kira.esitlemeAraligiDk === null) return { ok: false, reason: "ARALIK_YOK" };
  if (!cloudUrl) return { ok: false, reason: "BULUT_ADRESI_YOK" };
  return { ok: true, installationId, baseUrl: cloudUrl, intervalMinutes: kira.esitlemeAraligiDk, subscriptionEndsAtMs: ends, snap };
}

/** Canlı girdilerle ön koşul — anlık görüntü okunamazsa HAZIR_DEGIL (fail-closed). */
export function cloudEligibility(nowMs: number = Date.now()): CloudEligibility {
  let snap: LicenseSnapshot;
  try {
    snap = getLicenseSnapshot(nowMs);
  } catch {
    return { ok: false, reason: "HAZIR_DEGIL" };
  }
  return evaluateCloudEligibility(snap, nowMs, getCloudUrl().url, getLicenseInstallationId());
}

/**
 * Gelen kutusu YAZMADIR: işleyici HTTP kapısından geçmez, `licenseGate`in yazma yüklemini (aynı yol listesi) doğrudan
 * sorar. Uygulanan kademede sipariş VE cari yaratma açık değilse kayıtlar bulutta BEKLIYOR kalır (`al` çağrılmaz).
 */
export function inboxWritesAllowed(snap: LicenseSnapshot): boolean {
  const tier = snap.state.uygulananKademe;
  return isOpenInTier(tier, "POST", "/api/orders") && isOpenInTier(tier, "POST", "/api/customers");
}
