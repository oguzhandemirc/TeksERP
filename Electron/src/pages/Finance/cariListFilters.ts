// Cari Hesaplar listesi — "Durum" süzgeci (Z-B ④, 2026-09-18): VARSAYILAN Hareketli (yalnız hareketi olan hesaplar,
// `filter[hasActivity]=true`); Tümü süzgeç GÖNDERMEZ (bugünkü davranış). Hesap kartla doğar (Z-A) — listede "Yeni hesap" yolu YOK.
export type CariActivityFilter = "active" | "all";
export const CARI_ACTIVITY_DEFAULT: CariActivityFilter = "active";
export const CARI_ACTIVITY_OPTIONS: readonly { value: CariActivityFilter; label: string }[] = [
  { value: "active", label: "Hareketli" },
  { value: "all", label: "Tümü" },
];
/** İstek süzgeci: Hareketli → `hasActivity: "true"`; Tümü → anahtar yok. */
export function activityFilters(v: CariActivityFilter): Record<string, string> {
  return v === "active" ? { hasActivity: "true" } : {};
}
export const CARI_EMPTY_ACTIVE_HINT = "Hareketi olan cari hesap yok. Tümü'nü seçerek hareketsiz hesapları da görün. Yeni hesap Cariler'den kart açılınca kendiliğinden doğar.";
export const CARI_EMPTY_ALL_HINT = "Cari hesap yok. Hesap, Cariler'de kart açılınca kendiliğinden doğar; terimler kart formunun Finans bölümünden yazılır.";
