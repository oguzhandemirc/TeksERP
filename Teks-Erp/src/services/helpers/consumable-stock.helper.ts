// =============================================================================
// SARF STOK DEFTERİ — tek yazar (kuşak / kurşun şeridi; `consumable_movements`)
// =============================================================================
// Ayar `consumable.stockEnabled` (ticaret && bayrak) KAPALIYKEN ileri satır yazılmaz (bugünkü davranış).
// Ters kayıt ayardan BAĞIMSIZ yazılır: açıkken düşülmüş tüketim, ayar sonra kapansa da geri alınınca geri gelir.
// Miktar formülü YAZILMAZ, tek kaynaklardan gelir: kurşun = işlenen metre × geçerli sarf normu
// (`consumableNormsValidAt`, hizmet kalemi `pickServiceItemId`), kuşak = `expectedRolls` (kuşak ihtiyacı raporu).
// Eksi bakiye ENGELLEMEZ; uyarı döner.
// =============================================================================
import { ConsumableMovementKind, Prisma, RollOperationType } from "@prisma/client";
import { resolveConsumableStockEnabled } from "../system-setting.service";
import { consumableNormsValidAt } from "./cost-rate-validity.helper";
import { pickServiceItemId } from "./service-item-pick.helper";
import { ACTIVE_ORDER_LINK } from "./order-link.helper";
import { expectedRolls } from "./expected-rolls.helper";
import { TERIM } from "../../constants/terim";

type Tx = Prisma.TransactionClient;
type Reader = Pick<Prisma.TransactionClient, "consumableMovement">;

const IN_KINDS: ReadonlySet<ConsumableMovementKind> = new Set([
  ConsumableMovementKind.RECEIPT_IN,
  ConsumableMovementKind.CONSUMPTION_REVERSAL_IN,
]);

/** Hareketin bakiyeye işareti: giriş +1, çıkış −1. */
export function consumableMovementSign(kind: ConsumableMovementKind): 1 | -1 {
  return IN_KINDS.has(kind) ? 1 : -1;
}

/** Kalem başına bakiye (Σ işaret × qty). Hareketi olmayan kalem haritada YOKTUR (sıfır sayılır). */
export async function consumableBalances(db: Reader, itemIds?: string[]): Promise<Map<string, Prisma.Decimal>> {
  if (itemIds && itemIds.length === 0) return new Map();
  const rows = await db.consumableMovement.groupBy({
    by: ["itemId", "kind"],
    where: itemIds ? { itemId: { in: itemIds } } : {},
    _sum: { qty: true },
  });
  const out = new Map<string, Prisma.Decimal>();
  for (const r of rows) {
    const v = (r._sum.qty ?? new Prisma.Decimal(0)).mul(consumableMovementSign(r.kind));
    out.set(r.itemId, (out.get(r.itemId) ?? new Prisma.Decimal(0)).plus(v));
  }
  return out;
}

export interface ConsumableWarning {
  code: "CONSUMABLE_NEGATIVE_BALANCE" | "CONSUMABLE_PIECE_LENGTH_UNKNOWN";
  message: string;
  itemId?: string;
}

async function negativeWarnings(tx: Tx, itemIds: string[]): Promise<ConsumableWarning[]> {
  if (itemIds.length === 0) return [];
  const bal = await consumableBalances(tx, itemIds);
  const neg = [...bal].filter(([, v]) => v.lt(0)).map(([id]) => id);
  if (neg.length === 0) return [];
  const items = await tx.item.findMany({ where: { id: { in: neg } }, select: { id: true, name: true, unit: true } });
  return items.map((it) => ({
    code: "CONSUMABLE_NEGATIVE_BALANCE" as const,
    itemId: it.id,
    message: `"${it.name}" sarf stoğu eksiye düştü (${bal.get(it.id)!.toFixed(3)} ${it.unit}) — iş durmadı, mal kabul girişini kontrol edin.`,
  }));
}

