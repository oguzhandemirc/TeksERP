// =============================================================================
// "BU TOP HANGİ DOKUMA İŞİNDEN?" — TEK OKUYUCU (G2, 2026-09-14)
// =============================================================================
// Üç doğum yolu, tek soru: kendi tezgahında dokunan top İNDİRME üzerinden
// (`Roll.doffEventId → DoffEvent.machineRunId → MachineRun.weavingOrderId`),
// fasonda dokunan top MAKBUZ üzerinden (`Roll.parentReceiptId →
// SubcontractorReceipt.weavingOrderId`), KK1'de iş emri seçilip tezgahı bilinmeyen
// top (S1 A-yolu, D11) DOĞRUDAN `Roll.weavingOrderId` üzerinden. Kolon yalnız
// doff'suz satırda dolar (CHECK `rolls_weaving_order_xor_ck`) — doff'lu topta
// ikinci kaynak olmaz, zincir tek: doff varsa koşumdan, yoksa kolondan.
// Bekçi (`test_subcontractor_weaving §5`) bu zincirleri başka dosyada aramaz.
// =============================================================================
import { Prisma, RollStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { K18_DEAD_STATUSES } from "../batch.service";

const Decimal = Prisma.Decimal;

type Db = Prisma.TransactionClient | typeof prisma;

export type WeavingOrderOfRoll = {
  weavingOrderId: string;
  /** DOFF = kendi tezgahı (indirme) · RECEIPT = fason dokuma makbuzu · ORDER = KK1 iş seçimi, tezgah bilinmiyor (S1 A-yolu). */
  via: "DOFF" | "RECEIPT" | "ORDER";
};

/** "Bu işten doğan top" yüklemi (indirme zinciri ∪ doff'suz iş bağı) — sayı (detay), metre/liste (genel bakış) ve gerçek maliyet paydası AYNI where'i okur. */
export function rollsOfWeavingOrderWhere(weavingOrderId: string | string[]): Prisma.RollWhereInput {
  const wo = Array.isArray(weavingOrderId) ? { in: weavingOrderId } : weavingOrderId;
  return { OR: [{ doffEvent: { revokedAt: null, machineRun: { weavingOrderId: wo } } }, { weavingOrderId: wo }] };
}

/** Z1 (Y3 türetme, kolon yok): bu işten indirme yoluyla doğan (iptal edilmemiş) top sayısı — aynı zincir, aynı dosya. */
export async function countRollsOfWeavingOrder(db: Db, weavingOrderId: string): Promise<number> {
  return db.roll.count({ where: rollsOfWeavingOrderWhere(weavingOrderId) });
}

/** Top hiçbir dokuma işine bağlı değilse `null` (uydurulmaz). */
export async function weavingOrderOfRoll(db: Db, rollId: string): Promise<WeavingOrderOfRoll | null> {
  const roll = await db.roll.findUnique({
    where: { id: rollId },
    select: {
      weavingOrderId: true,
      doffEvent: { select: { revokedAt: true, machineRun: { select: { weavingOrderId: true } } } },
      parentReceipt: { select: { cancelledAt: true, weavingOrderId: true } },
    },
  });
  if (!roll) return null;
  const doffWo = roll.doffEvent?.revokedAt ? null : roll.doffEvent?.machineRun?.weavingOrderId ?? null;
  if (doffWo) return { weavingOrderId: doffWo, via: "DOFF" };
  const receiptWo = roll.parentReceipt?.cancelledAt ? null : roll.parentReceipt?.weavingOrderId ?? null;
  if (receiptWo) return { weavingOrderId: receiptWo, via: "RECEIPT" };
  if (roll.weavingOrderId) return { weavingOrderId: roll.weavingOrderId, via: "ORDER" };
  return null;
}

/** Z3: fasonda dokunan işlerin KABUL edilen metresi (makbuz zinciri, iptal edilmemiş makbuz, ölü olmayan top) — iş başına Σ ilk metre. */
export async function receivedMetersByWeavingOrder(db: Db, weavingOrderIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (weavingOrderIds.length === 0) return out;
  const rolls = await db.roll.findMany({
    where: { status: { notIn: K18_DEAD_STATUSES }, parentReceipt: { cancelledAt: null, weavingOrderId: { in: weavingOrderIds } } },
    select: { initialQty: true, parentReceipt: { select: { weavingOrderId: true } } },
  });
  for (const r of rolls) { const id = r.parentReceipt?.weavingOrderId; if (id) out.set(id, (out.get(id) ?? 0) + Number(r.initialQty)); }
  return out;
}

/**
 * SY-D3: işin CANLI top metresi (gerçek maliyet paydası), iki kova: `viaRun` indirme→koşum zinciri (B yolu),
 * `viaOrder` KK1 iş seçimi (A yolu, tezgah bilinmiyor). Yalnız İPTAL topu paydaya GİRMEZ; fason/tambur/kartela
 * tüketimi (K18'in diğer üyeleri) dokunan metreyi yok etmez — boyahaneye giden ham top işin paydasında KALIR.
 */
export async function liveRollMetersByWeavingOrder(
  db: Db, weavingOrderIds: string[],
): Promise<Map<string, { viaRun: Prisma.Decimal; viaOrder: Prisma.Decimal }>> {
  const out = new Map<string, { viaRun: Prisma.Decimal; viaOrder: Prisma.Decimal }>();
  if (weavingOrderIds.length === 0) return out;
  const rolls = await db.roll.findMany({
    where: { status: { not: RollStatus.CANCELLED }, ...rollsOfWeavingOrderWhere(weavingOrderIds) },
    select: { initialQty: true, weavingOrderId: true, doffEvent: { select: { revokedAt: true, machineRun: { select: { weavingOrderId: true } } } } },
    orderBy: { id: "asc" },
  });
  for (const r of rolls) {
    const runWo = r.doffEvent && !r.doffEvent.revokedAt ? r.doffEvent.machineRun?.weavingOrderId ?? null : null;
    const id = runWo ?? r.weavingOrderId;
    if (!id) continue;
    const cur = out.get(id) ?? { viaRun: new Decimal(0), viaOrder: new Decimal(0) };
    if (runWo) cur.viaRun = cur.viaRun.plus(r.initialQty);
    else cur.viaOrder = cur.viaOrder.plus(r.initialQty);
    out.set(id, cur);
  }
  return out;
}
