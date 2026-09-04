import apiClient from "@/services/apiClient";
import type { ApiResponse, PaginatedResponse, QueryParams } from "@/types/api";

// =============================================================================
// ÇUVAL İZİ (ETİKET) KATALOĞU — SERVİS (2026-09-04)
// =============================================================================
// `createCrudService` KULLANILMADI (`ReasonPresets/service.ts` ile aynı gerekçe):
// uç sayfalama döndürmüyor (liste onlarca satır, binlerce değil) ve "silme"
// burada istisnadır — katalogdan çıkarmanın doğru yolu `isActive:false`.
//
// ⚠️ YENİ İZİN KODU YOK: okuma `shipping:read`, yazma `shipping:write`
// (backend route'larının birebir aynası). Sahada atanması unutulacak bir kod
// daha üretmek yerine sevkiyat yetkisine bağlandı.
// =============================================================================

export interface SackTag {
  id: string;
  /** Rapor/entegrasyon anahtarı — addan türer ve SONRADAN DEĞİŞMEZ. */
  code: string;
  name: string;
  /** `#RRGGBB` (büyük harf) — rozet rengi. */
  hex: string;
  sortOrder: number;
  /** false → katalogdan çıkarılmış: rozet soluk, YENİ atamaya kapalı. */
  isActive: boolean;
}

/**
 * HAZIR RENK PALETİ — bir **UI SABİTİ**, katalog DEĞİL.
 *
 * ⚠️ Şemaya renk kataloğu BAĞLANMADI ve bağlanmayacak: `Color` tablosu
 * BOYAHANE kataloğudur; rafa yapıştırılan bir işaret oraya satır ekleseydi
 * mükerrer tespiti bir boyayla bir post-it'i birleştirmeyi önerirdi (plan §B).
 * Bu yüzden `SackTag.hex` kendi kolonu ve seçenekler burada, istemcide yaşar.
 *
 * macOS Finder etiket paleti emsali: az sayıda, birbirinden AYIRT EDİLEBİLİR
 * ton. Serbest hex girişi de var (aşağıdaki alan) — bu liste kısayoldur, kısıt
 * değil.
 */
export const TAG_PRESET_HEXES: { hex: string; label: string }[] = [
  { hex: "#DC2626", label: "Kırmızı" },
  { hex: "#EA580C", label: "Turuncu" },
  { hex: "#CA8A04", label: "Sarı" },
  { hex: "#16A34A", label: "Yeşil" },
  { hex: "#0891B2", label: "Turkuaz" },
  { hex: "#2563EB", label: "Mavi" },
  { hex: "#7C3AED", label: "Mor" },
  { hex: "#DB2777", label: "Pembe" },
  { hex: "#78716C", label: "Gri" },
  { hex: "#1F2937", label: "Siyah" },
];

/** `#RRGGBB` — backend `HEX_RE` ile birebir (aynı reddi istemcide de ver). */
export const TAG_HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Rozet zemini koyu mu — üstüne beyaz mı siyah yazı gideceğini söyler.
 * Basit luminance eşiği; renk seçici serbest hex kabul ettiği için gerekli
 * (sabit beyaz yazı sarı zeminde okunmaz).
 */
export function isDarkHex(hex: string): boolean {
  if (!TAG_HEX_RE.test(hex)) return true;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // ITU-R BT.601 luma — göz yeşile daha duyarlı.
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.6;
}

const BASE = "/api/shipping/sacks/tags";

export const sackTagService = {
  /** Katalog. `includeInactive` YALNIZ düzenleme yüzeyi içindir. */
  list: (includeInactive = false): Promise<SackTag[]> =>
    apiClient
      .get<ApiResponse<SackTag[]>>(`${BASE}${includeInactive ? "?includeInactive=true" : ""}`)
      .then((r) => r.data.data),

  create: (body: { name: string; hex: string }): Promise<SackTag> =>
    apiClient.post<ApiResponse<SackTag>>(BASE, body).then((r) => r.data.data),

  /** ⚠️ `code` GÖNDERİLMEZ — sunucu da kabul etmez (rapor anahtarı sabittir). */
  update: (
    id: string,
    body: { name?: string; hex?: string; sortOrder?: number; isActive?: boolean },
  ): Promise<SackTag> =>
    apiClient.patch<ApiResponse<SackTag>>(`${BASE}/${id}`, body).then((r) => r.data.data),

  /**
   * SERT SİLME — yalnız HİÇ KULLANILMAMIŞ etiket için. Kullanımdaki etiket
   * sunucudan 409 + Türkçe mesajla döner ("… çuvalda kullanılmış"); ekran o
   * mesajı AYNEN gösterir ve "Pasif yap"a yönlendirir.
   */
  remove: (id: string): Promise<void> =>
    apiClient.delete<ApiResponse<unknown>>(`${BASE}/${id}`).then(() => undefined),

  /**
   * FilterBar `multi-lookup` ADAPTÖRÜ — o bileşen `CrudService.getAll`
   * sözleşmesi (sayfalı yanıt) bekler, bu uç ise düz dizi döner.
   *
   * ⚠️ ARAMA İSTEMCİDE süzülür ve bu, "istemci süzmesi yanlış 'sonuç yok'
   * üretir" dersinin İSTİSNASIDIR: uç KESMİYOR (tavan yok, katalog tamamı tek
   * yanıtta geliyor) — kesilmiş bir listeyi süzmek yalan üretir, TAM listeyi
   * süzmek üretmez. Katalog büyürse çözüm sunucu araması, istemci tavanı değil.
   *
   * ⚠️ `isActive` süzgeci: FilterBar her lookup'a `filters.isActive="true"`
   * gönderir; burada `includeInactive` KAPALI çağrılarak aynı anlam sunucuda
   * karşılanır — pasif etiket YENİ süzgeç seçeneği olarak çizilmez.
   */
  getAll: async (params: QueryParams): Promise<PaginatedResponse<SackTag>> => {
    const rows = await sackTagService.list(false);
    const term = params.search?.trim().toLocaleLowerCase("tr") ?? "";
    const data = term
      ? rows.filter((r) => r.name.toLocaleLowerCase("tr").includes(term))
      : rows;
    return {
      success: true,
      data,
      // Tek sayfa: `useTruncationWarning` "liste kesildi" uyarısı basmasın diye
      // total = uzunluk (gerçekten kesilmiyor).
      pagination: { page: 1, pageSize: data.length || 1, total: data.length, totalPages: 1 },
    };
  },
};
