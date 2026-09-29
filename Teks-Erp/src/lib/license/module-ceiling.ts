// Lisans modül tavanı — enforcement okuyucusunun lisans ayağı (`readX = readXRaw ∧ tavan`).
// Senkron ve bellekten: tx içinde güvenli, DB'ye inmez. Motor hazır değilse ham değer geçer
// (lisans belirsizliği üretimi kapatmaz); gözlemde uygulanan tavan yoktur (sıfır fark).
import { AppError } from "../../utils/app-error";
import { currentOrigin } from "../request-context";
import { getLicenseSnapshot, recordModuleObservation, type LicenseSnapshot } from "./runtime";
import { ceilingAllows, type ModuleCeiling } from "./state";
import type { LicenseMode } from "./protocol";

export type ModuleClosedReason = "LISANSTA_YOK" | "DONDURULDU";

/** Panelin salt-okunur lisans bloğu (`GET /api/feature-flags` → `license`). */
export interface LicenseModuleBlock {
  readonly kip: LicenseMode;
  /** Uygulanan tavanın kapattığı modüller (DB anahtarı: `finance.enabled`); gözlemde daima boş. */
  readonly kapaliModuller: ReadonlyArray<{ readonly anahtar: string; readonly neden: ModuleClosedReason }>;
}

function readySnapshot(): LicenseSnapshot | null {
  try {
    const snap = getLicenseSnapshot();
    return snap.hazir ? snap : null;
  } catch {
    return null;
  }
}

function closedReason(cap: ModuleCeiling, settingKey: string): ModuleClosedReason | null {
  if (!cap.applies) return null;
  if (cap.denied.includes(settingKey)) return "DONDURULDU";
  return cap.allowed !== null && !cap.allowed.includes(settingKey) ? "LISANSTA_YOK" : null;
}

/**
 * Ham değeri uygulanan tavandan geçirir; gözlemde tavanın kapatacağı modül İSTEK × modül başına
 * bir kez sayılır (okuyucu bir istekte defalarca çağrılır — çağrı sayısı ölçü değildir).
 */
export function applyModuleCeiling(settingKey: string, rawEnabled: boolean): boolean {
  if (!rawEnabled) return false;
  const snap = readySnapshot();
  if (!snap) return true;
  const allowed = ceilingAllows(snap.state.uygulanan.modulTavani, settingKey);
  if (allowed && !ceilingAllows(snap.state.hesaplanan.modulTavani, settingKey)) {
    recordModuleObservation(settingKey, currentOrigin().requestId);
  }
  return allowed;
}

/** Lisans bu modülü kapatıyorsa 403 `LICENSE_MODULE` (adlı modül kapıları), değilse null. */
export function licenseModuleError(settingKey: string, label: string): AppError | null {
  const snap = readySnapshot();
  const reason = snap ? closedReason(snap.state.uygulanan.modulTavani, settingKey) : null;
  if (!reason) return null;
  const why = reason === "DONDURULDU" ? "lisans sunucusunca dondurulmuş" : "lisansınızda yok";
  return AppError.forbidden(`${label} modülü ${why}.`, { code: "LICENSE_MODULE", modul: settingKey, neden: reason });
}

/** Verilen modül anahtarları için panel bloğu — önbelleğe girmez, her okumada tazedir. */
export function licenseModuleBlock(settingKeys: Iterable<string>): LicenseModuleBlock {
  const snap = readySnapshot();
  if (!snap) return { kip: "gozlem", kapaliModuller: [] };
  const cap = snap.state.uygulanan.modulTavani;
  const closed: Array<{ anahtar: string; neden: ModuleClosedReason }> = [];
  for (const key of settingKeys) {
    const reason = closedReason(cap, key);
    if (reason) closed.push({ anahtar: key, neden: reason });
  }
  return { kip: snap.state.kip, kapaliModuller: closed };
}
