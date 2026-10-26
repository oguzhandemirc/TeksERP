/**
 * Satış teklifi + fiyat listesi örnek belgeleri (MAL-6) — iç alan (maliyet/kâr/iç not)
 * örnekte de YOK. `sample-data.ts` satır tavanı yüzünden ayrı dosyada; an onunla aynı.
 */
import { previewSeriesCode, resolveSeriesFormat } from "../number-series.service";
import { SAMPLE_INSPECTION_REPORT } from "./sample-data-inspection";

const DAY = "2026-06-07T00:00:00.000Z";
// Örnek no seriden, ERİŞİMDE türetilir (literal yazılmaz; modül yüklenirken seri okunmaz — sample-data `ornekNo` emsali).
const ornekNo = (key: string, seq: number): string => previewSeriesCode(resolveSeriesFormat(key), seq, new Date(DAY));

export const SAMPLE_SALES_QUOTE: Record<string, unknown> = {
  header: {
    get documentNo() { return `${ornekNo("salesQuote", 42)}/R1`; }, get quoteNo() { return ornekNo("salesQuote", 42); }, revisionNo: 1, quoteDate: DAY, validUntilDate: "2026-07-07T00:00:00.000Z",
    currency: "USD", fxRate: 32.4512, paymentTermDays: 60, customerReference: "PO-7781",
    customerName: "Örnek Tekstil A.Ş.", customerCode: "M001", branchName: "İstanbul Merkez",
  },
  lines: [
    { lineNo: 1, description: "Pamuklu Astar", itemCode: "KM-0101", colorName: "Bej", widthCm: 150, quantity: 1200, unit: "MT", unitPrice: 2.85, lineTotal: 3420 },
    { lineNo: 2, description: "Süet Kumaş", itemCode: "KM-0207", colorName: "Antrasit", widthCm: 140, quantity: 800, unit: "MT", unitPrice: 4.1, lineTotal: 3280 },
    { lineNo: 3, description: "Numune desen — özel dokuma", itemCode: null, colorName: null, widthCm: null, quantity: 50, unit: "MT", unitPrice: 6.75, lineTotal: 337.5 },
  ],
  totals: { quantity: 2050, amount: 7037.5 },
  notes: "Fiyatlara KDV dahil değildir. Teslim: fabrika teslim.",
};

export const SAMPLE_PRICE_LIST: Record<string, unknown> = {
  header: {
    get documentNo() { return `${ornekNo("priceList", 7)}/R1`; }, get listNo() { return ornekNo("priceList", 7); }, revisionNo: 1, name: "2026 Kış Sezonu", customerName: "Örnek Tekstil A.Ş.", customerCode: "M001",
    currency: "EUR", publishedAt: "2026-06-07T10:30:00.000Z", validFromDate: DAY, validUntilDate: "2026-12-31T00:00:00.000Z",
  },
  lines: [
    { lineNo: 1, itemCode: "KM-0101", itemName: "Pamuklu Astar", colorName: null, unitPrice: 2.6, minQty: 500 },
    { lineNo: 2, itemCode: "KM-0101", itemName: "Pamuklu Astar", colorName: "Bej", unitPrice: 2.75, minQty: null },
    { lineNo: 3, itemCode: "KM-0207", itemName: "Süet Kumaş", colorName: "Antrasit", unitPrice: 3.9, minQty: 1000 },
  ],
  notes: "Liste fiyatları metre başınadır.",
};

/** `SAMPLE_PRINTED_DOCS`a yayılan ek müşteri belgeleri (muayene: geçen/kalan/muayenesiz top). */
export const SAMPLE_CUSTOMER_EXTRA_DOCS = {
  INSPECTION_REPORT: SAMPLE_INSPECTION_REPORT,
  SALES_QUOTE: SAMPLE_SALES_QUOTE,
  PRICE_LIST: SAMPLE_PRICE_LIST,
} as const satisfies Record<string, Record<string, unknown>>;
