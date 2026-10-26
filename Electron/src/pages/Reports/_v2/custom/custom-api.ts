// =============================================================================
// Özel (kayıtlı) raporlar — `/api/rapor-tanimlari` ve `/api/rapor-semantik/katalog` istemcisi (R1-KAYIT)
// =============================================================================
// Tanım gövdesi SUNUCUDA doğrulanır (`dogrula` / `onizle`); istemci şemayı kopyalamaz, yalnız gövdeyi kurar.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";
import { REPORT_CATALOG } from "@/lib/report-catalog";
import type { AnalysisOutcome } from "../analysis/analysis-model";
import type { AnlatiCumlesi } from "../sunum";

export const REPORT_BUILDER_PERMISSION = "report:builder";
export const REPORT_PUBLISH_PERMISSION = "report:publish";
/** `/api/rapor-tanimlari` giriş kapısı: herhangi bir rapor izni (veri yetkisi blok düzeyinde). */
export const REPORT_ANY_PERMISSIONS: string[] = [...new Set([...REPORT_CATALOG.map((e) => e.izin), REPORT_BUILDER_PERMISSION, REPORT_PUBLISH_PERMISSION])];

const BASE = "/api/rapor-tanimlari";

export interface DefinitionSummary {
  id: string;
  tur: "SISTEM" | "OZEL";
  ad: string;
  aciklama: string | null;
  kategori: { id: string; ad: string; kod: string | null };
  sahip: { id: string; ad: string } | null;
  gorunurluk: "OZEL" | "PAYLASIMLI" | "HERKES";
  durum: "TASLAK" | "YAYINDA" | "ARSIV";
  aktifSurum: { id: string; no: number; tarih: string } | null;
  bozuk: boolean;
  duzenleyebilir: boolean;
  /** Sistem şablonu (R3-ANALIZ): görüntüleyicide çalışır, "Kopyasını özel rapor yap" ile OZEL olur. */
  sablon?: boolean;
  guncellendi: string;
}

export interface DefinitionDetail extends DefinitionSummary {
  govde: unknown;
}

export interface CatalogCube {
  kimlik: string;
  ad: string;
  olculer: Array<{ kimlik: string; ad: string; aciklama: string; birim: string; boyutlar: string[] | null }>;
  boyutlar: Array<{ kimlik: string; ad: string; tur: "zaman" | "kategori"; islecler: string[] }>;
}

export interface Category {
  id: string;
  ad: string;
  ustId: string | null;
  aktif: boolean;
}

export interface VersionRow {
  id: string;
  no: number;
  not: string | null;
  tarihMetni: string;
  yazan: string | null;
  aktif: boolean;
}

export interface ShareState {
  gorunurluk: DefinitionSummary["gorunurluk"];
  paylasimlar: Array<{ kullaniciId: string; ad: string; yetki: "GOR" | "DUZENLE" }>;
}

export interface SemanticResultLite {
  olculer: Array<{ kimlik: string; ad: string; birim: string }>;
  boyutlar: Array<{ kimlik: string; ad: string }>;
  satirlar: Array<{ anahtarlar: Record<string, { deger: string | null; etiket: string | null }>; donem?: string | null; degerler: Record<string, number | null> }>;
  toplam: { degerler: Record<string, number | null>; donemler?: Array<{ donem: string | null; degerler: Record<string, number | null> }> };
  kiyas: { toplam: { degerler: Record<string, number | null> } } | null;
  /** Dönem kıyası bölümü (R2-DUZEN): satırlar `donem` anahtarıyla gelir, sütunlar bu sırayla. */
  donemler?: { birim: string; adet: number; anahtarlar: Array<string | null> } | null;
  uyarilar: string[];
}

export type BlockOutcome =
  | { id: string; tur: string; baslik: string | null; durum: "tamam"; sonuclar: SemanticResultLite[]; metin?: string; analiz?: AnalysisOutcome; anlati?: AnlatiCumlesi[] }
  | { id: string; tur: string; baslik: string | null; durum: "yetkisiz" | "desteklenmiyor"; mesaj: string };

