// =============================================================================
// BİRLEŞTİRMEYİ GERİ ALMA (unmerge) — defterden okunur, ileri satır değişmez
// =============================================================================
// `master-data-merge` "EN YIKICI ve geri alınamaz" diye yazılmıştı; geri
// alınamazlığın sebebi KARAR değil EKSİK DEFTERdi: taşınan satırın kimliği
// hiçbir yerde durmuyordu (audit yalnız tablo başına SAYI tutuyor ve 6 ayda
// arşivleniyor). `MergeOperation` defteri geldikten sonra geri alma okunabilir
// bir işlemdir ve bu servis onu yapar.
//
// ⚠️ İLERİ SATIR DEĞİŞMEZ: operasyon satırı ve kalemleri DURUR, geri alma
// `revertedAt`/`revertedById`/`revertReason` DAMGASIDIR (defter doktrini).
//
// ⚠️ LIFO: bir kaydı ilgilendiren DAHA SONRAKİ (geri alınmamış) birleştirme
// varsa bu operasyon geri alınamaz — aradaki operasyonun taşıdığı satırlar bu
// geri almanın kümesinde değildir ve sıra bozulursa ikisi birbirini yalanlar.
//
// ⚠️ AD ÇAKIŞMASI KULLANICI KARARIDIR: mükerrerlerin katlanmış adı çoğunlukla
// AYNIDIR ve `<tablo>_nameFold_key` partial unique'i (WHERE mergedIntoId IS NULL)
// tombstone kalkar kalkmaz ikinci satırı reddeder. Bu yüzden geri alma isteği
// çakışan kaynak için YENİ AD taşır; önizleme hangi kaynağın ad istediğini söyler.
//
// ⚠️ ATLANAN SATIR SESSİZ DEĞİL: birleştirmeden sonra başka bir yere taşınmış,
// silinmiş ya da anahtarı yeniden doğmuş satır geri yazılamaz; sayısı yanıtta ve
// audit'te AYRI alan olarak durur ("hepsi döndü" yalanı yok).
// =============================================================================
import { ItemLifecycleStatus, MergeRefKind, Prisma } from "@prisma/client";
import { itemLifecycleWriteData } from "./helpers/item-lifecycle-data.helper";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { DuplicateReviewService } from "./duplicate-review.service";
import {
  newPkCache,
  repointBackTx,
  restoreDeletedRowsTx,
  restoreSnapshotRowsTx,
} from "./helpers/merge-ledger.helper";
import { type MergeEntity } from "../constants/merge-map";
// Advisory uzayı TEK YERDE tanımlanır (envanter kuralı, `period-guard.helper` başlığı):
// geri alma birleştirmeyle AYNI satırlara dokunur, yani aynı uzayı İTHAL EDER.
import { MERGE_LOCK_KEY, MERGE_LOCK_NS } from "./master-data-merge.service";
import {
  buildPlan,
  entityOf,
  OPERATION_INCLUDE,
  TABLE_OF,
  type UnmergePlan,
  type UnmergeSourcePlan,
} from "./helpers/master-data-unmerge-plan.helper";

export type { UnmergePlan, UnmergeSourcePlan };

const UNMERGE_TX_TIMEOUT_MS = 120_000;

export interface UnmergeOutcome {
  operationId: string;
  entity: MergeEntity;
  restoredSources: number;
  repointedRows: number;
  restoredDeletedRows: number;
  restoredFieldRows: number;
  /** Defterde duran ama bugün geri yazılamayan satır sayısı (sessiz değil). */
  skippedRows: number;
}

