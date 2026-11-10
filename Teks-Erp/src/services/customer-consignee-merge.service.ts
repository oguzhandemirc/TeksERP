// =============================================================================
// Alıcı birleştirme (2026-11-10) — aynı sahibin iki alıcısı aslında aynıysa (MV-06'nın çıkış yolu).
// =============================================================================
// Önizleme etkilenen canlı topları TEK TEK listeler; sevk edilmiş/ölü toplar DOKUNULMAZ (üstlerindeki
// etiket eski adı taşır, "ne oldu" değişmez) ve yalnız sayıyla gösterilir. Kaynak SİLİNMEZ: mezar taşı
// (`mergedIntoId`, isActive=false) olarak kalır; aynı adla `ensure` hedefe çözülür.
// Cari birleştirmesinde (`master-data-merge`) katlanmış adı çakışan kaynak alıcı aynı çekirdekle hedefin
// alıcısına birleşir (`foldConsigneesOnCustomerMergeTx`), çakışmayanlar haritadaki MOVE ile taşınır.
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { consigneeLiveRollWhere, liveRollsOf } from "./customer-consignee.service";

const TABLE = "CUSTOMER_CONSIGNEE";

async function loadPair(id: string, targetId: string) {
  if (id === targetId) throw AppError.badRequest("Alıcı kendisiyle birleştirilemez.", { code: "CONSIGNEE_MERGE_SELF" });
  const rows = await prisma.customerConsignee.findMany({
    where: { id: { in: [id, targetId] } },
    select: { id: true, customerId: true, name: true, isActive: true, mergedIntoId: true },
  });
  const source = rows.find((r) => r.id === id);
  const target = rows.find((r) => r.id === targetId);
  if (!source || !target) throw AppError.notFound("Alıcı bulunamadı");
  if (source.customerId !== target.customerId) {
    throw AppError.badRequest("Yalnız aynı müşterinin alıcıları birleştirilebilir.", { code: "CONSIGNEE_OWNER_MISMATCH" });
  }
  if (source.mergedIntoId || target.mergedIntoId) {
    throw AppError.conflict("Alıcılardan biri zaten birleştirilmiş — listeyi yenileyin.", { code: "CONSIGNEE_MERGED" });
  }
  return { source, target };
}

/** Birleştirme önizlemesi: hedefe dönecek canlı toplar tek tek; sevkli/ölü toplar yalnız sayı ("değişmez"). */
export async function consigneeMergePreview(id: string, targetId: string) {
  const { source, target } = await loadPair(id, targetId);
  const rolls = await liveRollsOf([id]);
  const allCount = await prisma.roll.count({ where: { labelConsigneeId: id } });
  return {
    source: { id: source.id, name: source.name },
    target: { id: target.id, name: target.name, isActive: target.isActive },
    rolls,
    untouchedRollCount: allCount - rolls.length,
  };
}

/**
 * Kaynağı hedefe birleştirir (tx içinde): kaynak claim'i → canlı toplar hedefe (basılmış olan `labelDirty`) →
 * kaynağa birleşmiş mezar taşları da hedefe (zincir kısa kalır). Sevkli/ölü toplar dokunulmaz.
 */
export async function mergeConsigneeTx(tx: Prisma.TransactionClient, sourceId: string, targetId: string, userId?: string | null) {
  const { count } = await tx.customerConsignee.updateMany({
    where: { id: sourceId, mergedIntoId: null },
    data: { mergedIntoId: targetId, mergedAt: new Date(), isActive: false, updatedById: userId ?? null },
  });
  if (count === 0) throw AppError.conflict("Alıcı bu arada birleştirilmiş ya da değişmiş — listeyi yenileyin.", { code: "CONSIGNEE_MERGED" });
  const live = consigneeLiveRollWhere([sourceId]);
  const dirtied = await tx.roll.updateMany({ where: { ...live, labelPrintedAt: { not: null }, labelDirty: false }, data: { labelDirty: true } });
  const moved = await tx.roll.updateMany({ where: live, data: { labelConsigneeId: targetId } });
  await tx.customerConsignee.updateMany({ where: { mergedIntoId: sourceId }, data: { mergedIntoId: targetId } });
  return { movedRolls: moved.count, dirtiedRolls: dirtied.count };
}

export async function mergeConsignee(id: string, targetId: string, userId?: string) {
  const { source, target } = await loadPair(id, targetId);
  const res = await prisma.$transaction(async (tx) => {
    // Hedef tx içinde hâlâ canlı mı (aynı anda hedefin başka yere birleşmesi): satır kilidiyle sor.
    const t = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "customer_consignees" WHERE id = ${targetId}::uuid AND "mergedIntoId" IS NULL FOR UPDATE`;
    if (t.length === 0) throw AppError.conflict("Hedef alıcı bu arada birleştirilmiş — listeyi yenileyin.", { code: "CONSIGNEE_MERGED" });
    return mergeConsigneeTx(tx, id, targetId, userId);
  });
  await AuditService.log({
    userId, action: "UPDATE", tableName: TABLE, recordId: id,
    oldData: { name: source.name, isActive: source.isActive, mergedIntoId: null },
    newData: { mergedIntoId: targetId, targetName: target.name, isActive: false, ...res, event: "CONSIGNEE_MERGE" },
  });
  return { sourceId: id, targetId, ...res };
}

/**
 * Cari birleştirmesi yan etkisi (taşımadan ÖNCE, aynı tx): kaynak carilerin alıcılarından hedef caride
 * aynı katlanmış adla canlı alıcısı olanlar hedefinkine birleşir; kalanlar haritadaki MOVE ile taşınır
 * (birleşmiş satır partial unique dışında kaldığı için taşıma çakışmaz).
 */
export async function foldConsigneesOnCustomerMergeTx(tx: Prisma.TransactionClient, survivorId: string, sourceIds: string[], userId?: string | null) {
  if (sourceIds.length === 0) return { folded: 0 };
  const pairs = await tx.$queryRaw<Array<{ sourceId: string; targetId: string }>>`
    SELECT s.id AS "sourceId", t.id AS "targetId"
      FROM "customer_consignees" s
      JOIN "customer_consignees" t ON t."customerId" = ${survivorId}::uuid AND t."mergedIntoId" IS NULL AND t."nameFold" = s."nameFold"
     WHERE s."customerId" = ANY(${sourceIds}::uuid[]) AND s."mergedIntoId" IS NULL
     ORDER BY s.id`;
  for (const p of pairs) await mergeConsigneeTx(tx, p.sourceId, p.targetId, userId);
  return { folded: pairs.length };
}
