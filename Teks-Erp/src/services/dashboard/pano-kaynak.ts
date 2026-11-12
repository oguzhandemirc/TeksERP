// =============================================================================
// AÇILIŞ PANOSU — kaynak okuyucu (istek başına bellekli) + kutu kapıları
// =============================================================================
// Her kaynak bir istek içinde EN FAZLA BİR KEZ okunur: iki kutu aynı kaynağı isterse (ör. stok KPI +
// stok özeti + emanet → Stok karnesi) tek sorgu atılır; istenmeyen kutunun kaynağı hiç çağrılmaz.
// Gruplama SQL'leri tek kaynak gövdelerin (`_produced`, `_shipped`) üstündedir; yeni tanım yok.
// =============================================================================
import { Prisma, ShipmentStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { matchesPermission } from "../../middlewares/rbac.middleware";
import { canAccess, isModuleOpen, type AccessContext } from "../reports/semantik/izin";
import { SEMANTIC_CUBES } from "../reports/semantik/katalog";
import { producedRollsSql } from "../reports/_produced";
import { shippedPartsSql } from "../reports/_shipped";
import type { DateRange } from "../reports/_shared";
import { getOrderIntake } from "../reports/order-intake.report.service";
import { getSubcontractScorecard } from "../reports/subcontract-scorecard.report.service";
import { getStockScorecard } from "../reports/stock-scorecard.report.service";
import { getAgingReport } from "../reports/finance-aging.report";
import { InventoryService } from "../inventory.service";
import { yarnService } from "../yarn.service";
import { getLoomFloor } from "../loom-floor.service";
import { buildDeliveryNoteBaseWhere, deliveryNoteStatusSummary } from "../gelen-belge-note.service";
import { buildShipmentListSummary } from "../shipping/list";
import { WO_STATE_WHERE } from "../order/list";
import { DEADLINE_OPEN_ORDER_STATUSES } from "../helpers/order-deadline.helper";
import { movementGates } from "./pano-hareketler.service";
import { bucketKeySql, type PanoKova, type PanoPencere } from "./pano-donem";

/** "En çok" listeleri ve halka dilimi sayısı. */
export const PANO_TOP_N = 5;

export interface PanoKullanici {
  userId: string;
  permissions: readonly string[];
}

// ── kapılar ──────────────────────────────────────────────────────────────────

/** Semantik küp + ölçünün izin ve modülü — panonun sayısı ile rapor/analizin sayısı aynı kapıdan. */
function measureGate(ctx: AccessContext, cubeId: string, measureId: string): boolean {
  const cube = SEMANTIC_CUBES.find((c) => c.id === cubeId);
  const measure = cube?.measures.find((m) => m.id === measureId);
  return Boolean(cube && measure && canAccess(cube, ctx) && canAccess(measure, ctx));
}

function gate(ctx: AccessContext, permission: string, ...modules: string[]): boolean {
  return matchesPermission(ctx.permissions, permission) && modules.every((m) => isModuleOpen(m, ctx));
}

/** Kutu kapılarının izin kodları — tek tablo (izin kataloğu bekçisi bu sabiti okur). */
const GATE_PERMISSIONS = {
  iplik: "warehouse:read",
  fasonOzeti: "roll:read",
  emanet: "report:inventory",
  tezgah: "loom:live-view",
  gelenBelge: "gelen-belge:read",
  sevkeHazir: "shipping:read",
  uretimeBekleyen: "order:read",
  finans: "finance:read",
  nakit: "report:finance",
  isEmri: "workorder:read",
  alis: "purchase-order:read",
  dokumaIsi: "weavingorder:read",
} as const;

export function panoGates(ctx: AccessContext) {
  return {
    uretim: measureGate(ctx, "uretim", "kalite.bitenMetre"),
    sevk: measureGate(ctx, "sevk", "sevk.brutMetre"),
    sevkTutar: measureGate(ctx, "sevk", "sevk.tutar"),
    siparis: measureGate(ctx, "siparis", "siparis.metre"),
    fason: measureGate(ctx, "fason", "fason.gonderilenMetre"),
    stok: measureGate(ctx, "stok", "stok.bitmisMetre"),
    istasyon: measureGate(ctx, "istasyon", "uretim.gecenMetre"),
    iplik: gate(ctx, GATE_PERMISSIONS.iplik, "ticaretEnabled", "iplikEnabled"),
    fasonOzeti: gate(ctx, GATE_PERMISSIONS.fasonOzeti),
    emanet: gate(ctx, GATE_PERMISSIONS.emanet, "emanetEnabled"),
    tezgah: gate(ctx, GATE_PERMISSIONS.tezgah, "tezgahEnabled"),
    gelenBelge: gate(ctx, GATE_PERMISSIONS.gelenBelge, "gelenBelgeEnabled"),
    sevkeHazir: gate(ctx, GATE_PERMISSIONS.sevkeHazir),
    uretimeBekleyen: gate(ctx, GATE_PERMISSIONS.uretimeBekleyen, "productionEnabled"),
    finans: gate(ctx, GATE_PERMISSIONS.finans, "financeEnabled"),
    // Kasa/banka hareketi Kasa-Banka Defteri'nin kapısıyla (rapor izni + finans modülü).
    nakit: gate(ctx, GATE_PERMISSIONS.nakit, "financeEnabled"),
    isEmri: gate(ctx, GATE_PERMISSIONS.isEmri),
    alis: gate(ctx, GATE_PERMISSIONS.alis, "ticaretEnabled"),
    dokumaIsi: gate(ctx, GATE_PERMISSIONS.dokumaIsi, "dokumaEnabled"),
    hareket: Object.values(movementGates(ctx)).some(Boolean),
  };
}
export type PanoGates = ReturnType<typeof panoGates>;

// ── toplayıcılar (tek kaynak SQL gövdelerinin üstünde yalnız gruplama) ──────

interface TotalRow { qty: number | null; cnt: bigint | null; docs?: bigint | null }
export interface BucketRow { k: string; qty: number | null }
export interface ItemRow { itemId: string | null; code: string | null; name: string | null; qty: number | null }
export interface CustomerRow { customerId: string; name: string | null; qty: number | null }

async function producedTotal(range: DateRange): Promise<{ qty: number; rolls: number }> {
  const [r] = await prisma.$queryRaw<TotalRow[]>`SELECT SUM(p.qty)::float AS qty, COUNT(*) AS cnt FROM ${producedRollsSql(range)}`;
  return { qty: Number(r?.qty ?? 0), rolls: Number(r?.cnt ?? 0) };
}

function producedByBucket(range: DateRange, kova: PanoKova): Promise<BucketRow[]> {
  return prisma.$queryRaw<BucketRow[]>`SELECT ${bucketKeySql(kova, "p.at")} AS k, SUM(p.qty)::float AS qty FROM ${producedRollsSql(range)} GROUP BY 1`;
}

function producedByItem(range: DateRange): Promise<ItemRow[]> {
  return prisma.$queryRaw<ItemRow[]>`
    SELECT p."itemId" AS "itemId", i.code AS code, i.name AS name, SUM(p.qty)::float AS qty
    FROM ${producedRollsSql(range)} LEFT JOIN items i ON i.id = p."itemId"
    GROUP BY p."itemId", i.code, i.name ORDER BY qty DESC NULLS LAST, i.code ASC`;
}

async function shippedTotal(range: DateRange): Promise<{ qty: number; docs: number }> {
  const [r] = await prisma.$queryRaw<TotalRow[]>(Prisma.sql`
    WITH parts AS (${shippedPartsSql(range)})
    SELECT SUM(qty)::float AS qty, SUM(cnt) AS cnt, COUNT(DISTINCT sid) AS docs FROM parts`);
  return { qty: Number(r?.qty ?? 0), docs: Number(r?.docs ?? 0) };
}

function shippedByBucket(range: DateRange, kova: PanoKova): Promise<BucketRow[]> {
  return prisma.$queryRaw<BucketRow[]>(Prisma.sql`
    WITH parts AS (${shippedPartsSql(range)})
    SELECT ${bucketKeySql(kova, "p.at")} AS k, SUM(p.qty)::float AS qty FROM parts p GROUP BY 1`);
}

function shippedByItem(range: DateRange): Promise<ItemRow[]> {
  return prisma.$queryRaw<ItemRow[]>(Prisma.sql`
    WITH parts AS (${shippedPartsSql(range)})
    SELECT p."itemId" AS "itemId", i.code AS code, i.name AS name, SUM(p.qty)::float AS qty
    FROM parts p JOIN items i ON i.id = p."itemId"
    GROUP BY p."itemId", i.code, i.name ORDER BY qty DESC NULLS LAST, i.code ASC
    LIMIT ${PANO_TOP_N}`);
}

/** Brüt sevkin müşteri kırılımı (ilk N) — aynı `_shipped` gövdesi. */
function shippedByCustomer(range: DateRange): Promise<CustomerRow[]> {
  return prisma.$queryRaw<CustomerRow[]>(Prisma.sql`
    WITH parts AS (${shippedPartsSql(range)})
    SELECT p."customerId" AS "customerId", c.name AS name, SUM(p.qty)::float AS qty
    FROM parts p JOIN customers c ON c.id = p."customerId"
    GROUP BY p."customerId", c.name HAVING SUM(p.qty) > 0 ORDER BY qty DESC, c.name ASC
    LIMIT ${PANO_TOP_N}`);
}

// ── istek başına bellekli kaynaklar ─────────────────────────────────────────

type Loaded<F extends (...a: never[]) => unknown> = Awaited<ReturnType<F>>;

export class PanoSources {
  private readonly memo = new Map<string, Promise<unknown>>();

  constructor(readonly window: PanoPencere, readonly now: Date) {}

  /** Aynı anahtar aynı istekte bir kez yüklenir; tüm kutular aynı sözü bekler. */
  once<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.memo.get(key) as Promise<T> | undefined;
    if (hit) return hit;
    const fresh = load();
    this.memo.set(key, fresh);
    return fresh;
  }

  producedCur = () => this.once("producedCur", () => producedTotal(this.window.aralik));
  producedPrev = () => this.once("producedPrev", () => producedTotal(this.window.oncekiAralik));
  producedBuckets = () => this.once("producedBuckets", () => producedByBucket(this.window.aralik, this.window.kova));
  producedItems = () => this.once("producedItems", () => producedByItem(this.window.aralik));
  shippedCur = () => this.once("shippedCur", () => shippedTotal(this.window.aralik));
  shippedPrev = () => this.once("shippedPrev", () => shippedTotal(this.window.oncekiAralik));
  shippedBuckets = () => this.once("shippedBuckets", () => shippedByBucket(this.window.aralik, this.window.kova));
  shippedItems = () => this.once("shippedItems", () => shippedByItem(this.window.aralik));
  shippedCustomers = () => this.once("shippedCustomers", () => shippedByCustomer(this.window.aralik));
  intake = () => this.once("intake", () => getOrderIntake(this.window.aralik, this.window.oncekiAralik));
  subcontract = () => this.once("subcontract", () => getSubcontractScorecard(this.window.aralik, this.window.oncekiAralik));
  stock = () => this.once("stock", () => getStockScorecard());
  yarn = () => this.once("yarn", () => yarnService.listStocks({ pageSize: 1 }));
  outside = () => this.once("outside", () => new InventoryService().getRollSubcontractorSummary());
  floor = () => this.once("floor", () => getLoomFloor(this.now));
  notes = () => this.once("notes", () => deliveryNoteStatusSummary(buildDeliveryNoteBaseWhere({})));
  planned = () => this.once("planned", () => buildShipmentListSummary({ status: ShipmentStatus.PLANNED }, null));
  noWorkOrder = () => this.once("noWorkOrder", () =>
    prisma.order.count({ where: { AND: [{ status: { in: [...DEADLINE_OPEN_ORDER_STATUSES] } }, WO_STATE_WHERE.NONE as Prisma.OrderWhereInput] } }));
  aging = () => this.once("aging", () => getAgingReport({ asOf: this.now }));
}

export type StockData = Loaded<typeof getStockScorecard>;
export type FloorData = Loaded<typeof getLoomFloor>;
