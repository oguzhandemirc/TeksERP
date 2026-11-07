// "Excel (stok kalemi bazında)" modal seçenekleri — kullanıcı tercihinde (`prefs.orders.stockLineExport`)
// saklanır. Saklanan blob gevşektir (backend doğrulamaz): okurken HER alan süzülür, bozuk/eski şema
// varsayılana döner — tanınmayan sütun sessizce düşer, hiç sütun kalmazsa varsayılan sütunlar.

export const STOCK_LINE_COLUMNS = [
  { key: "ordered", label: "Sipariş miktarı" },
  { key: "shipped", label: "Sevk edilen" },
  { key: "open", label: "Açık" },
  { key: "inProduction", label: "Üretimde" },
  { key: "inStock", label: "Depoda hazır (serbest)" },
  { key: "inStockAll", label: "Depoda (tümü)" },
  { key: "toProduce", label: "Üretilmesi gereken" },
  { key: "customerCount", label: "Müşteri sayısı" },
  { key: "customers", label: "Müşteriler" },
  { key: "orderCount", label: "Sipariş sayısı" },
  { key: "nearestDeadline", label: "En yakın termin" },
] as const;

export type StockLineColumn = (typeof STOCK_LINE_COLUMNS)[number]["key"];

export interface StockLineOptions {
  byColor: boolean;
  byWidth: boolean;
  columns: StockLineColumn[];
  onlyOpen: boolean;
}

export const DEFAULT_STOCK_LINE_COLUMNS: StockLineColumn[] = ["ordered", "shipped", "open", "inProduction", "customerCount"];

export const DEFAULT_STOCK_LINE_OPTIONS: StockLineOptions = {
  byColor: true,
  byWidth: true,
  columns: DEFAULT_STOCK_LINE_COLUMNS,
  onlyOpen: true,
};

const KNOWN = new Set<string>(STOCK_LINE_COLUMNS.map((c) => c.key));

/** Saklanan değeri güvenle okur; her alan ayrı süzülür, şekli bozuk alan varsayılanına döner. */
export function readStockLineOptions(raw: unknown): StockLineOptions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_STOCK_LINE_OPTIONS };
  const r = raw as Record<string, unknown>;
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const cols = Array.isArray(r.columns)
    ? [...new Set(r.columns.filter((c): c is StockLineColumn => typeof c === "string" && KNOWN.has(c)))]
    : [];
  return {
    byColor: bool(r.byColor, DEFAULT_STOCK_LINE_OPTIONS.byColor),
    byWidth: bool(r.byWidth, DEFAULT_STOCK_LINE_OPTIONS.byWidth),
    onlyOpen: bool(r.onlyOpen, DEFAULT_STOCK_LINE_OPTIONS.onlyOpen),
    columns: cols.length > 0 ? sortColumns(cols) : [...DEFAULT_STOCK_LINE_COLUMNS],
  };
}

/** Sütunlar seçim sırasıyla değil katalog sırasıyla basılır (dosyalar birbirine benzesin). */
export function sortColumns(cols: StockLineColumn[]): StockLineColumn[] {
  const order = STOCK_LINE_COLUMNS.map((c) => c.key as StockLineColumn);
  return order.filter((k) => cols.includes(k));
}

/** Üretim modülü kapalıyken üretim türevi sütunlar seçilemez (İE yok). */
export function availableColumns(productionEnabled: boolean): typeof STOCK_LINE_COLUMNS[number][] {
  return STOCK_LINE_COLUMNS.filter((c) => productionEnabled || c.key !== "inProduction");
}
