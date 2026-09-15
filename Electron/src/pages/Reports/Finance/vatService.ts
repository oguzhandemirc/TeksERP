// =============================================================================
// KDV DÖNEM ÖZETİ — tipler + API çağrısı (backend `finance-vat.report.ts` aynası)
// =============================================================================
// ⚠️ Yol TAM yazılır ("/api/reports/finance/vat-summary") — `apiClient.baseURL`
// `/api` İÇERMEZ; öneksiz yol 404 alır ve çağıran hatayı yutarsa ekran "bu
// dönemde fatura yok" gösterir (rapor BOZUK değil BOŞ görünür).
//
// ⚠️ TUTARLAR STRING gelir (backend Decimal → 2 hane string). İstemci bu
// değerlerle ARİTMETİK YAPMAZ — gösterim `moneyStr`, Excel hücresi `toNum`.
// Bu yüzden ekranın/exportun ihtiyaç duyduğu HER toplam backend'de hazırdır
// (`totalsTry.netBase/netVat/netWithholding` dahil): "istemci toplamasın"
// kuralı, alan listesini backend sözleşmesinin belirlemesi demektir.
//
// ⚠️ `reconDiff` "0.00" OLMAK ZORUNDA: oran satırlarından türetilen TL net'i
// ile damgalı `grandTotalTry` toplamının farkıdır. Sıfır değilse dağıtım
// hatası var demektir — ekran bunu GİZLEMEZ (kırmızı bant basar).
// =============================================================================

import apiClient from "@/services/apiClient";
import type { ReportResponse } from "../_services/types";

export type VatBlockKind = "SALES" | "PURCHASE";

export interface VatRateRow {
  /** Oran, sabit 2 hane ("20.00"). */
  vatRate: string;
  /** İade satırı — blokta AYRI görünür, toplamda negatif toplanmıştır. */
  isReturn: boolean;
  docCount: number;
  /** Matrah / KDV / tevkifat — BELGE para biriminde. */
  base: string;
  vat: string;
  withholding: string;
  /** TL karşılıkları — her belgenin KENDİ kur damgasıyla. */
  baseTry: string;
  vatTry: string;
  withholdingTry: string;
  /** baseTry + vatTry − withholdingTry (kuruş kalıntısı düzeltmeli). */
  totalTry: string;
}

export interface VatKindTotals {
  docCount: number;
  base: string;
  vat: string;
  withholding: string;
  grand: string;
  /** Damgalı `grandTotalTry` toplamı. */
  grandTry: string;
}

export interface VatCurrencyGroup {
  currency: string;
  /** Önce ileri satırlar (oran artan), sonra iade satırları. */
  rows: VatRateRow[];
  forward: VatKindTotals;
  /** İade yoksa null. */
  returns: VatKindTotals | null;
  /** İleri − iade (belge para birimi + TL genel toplam). */
  net: { base: string; vat: string; withholding: string; grand: string; grandTry: string };
}

export interface VatBlockTotalsTry {
  forward: string;
  returns: string;
  net: string;
  netBase: string;
  netVat: string;
  netWithholding: string;
  /** "0.00" olmalı — değilse dağıtım hatası (ekran kırmızı bant basar). */
  reconDiff: string;
}

export interface VatBlock {
  kind: VatBlockKind;
  label: string;
  docCount: number;
  currencies: VatCurrencyGroup[];
  totalsTry: VatBlockTotalsTry;
}

export interface VatSummaryReport {
  sales: VatBlock;
  purchase: VatBlock;
  notes: string[];
}

export interface VatSummaryApiParams {
  dateFrom?: string;
  dateTo?: string;
  /** Yön — KAPALI enum (panel statik çizer). İade yönleri AYRI değerlerdir. */
  yon?: VatYon;
  /** Oran GRUPLAMA ANAHTARIYLA aynı biçimde: "20.00" (iki hane şart). */
  oran?: string;
}

/** Backend `VAT_YONLERI` aynası — iade yönleri ayrı değer. */
export const VAT_YONLERI = ["SALES", "SALES_RETURN", "PURCHASE", "PURCHASE_RETURN"] as const;
export type VatYon = (typeof VAT_YONLERI)[number];
export const VAT_YON_ETIKET: Record<VatYon, string> = {
  SALES: "Satış",
  SALES_RETURN: "Satış iadesi",
  PURCHASE: "Alış",
  PURCHASE_RETURN: "Alış iadesi",
};

export async function getVatSummaryReport(
  p: VatSummaryApiParams,
): Promise<ReportResponse<VatSummaryReport>> {
  // Boş değer GÖNDERİLMEZ: backend şeması `.strict()` ve boş string tarih
  // "Geçersiz tarih formatı" 400'ü üretir.
  const params: Record<string, string> = {};
  if (p.dateFrom) params.dateFrom = p.dateFrom;
  if (p.dateTo) params.dateTo = p.dateTo;
  if (p.yon) params.yon = p.yon;
  if (p.oran) params.oran = p.oran;
  const res = await apiClient.get<ReportResponse<VatSummaryReport>>(
    "/api/reports/finance/vat-summary",
    { params },
  );
  return res.data;
}

/** Satır türü etiketi — blok türüne göre ("Satış"/"Satış iadesi" · "Alış"/"Alış iadesi"). */
export function vatRowKindLabel(block: VatBlockKind, isReturn: boolean): string {
  if (block === "SALES") return isReturn ? "Satış iadesi" : "Satış";
  return isReturn ? "Alış iadesi" : "Alış";
}

/** "20.00" → "%20" · "1.50" → "%1,5" — oran görüntü metni. */
export function vatRateLabel(rate: string): string {
  const n = Number(rate);
  if (!Number.isFinite(n)) return `%${rate}`;
  return `%${n.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
}
