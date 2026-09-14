// =============================================================================
// ÖZELLİK PİVOTU DAMGASI — `RollProperty` · `WorkOrderTargetProperty` (③a ticari pivot)
// =============================================================================
// 2026-09-14'ten beri satır SİLİNMEZ, `revokedAt` ile damgalanır
// (docs/design/OZELLIK-PIVOT-SURUMLEME-PLAN.md). Değişiklik = eski aktif satırın
// damgası + yeni satır; yerinde `valueId` güncellemesi YOK — "ne oldu" değişmez.
//
// Dışlayıcılık DB'de PARTIAL UNIQUE ile korunur (`… WHERE "revokedAt" IS NULL`):
// damgalı satır dururken aynı çift yeniden yazılabilir, AKTİF çift tekildir.
//
// İKİ SABİT TEK DOSYADA: biri süzülüp diğeri unutulamaz; AST bekçisi
// (`test_roll_property_revoke` §13, `revoke-ast-tarama.ts`) okuyan HER yolun bu
// sabitlerden geçtiğini ölçer — elle kopyalanan `revokedAt: null` ihlaldir.
//
// ⚠️ Bilinçli süzgeçsiz okur (`fabric-property.service.ts` tip dönüşümü kilidi):
// "bu özellik HİÇ değer taşıdı mı" sorusu tarihsel satırı da sayar, `revokedAt
// SÜZÜLMEZ` işaretiyle geçer.
// =============================================================================

