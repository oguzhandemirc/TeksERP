// =============================================================================
// DEVERECİ FATURASI — panel saf katmanı + uç çağrıları (devere A2; backend A1 `fee-summary.ts` / `fee-invoice.ts`)
// =============================================================================
// Bütün sayılar SUNUCUDAN gelir (beklenen ücret, fark, durum); burada yalnız etiket, seçim kümesi ve biçim var.
// Tel×metre fiyatı 8 ondalık taşır → gösterim 8'e kadar; 4'ü aşan fiyatta taslak satırı götürü doğar (miktar 1).
// =============================================================================
import apiClient from "@/services/apiClient";
import { formatAmount, formatQty } from "@/lib/format";
import { money, type Currency } from "./service";

export type WarpingFeeUnit = "METRE" | "KG" | "ENDS_METRE";
export type WarpingFeeInvoiceState = "NONE" | "PARTIAL" | "FULL";

export interface WarpingFeeReceipt {
  receiptKey: string;
  deliveryNoteNo: string | null;
  receivedAt: string;
  beamCount: number;
  lengthM: string;
  qty: string;
  expectedAmount: string | null;
  invoice: { id: string; docNo: string; status: string } | null;
  /** Yalnız aday listesinde: bu faturaya bağlanabilir mi. */
  selectable?: boolean;
}

export interface WarpingFeeOrder {
  id: string;
  orderNo: string;
  status: string;
  warpSpecName: string;
  subcontractor: { id: string; name: string };
  fee: { unit: WarpingFeeUnit; unitPrice: string | null; currency: Currency | null };
  receipts: WarpingFeeReceipt[];
  totals: { lengthM: string; qty: string; expectedAmount: string | null };
  /** Fatura bilgisi okunamıyorsa (izin/ön muhasebe kapalı) ya da kabul yoksa null. */
  invoiceState: WarpingFeeInvoiceState | null;
}

export interface WarpingFeeMatch {
  currency: Currency;
  orders: Array<{
    warpingOrderId: string;
    orderNo: string;
    feeUnit: WarpingFeeUnit;
    feeUnitPrice: string | null;
    feeCurrency: Currency | null;
    receipts: Array<{ receiptKey: string; deliveryNoteNo: string | null; beamCount: number; qty: string; expectedAmount: string | null }>;
    qty: string;
    expectedAmount: string | null;
  }>;
  expectedTotal: string | null;
  invoiceNet: string;
  difference: string | null;
  diffPct: string | null;
  tolerancePct: number;
  exceeded: boolean;
  currencyMismatch: boolean;
  missingPrice: boolean;
  warnings: string[];
}

/** Fatura detayında bağlı kabuller (`warpingReceipts`); eski backend göndermez. */
export interface InvoiceWarpingReceiptRef {
  warpingOrderId: string;
  orderNo: string;
  receiptKey: string;
}

// ── Uçlar ──────────────────────────────────────────────────────────────────

export async function listWarpingCandidates(cariId: string, invoiceId?: string | null): Promise<WarpingFeeOrder[]> {
  const res = await apiClient.get<{ data: WarpingFeeOrder[] }>("/api/finance/invoices/warping-orders/candidates", {
    params: invoiceId ? { cariId, invoiceId } : { cariId },
  });
  return res.data.data;
}

export async function getWarpingOrderFeeSummary(orderId: string): Promise<WarpingFeeOrder> {
  const res = await apiClient.get<{ data: WarpingFeeOrder }>(`/api/warping-orders/${orderId}/fee-summary`);
  return res.data.data;
}

export async function createDraftFromWarping(receiptKeys: string[], clientToken: string) {
  const res = await apiClient.post("/api/finance/invoices/draft-from-warping", { receiptKeys, clientToken });
  return res.data as { data: { id: string; docNo: string }; message?: string; warnings?: string[] };
}

