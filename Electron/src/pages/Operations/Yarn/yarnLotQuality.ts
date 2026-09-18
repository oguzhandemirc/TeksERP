// =============================================================================
// İPLİK LOTU KALİTE BEKLETME — saf katman (2026-09-18, 1e dilimi)
// =============================================================================
// Lot üç kalite durumundan birindedir: RELEASED (Serbest) · ON_HOLD (Bekletmede) · BLOCKED (Bloke). Rozet, eylem etiketi,
// geçiş listesi ve süzgeç seçenekleri TEK yerde; bileşenler yalnız çizer. Eski backend alanı göndermez → Serbest sayılır
// (bugünkü davranış: her lot kullanılabilir). Onay diyaloğu YALNIZ Bloke'de (simple is more: öteki ikisi tek tık).
// =============================================================================
export type YarnLotQualityStatus = "RELEASED" | "ON_HOLD" | "BLOCKED";

export const YARN_LOT_QUALITY_STATUSES: readonly YarnLotQualityStatus[] = ["RELEASED", "ON_HOLD", "BLOCKED"];

export const YARN_LOT_QUALITY: Record<YarnLotQualityStatus, { label: string; cls: string }> = {
  RELEASED: { label: "Serbest", cls: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  ON_HOLD: { label: "Bekletmede", cls: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  BLOCKED: { label: "Bloke", cls: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200" },
};

/** Satır eylemi etiketi — hedef duruma göre. */
export const YARN_LOT_QUALITY_ACTION: Record<YarnLotQualityStatus, string> = {
  RELEASED: "Serbest bırak",
  ON_HOLD: "Bekletmeye al",
  BLOCKED: "Bloke et",
};

/** Eski backend `qualityStatus` göndermez → Serbest (bugünkü davranış). */
export function lotQualityOf(row: { qualityStatus?: YarnLotQualityStatus | null }): YarnLotQualityStatus {
  return row.qualityStatus ?? "RELEASED";
}

/** Sunulan geçişler: mevcut durum dışındaki ikisi (sıra sabit). */
export function qualityTargets(current: YarnLotQualityStatus): YarnLotQualityStatus[] {
  return YARN_LOT_QUALITY_STATUSES.filter((s) => s !== current);
}

/** Onay diyaloğu yalnız Bloke'de — malı kullanımdan düşürür; öteki ikisi geri alınabilir tek tık. */
export const qualityNeedsConfirm = (target: YarnLotQualityStatus): boolean => target === "BLOCKED";

/** Süzgeç "Kalite: Değer" — değer düz CSV query (`qualityStatus=RELEASED,ON_HOLD`); "ALL" = Tümü (Radix Select boş değer almaz). */
export const YARN_LOT_QUALITY_FILTER_ALL = "ALL";
export const YARN_LOT_QUALITY_FILTER_OPTIONS: readonly { value: string; label: string }[] = [
  { value: YARN_LOT_QUALITY_FILTER_ALL, label: "Tümü" },
  { value: "RELEASED", label: "Serbest" },
  { value: "ON_HOLD", label: "Bekletmede" },
  { value: "BLOCKED", label: "Bloke" },
  { value: "RELEASED,ON_HOLD", label: "Serbest + Bekletmede" },
];

/** Süzgeç değeri → query parametresi (Tümü → gönderilmez). */
export const qualityFilterParam = (value: string): string | undefined => (value === YARN_LOT_QUALITY_FILTER_ALL || !value ? undefined : value);
