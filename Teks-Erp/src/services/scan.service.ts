// =============================================================================
// OKUTMA SINIFLANDIRMASI — barkodun türü SUNUCUDAN sorulur (2026-09-22, Faz B)
// =============================================================================
// Sorun (ölçüldü): ön ek bugün istemcilerde REGEX olarak sabit (panel
// `barcode-kind.ts` 12 regex · mobil üç ekran). Ön ek bir gün değişirse eski
// tablet 400/404 vermez, SESSİZCE yanlış dala düşer — çuval kodunu top sanıp
// "Top bulunamadı" der. Bu servis, biçimin tek sahibini (`number-series.service`)
// istemcilere açar: tablo okunur, kod çözülür, istemci biçim BİLMEZ.
//
// Yük iş verisi DEĞİL, BİÇİM META VERİSİDİR: `resolve` DB'ye hiç inmez ve
// kaydın varlığını bile söylemez, yalnız stringi sınıflandırır.
// =============================================================================
import {
  classifyScannedCode,
  seriesClassifierTable,
  type SeriesClassifierRow,
} from "./number-series.service";
import type { ApiResponse } from "../types/api.types";

export interface ScanResolveDto {
  /** Normalize edilmiş hâli (trim + büyük harf) — istemci aynısını kullanır. */
  code: string;
  /** Çözülemeyen kodun türü `UNKNOWN`'dur; istemci TAHMİN YÜRÜTMEZ. */
  kind: SeriesClassifierRow["kind"] | "UNKNOWN";
  key: string | null;
}

/** Sınıflandırma tablosu — istemci açılışta çeker ve önbelleğe alır. */
export function getSeriesClassifier(): ApiResponse<SeriesClassifierRow[]> {
  return { success: true, data: seriesClassifierTable() };
}

/** Tek kodun türü — istemci tabloyla çözemediğinde (ör. emekli ön ek) buraya sorar. */
export function resolveScannedCode(code: string): ApiResponse<ScanResolveDto> {
  const row = classifyScannedCode(code);
  return {
    success: true,
    data: {
      code: code.trim().toUpperCase(),
      kind: row?.kind ?? "UNKNOWN",
      key: row?.key ?? null,
    },
  };
}
