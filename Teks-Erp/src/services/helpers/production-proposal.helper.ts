// =============================================================================
// ÜRETİM ÖNERİSİ — "Bu sipariş için ne yaratılmalı?" (TEK KAYNAK; SY-M1, tasarım §14.5)
// =============================================================================
// Önizleme ve uygula AYNI fonksiyonu koşar; uygula onu satır kilitlerinin ARKASINDA yeniden koşar
// (önizlemeye güvenilmez). Dokuma işi grubu = (ürün, varyant); iş emri grubu = (ürün, renk, en) —
// toplu "Siparişten İş Emri" eylemiyle aynı kural. Zaten bağlı satır gruptan düşer, uyarıyla listelenir.
// Ham ihtiyaç = açık metre ÷ (1 − boy çekmesi); çekme varyant → ürün yapısı terbiye tarifesinden (öneri, düzenlenebilir).
// =============================================================================

import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { resolveEffectiveConstruction } from "./effective-construction.helper";
import { ACTIVE_FINISHING_RATE } from "./cost-price-validity.helper";
import { ACTIVE_ORDER_LINK } from "./order-link.helper";
import { resolveFinishingRateCode } from "./finishing-rate-code.helper";

type Db = Prisma.TransactionClient | typeof prisma;

/** Öneri üretilebilen sipariş durumları (toplu "Siparişten İş Emri" eylemiyle aynı). */
export const PROPOSAL_ORDER_STATUSES = ["APPROVED", "PARTIAL_SHIPPED"] as const;

export const PROPOSAL_CODES = {
  alreadyPlanned: "ORDER_LINE_ALREADY_PLANNED",
  lineClosed: "ORDER_LINE_CLOSED",
  notWoven: "ITEM_NOT_WOVEN",
  routeMissing: "ROUTE_MISSING",
} as const;

export interface ProposalScope {
  /** Dokuma işi bölümü (üretim ∧ dokuma modülü ∧ okuma izni). */
  weaving: boolean;
  /** İş emri bölümü (üretim modülü). */
  workOrder: boolean;
}

export interface WeavingProposal {
  key: string;
  itemId: string;
  itemName: string;
  recipeId: string | null;
  warpSpecId: string | null;
  weftSpecId: string | null;
  weaveDesignId: string | null;
  shrinkPct: number | null;
  /** Önerilen plan metresi (ham ihtiyaç toplamı); ölçülmeyen birimde null. */
  plannedM: number | null;
  orderLines: Array<{ orderLineId: string; openM: number | null; allocatedM: number | null }>;
}

export interface WorkOrderProposal {
  key: string;
  itemId: string;
  itemName: string;
  colorId: string | null;
  width: number | null;
  routeId: string | null;
  foldType: string | null;
  targetQuantity: number | null;
  orderLines: Array<{ orderLineId: string; allocatedQty: number }>;
  /** Yaratılamazsa nedeni (`ROUTE_MISSING`); null = seçilebilir. */
  blockedCode: string | null;
}

export interface ProductionProposal {
  orderId: string;
  orderNumber: string;
  weavingOrders: WeavingProposal[];
  workOrders: WorkOrderProposal[];
  excluded: Array<{ orderLineId: string; kind: "WEAVING" | "WORK_ORDER" | "LINE"; code: string }>;
}

/** "Satır zaten planlanmış mı" — canlı dokuma işi bağı (iptal dışı her durum). */
export const LIVE_WEAVING_ORDER_LINK = { weavingOrder: { status: { not: "CANCELLED" } } } satisfies Prisma.WeavingOrderToOrderLineWhereInput;
/** "Satır zaten planlanmış mı" — canlı iş emri bağı (aktif, iptal/yerine-geçilmiş dışı). */
export const LIVE_WORK_ORDER_LINK = {
  ...ACTIVE_ORDER_LINK, workOrder: { isActive: true, status: { notIn: ["CANCELLED", "SUPERSEDED"] } },
} satisfies Prisma.WorkOrderToOrderLineWhereInput;