/** Mal kabul sarf satırı — fiş satırı başına bir RECEIPT_IN. */
export async function recordConsumableReceiptTx(
  tx: Tx,
  a: { itemId: string; qty: Prisma.Decimal.Value; unitPrice: Prisma.Decimal.Value | null; goodsReceiptId: string; userId?: string | null },
): Promise<string> {
  const row = await tx.consumableMovement.create({
    data: {
      itemId: a.itemId,
      kind: ConsumableMovementKind.RECEIPT_IN,
      qty: a.qty,
      unitPrice: a.unitPrice,
      goodsReceiptId: a.goodsReceiptId,
      userId: a.userId ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

/** Fiş iptali — ters kaydı olmayan her RECEIPT_IN için RECEIPT_CANCEL_OUT. Dönen: yazılan ters satır sayısı. */
export async function reverseConsumableReceiptTx(tx: Tx, goodsReceiptId: string, userId?: string | null): Promise<number> {
  const open = await tx.consumableMovement.findMany({
    where: { goodsReceiptId, kind: ConsumableMovementKind.RECEIPT_IN, reversedBy: null },
    select: { id: true, itemId: true, qty: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const m of open) {
    await tx.consumableMovement.create({
      data: { itemId: m.itemId, kind: ConsumableMovementKind.RECEIPT_CANCEL_OUT, qty: m.qty, goodsReceiptId, reversesId: m.id, reason: "Mal kabul fişi iptali", userId: userId ?? null },
    });
  }
  return open.length;
}

interface Demand {
  itemId: string;
  qty: Prisma.Decimal;
}

/**
 * Bir işlenen topun metresi. Çağıran istasyon hareketinin `qtyIn`ini verdiyse o esastır (tambur
 * finalize'ın qtyOut kuralı — girişte kesilmiş topta initialQty fazla sayar); yoksa kalan, o da 0 ise ilk metre.
 */
function processedMeters(r: { currentQty: Prisma.Decimal; initialQty: Prisma.Decimal }, given?: Prisma.Decimal | null): Prisma.Decimal {
  if (given && given.gt(0)) return given;
  return r.currentQty.gt(0) ? r.currentQty : r.initialQty;
}

async function kursunDemands(tx: Tx, op: OpRow, at: Date, given?: Prisma.Decimal | null): Promise<Demand[]> {
  if (!op.propertyValue) return [];
  const serviceItemId = pickServiceItemId({ value: op.propertyValue.serviceItemId, property: op.propertyValue.property.serviceItemId });
  if (!serviceItemId) return [];
  const norms = await consumableNormsValidAt(tx, serviceItemId, at);
  const meters = processedMeters(op.roll, given);
  return norms.map((n) => ({ itemId: n.consumableItemId, qty: meters.mul(n.qtyPerM).toDecimalPlaces(3) }));
}

/** Kuşak: iş emri hedef değerinin sarf kalemi × beklenen top (`expectedRolls`; top boyu siparişten, tekse). */
async function kusakDemands(tx: Tx, op: OpRow, warnings: ConsumableWarning[], given?: Prisma.Decimal | null): Promise<Demand[]> {
  const targets = await tx.workOrderTargetValue.findMany({
    where: { workOrderId: op.step.workOrderId, revokedAt: null, value: { consumableItemId: { not: null } } },
    select: { value: { select: { name: true, consumableItemId: true } } },
  });
  if (targets.length === 0) return [];
  const links = await tx.workOrderToOrderLine.findMany({
    where: { workOrderId: op.step.workOrderId, ...ACTIVE_ORDER_LINK },
    select: { orderLine: { select: { pieceLengthM: true } } },
  });
  const lengths = [...new Set(links.map((l) => l.orderLine.pieceLengthM?.toString() ?? null))];
  const rolls = lengths.length === 1 && lengths[0] !== null ? expectedRolls(processedMeters(op.roll, given), new Prisma.Decimal(lengths[0])) : null;
  if (rolls === null) {
    warnings.push({ code: "CONSUMABLE_PIECE_LENGTH_UNKNOWN", message: `${TERIM.terbiyeIsEmri.cekim.ilgi} top boyu tek ve belli değil — kuşak sarf stoktan düşülmedi.` });
    return [];
  }
  return targets.map((t) => ({ itemId: t.value.consumableItemId!, qty: new Prisma.Decimal(rolls) }));
}

const OP_SELECT = {
  id: true,
  operationType: true,
  inheritedFromParentRollId: true,
  roll: { select: { currentQty: true, initialQty: true } },
  step: { select: { workOrderId: true } },
  propertyValue: { select: { serviceItemId: true, property: { select: { serviceItemId: true } } } },
} satisfies Prisma.RollOperationSelect;
type OpRow = Prisma.RollOperationGetPayload<{ select: typeof OP_SELECT }>;

/**
 * Üretim izi doğunca sarf düşümü (kurşun: KURSUN_APPLIED, kuşak: TAMBUR_PROCESSED). Ayar kapalıysa, iz
 * mirassa (bölünmede kopyalanan) ya da kalem/norm yoksa hiçbir şey yazılmaz. Aynı ize ikinci çağrı no-op
 * (`@@unique([rollOperationId, itemId])`, `skipDuplicates`). Dönen: uyarılar (eksi bakiye engellemez).
 */
export async function consumeForOperationTx(
  tx: Tx,
  operationId: string,
  userId?: string | null,
  opts?: { processedQty?: Prisma.Decimal | null },
): Promise<ConsumableWarning[]> {
  if (!(await resolveConsumableStockEnabled(tx))) return [];
  // ⚠️ `revokedAt` SÜZÜLMEZ (bilinçli): çağıran izi aynı tx'te YENİ yazdı; id ile tekil okuma.
  const op = await tx.rollOperation.findUnique({ where: { id: operationId }, select: OP_SELECT });
  if (!op || op.inheritedFromParentRollId) return [];
  const warnings: ConsumableWarning[] = [];
  let demands: Demand[] = [];
  if (op.operationType === RollOperationType.KURSUN_APPLIED) demands = await kursunDemands(tx, op, new Date(), opts?.processedQty);
  else if (op.operationType === RollOperationType.TAMBUR_PROCESSED) demands = await kusakDemands(tx, op, warnings, opts?.processedQty);
  demands = demands.filter((d) => d.qty.gt(0));
  if (demands.length === 0) return warnings;
  await tx.consumableMovement.createMany({
    data: demands.map((d) => ({ itemId: d.itemId, kind: ConsumableMovementKind.CONSUMPTION_OUT, qty: d.qty, rollOperationId: op.id, userId: userId ?? null })),
    skipDuplicates: true,
  });
  return [...warnings, ...(await negativeWarnings(tx, demands.map((d) => d.itemId)))];
}

/** İz geri alınınca (damga) ters kaydı olmayan tüketimin CONSUMPTION_REVERSAL_IN'i — ayardan bağımsız. */
export async function reverseConsumptionTx(
  tx: Tx,
  opWhere: Prisma.RollOperationWhereInput,
  userId?: string | null,
  reason?: string,
): Promise<number> {
  const open = await tx.consumableMovement.findMany({
    where: { kind: ConsumableMovementKind.CONSUMPTION_OUT, reversedBy: null, rollOperation: opWhere },
    select: { id: true, itemId: true, qty: true, rollOperationId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const m of open) {
    await tx.consumableMovement.create({
      data: {
        itemId: m.itemId,
        kind: ConsumableMovementKind.CONSUMPTION_REVERSAL_IN,
        qty: m.qty,
        reversesId: m.id,
        reason: (reason ?? "Üretim izi geri alındı").slice(0, 300),
        userId: userId ?? null,
      },
    });
  }
  return open.length;
}
