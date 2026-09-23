import apiClient from "@/services/apiClient";
import { createSettingsPasswordScope, withSettingsPassword, type SettingsPasswordScope } from "@/lib/settings-password";
import type {
  NumberSeriesRow,
  NumberSourceMode,
  SeriesCounterInput,
  SeriesExhaustion,
  SeriesFormatInput,
} from "./types";

/**
 * ⚠️ ÖNİZLEME VE ETKİ SAYISI SUNUCUDAN — panel kendi biçimlendiricisini YAZMAZ.
 * Bütün bu işin sebebi iki yerde iki biçimlendirici olmasıydı ("programda P-2,
 * çıktıda P20260202"). Ekran örnek kodu da, etki cümlesindeki sayıyı da ister.
 *
 * ⚠️ ÜÇ YAZMA UCU AYAR ŞİFRESİ KAPILI (`requireSettingsPassword`) → `withSettingsPassword`tan geçer:
 * `apiClient` o 403'ün toast'ını bastırır; sarmalayıcı yoksa ne diyalog açılır ne hata görünür.
 * Yük sarmalayıcının DIŞINDA bir kez kurulur — şifreyle tekrar AYNI yükü gönderir.
 */
export const numberingService = {
  async list(): Promise<NumberSeriesRow[]> {
    const r = await apiClient.get<{ data: NumberSeriesRow[] }>("/api/number-series");
    return r.data?.data ?? [];
  },

  /**
   * ⚠️ `suppressErrorToast`: önizleme KULLANICI YAZARKEN koşar ve hatası ALANIN
   * YANINDA gösterilir. Global toast burada iki kez zarar veriyordu (d3 ölçtü
   * 2026-09-23, gerçek panel): her tuş vuruşunda kırmızı bir toast yağıyor ve
   * diyaloğun kendi iptal bayrağıyla bastırdığı BAYAT yanıt bile ekrana
   * düşüyordu. Hatayı gösteren yüzey diyalogdur.
   */
  async preview(key: string, fmt: SeriesFormatInput): Promise<string> {
    const r = await apiClient.post<{ data: { preview: string } }>(
      "/api/number-series/preview",
      { key, ...fmt },
      { suppressErrorToast: true },
    );
    return r.data?.data?.preview ?? "";
  },

  /** `null` = bu seride sayım kaynağı yok ⇒ ekran SAYI YAZMAZ ("0" demez). */
  async impact(key: string): Promise<number | null> {
    const r = await apiClient.get<{ data: { count: number | null } }>(
      `/api/number-series/${encodeURIComponent(key)}/impact`,
    );
    return r.data?.data?.count ?? null;
  },

  /** `effectiveFrom` boş = HEMEN (bugünkü davranış); dolu = ileri tarihli geçiş. */
  async update(key: string, fmt: SeriesFormatInput, effectiveFrom?: string, scope?: SettingsPasswordScope): Promise<void> {
    const body = {
      ...fmt,
      ...(effectiveFrom ? { effectiveFrom: new Date(`${effectiveFrom}T00:00:00`).toISOString() } : {}),
    };
    await withSettingsPassword((headers) => apiClient.patch(`/api/number-series/${encodeURIComponent(key)}`, body, { headers }), scope);
  },

  /**
   * Sayaç ayarları AYRI uç: biçim ile sayaç farklı kilitlere tabi. Biçimi
   * yapısal olarak kilitli bir serinin (iş emri no) sayacı ayarlanabilir.
   */
  /** Tükenme durumu — sınır yoksa `percent: null` (ölçülemedi), ekran yüzde YAZMAZ. */
  async exhaustion(key: string): Promise<SeriesExhaustion | null> {
    const r = await apiClient.get<{ data: SeriesExhaustion }>(
      `/api/number-series/${encodeURIComponent(key)}/exhaustion`,
    );
    return r.data?.data ?? null;
  },

  /** Numara kaynağı AYRI uç: biçim/sayaç/kaynak üçü farklı kilitlere tabi. */
  async updateSource(key: string, numberSource: NumberSourceMode, scope?: SettingsPasswordScope): Promise<void> {
    await withSettingsPassword((headers) =>
      apiClient.patch(`/api/number-series/${encodeURIComponent(key)}/source`, { numberSource }, { headers }),
    scope);
  },

  async updateCounter(key: string, ayar: SeriesCounterInput, scope?: SettingsPasswordScope): Promise<void> {
    await withSettingsPassword((headers) =>
      apiClient.patch(`/api/number-series/${encodeURIComponent(key)}/counter`, ayar, { headers }),
    scope);
  },

  /**
   * ÜÇ UÇ, ÜÇ KİLİT: yalnız AÇIK olan ve GERÇEKTEN değişen bölüm gönderilir (kapalıyı göndermek dokunulmamış
   * alan yüzünden 400, değişmeyeni göndermek gereksiz denetim satırı). Tek "Kaydet" = TEK şifre sorusu:
   * üç istek aynı eylem kapsamını paylaşır, kapsam dönüşte atılır.
   */
  async saveChanges(
    row: NumberSeriesRow,
    value: { fmt: SeriesFormatInput; counter: SeriesCounterInput; source: NumberSourceMode; effectiveFrom: string },
    changed: { formatChanged: boolean; counterChanged: boolean; sourceChanged: boolean },
  ): Promise<void> {
    const scope = createSettingsPasswordScope();
    if (row.editable && changed.formatChanged) await numberingService.update(row.key, value.fmt, value.effectiveFrom, scope);
    if (row.counter.startValue && changed.counterChanged) await numberingService.updateCounter(row.key, value.counter, scope);
    if (row.source.editable && changed.sourceChanged) await numberingService.updateSource(row.key, value.source, scope);
  },
};
