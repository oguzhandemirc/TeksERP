// "Excel (stok kalemi bazında)" sayfası — başlık (sayım + süzgeç özeti), satırlar, birim başına toplam.
// Toplam satırı tek birimde kalın `totalRow`; çok birimde birim başına ayrı tablo (MT + KG toplanmaz).
import type { SheetColumn, SheetSpec } from "@/lib/xlsx-export";
import { upTo3ExcelNumFmt } from "@/lib/number-format";
import { unitLabel } from "@/lib/item-unit";
import { safeFormat } from "@/lib/format";
import type { StockLineResult, StockLineRow, StockLineTotal } from "./aggregate";
import { STOCK_LINE_COLUMNS, type StockLineColumn, type StockLineOptions } from "./options";

const NUMERIC: ReadonlySet<StockLineColumn> = new Set([
  "ordered", "shipped", "open", "inProduction", "inStock", "inStockAll", "toProduce", "customerCount", "orderCount",
]);

const label = (k: StockLineColumn) => STOCK_LINE_COLUMNS.find((c) => c.key === k)?.label ?? k;

function cellOf(r: StockLineRow, k: StockLineColumn): unknown {
  switch (k) {
    case "customerCount":
      return r.customers.length;
    case "customers":
      return r.customers.join(", ");
    case "nearestDeadline":
      return r.nearestDeadline ? safeFormat(r.nearestDeadline, "dd.MM.yyyy") : null;
    default:
      return r[k];
  }
}

function totalOf(t: StockLineTotal, k: StockLineColumn): unknown {
  if (k === "customers" || k === "nearestDeadline") return null;
  return t[k];
}

export interface StockLineSheetInput {
  title: string;
  result: StockLineResult;
  options: StockLineOptions;
  scopeLines: string[];
  notes: string[];
}

export function buildStockLineSheet({ title, result, options, scopeLines, notes }: StockLineSheetInput): SheetSpec {
  const lead: SheetColumn[] = [
    { header: "Kumaş Kodu", key: "itemCode", width: 14 },
    { header: "Kumaş", key: "itemName", width: 28 },
    ...(options.byColor
      ? [
          { header: "Renk Kodu", key: "colorCode", width: 12 },
          { header: "Renk", key: "colorName", width: 18 },
        ]
      : []),
    ...(options.byWidth ? [{ header: "En (cm)", key: "width", width: 9, numFmt: upTo3ExcelNumFmt(), align: "right" as const }] : []),
    { header: "Birim", key: "unit", width: 8 },
  ];
  const data: SheetColumn[] = options.columns.map((k) => ({
    header: label(k),
    key: k,
    width: k === "customers" ? 40 : 14,
    ...(NUMERIC.has(k) ? { numFmt: upTo3ExcelNumFmt(), align: "right" as const } : {}),
  }));
  const rows = result.rows.map((r) => ({
    itemCode: r.itemCode,
    itemName: r.itemName,
    colorCode: r.colorCode,
    colorName: r.colorName ?? (options.byColor ? "(renksiz)" : null),
    width: r.width,
    unit: unitLabel(r.unit),
    ...Object.fromEntries(options.columns.map((k) => [k, cellOf(r, k)])),
  }));
  const single = result.totals.length === 1 ? result.totals[0] : null;
  const totalRow = single
    ? { itemCode: "GENEL TOPLAM", unit: unitLabel(single.unit), ...Object.fromEntries(options.columns.map((k) => [k, totalOf(single, k)])) }
    : undefined;
  const subTables =
    result.totals.length > 1
      ? [
          {
            title: "GENEL TOPLAM — birim başına (farklı birimler toplanmaz)",
            columns: [{ header: "Birim" }, ...data.map(({ header, numFmt, align }) => ({ header, numFmt, align }))],
            rows: result.totals.map((t) => [unitLabel(t.unit), ...options.columns.map((k) => totalOf(t, k))]),
          },
        ]
      : undefined;

  const counts = `${result.rows.length} satır · ${result.orderCount} sipariş · ${result.lineCount} kalem`;
  return {
    name: "Stok kalemi bazında",
    preamble: [[title], [counts], [`Süzgeç: ${scopeLines.length ? scopeLines.join(" · ") : "yok (tüm siparişler)"}`]],
    columns: [...lead, ...data],
    rows,
    totalRow,
    subTables,
    notes,
  };
}

/** Dosyanın altındaki "rakam nasıl okunur" notları — seçime göre. */
export function stockLineNotes(options: StockLineOptions, sourceNotes: string[]): string[] {
  const ax = ["kumaş", options.byColor ? "renk" : null, options.byWidth ? "en" : null, "birim"].filter(Boolean).join(" + ");
  return [
    `Satır = ${ax}; sipariş no ve müşteri ayrımı yapılmaz. Farklı birimler (m / kg / adet) asla toplanmaz.`,
    "İptal kalemler ve iptal siparişler hariç. Sevk BRÜT; Açık = kalem başına (sipariş − sevk), 0'ın altına düşmez; elle kapatılan siparişte 0.",
    "kg/adet kalemlerde sevk ve açık ölçülmez (metre defteri) — hücre boş.",
    "Üretimde = bu kalemlere bağlı iş emirlerinde şu an üretimde/fasonda olan topların metresi (giriş metresi; çekme öncesi). Bir iş emri tek satırda sayılır.",
    "Depoda hazır (serbest) = bitmiş kumaş stoğu (depo + A1 stok; sevke/çuvala girmemiş), Stok & Ölü Stok raporuyla aynı tanım; kat ayrımı toplanır.",
    ...(options.columns.includes("inStockAll")
      ? ["Depoda (tümü) = depodaki her bitmiş top (depo + A1 stok), çuvaldakiler ve sevkiyata ayrılmışlar DAHİL; henüz sevk edilmemiş mal."]
      : []),
    "Üretilmesi gereken = Açık − Depoda hazır (serbest) − Üretimde (0'ın altına düşmez).",
    ...sourceNotes,
  ];
}
