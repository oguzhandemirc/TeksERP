// "Excel (stok kalemi bazında)" — SAF toplama. Sipariş no/müşteri önemsiz: kumaş (+renk, +en) ve
// BİRİM başına tek satır (MT ile KG asla toplanmaz). Girdi ekrandaki süzgeçle çekilmiş siparişler
// (`useDataTable.fetchAll`) + bitmiş stok (Stok & Ölü Stok kalem ucu) + iş emri başına canlı metre.
import { isMeasuredUnit } from "@/lib/item-unit";
import type { Order, OrderLine } from "../types";
import type { StockLineOptions } from "./options";

/** Sipariş "rollup" aktif kümesi (`deriveWoRollup` ile aynı: CANCELLED + SUPERSEDED hariç). */
const ACTIVE_WO = new Set(["PLANNED", "IN_PROGRESS", "COMPLETED"]);

/** Bitmiş stok hücresi (kat kırılımı çağıranda ya da burada toplanır). */
export interface StockCellInput {
  itemId: string;
  colorId: string | null;
  width: number | null;
  qty: number;
}

export interface StockLineSources {
  /** Serbest bitmiş stok. null = ölçülemedi (yetki yok / rapor kapalı / uç hatası) → "Depoda hazır (serbest)" boş. */
  stock: StockCellInput[] | null;
  /** Çuvaldaki + sevkiyata ayrılmış dahil TÜM bitmiş stok. null = ölçülemedi / sütun seçilmedi → "Depoda (tümü)" boş. */
  stockAll: StockCellInput[] | null;
  /** İş emri id → canlı top metresi. null = ölçülemedi → "Üretimde" boş. */
  liveMetersByWorkOrder: Map<string, number> | null;
}

export interface StockLineRow {
  key: string;
  itemCode: string;
  itemName: string;
  colorCode: string | null;
  colorName: string | null;
  width: number | null;
  unit: string;
  /** Sevk/açık metre defterinden ölçülür mü (yalnız MT). */
  measured: boolean;
  ordered: number;
  shipped: number | null;
  open: number | null;
  inProduction: number | null;
  inStock: number | null;
  inStockAll: number | null;
  toProduce: number | null;
  customers: string[];
  orderCount: number;
  lineCount: number;
  /** En yakın termin (ISO) — yalnız açığı olan kalemlerin siparişlerinden. */
  nearestDeadline: string | null;
}

export interface StockLineTotal {
  unit: string;
  ordered: number;
  shipped: number | null;
  open: number | null;
  inProduction: number | null;
  inStock: number | null;
  inStockAll: number | null;
  toProduce: number | null;
  customerCount: number;
  orderCount: number;
}

