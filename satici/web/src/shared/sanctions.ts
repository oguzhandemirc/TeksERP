// Yaptırım sınıflaması — sunucunun (satici/sunucu src/services/sanction.service.ts) aynası. AĞIR
// eylem: K4 · K5 · kısıtlama anı şimdiden 7 günden yakın K3 (yönetici kararı f). Ağır eylemi yalnız
// yönetici uygular/planlar/geri alır ve kurulumun lisans numarasını AYNEN yazar (`onay`). K4/K5 ağır
// uçtan (/agir-yaptirim), K3 kendi ucundan onayla gider. Arayüz yalnız GİZLER; kararı sunucu verir.
export const HEAVY_K3_MIN_DAYS = 7;
const DAY_MS = 86_400_000;
/** Taksit planında kısıtlama günü verilmezse sunucunun varsayılanı. */
export const INSTALLMENT_DEFAULT_RESTRICTION_DAYS = 15;

export type SanctionLevel = "K0" | "K1" | "K2" | "K3" | "K4" | "K5";

export interface SanctionInput {
  readonly level: SanctionLevel;
  /** K3: geri sayım günü (0 = hemen) ya da açık tarih (ISO). */
  readonly restrictionDays?: number;
  readonly restrictionDate?: string;
}

/** K4/K5 ayrı uçtan gider; kısa K3 hafif uçtan ikinci onayla. */
export const HEAVY_ENDPOINT_LEVELS: readonly SanctionLevel[] = ["K4", "K5"];

export function isHeavySanctionInput(g: SanctionInput, nowMs: number): boolean {
  if (g.level === "K4" || g.level === "K5") return true;
  if (g.level !== "K3") return false;
  const at = g.restrictionDate !== undefined ? Date.parse(g.restrictionDate) : g.restrictionDays !== undefined ? nowMs + g.restrictionDays * DAY_MS : Number.NaN;
  return Number.isFinite(at) && at < nowMs + HEAVY_K3_MIN_DAYS * DAY_MS;
}

/** Defter satırı: K3'ün ağırlığı yazım anında parametreye (`agir`) donar — sonradan yeniden hesaplanmaz. */
export function isHeavySanctionRow(row: { tur: string; parametre: unknown }): boolean {
  if (row.tur === "K4" || row.tur === "K5") return true;
  return row.tur === "K3" && (row.parametre as { agir?: unknown } | null)?.agir === true;
}

/** Vadesinde K3 uygulayacak planlı eylem / taksit gecikmesi: geri sayım günü 7'den kısaysa ağır. */
export function isHeavyPlannedK3(level: string, restrictionDays: number | undefined): boolean {
  return level === "K3" && restrictionDays !== undefined && Number.isInteger(restrictionDays) && restrictionDays < HEAVY_K3_MIN_DAYS;
}