export async function getWarpingFeeMatch(invoiceId: string): Promise<WarpingFeeMatch | null> {
  const res = await apiClient.get<{ data: WarpingFeeMatch | null }>(`/api/finance/invoices/${invoiceId}/warping-fee-match`, { suppressErrorToast: true } as never);
  return res.data.data;
}

export const warpingFeeMatchKey = (invoiceId: string) => ["finance", "invoice", invoiceId, "warping-fee-match"] as const;

// ── Etiket ve biçim ───────────────────────────────────────────────────────

export const FEE_UNIT_TEXT: Record<WarpingFeeUnit, string> = { METRE: "m", KG: "kg", ENDS_METRE: "tel×m" };

export const FEE_STATE_LABEL: Record<WarpingFeeInvoiceState, string> = { NONE: "Faturasız", PARTIAL: "Kısmen faturalı", FULL: "Faturalandı" };

export const FEE_STATE_CLASS: Record<WarpingFeeInvoiceState, string> = {
  NONE: "bg-muted text-muted-foreground",
  PARTIAL: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  FULL: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
};

/** Liste süzgeci seçenekleri (`filter[feeInvoiced]`). */
export const FEE_FILTER_OPTIONS: Array<{ value: WarpingFeeInvoiceState; label: string }> = [
  { value: "FULL", label: "Faturalandı" },
  { value: "PARTIAL", label: "Kısmen" },
  { value: "NONE", label: "Yok" },
];

/** Ondalık hane sayısı (sondaki sıfırlar sayılmaz): "0.00012500" → 6. */
export function priceDecimals(price: string | null): number {
  if (!price) return 0;
  const frac = price.split(".")[1]?.replace(/0+$/, "") ?? "";
  return frac.length;
}

/** Fatura satırı birim fiyatı 4 ondalık taşır; aşan fiyatta taslak satırı GÖTÜRÜ doğar (sunucu kuralının aynası, yalnız açıklama için). */
export const isLumpPrice = (price: string | null) => priceDecimals(price) > 4;

export const LUMP_INFO =
  "Bu ücret 4 ondalıktan fazla (ör. tel × metre fiyatı). Fatura satırı birim fiyatı 4 ondalık taşıdığından yuvarlama tutarı kaydırırdı; bu yüzden taslak satırı götürü doğar: miktar 1, tutar = beklenen ücret, ölçü × fiyat satır açıklamasında yazar.";

/** "0,00001250 USD / tel×m" — fiyat 8 ondalığa kadar, sondaki sıfırlar atılır. */
export function feePriceText(fee: { unit: WarpingFeeUnit; unitPrice: string | null; currency: string | null }): string {
  const unit = FEE_UNIT_TEXT[fee.unit];
  return fee.unitPrice === null ? `Ücret girilmedi (${unit} başına)` : `${formatQty(fee.unitPrice, 8)} ${fee.currency ?? ""} / ${unit}`.replace("  ", " ");
}

/** Ölçü: "6.000 m" · "12,5 kg" · "4.800.000 tel×m". */
// Binlik ayırıcılı: tel × metre ölçüsü milyonlara çıkar (17.640.000).
export const feeQtyText = (qty: string, unit: WarpingFeeUnit) => `${formatAmount(qty, 0, 3)} ${FEE_UNIT_TEXT[unit]}`;

/** Beklenen tutar (para birimi yoksa — ücretsiz sipariş — tire). */
export function expectedText(amount: string | null, currency: Currency | null): string {
  if (amount === null || currency === null) return "—";
  return money(amount, currency);
}

// ── Seçim kümesi ──────────────────────────────────────────────────────────

export const selectableReceipts = (o: WarpingFeeOrder) => o.receipts.filter((r) => r.selectable ?? r.invoice === null);

/** Sipariş satırı onay kutusu: hepsi · bir kısmı · hiçbiri (yalnız seçilebilir kabuller sayılır). */
export function orderCheckState(o: WarpingFeeOrder, selected: ReadonlySet<string>): "all" | "some" | "none" {
  const sel = selectableReceipts(o);
  const n = sel.filter((r) => selected.has(r.receiptKey)).length;
  return n === 0 ? "none" : n === sel.length ? "all" : "some";
}

