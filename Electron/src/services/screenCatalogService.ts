import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";

// =============================================================================
// Ekran manifestosu — hangi ekran hangi yetkiyi ister
// =============================================================================
// Backend TEK KAYNAK (`Teks-Erp/src/constants/screen-catalog.ts`); burada AYNA
// TUTULMAZ, uçtan çekilir. Karar belgesi: docs/design/YETKI-MIMARISI.md
// =============================================================================

export interface ScreenCapability {
  code: string;
  /** Operatörün anlayacağı dille NE yapabildiği. */
  label: string;
}

export interface ScreenEntry {
  key: string;
  app: "mobile" | "desktop";
  title: string;
  /** Ekranı AÇMAK için gereken izinler — HERHANGİ BİRİ yeterli. */
  requires: string[];
  capabilities: ScreenCapability[];
  /**
   * Bu ekranın ait olduğu MODÜL ya da çekirdek blok (2026-09-03 / P6).
   *
   * Üç biçim: modül anahtarı (`productionEnabled`), çekirdek blok
   * (`cekirdek:ana-veri`) ya da anahtarı henüz olmayan planlanan modül
   * (`planlanan:kartela`). Sistem Profili ekranının "bu modülü kapatırsan şu
   * ekranlar gizlenir" önizlemesi bu alandan üretilir.
   *
   * ⚠️ OPSİYONEL YAZILDI ve bu bilinçli: alanı taşımayan ESKİ bir backend'e
   * bağlanan panel, listeyi okuyamamış gibi değil, alanı boş görmüş gibi
   * davranmalı. Önizleme tarafı zaten fail-closed ("liste okunamadı") — boş
   * liste "hiçbir şey gizlenmeyecek" YALANINI basmaz.
   */
  modul?: string;
}

export interface ScreenCatalog {
  screens: ScreenEntry[];
  /** Hiçbir ekranda kullanılmayan izinler — bugün boş, yeni izin bağlanmazsa dolar. */
  withoutScreen: string[];
}

export const screenCatalogService = {
  list: (): Promise<ApiResponse<ScreenCatalog>> =>
    apiClient.get<ApiResponse<ScreenCatalog>>("/api/admin/screens").then((r) => r.data),
};
