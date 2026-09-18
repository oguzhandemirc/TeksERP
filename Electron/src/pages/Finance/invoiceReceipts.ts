// =============================================================================
// FATURA ↔ MAL KABUL FİŞLERİ — saf katman (2026-09-18, 1e dilimi "fatura formunda fişler")
// =============================================================================
// Alış faturası birden çok fişe bağlanır (`goodsReceiptIds` REPLACE). Etiket, tetik metni, küme eşitliği ve
// sunucunun TOPLAM düzeyindeki fark satırlarının (`receiptMatch.differences`) insan diline çevrimi burada;
// bileşenler yalnız çizer. Kesin hat sunucudadır (400/409 kodları, onayda `INVOICE_RECEIPT_MISMATCH`).
// =============================================================================
import axios from "axios";
import { money, type Currency, type InvoiceReceiptDifference, type InvoiceReceiptMatch } from "./service";

export interface ReceiptLike {
  receiptNo: string;
  deliveryNoteNo: string | null;
}

/** "MK-… · irsaliye 4471" — irsaliye yoksa yalnız fiş no. */
export function receiptLabel(r: ReceiptLike): string {
  return r.deliveryNoteNo ? `${r.receiptNo} · irsaliye ${r.deliveryNoteNo}` : r.receiptNo;
}

/** Tetik metni "Ad: Değer" kalıbı (LabeledSelect ile aynı dil); cari seçilmeden liste kurulamaz. */
export function receiptsTriggerText(count: number, hasSupplier: boolean): string {
  if (!hasSupplier) return "Önce cari seç";
  return count > 0 ? `Mal kabul fişleri: ${count} seçili` : "Mal kabul fişleri: yok";
}

/** İki id kümesi aynı mı (sıra önemsiz) — değişmeyen küme PATCH'te GÖNDERİLMEZ. */
export function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

export const DIFF_KIND_LABEL: Record<InvoiceReceiptDifference["kind"], string> = {
  QTY: "Miktar",
  AMOUNT: "Tutar",
};

const pct = (n: number) => `%${n.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`;
const qty = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 3 });

/** Tek fark satırı: "Miktar: fatura 1.250 ↔ fişler 1.200 (fark %4,2 · tolerans %2)". */
export function differenceText(d: InvoiceReceiptDifference, currency: Currency): string {
  const fmt = d.kind === "AMOUNT" ? (n: number) => money(n, currency) : qty;
  return `${DIFF_KIND_LABEL[d.kind]}: fatura ${fmt(d.invoice)} ↔ fişler ${fmt(d.receipts)} (fark ${pct(d.diffPct)} · tolerans ${pct(d.tolerancePct)})`;
}

/** Sarı banda girecek satırlar: yalnız toleransı AŞAN farklar (kontrol kapalıysa sunucu hiçbirini aşmış saymaz). */
export function exceededDifferences(match: InvoiceReceiptMatch | null | undefined): InvoiceReceiptDifference[] {
  return (match?.differences ?? []).filter((d) => d.exceeded);
}

/** Sunucu mesajı (+ `details.code`) — alanın altında yazılır; ağ hatasında sabit cümle. */
export function receiptsErrorText(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as { message?: string; details?: { code?: string } } | undefined;
    if (body?.message) return body.details?.code ? `${body.message} (${body.details.code})` : body.message;
    if (!error.response) return "Sunucuya ulaşılamadı. Bağlantıyı kontrol edip tekrar deneyin.";
  }
  return "Fişler bağlanamadı. Lütfen tekrar deneyin.";
}
