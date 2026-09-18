// =============================================================================
// ÜRETİM ZİNCİRİ (Z3) — tipler · uç · çıktı · süzgeç şerhleri (saf katman)
// =============================================================================
// Sunucu sözleşmesi `Teks-Erp/src/services/reports/production-chain.report.service.ts` (getProductionChain). Panel hiçbir
// sayıyı yeniden hesaplamaz; yalnız çizer ve dışa aktarır. Devere kapalıyken `levent` anahtarı HİÇ gelmez → kolon düşer.
// =============================================================================
import apiClient from "@/services/apiClient";
import type { ReportResponse } from "../_services/types";
import type { ReportExportSpec } from "../_components/reportExport";

export type ChainStatus = "BEKLEYEN" | "DEVAM" | "GECIKMIS" | "TAMAMLANAN";
export const CHAIN_STATUS_LABEL: Record<ChainStatus, string> = { BEKLEYEN: "Bekleyen", DEVAM: "Devam eden", GECIKMIS: "Gecikmiş", TAMAMLANAN: "Tamamlanan" };
/** "Durum: Tümü" seçicisi — değer sorgu parametresinin kendisi; "ALL" = anahtar istekte YOK. */
export const CHAIN_STATUS_ALL = "ALL";
export const CHAIN_STATUS_OPTIONS: readonly { value: string; label: string }[] = [
  { value: CHAIN_STATUS_ALL, label: "Tümü" },
  ...(Object.keys(CHAIN_STATUS_LABEL) as ChainStatus[]).map((k) => ({ value: k, label: CHAIN_STATUS_LABEL[k] })),
];

export interface ChainRow {
  orderLineId: string;
  siparis: { id: string; no: string; teslimTarihi: string | null };
  musteri: { id: string; ad: string };
  kumas: { id: string; ad: string };
  renk: { id: string; ad: string } | null;
  siparisM: number;
  sevkM: number;
  isEmri: { id: string; no: string; durum: string; adim: string | null } | null;
  dokuma: { id: string; no: string; durum: string; dokunanM: number; planM: number | null; ilerlemePct: number | null; planBitis: string | null } | null;
  levent?: { id: string; no: string; durum: string; kalanM: number } | null;
  gecikmeGun: number | null;
  durum: ChainStatus;
}

export interface ChainReport {
  satirlar: ChainRow[];
  satirOmitted: number;
  kovalar: { issizLevent?: number; siparissizDokuma: number; disaridanTop: number };
  ozet: { satir: number; gecikmis: number; bagsiz: number };
  moduller: { devere: boolean };
}

export const productionChainApi = {
  get: async (params: Record<string, string> = {}): Promise<ReportResponse<ChainReport>> => {
    const res = await apiClient.get<ReportResponse<ChainReport>>("/api/reports/dokuma/zincir", { params });
    return res.data;
  },
};

/** Sorgu parametreleri: eksen (müşteri CSV) + durum + gecikmiş — "Tümü"/kapalı anahtar istekte yok. */
export function chainParams(axisParams: Record<string, string>, durum: string, gecikmis: boolean): Record<string, string> {
  return { ...axisParams, ...(durum && durum !== CHAIN_STATUS_ALL ? { durum } : {}), ...(gecikmis ? { gecikmis: "true" } : {}) };
}

/** Eksen dışı süzgeçlerin şerh satırları — ekranda ve çıktıda aynı cümle. */
export function chainFilterNotes(durum: string, gecikmis: boolean): string[] {
  const out: string[] = [];
  if (durum && durum !== CHAIN_STATUS_ALL) out.push(`Durum: ${CHAIN_STATUS_LABEL[durum as ChainStatus] ?? durum}`);
  if (gecikmis) out.push("Yalnız gecikmiş satırlar");
  return out;
}

/** Bağsız kovalar — adıyla, listeye gidecek yolla; devere kapalıysa levent kovası hiç yok. */
export function bucketRows(c: ChainReport): Array<{ key: string; ad: string; sayi: number; yol: string }> {
  return [
    ...(c.kovalar.issizLevent === undefined ? [] : [{ key: "issizLevent", ad: "İşsiz levent", sayi: c.kovalar.issizLevent, yol: "/operations/warp-beams" }]),
    { key: "siparissizDokuma", ad: "Siparişsiz dokuma", sayi: c.kovalar.siparissizDokuma, yol: "/operations/weaving-orders" },
    { key: "disaridanTop", ad: "Dışarıdan gelen top", sayi: c.kovalar.disaridanTop, yol: "/operations/rolls" },
  ];
}