export class MasterDataUnmergeService {
  /** Defterdeki birleştirmeler — en yeni önce (geri alma ekranının listesi). */
  static async list(params: { entity?: string; limit?: number }): Promise<
    Array<{
      id: string;
      entity: string;
      survivorId: string;
      reason: string;
      createdAt: Date;
      createdById: string | null;
      revertedAt: Date | null;
      revertReason: string | null;
      sourceCount: number;
      movedRows: number;
    }>
  > {
    const take = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const rows = await prisma.mergeOperation.findMany({
      where: params.entity ? { entity: params.entity } : {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      include: { sources: { select: { id: true } }, refs: { select: { count: true, kind: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      entity: r.entity,
      survivorId: r.survivorId,
      reason: r.reason,
      createdAt: r.createdAt,
      createdById: r.createdById,
      revertedAt: r.revertedAt,
      revertReason: r.revertReason,
      sourceCount: r.sources.length,
      movedRows: r.refs.filter((x) => x.kind === MergeRefKind.MOVED).reduce((a, x) => a + x.count, 0),
    }));
  }

  static async preview(operationId: string, renames: Record<string, string> = {}): Promise<UnmergePlan> {
    const op = await prisma.mergeOperation.findUnique({ where: { id: operationId }, include: OPERATION_INCLUDE });
    if (!op) throw AppError.notFound("Birleştirme kaydı bulunamadı.");
    return buildPlan(prisma, op, renames);
  }

  static async revert(
    operationId: string,
    params: { reason: string; renames?: Record<string, string>; userId?: string },
  ): Promise<UnmergeOutcome> {
    const reason = params.reason?.trim() ?? "";
    if (reason.length < 10) {
      throw AppError.badRequest("Geri alma gerekçesi en az 10 karakter olmalı — bu kararın başka kaydı yok.");
    }
    const renames = params.renames ?? {};

    const outcome = await prisma.$transaction(
      (tx) => revertTx({ tx, operationId, reason, renames, userId: params.userId }),
      { timeout: UNMERGE_TX_TIMEOUT_MS, maxWait: 10_000 },
    );

    for (const src of outcome.auditSources) {
      await AuditService.log({
        userId: params.userId,
        action: "UPDATE",
        tableName: outcome.auditTable,
        recordId: src.sourceId,
        oldData: { mergedIntoId: outcome.survivorId, isActive: false },
        newData: {
          event: "MASTER_DATA_UNMERGE",
          operationId,
          reason,
          name: src.name,
          isActive: src.isActive,
          repointedRows: outcome.repointedRows,
          restoredDeletedRows: outcome.restoredDeletedRows,
          skippedRows: outcome.skippedRows,
        },
      });
    }
    await DuplicateReviewService.markUnmerged({
      entity: outcome.entity,
      survivorId: outcome.survivorId,
      sourceIds: outcome.auditSources.map((s) => s.sourceId),
      userId: params.userId,
      reason,
    });
    return {
      operationId,
      entity: outcome.entity,
      restoredSources: outcome.auditSources.length,
      repointedRows: outcome.repointedRows,
      restoredDeletedRows: outcome.restoredDeletedRows,
      restoredFieldRows: outcome.restoredFieldRows,
      skippedRows: outcome.skippedRows,
    };
  }
}

interface RevertInput {
  tx: Prisma.TransactionClient;
  operationId: string;
  reason: string;
  renames: Record<string, string>;
  userId?: string;
}

/** Defterdeki referansları geri yazar: taşınanı kaynağına, silineni fotoğraftan, zenginleşeni eski hâline. */
async function restoreRefsTx(
  tx: Prisma.TransactionClient,
  op: Awaited<ReturnType<typeof loadOperationTx>>,
): Promise<{ repointedRows: number; restoredDeletedRows: number; restoredFieldRows: number; skippedRows: number }> {
  const pkCache = newPkCache();
  let repointedRows = 0;
  let restoredDeletedRows = 0;
  let restoredFieldRows = 0;
  let skippedRows = 0;
  for (const ref of op.refs) {
    if (ref.kind === MergeRefKind.MOVED) {
      const moved = await repointBackTx(tx, {
        table: ref.tableName,
        column: ref.columnName,
        survivorId: op.survivorId,
        sourceId: ref.sourceId as string,
        rowIds: ref.rowIds,
        rowKeys: (ref.rowKeys as Array<Record<string, unknown>> | null) ?? null,
      });
      repointedRows += moved;
      skippedRows += Math.max(0, ref.count - moved);
      continue;
    }
    const rows = (ref.rowData as Array<Record<string, unknown>> | null) ?? [];
    if (ref.kind === MergeRefKind.DELETED) {
      const written = await restoreDeletedRowsTx(tx, { table: ref.tableName, rows });
      restoredDeletedRows += written;
      skippedRows += Math.max(0, ref.count - written);
    } else {
      const written = await restoreSnapshotRowsTx(tx, { table: ref.tableName, rows }, pkCache);
      restoredFieldRows += written;
      skippedRows += Math.max(0, ref.count - written);
    }
  }
  return { repointedRows, restoredDeletedRows, restoredFieldRows, skippedRows };
}

/** Tombstone'ları kaldırır: ad/aktiflik defterdeki ÖNCEKİ hâle (ya da verilen yeni ada). */
async function liftTombstonesTx(
  tx: Prisma.TransactionClient,
  op: Awaited<ReturnType<typeof loadOperationTx>>,
  table: string,
  ctx: { renames: Record<string, string>; userId?: string },
): Promise<Array<{ sourceId: string; name: string; isActive: boolean }>> {
  const { renames, userId } = ctx;
  const out: Array<{ sourceId: string; name: string; isActive: boolean }> = [];
  for (const src of op.sources) {
    const name = (renames[src.sourceId]?.trim() || src.nameBefore).slice(0, 255);
    if (table === "items") {
      out.push(await liftItemTombstoneTx(tx, { survivorId: op.survivorId, src, name, userId }));
      continue;
    }
    const done = await tx.$executeRawUnsafe(
      `UPDATE "${table}"
          SET "mergedIntoId" = NULL, "mergedAt" = NULL, "mergedById" = NULL,
              "isActive" = $1, "name" = $2
        WHERE id = $3::uuid AND "mergedIntoId" = $4::uuid`,
      src.isActiveBefore,
      name,
      src.sourceId,
      op.survivorId,
    );
    if (Number(done) !== 1) {
      throw AppError.conflict("Kaynak kayıt bu sırada değişti — geri alma geri sarıldı.");
    }
    out.push({ sourceId: src.sourceId, name, isActive: src.isActiveBefore });
  }
  return out;
}

/**
 * Ürün mezar taşı: yaşam döngüsü ÖNCEKİ durumuna döner (`isActive` ondan türer — CHECK).
 * Eski operasyonda `lifecycleBefore` yok → `isActiveBefore`dan eşlenir (true→ACTIVE, false→ARCHIVED).
 */
async function liftItemTombstoneTx(
  tx: Prisma.TransactionClient,
  p: {
    survivorId: string;
    src: { sourceId: string; isActiveBefore: boolean; lifecycleBefore: ItemLifecycleStatus | null };
    name: string;
    userId?: string;
  },
): Promise<{ sourceId: string; name: string; isActive: boolean }> {
  const { survivorId, src, name, userId } = p;
  const before =
    src.lifecycleBefore ?? (src.isActiveBefore ? ItemLifecycleStatus.ACTIVE : ItemLifecycleStatus.ARCHIVED);
  const claim = await tx.item.updateMany({
    where: { id: src.sourceId, mergedIntoId: survivorId },
    data: {
      mergedIntoId: null,
      mergedAt: null,
      mergedById: null,
      name,
      ...itemLifecycleWriteData(before, userId, "Birleştirme geri alındı"),
    },
  });
  if (claim.count !== 1) {
    throw AppError.conflict("Kaynak kayıt bu sırada değişti — geri alma geri sarıldı.");
  }
  return { sourceId: src.sourceId, name, isActive: before !== ItemLifecycleStatus.ARCHIVED };
}

/** Survivor'a yazılan alan seçimleri: yalnız DEĞER HÂLÂ birleştirmenin yazdığıysa geri alınır. */
async function restoreFieldPicksTx(
  tx: Prisma.TransactionClient,
  op: Awaited<ReturnType<typeof loadOperationTx>>,
  table: string,
): Promise<number> {
  const picks = (op.fieldPicks as Array<{ field: string; before: string | null; after: string | null }> | null) ?? [];
  let skipped = 0;
  for (const pick of picks) {
    const done = await tx.$executeRawUnsafe(
      `UPDATE "${table}" SET "${pick.field}" = $1 WHERE id = $2::uuid AND "${pick.field}"::text IS NOT DISTINCT FROM $3`,
      pick.before,
      op.survivorId,
      pick.after,
    );
    if (Number(done) === 0) skipped += 1;
  }
  return skipped;
}

async function loadOperationTx(tx: Prisma.TransactionClient, operationId: string) {
  const op = await tx.mergeOperation.findUnique({ where: { id: operationId }, include: OPERATION_INCLUDE });
  if (!op) throw AppError.notFound("Birleştirme kaydı bulunamadı.");
  return op;
}

async function revertTx(input: RevertInput) {
  const { tx, operationId, reason, renames, userId } = input;
  // İLK İFADE: birleştirmeyle AYNI kilit (yazarlar paylaşımlı kilit alır).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MERGE_LOCK_NS}::int, ${MERGE_LOCK_KEY}::int)`;

  const op = await loadOperationTx(tx, operationId);
  const plan = await buildPlan(tx, op, renames);
  const needRename = plan.sources.filter((s) => s.needsRename);
  if (plan.blockers.length > 0 || needRename.length > 0) {
    throw AppError.conflict(
      plan.blockers.length > 0
        ? plan.blockers.join(" · ")
        : `${needRename.length} kaynak kaydın adı hayattaki bir kayıtla çakışıyor — geri alma yeni ad ister.`,
      {
        code: needRename.length > 0 && plan.blockers.length === 0 ? "UNMERGE_NEEDS_RENAME" : "UNMERGE_BLOCKED",
        blockers: plan.blockers,
        needsRename: needRename.map((s) => ({ sourceId: s.sourceId, nameBefore: s.nameBefore, collidesWith: s.collidesWith })),
      },
    );
  }

  const claim = await tx.mergeOperation.updateMany({
    where: { id: operationId, revertedAt: null },
    data: { revertedAt: new Date(), revertedById: userId ?? null, revertReason: reason.slice(0, 500) },
  });
  if (claim.count === 0) throw AppError.conflict("Bu birleştirme az önce geri alınmış.", { code: "UNMERGE_RACE" });

  const entity = plan.entity;
  const table = TABLE_OF[entity];
  const counts = await restoreRefsTx(tx, op);
  const auditSources = await liftTombstonesTx(tx, op, table, { renames, userId });
  const pickSkipped = await restoreFieldPicksTx(tx, op, table);

  return {
    entity,
    survivorId: op.survivorId,
    auditTable: entity.toUpperCase(),
    auditSources,
    repointedRows: counts.repointedRows,
    restoredDeletedRows: counts.restoredDeletedRows,
    restoredFieldRows: counts.restoredFieldRows,
    skippedRows: counts.skippedRows + pickSkipped,
  };
}

export const masterDataUnmergeService = MasterDataUnmergeService;
