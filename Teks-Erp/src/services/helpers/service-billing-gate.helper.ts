// =============================================================================
// HİZMET FATURASI KAPISI — salt-okuma (H7, karar belgesi §5)
// =============================================================================
// Kurşun düzeltme yolları ve sevk geri alma buradan sorar: "bu iş/sevk faturaya
// bağlı mı?" Yazmaz; ön muhasebe kapalı kurulumda tablo boştur (0 satır). Hafif
// tutulur (yalnız prisma) — üretim helper'larına ağır fiyat zinciri taşınmasın.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { SACK_ABSENT_STATUSES } from "./sack-invariants.helper";

type Db = Prisma.TransactionClient | typeof prisma;

/** Aktif bağın fatura numarası — 409 mesajı için (yoksa null). */
export async function findActiveBillingTx(
  db: Db,
  where: Prisma.ServiceBillingLinkWhereInput,
): Promise<{ docNo: string } | null> {
  const hit = await db.serviceBillingLink.findFirst({ where: { ...where, revokedAt: null }, select: { invoice: { select: { docNo: true } } } });
  return hit ? { docNo: hit.invoice.docNo } : null;
}

export function alreadyBilled(docNo: string | null): AppError {
  return AppError.conflict(
    docNo ? `Bu iş ${docNo} faturasına bağlı — önce faturayı iptal edin` : "Bu iş başka bir faturaya bağlandı — yenileyip tekrar deneyin",
    { code: "SERVICE_ALREADY_BILLED", ...(docNo ? { docNo } : {}) },
  );
}

/**
 * Düzeltme kapısı (salt-okuma): faturalı iş (top × adım) için okuma/gramaj düzeltmesi ve adım
 * yeniden açma 409 `SERVICE_ALREADY_BILLED` (fatura no ile). Ön muhasebe kapalı kurulumda tablo boştur.
 */
export async function assertWorkNotBilledTx(tx: Db, work: { rollIds: string[]; workOrderStepId: string }): Promise<void> {
  if (work.rollIds.length === 0) return;
  const prior = await findActiveBillingTx(tx, { rollId: { in: work.rollIds }, workOrderStepId: work.workOrderStepId });
  if (prior) throw alreadyBilled(prior.docNo);
}

/** Ata zinciri (kendisi dahil) — Tambur bölmesi `parentRollId` ile; derinlik tavanı döngüye karşı sigorta. */
export async function collectRollLineage(rollIds: string[], db: Db = prisma): Promise<string[]> {
  const seen = new Set(rollIds);
  let frontier = [...seen];
  for (let depth = 0; depth < 32 && frontier.length > 0; depth++) {
    const rows = await db.roll.findMany({ where: { id: { in: frontier }, parentRollId: { not: null } }, select: { parentRollId: true } });
    frontier = rows.map((r) => r.parentRollId!).filter((id) => !seen.has(id));
    for (const id of frontier) seen.add(id);
  }
  return [...seen];
}

/** Sevkiyatların EMANET topları (canlı + iade edilmiş, BRÜT) — sevk/dönem taslağı ve geri alma kapısının ORTAK kümesi. */
export async function listShipmentServiceRollIds(shipmentIds: string[], db: Db = prisma): Promise<string[]> {
  return [...new Set((await listShipmentServiceRollShipments(shipmentIds, db)).map((r) => r.rollId))];
}

/** Aynı küme, top → hangi sevkiyattan (H8b: dönem taslağında iş başına sevk günü). İade edilen top ilk sevkinden gelir. */
export async function listShipmentServiceRollShipments(shipmentIds: string[], db: Db = prisma): Promise<Array<{ rollId: string; shipmentId: string }>> {
  if (shipmentIds.length === 0) return [];
  const live = await db.roll.findMany({ where: { shipmentId: { in: shipmentIds }, ownerCustomerId: { not: null }, status: { notIn: SACK_ABSENT_STATUSES } }, select: { id: true, shipmentId: true } });
  const returned = await db.rollReturn.findMany({
    where: { fromShipmentId: { in: shipmentIds }, cancelledAt: null, roll: { ownerCustomerId: { not: null } } },
    select: { rollId: true, fromShipmentId: true },
  });
  return [
    ...live.map((r) => ({ rollId: r.id, shipmentId: r.shipmentId! })),
    ...returned.map((r) => ({ rollId: r.rollId, shipmentId: r.fromShipmentId! })),
  ];
}

/**
 * Sevk geri alma kapısı (salt-okuma): bu sevkiyatın faturasına bağlı aktif hizmet bağları + DÖNEM taslaklarının
 * (shipmentId null) bu sevkin emanet toplarına (ata zinciriyle) kurulmuş aktif bağları → fatura numaraları.
 * Dönem kolu atasını başka sevkle paylaşan topta da kapatır (fail-closed).
 */
export async function listShipmentServiceBilledDocNos(db: Db, shipmentId: string): Promise<string[]> {
  const rollIds = await listShipmentServiceRollIds([shipmentId], db);
  const lineage = rollIds.length === 0 ? [] : await collectRollLineage(rollIds, db);
  const rows = await db.serviceBillingLink.findMany({
    where: {
      revokedAt: null,
      OR: [
        { invoice: { shipmentId } },
        ...(lineage.length > 0 ? [{ invoice: { shipmentId: null }, rollId: { in: lineage } }] : []),
      ],
    },
    select: { invoice: { select: { docNo: true } } },
    distinct: ["invoiceId"],
  });
  return rows.map((r) => r.invoice.docNo);
}


/**
 * Bayrak geri alma kapısı (salt-okuma, H10): faturalı bayrak işinin kanıtı (topun aktif özelliği) geri
 * alınamaz — top ya da ataları o kalemle aktif bağ taşıyorsa 409 `SERVICE_ALREADY_BILLED`.
 */
export async function assertFlagWorkNotBilledTx(tx: Db, input: { rollId: string; propertyIds: string[] }): Promise<void> {
  if (input.propertyIds.length === 0) return;
  const props = await tx.fabricProperty.findMany({ where: { id: { in: input.propertyIds }, serviceItemId: { not: null } }, select: { serviceItemId: true } });
  if (props.length === 0) return;
  const lineage = [input.rollId];
  for (let cur: string | null = input.rollId, d = 0; cur && d < 32; d++) {
    const row: { parentRollId: string | null } | null = await tx.roll.findUnique({ where: { id: cur }, select: { parentRollId: true } });
    cur = row?.parentRollId ?? null;
    if (cur) lineage.push(cur);
  }
  const prior = await findActiveBillingTx(tx, { rollId: { in: lineage }, serviceItemId: { in: props.map((p) => p.serviceItemId!) } });
  if (prior) throw alreadyBilled(prior.docNo);
}