export function buildChainExport(c: ChainReport, filterNotes: string[] = []): ReportExportSpec {
  return {
    title: "Üretim Zinciri",
    subtitle: "Anlık durum",
    orientation: "landscape",
    meta: [
      ...filterNotes,
      "Satır = açık sipariş satırı → iş emri → dokuma işi" + (c.moduller.devere ? " → levent" : "") + ". Sayılar kendi defterlerinden: karşılanan sevkten, dokunan koşum metresinden, levent kalanı levent defterinden.",
      "Dokuma ilerlemesi Σ dokunan ÷ planlanan; plan yoksa boş kalır (yüzde uydurulmaz). %100 işi kapatmaz.",
      "Gecikme: dokuma işinin plan bitişi (yoksa siparişin teslim tarihi) bugünden önceyse gün sayısı.",
      c.satirOmitted > 0 ? `⚠️ ${c.satirOmitted} satır listeye SIĞMADI (tavan 500). Özet rakamları TÜM satırları kapsar.` : "Tüm satırlar listelendi.",
      "Bağsız kayıtlar (işsiz levent · siparişsiz dokuma · dışarıdan gelen top) ayrı tablodadır; ana listeye karışmaz.",
    ],
    tables: [
      {
        name: "Zincir",
        columns: [
          { header: "Müşteri", key: "musteri", width: 24 },
          { header: "Kumaş", key: "kumas", width: 22 },
          { header: "Renk", key: "renk", width: 14 },
          { header: "Sipariş", key: "siparisNo", width: 16 },
          { header: "İstenen (m)", key: "siparisM", width: 12, numFmt: "#,##0.#" },
          { header: "Karşılanan (m)", key: "sevkM", width: 14, numFmt: "#,##0.#" },
          { header: "İş emri", key: "isEmri", width: 16 },
          { header: "İş emri durumu", key: "isEmriDurum", width: 14 },
          { header: "Adım", key: "adim", width: 16 },
          { header: "Dokuma işi", key: "dokuma", width: 16 },
          { header: "Dokuma durumu", key: "dokumaDurum", width: 14 },
          { header: "Dokunan (m)", key: "dokunanM", width: 12, numFmt: "#,##0.#" },
          { header: "Plan (m)", key: "planM", width: 12, numFmt: "#,##0.#" },
          { header: "İlerleme %", key: "ilerlemePct", width: 11, numFmt: "#,##0.#" },
          ...(c.moduller.devere ? [{ header: "Levent", key: "levent", width: 14 }, { header: "Levent durumu", key: "leventDurum", width: 12 }, { header: "Kalan (m)", key: "kalanM", width: 11, numFmt: "#,##0.#" }] : []),
          { header: "Gecikme (gün)", key: "gecikmeGun", width: 12, numFmt: "#,##0" },
          { header: "Durum", key: "durum", width: 12 },
        ],
        rows: c.satirlar.map((r) => ({
          musteri: r.musteri.ad, kumas: r.kumas.ad, renk: r.renk?.ad ?? "—", siparisNo: r.siparis.no, siparisM: r.siparisM, sevkM: r.sevkM,
          isEmri: r.isEmri?.no ?? "—", isEmriDurum: r.isEmri?.durum ?? "", adim: r.isEmri?.adim ?? "",
          dokuma: r.dokuma?.no ?? "—", dokumaDurum: r.dokuma?.durum ?? "", dokunanM: r.dokuma?.dokunanM ?? "", planM: r.dokuma?.planM ?? "", ilerlemePct: r.dokuma?.ilerlemePct ?? "",
          ...(c.moduller.devere ? { levent: r.levent?.no ?? "—", leventDurum: r.levent?.durum ?? "", kalanM: r.levent?.kalanM ?? "" } : {}),
          gecikmeGun: r.gecikmeGun ?? "", durum: CHAIN_STATUS_LABEL[r.durum],
        })),
      },
      { name: "Bağsız kayıtlar", columns: [{ header: "Kova", key: "ad", width: 24 }, { header: "Sayı", key: "sayi", width: 10, numFmt: "#,##0" }], rows: bucketRows(c).map((b) => ({ ad: b.ad, sayi: b.sayi })) },
    ],
  };
}
