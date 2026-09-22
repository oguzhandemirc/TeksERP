import apiClient from "@/services/apiClient";
import type { NumberSeriesRow, SeriesCounterInput, SeriesFormatInput } from "./types";

/**
 * ⚠️ ÖNİZLEME VE ETKİ SAYISI SUNUCUDAN — panel kendi biçimlendiricisini YAZMAZ.
 * Bütün bu işin sebebi iki yerde iki biçimlendirici olmasıydı ("programda P-2,
 * çıktıda P20260202"). Ekran örnek kodu da, etki cümlesindeki sayıyı da ister.
 */
export const numberingService = {
  async list(): Promise<NumberSeriesRow[]> {
    const r = await apiClient.get<{ data: NumberSeriesRow[] }>("/api/number-series");
    return r.data?.data ?? [];
  },

  async preview(key: string, fmt: SeriesFormatInput): Promise<string> {
    const r = await apiClient.post<{ data: { preview: string } }>("/api/number-series/preview", {
      key,
      ...fmt,
    });
    return r.data?.data?.preview ?? "";
  },

  /** `null` = bu seride sayım kaynağı yok ⇒ ekran SAYI YAZMAZ ("0" demez). */
  async impact(key: string): Promise<number | null> {
    const r = await apiClient.get<{ data: { count: number | null } }>(
      `/api/number-series/${encodeURIComponent(key)}/impact`,
    );
    return r.data?.data?.count ?? null;
  },

  async update(key: string, fmt: SeriesFormatInput): Promise<void> {
    await apiClient.patch(`/api/number-series/${encodeURIComponent(key)}`, fmt);
  },

  /**
   * Sayaç ayarları AYRI uç: biçim ile sayaç farklı kilitlere tabi. Biçimi
   * yapısal olarak kilitli bir serinin (iş emri no) sayacı ayarlanabilir.
   */
  async updateCounter(key: string, ayar: SeriesCounterInput): Promise<void> {
    await apiClient.patch(`/api/number-series/${encodeURIComponent(key)}/counter`, ayar);
  },
};