const LINE_SELECT = {
  id: true, itemId: true, colorId: true, width: true, quantity: true, shippedQty: true, unit: true, recipeId: true,
  item: { select: { name: true, costStructure: { select: { finishingRateCode: true } } } },
  recipe: { select: { routeId: true, foldType: true, finishingRateCode: true } },
  weavingOrderLinks: { where: LIVE_WEAVING_ORDER_LINK, select: { id: true }, take: 1 },
  workOrderLinks: { where: LIVE_WORK_ORDER_LINK, select: { id: true }, take: 1 },
} satisfies Prisma.OrderLineSelect;
type LineRow = Prisma.OrderLineGetPayload<{ select: typeof LINE_SELECT }>;

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Sevk edilmemiş metre — yalnız MT satırda ölçülür (KG/ADET → null, toplu eylemle aynı). */
function openMeters(l: LineRow): number | null {
  if (l.unit !== "MT") return null;
  return Math.max(0, round3(Number(l.quantity) - Number(l.shippedQty)));
}

export function weavingKey(itemId: string, recipeId: string | null): string {
  return `W:${itemId}:${recipeId ?? "-"}`;
}

export function workOrderKey(itemId: string, colorId: string | null, width: number | null): string {
  return `I:${itemId}:${colorId ?? "-"}:${width ?? "-"}`;
}

async function shrinkPctOf(db: Db, code: string | null | undefined, memo: Map<string, number | null>): Promise<number | null> {
  if (!code) return null;
  if (!memo.has(code)) {
    const rate = await db.finishingRate.findFirst({ where: { code, ...ACTIVE_FINISHING_RATE }, select: { typicalShrinkPct: true } });
    memo.set(code, rate?.typicalShrinkPct == null ? null : Number(rate.typicalShrinkPct));
  }
  return memo.get(code) ?? null;
}

/** Ham ihtiyaç: açık metre ÷ (1 − çekme%); çekme yoksa/geçersizse açık metre. */
export function rawNeedMeters(openM: number | null, shrinkPct: number | null): number | null {
  if (openM == null) return null;
  if (shrinkPct == null || shrinkPct <= 0 || shrinkPct >= 100) return openM;
  return round3(openM / (1 - shrinkPct / 100));
}

async function buildWeavingGroups(db: Db, lines: LineRow[], out: ProductionProposal): Promise<void> {
  const groups = new Map<string, WeavingProposal>();
  const shrinkMemo = new Map<string, number | null>();
  for (const l of lines) {
    if (l.weavingOrderLinks.length > 0) {
      out.excluded.push({ orderLineId: l.id, kind: "WEAVING", code: PROPOSAL_CODES.alreadyPlanned });
      continue;
    }
    const key = weavingKey(l.itemId, l.recipeId);
    let g = groups.get(key);
    if (!g) {
      // Grup başına TEK etkin yapı çözümü (§14.9-3); ikinci yapı okuması yazılmaz.
      const c = await resolveEffectiveConstruction(db, l.itemId, l.recipeId);
      if (!c.groundWarp && !c.weft) {
        out.excluded.push({ orderLineId: l.id, kind: "WEAVING", code: PROPOSAL_CODES.notWoven });
        continue;
      }
      g = {
        key, itemId: l.itemId, itemName: l.item.name, recipeId: l.recipeId,
        warpSpecId: c.groundWarp?.id ?? null, weftSpecId: c.weft?.weftSpecId ?? null, weaveDesignId: c.weaveDesign?.id ?? null,
        shrinkPct: await shrinkPctOf(db, resolveFinishingRateCode(l.recipe?.finishingRateCode, l.item.costStructure?.finishingRateCode), shrinkMemo), plannedM: null, orderLines: [],
      };
      groups.set(key, g);
    }
    const openM = openMeters(l);
    g.orderLines.push({ orderLineId: l.id, openM, allocatedM: rawNeedMeters(openM, g.shrinkPct) });
  }
  for (const g of groups.values()) {
    const measured = g.orderLines.map((x) => x.allocatedM);
    g.plannedM = measured.every((m) => m != null) ? round3(measured.reduce<number>((s, m) => s + (m ?? 0), 0)) : null;
    if (g.plannedM === 0) g.plannedM = null;
    out.weavingOrders.push(g);
  }
}

