/**
 * ELLE NUMARA ALANININ EKRANDAKİ HÂLİ — sunucudaki `numberSource` ayarının
 * istemci karşılığı.
 *
 * ⚠️ TEK KAYNAK: mod SUNUCUDAN gelir (`GET /api/feature-flags` → `numberSources`)
 * ve panel kendi kuralını YAZMAZ. Karar burada tek bir saf fonksiyonda yaşar ki
 * iki form (sevk partisi adı · gelecekteki diğerleri) aynı davranışı göstersin.
 *
 * ⚠️ ÜÇ HÂL, iki değil: `hidden` (sunucu üretir, alan çizilmez) · `optional`
 * (bugünkü davranış: boş bırakılırsa sunucu üretir) · `required` (boş
 * bırakılamaz). "Gizli" ile "zorunlu değil" aynı şey değildir; ikisini
 * birleştiren bir bayrak, SYSTEM modunda kullanıcıya doldurulabilir ama
 * reddedilecek bir kutu gösterirdi.
 */
export type NumberSourceMode = "FREE" | "SYSTEM" | "MANUAL";

export interface NumberSourceInfo {
  key: string;
  label: string;
  mode: NumberSourceMode;
  scanned: boolean;
}

export type ManualFieldState = "hidden" | "optional" | "required";

export function manualFieldState(mode: NumberSourceMode | undefined): ManualFieldState {
  // ⚠️ Bilinmeyen/eksik mod `optional`a düşer: sunucu yükü eski bir sürümden
  // gelmiyorsa (ya da alan hiç yoksa) BUGÜNKÜ davranış sürer. Burada
  // fail-closed olmak, ayarı hiç açmamış bir fabrikada çalışan bir alanı
  // sebepsiz gizlerdi.
  if (mode === "SYSTEM") return "hidden";
  if (mode === "MANUAL") return "required";
  return "optional";
}

/** Sunucudan gelen listeden bir serinin modunu okur. */
export function numberSourceOf(
  liste: NumberSourceInfo[] | undefined,
  key: string,
): NumberSourceMode | undefined {
  return liste?.find((x) => x.key === key)?.mode;
}
