import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";

// =============================================================================
// KURULUM PROFİLLERİ — SALT OKUMA
// =============================================================================
// Profil KATALOĞU backend'de yaşar (`Teks-Erp/src/constants/module-profiles.ts`)
// ve FARK DA SUNUCUDA hesaplanır. Panel profil tablosunun ikinci bir kopyasını
// TAŞIMAZ: taşısaydı iki tablo bir gün ayrışır ve ekran "bu kurulum standart"
// derken sunucu başka bir şey düşünürdü.
//
// ⚠️ YAZMA UCU YOK ve olmamalı. Profil uygulamak = `diffs[profil]` listesini
// tek bir `PATCH /api/feature-flags` gövdesine çevirip göndermek. Ayrı bir
// `POST /apply` yazılsaydı süperadmin dalı + bağımlılık doğrulaması + ayar
// şifresi zinciri İKİNCİ kez kurulurdu (kapı çoğaltmak).
//
// ⚠️ FARK DB ANAHTARLARIYLA gelir (`production.enabled`), PATCH ise camelCase
// alanlarla yazar (`productionEnabled`). Dönüşüm `lib/module-flags.ts`teki
// `MODULE_FIELD_BY_SETTING_KEY` haritasıyla yapılır — elle string oyunu
// `depo.multiEnabled` için yanlış sonuç verir.
// =============================================================================

export interface ModuleProfileSummary {
  id: string;
  ad: string;
  aciklama: string;
  /** DB anahtarı → hedef değer. */
  moduller: Record<string, boolean>;
}

export interface ModuleProfileDiffRow {
  /** DB anahtarı (`production.enabled`). */
  key: string;
  from: boolean;
  to: boolean;
}

export interface ModuleProfileState {
  profiles: ModuleProfileSummary[];
  current: {
    /** DB anahtarı → HAM değer (satır yoksa `null`). */
    values: Record<string, unknown>;
    /** Kurulum anında uygulanan profil damgası — MEVCUT durumu söylemez. */
    appliedProfile: string | null;
    /** TAM eşleşen profil kimliği, yoksa `"ozel"`. */
    closest: string;
  };
  /** Profil kimliği → o profile geçmek için gereken değişiklikler. */
  diffs: Record<string, ModuleProfileDiffRow[]>;
}

export const moduleProfileService = {
  get: (): Promise<ApiResponse<ModuleProfileState>> =>
    apiClient
      .get<ApiResponse<ModuleProfileState>>("/api/admin/module-profile")
      .then((r) => r.data),
};
