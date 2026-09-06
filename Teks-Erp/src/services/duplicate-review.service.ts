// =============================================================================
// MÜKERRER İNCELEME KUYRUĞU — kararlar (mükerrer paneli v2 P1, 2026-08-22)
// =============================================================================
// Tespit motoru adayları her taramada yeniden hesaplar; BURADA saklanan şey
// operatörün KARARIDIR (ÇİFT bazlı — kullanıcı kararı 2026-08-22):
//   NOT_DUPLICATE → çift kuyruktan kalıcı düşer (taramada süzülür)
//   DEFERRED      → kuyrukta kalır, "ertelendi" işaretli
//   MERGED        → yalnız birleştirme motoru yazar (survivor × kaynak)
// Karar geri alınabilir (`reopen` → satır silinir, audit'e düşer) — birleştirmenin
// aksine bir "veri" değişikliği değil, bir "görüş" değişikliğidir.
// Tasarım: docs/design/MUKERRER-PANELI-TASARIM.md §2.2
// =============================================================================
import { DuplicateReviewDecision, DuplicateReviewEntity, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import type { MergeEntity } from "../constants/merge-map";
import { uyari } from "../lib/logger";

/** Birleştirme varlığı → kuyruk enum'u (tek yönlü eşleme, her ikisi de 4'lü). */
const ENTITY_TO_ENUM: Record<MergeEntity, DuplicateReviewEntity> = {
  customer: DuplicateReviewEntity.CUSTOMER,
  item: DuplicateReviewEntity.ITEM,
  color: DuplicateReviewEntity.COLOR,
  subcontractor: DuplicateReviewEntity.SUBCONTRACTOR,
};

export function reviewEntityOf(entity: MergeEntity): DuplicateReviewEntity {
  return ENTITY_TO_ENUM[entity];
}

/** Çiftin sıradan bağımsız anahtarı: küçük id + ":" + büyük id. */
export function pairKeyOf(aId: string, bId: string): string {
  return aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`;
}

export type DuplicateReviewDto = {
  id: string;
  entity: DuplicateReviewEntity;
  pairKey: string;
  aId: string;
  bId: string;
  decision: DuplicateReviewDecision;
  note: string | null;
  evidence: unknown;
  decidedAt: Date;
  decidedBy: { id: string; username: string; fullName: string | null } | null;
};

const SELECT = {
  id: true,
  entity: true,
  pairKey: true,
  aId: true,
  bId: true,
  decision: true,
  note: true,
  evidence: true,
  decidedAt: true,
  decidedBy: { select: { id: true, username: true, fullName: true } },
} satisfies Prisma.DuplicateReviewSelect;

/** Operatörün panelden verebildiği kararlar — MERGED yalnız motor yazar. */
export const OPERATOR_DECISIONS = [
  DuplicateReviewDecision.NOT_DUPLICATE,
  DuplicateReviewDecision.DEFERRED,
] as const;

export const DuplicateReviewService = {
  /** Varlığın tüm kararları (tespit servisi süzmek için okur; panel "Kararlar" sekmesi). */
  async list(
    entity: MergeEntity,
    decision?: DuplicateReviewDecision,
  ): Promise<DuplicateReviewDto[]> {
    return prisma.duplicateReview.findMany({
      where: { entity: reviewEntityOf(entity), ...(decision ? { decision } : {}) },
      select: SELECT,
      orderBy: { decidedAt: "desc" },
    });
  },

  /** Çift anahtarı → karar haritası (tarama süzgeci için). */
  async mapByPairKey(entity: MergeEntity): Promise<Map<string, DuplicateReviewDto>> {
    const rows = await this.list(entity);
    return new Map(rows.map((r) => [r.pairKey, r]));
  },

  /**
   * Operatör kararı (NOT_DUPLICATE | DEFERRED) — aynı çift için tek satır (upsert).
   * `evidence` karar anındaki gerekçe snapshot'ıdır (panel gönderir); sorgulanmaz.
   */
  async decide(params: {
    entity: MergeEntity;
    aId: string;
    bId: string;
    decision: DuplicateReviewDecision;
    note?: string | null;
    evidence?: unknown;
    userId?: string;
  }): Promise<DuplicateReviewDto> {
    if (params.aId === params.bId) throw AppError.badRequest("Aynı kayıt kendisiyle çift olamaz.");
    if (!(OPERATOR_DECISIONS as readonly string[]).includes(params.decision)) {
      throw AppError.badRequest("Bu karar panelden verilemez (MERGED yalnız birleştirme motoru yazar).");
    }
    const entity = reviewEntityOf(params.entity);
    const pairKey = pairKeyOf(params.aId, params.bId);
    const note = params.note?.trim() ? params.note.trim().slice(0, 500) : null;
    const evidence = (params.evidence ?? null) as Prisma.InputJsonValue | null;
    const existing = await prisma.duplicateReview.findUnique({
      where: { entity_pairKey: { entity, pairKey } },
      select: { id: true, decision: true, note: true },
    });
    const row = await prisma.duplicateReview.upsert({
      where: { entity_pairKey: { entity, pairKey } },
      create: {
        entity,
        pairKey,
        aId: params.aId < params.bId ? params.aId : params.bId,
        bId: params.aId < params.bId ? params.bId : params.aId,
        decision: params.decision,
        note,
        evidence: evidence ?? Prisma.JsonNull,
        decidedById: params.userId ?? null,
      },
      update: {
        decision: params.decision,
        note,
        evidence: evidence ?? Prisma.JsonNull,
        decidedById: params.userId ?? null,
        decidedAt: new Date(),
      },
      select: SELECT,
    });
    await AuditService.log({
      userId: params.userId,
      action: existing ? "UPDATE" : "CREATE",
      tableName: "duplicate_reviews",
      recordId: row.id,
      oldData: existing ? { decision: existing.decision, note: existing.note } : undefined,
      newData: { entity, pairKey, decision: row.decision, note: row.note, event: "DUPLICATE_REVIEW" },
    });
    return row;
  },

  /** Kararı geri aç — satır silinir (çift bir sonraki taramada yine kuyruğa düşer). */
  async reopen(id: string, userId?: string): Promise<void> {
    const existing = await prisma.duplicateReview.findUnique({ where: { id }, select: SELECT });
    if (!existing) throw AppError.notFound("Karar bulunamadı.");
    if (existing.decision === DuplicateReviewDecision.MERGED) {
      throw AppError.conflict("Birleştirilmiş çiftin kararı geri açılamaz — birleştirme geri alınamaz.");
    }
    await prisma.duplicateReview.delete({ where: { id } });
    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "duplicate_reviews",
      recordId: id,
      oldData: { entity: existing.entity, pairKey: existing.pairKey, decision: existing.decision, note: existing.note },
      newData: { event: "DUPLICATE_REVIEW_REOPENED" },
    });
  },

  /**
   * Birleştirme motoru çağırır: survivor × her kaynak → MERGED. Best-effort —
   * kuyruk izi birleştirmeyi ASLA geri sarmaz (hata yutulur, log'a düşer).
   */
  async markMerged(
    entity: MergeEntity,
    survivorId: string,
    sourceIds: string[],
    userId?: string,
    reason?: string,
  ): Promise<void> {
    const enumEntity = reviewEntityOf(entity);
    for (const sourceId of sourceIds) {
      const pairKey = pairKeyOf(survivorId, sourceId);
      try {
        await prisma.duplicateReview.upsert({
          where: { entity_pairKey: { entity: enumEntity, pairKey } },
          create: {
            entity: enumEntity,
            pairKey,
            aId: survivorId < sourceId ? survivorId : sourceId,
            bId: survivorId < sourceId ? sourceId : survivorId,
            decision: DuplicateReviewDecision.MERGED,
            note: reason ? reason.slice(0, 500) : null,
            evidence: { survivorId, sourceId },
            decidedById: userId ?? null,
          },
          update: {
            decision: DuplicateReviewDecision.MERGED,
            note: reason ? reason.slice(0, 500) : null,
            evidence: { survivorId, sourceId },
            decidedById: userId ?? null,
            decidedAt: new Date(),
          },
          select: { id: true },
        });
      } catch (e) {
        uyari("duplicate-review", `MERGED izi yazılamadı (${entity} ${pairKey}):`, (e as Error).message);
      }
    }
  },
};