export interface StockLineResult {
  rows: StockLineRow[];
  totals: StockLineTotal[];
  orderCount: number;
  lineCount: number;
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round = (n: number) => Math.round(n * 100) / 100;
const widthKey = (w: unknown): string => (w == null || w === "" ? "" : String(round(num(w))));

/** Grup anahtarının ayrım seçeneğine bağlı kısmı — stok eşlemesi de aynı anahtarı kurar. */
function specKey(itemId: string, colorId: string | null | undefined, width: unknown, o: StockLineOptions): string {
  return `${itemId}|${o.byColor ? (colorId ?? "") : "*"}|${o.byWidth ? widthKey(width) : "*"}`;
}

/** Kalem talep sayılır mı: iptal kalem ve iptal sipariş HARİÇ (iptal edilen talep talep değildir). */
export function isDemandLine(order: Order, line: OrderLine): boolean {
  return !line.cancelledAt && order.status !== "CANCELLED";
}

/** Kalemin açığı: kalem başına max(0, miktar − sevk) — fazla sevk başka müşterinin açığını yemez. */
function lineOpen(order: Order, line: OrderLine): number {
  if (order.status === "COMPLETED") return 0;
  return Math.max(0, num(line.quantity) - num(line.shippedQty));
}

interface Acc {
  row: StockLineRow;
  customerIds: Map<string, string>;
  orderIds: Set<string>;
  hasOpen: boolean;
}

function newAcc(key: string, line: OrderLine, unit: string, o: StockLineOptions): Acc {
  const measured = isMeasuredUnit(unit);
  return {
    row: {
      key,
      itemCode: line.item?.code ?? "",
      itemName: line.item?.name ?? "",
      colorCode: o.byColor ? (line.color?.code ?? null) : null,
      colorName: o.byColor ? (line.color?.name ?? null) : null,
      width: o.byWidth && line.width != null ? round(num(line.width)) : null,
      unit,
      measured,
      ordered: 0,
      shipped: measured ? 0 : null,
      open: measured ? 0 : null,
      inProduction: null,
      inStock: null,
      inStockAll: null,
      toProduce: null,
      customers: [],
      orderCount: 0,
      lineCount: 0,
      nearestDeadline: null,
    },
    customerIds: new Map(),
    orderIds: new Set(),
    hasOpen: false,
  };
}

/** Tek talep kalemini grubuna ekler; bağlı aktif İE'leri `woGroups`a yazar. */
interface Ctx {
  groups: Map<string, Acc>;
  woGroups: Map<string, Set<string>>;
  o: StockLineOptions;
}

function addLine({ groups, woGroups, o }: Ctx, order: Order, line: OrderLine) {
  const unit = line.unit ?? "MT";
  const measured = isMeasuredUnit(unit);
  const key = `${specKey(line.itemId, line.colorId, line.width, o)}|${unit}`;
  const acc = groups.get(key) ?? newAcc(key, line, unit, o);
  groups.set(key, acc);
  const r = acc.row;
  r.ordered += num(line.quantity);
  r.lineCount += 1;
  acc.orderIds.add(order.id);
  acc.customerIds.set(order.customerId, order.customer?.name ?? order.customerId);
  const open = lineOpen(order, line);
  if (measured) {
    r.shipped = (r.shipped ?? 0) + num(line.shippedQty);
    r.open = (r.open ?? 0) + open;
  }
  const isOpen = measured ? open > 0 : order.status !== "COMPLETED";
  if (isOpen) {
    acc.hasOpen = true;
    if (order.deadline && (!r.nearestDeadline || Date.parse(order.deadline) < Date.parse(r.nearestDeadline))) {
      r.nearestDeadline = order.deadline;
    }
  }
  if (!measured) return;
  for (const link of line.workOrderLinks ?? []) {
    if (!ACTIVE_WO.has(link.workOrder.status)) continue;
    const set = woGroups.get(link.workOrder.id) ?? new Set<string>();
    set.add(key);
    woGroups.set(link.workOrder.id, set);
  }
}

/** İE canlı metresini gruplara dağıtır: birden çok gruba bağlı İE açığı en büyük gruba (eşitlikte anahtar) — belirlenimli. */
function productionByGroup(groups: Map<string, Acc>, woGroups: Map<string, Set<string>>, live: Map<string, number>) {
  const prodByKey = new Map<string, number>();
  for (const [woId, keys] of woGroups) {
    const m = live.get(woId) ?? 0;
    if (m <= 0) continue;
    const target = [...keys].sort(
      (a, b) => (groups.get(b)?.row.open ?? 0) - (groups.get(a)?.row.open ?? 0) || a.localeCompare(b),
    )[0];
    if (target) prodByKey.set(target, (prodByKey.get(target) ?? 0) + m);
  }
  return prodByKey;
}

/** Stok: aynı ayrım anahtarına toplanır (kat ve ayrılmayan eksenler toplanır); yalnız MT grubuna. */
function sumBySpec(cells: StockCellInput[] | null, o: StockLineOptions): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cells ?? []) {
    const k = specKey(c.itemId, c.colorId, c.width, o);
    m.set(k, (m.get(k) ?? 0) + num(c.qty));
  }
  return m;
}