/** Sipariş satırına dokunma: hepsi seçiliyse çıkar, değilse seçilebilirlerin hepsini ekle. */
export function toggleOrder(o: WarpingFeeOrder, selected: readonly string[]): string[] {
  const keys = selectableReceipts(o).map((r) => r.receiptKey);
  const set = new Set(selected);
  if (orderCheckState(o, set) === "all") return selected.filter((k) => !keys.includes(k));
  for (const k of keys) set.add(k);
  return [...set];
}

export const toggleKey = (key: string, selected: readonly string[]) => (selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);

/** Ön seçim: verilen siparişlerin seçilebilir bütün kabulleri ("Fatura gir" yolu). */
export function preselectOrders(orders: readonly WarpingFeeOrder[], orderIds: readonly string[]): string[] {
  return orders.filter((o) => orderIds.includes(o.id)).flatMap((o) => selectableReceipts(o).map((r) => r.receiptKey));
}

/** Seçilen kabullerin beklenen toplamı, para birimi başına (karışık döviz sunucuda 400; burada önceden söylenir). */
export function selectedExpected(orders: readonly WarpingFeeOrder[], selected: readonly string[]): { byCurrency: Array<{ currency: Currency; amount: number }>; missingPrice: boolean; orderCount: number } {
  const set = new Set(selected);
  const sums = new Map<Currency, number>();
  let missingPrice = false;
  let orderCount = 0;
  for (const o of orders) {
    const rs = o.receipts.filter((r) => set.has(r.receiptKey));
    if (rs.length === 0) continue;
    orderCount += 1;
    if (o.fee.unitPrice === null || o.fee.currency === null) {
      missingPrice = true;
      continue;
    }
    // Kuruş tamsayısında toplanır (kayan nokta kaymasın); kaynak sunucunun 2 ondalıklı tutarıdır.
    const k = rs.reduce((s, r) => s + Math.round(Number(r.expectedAmount ?? 0) * 100), 0);
    sums.set(o.fee.currency, (sums.get(o.fee.currency) ?? 0) + k);
  }
  return { byCurrency: [...sums].map(([currency, k]) => ({ currency, amount: k / 100 })), missingPrice, orderCount };
}

/** Tetik metni ("Ad: Değer" kalıbı, fiş alanıyla aynı dil). */
export function warpingTriggerText(count: number, hasSupplier: boolean): string {
  if (!hasSupplier) return "Önce cari seç";
  return count > 0 ? `Devere kabulleri: ${count} seçili` : "Devere kabulleri: yok";
}

/** Bağlı kabullerin sipariş no özeti: "DS-2611-0007 (2 kabul) · DS-2611-0008". */
export function linkedOrdersText(refs: readonly InvoiceWarpingReceiptRef[], keys: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const r of refs) if (keys.includes(r.receiptKey)) counts.set(r.orderNo, (counts.get(r.orderNo) ?? 0) + 1);
  return [...counts].map(([no, n]) => (n > 1 ? `${no} (${n} kabul)` : no)).join(" · ");
}

/** Fark satırı: "Fark +26,00 $ (%4,6)"; karşılaştırılamıyorsa nedeni. */
export function differenceText(m: WarpingFeeMatch): string {
  if (m.currencyMismatch) return "Fark hesaplanmadı — sipariş ücreti faturayla farklı para biriminde (kur çevrilmez).";
  if (m.missingPrice) return "Fark hesaplanmadı — bağlı siparişlerden birinde devere ücreti girilmemiş.";
  if (m.difference === null) return "Fark hesaplanamadı.";
  const d = Number(m.difference);
  const sign = d > 0 ? "+" : "";
  const pct = m.diffPct === null ? "" : ` (%${formatQty(m.diffPct, 1)})`;
  return `Fark ${sign}${money(d, m.currency)}${pct}`;
}
