import { useState } from "react";
import { useLocation } from "react-router-dom";
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

// D4-I3: "Kilit" süzgeci — Kilitli → `filter[held]=true` (SUNUCUDA; liste + toplam aynı where). Tümü süzgeç göndermez.
export type CariHoldFilter = "all" | "held";
export const CARI_HOLD_FILTER_OPTIONS: readonly { value: CariHoldFilter; label: string }[] = [
  { value: "all", label: "Tümü" },
  { value: "held", label: "Kilitli" },
];
export function holdFilters(v: CariHoldFilter): Record<string, string> {
  return v === "held" ? { held: "true" } : {};
}
/** Menüdeki "Kilitli cariler" derin bağlantısı `?kilit=1` ile gelir. */
export function holdFilterFromSearch(search: string): CariHoldFilter {
  return new URLSearchParams(search).get("kilit") === "1" ? "held" : "all";
}
export const CARI_EMPTY_HELD_HINT = "Kilitli cari yok. Kilit, cari kartının Kilit sekmesinden ya da bu listedeki Kilit düğmesinden konur.";
/** Cari Hesaplar "Kilit" süzgeci durumu — ilk değer derin bağlantıdan (`?kilit=1`). */
export function useHoldFilter() {
  const { search } = useLocation();
  return useState<CariHoldFilter>(() => holdFilterFromSearch(search));
}
