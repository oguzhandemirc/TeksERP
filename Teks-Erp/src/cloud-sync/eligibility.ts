// Eşitlemenin ÖN KOŞULU (§1.4) — FAIL-CLOSED: modül tavanının belirsizlikte fail-open
// davranışının bilinçli tersi. Eşitleme yeni bir dışarı veri kanalıdır; varsayılanı "gitmez".
// Lisans kademesi (KISITLI · DURDURULMUS) eşitlemeyi DURDURMAZ (§1.6) — veri erişimi açıktır.
import type { LicenseSnapshot } from "../lib/license/runtime";
import { isoToMs } from "../lib/license/protocol";

/** HAK'taki satın alınabilir hak anahtarı (`MODULE_SETTING_KEYS` dışı; protokol listeyi bilmez). */
export const PATRON_CLOUD_ENTITLEMENT = "patron-bulut";

export const SYNC_BLOCK_REASONS = [
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
export type SyncBlockReason = (typeof SYNC_BLOCK_REASONS)[number];

export type SyncEligibility =
  | {
      readonly ok: true;
      /** Lisans kimliği (HAK'ın kurulumu — D14: LICENSE_DIR kimliği; DB installationId yalnız etiket). */
      readonly installationId: string;
      readonly intervalMinutes: number;
      readonly subscriptionEndsAtMs: number;
    }
  | { readonly ok: false; readonly reason: SyncBlockReason };

/** SAF — girdi lisans anlık görüntüsü + zaman + bulut adresi, çıktı karar. */
export function evaluateSyncEligibility(snap: LicenseSnapshot, nowMs: number, cloudUrl: string | null): SyncEligibility {
  if (!snap.hazir) return { ok: false, reason: "HAZIR_DEGIL" };
  const hak = snap.entitlement?.document;
  if (!hak) return { ok: false, reason: "HAK_YOK" };
  const kira = snap.lease?.document;
  if (!kira) return { ok: false, reason: "KIRA_YOK" };
  // Belirsizlik de geçersizlik de göndermez: kopyalanmış bir LICENSE_DIR (parmak izi
  // uyuşmaz) aslının verisini buluta taşıyamaz.
  if (snap.state.gecerlilik === "OLCULEMEDI") return { ok: false, reason: "LISANS_OLCULEMEDI" };
  if (snap.state.gecerlilik !== "GECERLI") return { ok: false, reason: "LISANS_GECERSIZ" };
  if (hak.sinif !== "URETIM") return { ok: false, reason: "SINIF_URETIM_DEGIL" };
  if (!hak.moduller.includes(PATRON_CLOUD_ENTITLEMENT)) return { ok: false, reason: "PATRON_BULUT_HAKKI_YOK" };
  if (kira.devredildi || snap.state.devredildi) return { ok: false, reason: "DEVREDILDI" };
  const ends = kira.patronBulutBitis === null ? null : isoToMs(kira.patronBulutBitis);
  if (ends === null || !(ends > nowMs)) return { ok: false, reason: "ABONELIK_YOK" };
  if (kira.esitlemeAraligiDk === null) return { ok: false, reason: "ARALIK_YOK" };
  if (!cloudUrl) return { ok: false, reason: "BULUT_ADRESI_YOK" };
  return { ok: true, installationId: hak.kurulumId, intervalMinutes: kira.esitlemeAraligiDk, subscriptionEndsAtMs: ends };
}