export interface RunResult {
  tanim: { id: string | null; ad: string; surumNo: number | null };
  baslik: string;
  itibariylaMetni: string;
  bloklar: BlockOutcome[];
}

export interface DefinitionIssue {
  yol: string;
  mesaj: string;
  oneri?: string;
}

const data = <T,>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data);

export const customReportApi = {
  list: (kapsam: "benim" | "paylasilan" | "sistem" | "tumu", ara?: string) =>
    data<{ items: DefinitionSummary[] }>(apiClient.get(BASE, { params: { kapsam, ...(ara ? { ara } : {}), limit: 100 } })),
  get: (id: string) => data<DefinitionDetail>(apiClient.get(`${BASE}/${id}`)),
  catalog: () => data<CatalogCube[]>(apiClient.get("/api/rapor-semantik/katalog")),
  categories: () => data<Category[]>(apiClient.get(`${BASE}/kategoriler`)),
  validate: (govde: unknown) => data<{ gecerli: boolean; hatalar: DefinitionIssue[] }>(apiClient.post(`${BASE}/dogrula`, { govde })),
  preview: (govde: unknown) => data<RunResult>(apiClient.post(`${BASE}/onizle`, { govde, parametreler: {} }, { suppressErrorToast: true })),
  create: (input: { ad: string; kategoriId?: string; govde: unknown; clientToken: string }) =>
    data<DefinitionSummary>(apiClient.post(BASE, { ...input, durum: "YAYINDA" })),
  saveVersion: (id: string, input: { govde: unknown; beklenenSurumId: string; clientToken: string }) =>
    data<{ id: string; no: number }>(apiClient.post(`${BASE}/${id}/surumler`, input)),
  updateMeta: (id: string, input: { ad?: string; kategoriId?: string }) => data<DefinitionSummary>(apiClient.patch(`${BASE}/${id}`, input)),
  run: (id: string, yenile: boolean) => data<RunResult>(apiClient.post(`${BASE}/${id}/calistir`, { parametreler: {}, yenile }, { suppressErrorToast: true })),
  versions: (id: string) => data<VersionRow[]>(apiClient.get(`${BASE}/${id}/surumler`)),
  shares: (id: string) => data<ShareState>(apiClient.get(`${BASE}/${id}/paylasim`)),
  replaceShares: (id: string, input: { gorunurluk: ShareState["gorunurluk"]; paylasimlar: Array<{ kullaniciId: string; yetki: "GOR" | "DUZENLE" }> }) =>
    data<ShareState>(apiClient.put(`${BASE}/${id}/paylasim`, input)),
  /** Süzgeç seçicisinin değerleri: boyuta göre kırılmış küçük sorgu (son dönemde verisi olan değerler); otomatik istek, zarf notu tostlanmaz. */
  dimensionValues: (kup: string, olcu: string, boyut: string) =>
    data<SemanticResultLite>(apiClient.post("/api/rapor-semantik/sorgu", { kup, olculer: [olcu], boyutlar: [boyut] }, { suppressErrorToast: true, serverWarnings: "silent" })).then((r) =>
      r.satirlar
        .map((row) => row.anahtarlar[boyut])
        .filter((c): c is { deger: string; etiket: string | null } => Boolean(c?.deger))
        .map((c) => ({ deger: c.deger, etiket: c.etiket ?? c.deger })),
    ),
  shareCandidates: () => data<Array<{ id: string; ad: string }>>(apiClient.get(`${BASE}/paylasim-adaylari`)),
};

export function useCustomReportList(kapsam: "benim" | "paylasilan" | "sistem" | "tumu", enabled: boolean) {
  return useQuery({ queryKey: ["custom-reports", kapsam], queryFn: () => customReportApi.list(kapsam), enabled, staleTime: 30_000 });
}

export function useSemanticCatalog(enabled = true) {
  return useQuery({ queryKey: ["semantic-catalog"], queryFn: customReportApi.catalog, enabled, staleTime: 5 * 60_000 });
}

export function useReportCategories(enabled = true) {
  return useQuery({ queryKey: ["report-categories"], queryFn: customReportApi.categories, enabled, staleTime: 5 * 60_000 });
}