export function aggregateStockLines(orders: Order[], o: StockLineOptions, src: StockLineSources): StockLineResult {
  const groups = new Map<string, Acc>();
  // İş emri → bağlı grup anahtarları (her İE TEK gruba sayılır; çift sayım yok).
  const woGroups = new Map<string, Set<string>>();
  const ctx: Ctx = { groups, woGroups, o };
  for (const order of orders) {
    for (const line of order.lines ?? []) {
      if (isDemandLine(order, line)) addLine(ctx, order, line);
    }
  }

  const stockBySpec = sumBySpec(src.stock, o);
  const stockAllBySpec = sumBySpec(src.stockAll, o);
  const live = src.liveMetersByWorkOrder;
  const prodByKey = live ? productionByGroup(groups, woGroups, live) : new Map<string, number>();

  const rows: StockLineRow[] = [];
  for (const acc of groups.values()) {
    if (o.onlyOpen && !acc.hasOpen) continue;
    const r = acc.row;
    r.customers = [...acc.customerIds.values()].sort((a, b) => a.localeCompare(b, "tr"));
    r.orderCount = acc.orderIds.size;
    r.ordered = round(r.ordered);
    if (r.measured) {
      r.shipped = round(r.shipped ?? 0);
      r.open = round(r.open ?? 0);
      const spec = r.key.slice(0, r.key.lastIndexOf("|"));
      r.inStock = src.stock ? round(stockBySpec.get(spec) ?? 0) : null;
      r.inStockAll = src.stockAll ? round(stockAllBySpec.get(spec) ?? 0) : null;
      r.inProduction = live ? round(prodByKey.get(r.key) ?? 0) : null;
      // Üretilecek SERBEST stoktan düşülür: çuvaldaki/sevke ayrılmış top başka talebe gidiyor.
      r.toProduce =
        r.inStock !== null && r.inProduction !== null ? round(Math.max(0, r.open - r.inStock - r.inProduction)) : null;
    }
    rows.push(r);
  }
  rows.sort(
    (a, b) =>
      (b.open ?? -1) - (a.open ?? -1) ||
      a.itemName.localeCompare(b.itemName, "tr") ||
      (a.colorName ?? "").localeCompare(b.colorName ?? "", "tr") ||
      (a.width ?? Infinity) - (b.width ?? Infinity) ||
      a.unit.localeCompare(b.unit),
  );

  return { rows, totals: unitTotals(rows, groups), ...countsOf(rows, groups) };
}

function countsOf(rows: StockLineRow[], groups: Map<string, Acc>) {
  const orders = new Set<string>();
  let lineCount = 0;
  for (const r of rows) {
    lineCount += r.lineCount;
    for (const id of groups.get(r.key)?.orderIds ?? []) orders.add(id);
  }
  return { orderCount: orders.size, lineCount };
}

const addNullable = (a: number | null | undefined, b: number | null): number | null =>
  b === null ? (a ?? null) : round((a ?? 0) + b);

/** Birim başına genel toplam — MT ile KG ayrı satır. */
function unitTotals(rows: StockLineRow[], groups: Map<string, Acc>): StockLineTotal[] {
  const by = new Map<string, StockLineTotal & { cust: Set<string>; ord: Set<string> }>();
  for (const r of rows) {
    const t = by.get(r.unit) ?? {
      unit: r.unit, ordered: 0, shipped: null, open: null, inProduction: null, inStock: null, inStockAll: null, toProduce: null,
      customerCount: 0, orderCount: 0, cust: new Set<string>(), ord: new Set<string>(),
    };
    t.ordered = round(t.ordered + r.ordered);
    t.shipped = addNullable(t.shipped, r.shipped);
    t.open = addNullable(t.open, r.open);
    t.inProduction = addNullable(t.inProduction, r.inProduction);
    t.inStock = addNullable(t.inStock, r.inStock);
    t.inStockAll = addNullable(t.inStockAll, r.inStockAll);
    t.toProduce = addNullable(t.toProduce, r.toProduce);
    const g = groups.get(r.key);
    for (const id of g?.customerIds.keys() ?? []) t.cust.add(id);
    for (const id of g?.orderIds ?? []) t.ord.add(id);
    by.set(r.unit, t);
  }
  return [...by.values()].map(({ cust, ord, ...t }) => ({ ...t, customerCount: cust.size, orderCount: ord.size }));
}
