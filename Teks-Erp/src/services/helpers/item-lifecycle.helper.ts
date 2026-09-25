// =============================================================================
// ÜRÜN KARTI YAŞAM DÖNGÜSÜ — tek yazar + canlı referans (D1) tek kaynağı
// =============================================================================
// Tasarım: docs/design/URUN-YASAM-DONGUSU.md §3, §5, §7.
//
// D1 — Pasif (ARCHIVED) kartta canlı referans OLAMAZ. "Canlı referans" tanımı
// burada yaşar (`ITEM_LIVE_REF_KINDS` + `liveRefWhere`); SQL ikizi migration
// `20260925100000_urun_yasam_dongusu`un D1 bloğudur ve iki tanımın aynı kartları
// saydığı `scripts/test_item_lifecycle_migration.ts` ile ölçülür.
//
// D2 — Durumu TEK yazar değiştirir: `transitionItemLifecycleTx` (+ birleştirmenin
// kullandığı `itemLifecycleWriteData`, `item-lifecycle-data.helper.ts`). `isActive` hiçbir yoldan ayrıca yazılmaz;
// DB CHECK `items_lifecycle_isactive_ck` ikisini birbirine bağlar.
//
// KİLİT SIRASI (her yolda aynı): 8030 SHARED (birleştirme ile serileşme) → kart
// satırı. Yazıcı kart satırını FOR UPDATE, referans doğuran yollar FOR SHARE alır
// (`item-usage.helper` → `assertItemUsableTx`) ⇒ sayım ile yazım arasında doğan referans görünür.
// =============================================================================
import { ItemLifecycleStatus, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { lockAgainstMergeTx } from "./master-data-live.helper";
import { itemLifecycleWriteData } from "./item-lifecycle-data.helper";
import { lowerTr } from "../../utils/tr-case";
import {
  DEAD_ROLL_STATUSES,
  LIVE_ROLL,
  OPEN_MACHINE_RUN,
  OPEN_PURCHASE_ORDER,
  OPEN_WEAVING_ORDER,
  OPEN_WORK_ORDER,
  openDemandLineWhere,
} from "./live-ref-where.helper";
import { AuditService } from "../audit.service";

export { ITEM_LIFECYCLE_LABEL, itemLifecycleWriteData } from "./item-lifecycle-data.helper";

type Db = Prisma.TransactionClient | typeof prisma;

/** Topun canlı OLMADIĞI statüler — ortak tanım `live-ref-where.helper` (geriye uyum adı). */
export const ITEM_DEAD_ROLL_STATUSES = DEAD_ROLL_STATUSES;

export type ItemLiveRefKind =
  | "ROLL" | "WORK_ORDER" | "ORDER_LINE" | "PURCHASE_ORDER_LINE"
  | "WEAVING_ORDER" | "MACHINE_RUN" | "FASON_YARN_DISPATCH" | "YARN_STOCK";

export const ITEM_LIVE_REF_KINDS: ReadonlyArray<{ kind: ItemLiveRefKind; label: string }> = [
  { kind: "ROLL", label: "Canlı top" },
  { kind: "WORK_ORDER", label: "Açık iş emri" },
  { kind: "ORDER_LINE", label: "Açık sipariş kalemi" },
  { kind: "PURCHASE_ORDER_LINE", label: "Açık alış siparişi kalemi" },
  { kind: "WEAVING_ORDER", label: "Açık dokuma işi" },
  { kind: "MACHINE_RUN", label: "Açık tezgah koşumu" },
  { kind: "FASON_YARN_DISPATCH", label: "Açık fason iplik sevki" },
  { kind: "YARN_STOCK", label: "İplik bakiyesi" },
];

interface LiveRefWhere {
  ROLL: Prisma.RollWhereInput;
  WORK_ORDER: Prisma.WorkOrderWhereInput;
  ORDER_LINE: Prisma.OrderLineWhereInput;
  PURCHASE_ORDER_LINE: Prisma.PurchaseOrderLineWhereInput;
  WEAVING_ORDER: Prisma.WeavingOrderWhereInput;
  MACHINE_RUN: Prisma.MachineRunWhereInput;
  FASON_YARN_DISPATCH: Prisma.SubcontractorDispatchItemWhereInput;
  YARN_STOCK: Prisma.YarnStockWhereInput;
}

/** Her türün Prisma yüklemi — migration D1 bloğunun birebir ikizi. */
function liveRefWhere(itemId: string, db: Db): LiveRefWhere {
  return {
    ROLL: { itemId, ...LIVE_ROLL },
    WORK_ORDER: { targetItemId: itemId, ...OPEN_WORK_ORDER },
    ORDER_LINE: { itemId, ...openDemandLineWhere(db) },
    PURCHASE_ORDER_LINE: {
      itemId,
      purchaseOrder: OPEN_PURCHASE_ORDER,
      qty: { gt: db.purchaseOrderLine.fields.receivedQty },
    },
    WEAVING_ORDER: { itemId, ...OPEN_WEAVING_ORDER },
    MACHINE_RUN: { itemId, ...OPEN_MACHINE_RUN },
    // Rollsuz iplik kalemi `OUTSTANDING_ITEM`le eşleşmez (roll ilişki süzgeci) — dar
    // tanım bilerek fazla sayar: arşivi yalnız fazladan reddeder (fail-closed, 1e 2026-09-25).
    FASON_YARN_DISPATCH: {
      yarnItemId: itemId,
      remainderClosedAt: null,
      dispatch: { cancelledAt: null, directShippedAt: null },
    },
    YARN_STOCK: { itemId, balanceKg: { not: 0 } },
  };
}

export interface ItemLiveRefCount { kind: ItemLiveRefKind; label: string; count: number }

/** Türe göre canlı referans sayıları (0 olanlar DAHİL — önizleme hepsini gösterir). */
export async function countItemLiveRefs(db: Db, itemId: string): Promise<ItemLiveRefCount[]> {
  const w = liveRefWhere(itemId, db);
  // Sıralı: tx istemcisinde Promise.all yasak (kök kural).
  const counts: Record<ItemLiveRefKind, number> = {
    ROLL: await db.roll.count({ where: w.ROLL }),
    WORK_ORDER: await db.workOrder.count({ where: w.WORK_ORDER }),
    ORDER_LINE: await db.orderLine.count({ where: w.ORDER_LINE }),
    PURCHASE_ORDER_LINE: await db.purchaseOrderLine.count({ where: w.PURCHASE_ORDER_LINE }),
    WEAVING_ORDER: await db.weavingOrder.count({ where: w.WEAVING_ORDER }),
    MACHINE_RUN: await db.machineRun.count({ where: w.MACHINE_RUN }),
    FASON_YARN_DISPATCH: await db.subcontractorDispatchItem.count({ where: w.FASON_YARN_DISPATCH }),
    YARN_STOCK: await db.yarnStock.count({ where: w.YARN_STOCK }),
  };
  return ITEM_LIVE_REF_KINDS.map(({ kind, label }) => ({ kind, label, count: counts[kind] }));
}

export const totalLiveRefs = (c: ItemLiveRefCount[]): number => c.reduce((s, x) => s + x.count, 0);

/** Önizlemede tür başına gösterilen üst sınır; toplam sayı ayrıca döner. */
export const LIVE_REF_LIST_LIMIT = 500;

export interface ItemLiveRefRecord { id: string; title: string; detail: string }

/** Canlı referansları TEK TEK listeler (yıkıcı işlem kuralı: soyut sayı yetmez). */
export async function listItemLiveRefs(
  db: Db,
  itemId: string,
): Promise<Array<ItemLiveRefCount & { records: ItemLiveRefRecord[] }>> {
  const w = liveRefWhere(itemId, db);
  const take = LIVE_REF_LIST_LIMIT;
  const counts = await countItemLiveRefs(db, itemId);
  const rec: Record<ItemLiveRefKind, ItemLiveRefRecord[]> = {
    ROLL: (await db.roll.findMany({
      where: w.ROLL, take, orderBy: { barcode: "asc" },
      select: { id: true, barcode: true, status: true, currentQty: true, warehouse: { select: { name: true } } },
    })).map((r) => ({
      id: r.id, title: r.barcode ?? r.id,
      detail: `${r.status} · ${r.currentQty.toString()} m${r.warehouse ? ` · ${r.warehouse.name}` : ""}`,
    })),
    WORK_ORDER: (await db.workOrder.findMany({
      where: w.WORK_ORDER, take, orderBy: { createdAt: "asc" }, select: { id: true, workOrderNumber: true, status: true },
    })).map((x) => ({ id: x.id, title: x.workOrderNumber, detail: x.status })),
    ORDER_LINE: (await db.orderLine.findMany({
      where: w.ORDER_LINE, take, orderBy: { createdAt: "asc" },
      select: { id: true, quantity: true, shippedQty: true, unit: true, order: { select: { orderNumber: true, customer: { select: { name: true } } } } },
    })).map((l) => ({
      id: l.id, title: l.order.orderNumber,
      detail: `${l.order.customer?.name ?? "—"} · kalan ${l.quantity.minus(l.shippedQty).toString()} ${l.unit}`,
    })),
    PURCHASE_ORDER_LINE: (await db.purchaseOrderLine.findMany({
      where: w.PURCHASE_ORDER_LINE, take, orderBy: { createdAt: "asc" },
      select: { id: true, qty: true, receivedQty: true, purchaseOrder: { select: { orderNo: true } } },
    })).map((l) => ({ id: l.id, title: l.purchaseOrder.orderNo, detail: `kalan ${l.qty.minus(l.receivedQty).toString()}` })),
    WEAVING_ORDER: (await db.weavingOrder.findMany({
      where: w.WEAVING_ORDER, take, orderBy: { createdAt: "asc" }, select: { id: true, weavingOrderNumber: true, status: true },
    })).map((x) => ({ id: x.id, title: x.weavingOrderNumber, detail: x.status })),
    MACHINE_RUN: (await db.machineRun.findMany({
      where: w.MACHINE_RUN, take, orderBy: { startedAt: "asc" },
      select: { id: true, startedAt: true, machine: { select: { name: true } } },
    })).map((x) => ({ id: x.id, title: x.machine.name, detail: `başladı ${x.startedAt.toISOString()}` })),
    FASON_YARN_DISPATCH: (await db.subcontractorDispatchItem.findMany({
      where: w.FASON_YARN_DISPATCH, take, orderBy: { createdAt: "asc" },
      select: { id: true, dispatchedQty: true, dispatch: { select: { dispatchNo: true, dispatchedAt: true } } },
    })).map((x) => ({
      id: x.id, title: x.dispatch.dispatchNo,
      detail: `${x.dispatch.dispatchedAt.toISOString()} · ${x.dispatchedQty.toString()} kg`,
    })),
    YARN_STOCK: (await db.yarnStock.findMany({
      where: w.YARN_STOCK, take, select: { id: true, balanceKg: true, warehouse: { select: { name: true } } },
    })).map((x) => ({ id: x.id, title: x.warehouse.name, detail: `${x.balanceKg.toString()} kg` })),
  };
  return counts.map((c) => ({ ...c, records: rec[c.kind] }));
}

export interface ItemLifecycleTransitionResult {
  itemId: string;
  from: ItemLifecycleStatus;
  to: ItemLifecycleStatus;
  idempotent: boolean;
  name: string;
}

/**
 * TEK YAZAR. Kilit: 8030 SHARED (ilk ifade) → kart FOR UPDATE. Arşivde D1 ihlali 409
 * `ITEM_HAS_LIVE_REFERENCES` (+ `details.references`, önizlemeyle aynı biçim). Hedef
 * durumdaki karta ikinci istek yazmadan döner (`idempotent:true`).
 */
export async function transitionItemLifecycleTx(
  tx: Prisma.TransactionClient,
  input: { itemId: string; to: ItemLifecycleStatus; reason?: string | null; userId?: string | null },
): Promise<ItemLifecycleTransitionResult> {
  await lockAgainstMergeTx(tx);
  const rows = await tx.$queryRaw<Array<{ name: string; status: ItemLifecycleStatus; mergedIntoId: string | null }>>`
    SELECT "name", "lifecycleStatus" AS status, "mergedIntoId" FROM "items" WHERE id = ${input.itemId}::uuid FOR UPDATE`;
  const cur = rows[0];
  if (!cur) throw AppError.notFound("Ürün bulunamadı");
  const base = { itemId: input.itemId, from: cur.status, to: input.to, name: cur.name };
  if (cur.status === input.to) return { ...base, idempotent: true };
  if (cur.mergedIntoId) {
    throw AppError.badRequest(
      "Bu kayıt başka bir kayda birleştirildi ve yeniden aktifleştirilemez. " +
        "Aynı ada gerçekten yeni bir kayıt gerekiyorsa yenisini oluşturun.",
      { code: "ITEM_MERGED" },
    );
  }
  if (input.to === ItemLifecycleStatus.ARCHIVED) {
    const counts = await countItemLiveRefs(tx, input.itemId);
    if (totalLiveRefs(counts) > 0) {
      const references = await listItemLiveRefs(tx, input.itemId);
      const summary = counts.filter((c) => c.count > 0).map((c) => `${c.count} ${lowerTr(c.label)}`).join(", ");
      throw AppError.conflict(
        `"${cur.name}" pasife alınamaz: üstünde canlı kayıt var (${summary}). ` +
          "Mal akmaya devam etsin istiyorsanız 'Tükenene kadar' seçin; kart başka bir kartın kopyasıysa Birleştir'i kullanın.",
        { code: "ITEM_HAS_LIVE_REFERENCES", references },
      );
    }
  }
  const claim = await tx.item.updateMany({
    where: { id: input.itemId, lifecycleStatus: cur.status },
    data: itemLifecycleWriteData(input.to, input.userId, input.reason?.trim() || null),
  });
  if (claim.count === 0) {
    const fresh = await tx.item.findUnique({ where: { id: input.itemId }, select: { lifecycleStatus: true } });
    if (fresh?.lifecycleStatus === input.to) return { ...base, idempotent: true };
    throw AppError.conflict("Kartın durumu bu sırada değişti — tekrar deneyin.", { code: "ITEM_LIFECYCLE_CHANGED" });
  }
  return { ...base, idempotent: false };
}

/**
 * Geçiş + audit — tek yazarın tam yolu. Audit tx DIŞINDA ve best-effort (kök kural);
 * hedef-durum idempotent tekrar audit yazmaz.
 */
export async function transitionItemLifecycle(
  input: { itemId: string; to: ItemLifecycleStatus; reason?: string | null; userId?: string | null },
): Promise<ItemLifecycleTransitionResult> {
  const result = await prisma.$transaction((tx) => transitionItemLifecycleTx(tx, input));
  if (!result.idempotent) {
    await AuditService.log({
      userId: input.userId ?? undefined,
      action: "UPDATE",
      tableName: "ITEM",
      recordId: input.itemId,
      oldData: { lifecycleStatus: result.from },
      newData: {
        lifecycleStatus: result.to,
        isActive: result.to !== ItemLifecycleStatus.ARCHIVED,
        ...(input.reason ? { lifecycleReason: input.reason } : {}),
      },
    });
  }
  return result;
}