import type { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";

type Tx = Prisma.TransactionClient;

/** Topun AKTİF özellik satırı — okuyan her yol buradan geçer. */
export const ACTIVE_ROLL_PROPERTY = { revokedAt: null } as const;
/** İş emrinin AKTİF hedef özelliği — okuyan her yol buradan geçer. */
export const ACTIVE_TARGET_PROPERTY = { revokedAt: null } as const;

export interface RevokeRollPropertiesArgs {
  rollIds: string[];
  /** Yalnız bu satır id'leri (fark bazlı yazarlar okudukları aktif satıra PİNLER). */
  ids?: string[];
  propertyIds?: string[];
  /** Yalnız bu tipteki özellikler (BAYRAK replace'i SEÇİM satırına dokunmaz). */
  valueType?: "FLAG" | "CHOICE";
  reason: string;
  userId?: string | null;
}

/**
 * Topun aktif özellik satırlarını DAMGALAR (silmez). Dönen sayı = damgalanan satır
 * (eski `deleteMany().count` ile aynı anlam). Zaten damgalı satıra dokunmaz.
 */
export async function revokeRollProperties(tx: Tx, args: RevokeRollPropertiesArgs): Promise<number> {
  if (args.rollIds.length === 0) return 0;
  if (args.ids && args.ids.length === 0) return 0;
  const res = await tx.rollProperty.updateMany({
    where: {
      rollId: { in: args.rollIds },
      ...(args.ids ? { id: { in: args.ids } } : {}),
      ...(args.propertyIds ? { propertyId: { in: args.propertyIds } } : {}),
      ...(args.valueType ? { property: { valueType: args.valueType } } : {}),
      ...ACTIVE_ROLL_PROPERTY,
    },
    data: {
      revokedAt: new Date(),
      revokedById: args.userId ?? null,
      revokeReason: args.reason.slice(0, 300),
    },
  });
  return res.count;
}

export interface RevokeTargetPropertiesArgs {
  workOrderId: string;
  propertyIds?: string[];
  reason: string;
  userId?: string | null;
}

/** İş emrinin aktif hedef özelliklerini DAMGALAR (silmez). Dönen sayı = damgalanan satır. */
export async function revokeTargetProperties(tx: Tx, args: RevokeTargetPropertiesArgs): Promise<number> {
  if (args.propertyIds && args.propertyIds.length === 0) return 0;
  const res = await tx.workOrderTargetProperty.updateMany({
    where: {
      workOrderId: args.workOrderId,
      ...(args.propertyIds ? { propertyId: { in: args.propertyIds } } : {}),
      ...ACTIVE_TARGET_PROPERTY,
    },
    data: {
      revokedAt: new Date(),
      revokedById: args.userId ?? null,
      revokeReason: args.reason.slice(0, 300),
    },
  });
  return res.count;
}

export type SetRollPropertyValueResult = "noop" | "created" | "versioned";

/**
 * Topa bir özelliği (ve SEÇİM tipinde değerini) yazar — SÜRÜMLEYEREK.
 *   • aktif satır yok            → INSERT (`createMany skipDuplicates`: partial unique'e
 *                                  `ON CONFLICT DO NOTHING` hedefsiz gider; düz `create`
 *                                  iki eşzamanlı istasyon yazımında P2002 verirdi)
 *   • aktif satır var, aynı değer / değer verilmedi → NO-OP (bypass kapanışı ve offline
 *                                  replay mevcut seçimi SİLMEZ)
 *   • aktif satır var, FARKLI değer → eski satır damgalanır (id'ye pinli, `count===0 → 409`)
 *                                  + yeni satır INSERT. Yerinde `valueId` güncellemesi YOK.
 * ⚠️ Eski `upsert({ where: { rollId_propertyId } })` partial unique ile YAŞAYAMAZ:
 *    PG `ON CONFLICT (rollId, propertyId)` için predicate'siz tekil index ister → 42P10
 *    (ölçüldü 2026-09-14, Faz 1 sondası). Bu yüzden 2a Faz 1 ile aynı commit'te.
 */
export async function setRollPropertyValueTx(
  tx: Tx,
  args: { rollId: string; propertyId: string; valueId: string | null; reason: string; userId?: string | null },
): Promise<SetRollPropertyValueResult> {
  const active = await tx.rollProperty.findFirst({
    where: { rollId: args.rollId, propertyId: args.propertyId, ...ACTIVE_ROLL_PROPERTY },
    select: { id: true, valueId: true },
  });
  if (!active) {
    await tx.rollProperty.createMany({
      data: [{ rollId: args.rollId, propertyId: args.propertyId, valueId: args.valueId }],
      skipDuplicates: true,
    });
    return "created";
  }
  if (args.valueId === null || args.valueId === active.valueId) return "noop";
  const revoked = await tx.rollProperty.updateMany({
    where: { id: active.id, ...ACTIVE_ROLL_PROPERTY },
    data: { revokedAt: new Date(), revokedById: args.userId ?? null, revokeReason: args.reason.slice(0, 300) },
  });
  if (revoked.count === 0) {
    throw AppError.conflict("Özellik bu sırada başka bir işlemle değişti — tekrar deneyin.", {
      code: "PROPERTY_VERSION_CONFLICT",
    });
  }
  await tx.rollProperty.createMany({
    data: [{ rollId: args.rollId, propertyId: args.propertyId, valueId: args.valueId }],
    skipDuplicates: true,
  });
  return "versioned";
}

/**
 * Topun BAYRAK (FLAG) kümesini istenen kümeye getirir — FARK BAZLI, sürümleyerek.
 * Çıkanlar tx içinde TAZE okunan aktif satır id'lerine PİNLİ damgalanır (araya giren
 * yazım sayıyı düşürürse 409), girenler `createMany skipDuplicates`; değişmeyen satıra
 * DOKUNULMAZ (aynı satır id'si, aynı `createdAt`). SEÇİM satırlarına dokunmaz.
 * Y5 (top düzeltme) ve Y9 (iş emri hedefi → top) aynı gövdeden geçer.
 */
export async function applyRollFlagSetTx(
  tx: Tx,
  args: { rollId: string; desired: string[]; reason: string; userId?: string | null },
): Promise<{ revoked: number; added: number; revokedPropertyIds: string[]; addedPropertyIds: string[] }> {
  const desired = new Set(args.desired);
  const active = await tx.rollProperty.findMany({
    where: { rollId: args.rollId, property: { valueType: "FLAG" }, ...ACTIVE_ROLL_PROPERTY },
    select: { id: true, propertyId: true },
  });
  const leaving = active.filter((r) => !desired.has(r.propertyId));
  const activeIds = new Set(active.map((r) => r.propertyId));
  const entering = [...desired].filter((pid) => !activeIds.has(pid));
  let revoked = 0;
  if (leaving.length > 0) {
    revoked = await revokeRollProperties(tx, {
      rollIds: [args.rollId],
      ids: leaving.map((r) => r.id),
      reason: args.reason,
      userId: args.userId,
    });
    if (revoked !== leaving.length) {
      throw AppError.conflict("Topun özellikleri bu sırada başka bir işlemle değişti — tekrar deneyin.", {
        code: "PROPERTY_VERSION_CONFLICT",
      });
    }
  }
  let added = 0;
  if (entering.length > 0) {
    const res = await tx.rollProperty.createMany({
      data: entering.map((propertyId) => ({ rollId: args.rollId, propertyId })),
      skipDuplicates: true,
    });
    added = res.count;
  }
  return { revoked, added, revokedPropertyIds: leaving.map((r) => r.propertyId), addedPropertyIds: entering };
}
