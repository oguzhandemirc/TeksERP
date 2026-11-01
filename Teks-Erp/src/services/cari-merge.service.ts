// =============================================================================
// CARİ BİRLEŞTİRME — panel uçları (D4-K3e, kullanıcı kararı 2026-11-01)
// =============================================================================
// İKİNCİ BİRLEŞTİRME KODU YOK: ön izleme `planCariMerge`, yazım `applyCariMerge` (`helpers/cari-merge.helper`) —
// `scripts/fix_cari_cift_hesap.ts` ile AYNI çekirdek. Bu dosya yalnız aday listesi, sürüm damgası ve clientToken
// replay'i ekler. Token kaydı = virman bacaklarının `transferGroupId`si (şema değişmeden; tek bacak grubu birleşmedir).
// Kalemsiz (sıfır bakiyeli) birleşme bacak yazmaz → token iz bırakmaz; tekrar deneme durum-idempotent
// (`alreadyMerged`) cevap alır.
// =============================================================================
import { CariTxnSource } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";
import { tokenReplay } from "./helpers/token-replay.helper";
import { applyCariMerge, cariMergePlanStamp, planCariMerge, type CariMergePlan, type CariMergeResult } from "./helpers/cari-merge.helper";

export interface CariMergeCandidate {
  id: string;
  kind: "CUSTOMER" | "SUBCONTRACTOR";
  label: string;
  isActive: boolean;
  /** Önerilen yön: eski fason bacağı kaynak, kartın kendi hesabı hedef (çekirdeğin sabit yönü). */
  sourceId: string;
  targetId: string;
  balances: Array<{ currency: string; balance: string }>;
}

export interface CariMergePreview extends CariMergePlan {
  stamp: string;
}

export interface CariMergeApplyInput {
  sourceId: string;
  targetId: string;
  stamp: string;
  clientToken: string;
}

const ACC = { id: true, kind: true, isActive: true, mergedIntoId: true, customerId: true, customer: { select: { code: true, name: true, mergedIntoId: true } }, subcontractor: { select: { code: true, name: true, customerId: true } } } as const;

/**
 * Aynı kartın öbür hesapları — farklı kimlik zaten engeldir (MASTER-VERI), seçici yalnız geçerli adayları listeler.
 * Ana veri birleştirmesinde mezar taşında kalan hesap (KEEP_ON_SOURCE) survivor kartın hesabı sayılır.
 */
async function candidates(cariId: string): Promise<ApiResponse<CariMergeCandidate[]>> {
  const self = await prisma.cariAccount.findUnique({ where: { id: cariId }, select: ACC });
  if (!self) throw AppError.notFound("Cari hesap bulunamadı.", { code: "CARI_ACCOUNT_NOT_FOUND" });
  const card = self.customerId ? (self.customer?.mergedIntoId ?? self.customerId) : (self.subcontractor?.customerId ?? null);
  if (!card) return { success: true, data: [] };
  const rows = await prisma.cariAccount.findMany({
    where: { id: { not: cariId }, mergedIntoId: null, OR: [{ customerId: card }, { subcontractor: { customerId: card } }, { customer: { mergedIntoId: card } }] },
    select: { ...ACC, balances: { select: { currency: true, balance: true }, orderBy: { currency: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  // Mezar taşı hesabının TEK hedefi kalan kartın kendi hesabıdır (başka mezar taşı ya da eski fason bacağı ara durak olmaz).
  const selfTomb = Boolean(self.customer?.mergedIntoId);
  const data = rows.filter((r) => !selfTomb || r.customerId === card).map((r) => {
    const party = r.customer ?? r.subcontractor;
    // Hedef = kartın KENDİ hesabı (mezar taşı ve eski fason bacağı kaynak olur).
    const otherIsCard = r.customerId === card;
    return {
      id: r.id,
      kind: r.kind,
      label: party ? `${party.code} ${party.name}` : r.id,
      isActive: r.isActive,
      sourceId: otherIsCard ? cariId : r.id,
      targetId: otherIsCard ? r.id : cariId,
      balances: r.balances.filter((b) => !b.balance.isZero()).map((b) => ({ currency: b.currency, balance: b.balance.toFixed(2) })),
    };
  });
  return { success: true, data };
}

async function preview(sourceId: string, targetId: string): Promise<ApiResponse<CariMergePreview>> {
  const plan = await planCariMerge(sourceId, targetId);
  return { success: true, data: { ...plan, stamp: cariMergePlanStamp(plan) } };
}

interface PriorMerge {
  sourceId: string | null;
  targetId: string | null;
  sourceMergedIntoId: string | null;
  legs: number;
}

const applyReplay = (input: CariMergeApplyInput) =>
  tokenReplay<PriorMerge, ApiResponse<CariMergeResult>>({
    find: async (db, clientToken) => {
      const legs = await db.cariTransaction.findMany({
        where: { transferGroupId: clientToken, sourceType: CariTxnSource.CARI_TRANSFER },
        select: { cariId: true, cari: { select: { mergedIntoId: true } } },
      });
      if (legs.length === 0) return null;
      // Kaynak bacağın hesabı birleşmiş (mergedIntoId dolu); geri alınmışsa ikisi de boş → 4. durum.
      const src = legs.find((l) => l.cari.mergedIntoId != null);
      const ids = [...new Set(legs.map((l) => l.cariId))];
      const sourceId = src?.cariId ?? (ids.includes(input.sourceId) ? input.sourceId : (ids[0] ?? null));
      return { sourceId, targetId: ids.find((i) => i !== sourceId) ?? null, sourceMergedIntoId: src?.cari.mergedIntoId ?? null, legs: legs.length };
    },
    alive: (prior) => {
      if (prior.sourceMergedIntoId) return;
      throw AppError.conflict("Bu birleştirme yapılmış ama sonra GERİ ALINMIŞ — yeniden birleştirmek için ön izlemeyi yenileyin.", { code: "CARI_MERGE_REVERTED" });
    },
    identity: (prior) => [
      { ad: "sourceId", mevcut: prior.sourceId, gelen: input.sourceId },
      { ad: "targetId", mevcut: prior.sourceMergedIntoId, gelen: input.targetId },
    ],
    collision: "Bu istemci anahtarı FARKLI bir cari birleştirmesi için kullanılmış. Pencereyi kapatıp yeniden açın.",
    respond: (prior) => ({
      success: true,
      data: { alreadyMerged: true, transferGroupId: input.clientToken, legs: prior.legs, movedDrafts: 0 },
      message: "Cari birleştirmesi zaten yapılmış.",
    }),
  });

async function apply(input: CariMergeApplyInput, userId: string): Promise<ApiResponse<CariMergeResult>> {
  return applyReplay(input).run(input.clientToken, async () => {
    const data = await applyCariMerge(input.sourceId, input.targetId, userId, { expectedStamp: input.stamp, transferGroupId: input.clientToken });
    return { success: true, data, message: data.alreadyMerged ? "Cari birleştirmesi zaten yapılmış." : "Cari hesaplar birleştirildi." };
  });
}

export const cariMergeService = { candidates, preview, apply };