function buildWorkOrderGroups(lines: LineRow[], out: ProductionProposal): void {
  const groups = new Map<string, WorkOrderProposal & { routeIds: Set<string | null>; foldTypes: Set<string | null> }>();
  for (const l of lines) {
    if (l.workOrderLinks.length > 0) {
      out.excluded.push({ orderLineId: l.id, kind: "WORK_ORDER", code: PROPOSAL_CODES.alreadyPlanned });
      continue;
    }
    const width = l.width == null ? null : Number(l.width);
    const key = workOrderKey(l.itemId, l.colorId, width);
    let g = groups.get(key);
    if (!g) {
      g = {
        key, itemId: l.itemId, itemName: l.item.name, colorId: l.colorId, width, routeId: null,
        foldType: null, targetQuantity: 0, orderLines: [], blockedCode: null, routeIds: new Set(), foldTypes: new Set(),
      };
      groups.set(key, g);
    }
    const openM = openMeters(l);
    g.routeIds.add(l.recipe?.routeId ?? null);
    g.foldTypes.add(l.recipe?.foldType ?? null);
    g.orderLines.push({ orderLineId: l.id, allocatedQty: openM ?? 0 });
    g.targetQuantity = openM == null || g.targetQuantity == null ? null : round3(g.targetQuantity + openM);
  }
  for (const { routeIds, foldTypes, ...g } of groups.values()) {
    // Rota varyanttan; satırlar tek rotada birleşmiyorsa öneri rota uydurmaz → seçilemez (formdan açılır).
    const only = routeIds.size === 1 ? [...routeIds][0] : null;
    // Kat tipi de uydurulmaz: varyantlar ayrışırsa boş kalır (formda/iş emrinde seçilir).
    const fold = foldTypes.size === 1 ? [...foldTypes][0] : null;
    out.workOrders.push({ ...g, foldType: fold ?? null, routeId: only ?? null, blockedCode: only ? null : PROPOSAL_CODES.routeMissing, targetQuantity: g.targetQuantity || null });
  }
}

/**
 * Siparişin üretim önerisi. Sipariş yoksa 404; onaylı/kısmi sevk değilse 409 `ORDER_NOT_PRODUCIBLE`.
 * Satırlar id sırasıyla okunur (uygula yolu aynı sırayla kilitler).
 */
export async function buildProductionProposal(db: Db, orderId: string, scope: ProposalScope): Promise<ProductionProposal> {
  const order = await db.order.findUnique({ where: { id: orderId }, select: { id: true, orderNumber: true, status: true } });
  if (!order) throw AppError.notFound("Sipariş bulunamadı");
  if (!(PROPOSAL_ORDER_STATUSES as readonly string[]).includes(order.status)) {
    throw AppError.conflict("Üretim önerisi yalnız onaylı ya da kısmi sevk edilmiş siparişte açılır.", { code: "ORDER_NOT_PRODUCIBLE", status: order.status });
  }
  const rows = await db.orderLine.findMany({ where: { orderId, cancelledAt: null }, select: LINE_SELECT, orderBy: { id: "asc" } });
  const out: ProductionProposal = { orderId: order.id, orderNumber: order.orderNumber, weavingOrders: [], workOrders: [], excluded: [] };
  const open: LineRow[] = [];
  for (const r of rows) {
    const m = openMeters(r);
    if (m === 0) out.excluded.push({ orderLineId: r.id, kind: "LINE", code: PROPOSAL_CODES.lineClosed });
    else open.push(r);
  }
  if (scope.weaving) await buildWeavingGroups(db, open, out);
  if (scope.workOrder) buildWorkOrderGroups(open, out);
  return out;
}
