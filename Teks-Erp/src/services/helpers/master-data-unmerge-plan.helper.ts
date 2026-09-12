// =============================================================================
// BİRLEŞTİRME GERİ ALMA PLANI — "geri alınabilir mi, neye dokunacak" (yazmaz)
// =============================================================================
// Önizleme ile geri almanın KENDİSİ aynı planı kurar; ayrışırsa ekran bir şey
// gösterir, işlem başkasını yapar. Burada dört karar verilir:
//   • defter var mı (defter öncesi birleştirme geri alınamaz)
//   • hedef kayıt hâlâ canlı mı, kaynaklar hâlâ bu birleştirmenin tombstone'u mu
//   • LIFO: bu kayıtları ilgilendiren daha sonraki (geri alınmamış) birleştirme
//   • ad çakışması: tombstone kalkınca `nameFold` partial unique'i ihlal eder mi
//     (mükerrerlerin katlanmış adı çoğunlukla AYNIDIR — yeni ad KULLANICI kararı)
// =============================================================================
import { MergeRefKind, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { foldColorNameForCompare, foldNameForCompare } from "./name-normalize.helper";
import { MERGE_ENTITIES, type MergeEntity } from "../../constants/merge-map";

export const TABLE_OF: Record<MergeEntity, string> = {
  customer: "customers",
  item: "items",
  color: "colors",
  subcontractor: "subcontractors",
};

export function entityOf(raw: string): MergeEntity {
  if (!(MERGE_ENTITIES as readonly string[]).includes(raw)) {
    throw AppError.internal(`Birleştirme defterinde tanınmayan varlık: '${raw}'.`);
  }
  return raw as MergeEntity;
}

export function foldOf(entity: MergeEntity, name: string): string {
  return entity === "color" ? foldColorNameForCompare(name) : foldNameForCompare(name);
}

export const OPERATION_INCLUDE = {
  sources: { orderBy: { createdAt: "asc" } },
  refs: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.MergeOperationInclude;

export type OperationWithChildren = Prisma.MergeOperationGetPayload<{ include: typeof OPERATION_INCLUDE }>;

/** Hem tx hem kök istemci: plan önizlemede tx'siz, stornoda tx içinde kurulur. */
export type Db = Prisma.TransactionClient | typeof prisma;

export interface UnmergeSourcePlan {
  sourceId: string;
  nameBefore: string;
  codeBefore: string | null;
  isActiveBefore: boolean;
  /** Tombstone hâlâ bu survivor'a mı bakıyor (değilse geri alınamaz). */
  stillMerged: boolean;
  /** Adı hayattaki bir kayıtla çakışıyor → istek YENİ AD taşımalı. */
  needsRename: boolean;
  collidesWith: string | null;
}

export interface UnmergePlan {
  operationId: string;
  entity: MergeEntity;
  survivorId: string;
  reason: string;
  createdAt: Date;
  revertedAt: Date | null;
  blockers: string[];
  sources: UnmergeSourcePlan[];
  /** Tablo+kolon+tip başına kaç satır geri yazılacak (defterdeki sayı). */
  refs: Array<{ tableName: string; columnName: string; kind: MergeRefKind; count: number }>;
}

/**
 * Hayattaki kayıtların katlanmış adları (kaynaklar hariç) — tombstone kalkınca
 * `<tablo>_nameFold_key` partial unique'ini ihlal edecek ad buradan bulunur.
 */
async function liveNameFolds(
  db: Db,
  entity: MergeEntity,
  table: string,
  sourceIds: string[],
): Promise<Map<string, string>> {
  const live = await db.$queryRawUnsafe<Array<{ id: string; name: string }>>(
    `SELECT id, "name" FROM "${table}" WHERE "mergedIntoId" IS NULL AND id <> ALL($1::uuid[])`,
    sourceIds,
  );
  return new Map(live.map((r: { id: string; name: string }) => [foldOf(entity, r.name), r.name]));
}

/** Geri alma planı — önizleme ve işlem AYNI fonksiyondan okur. */
export async function buildPlan(
  db: Prisma.TransactionClient | typeof prisma,
  op: OperationWithChildren,
  renames: Record<string, string>,
): Promise<UnmergePlan> {
  const entity = entityOf(op.entity);
  const table = TABLE_OF[entity];
  const blockers: string[] = [];
  if (op.revertedAt) blockers.push("Bu birleştirme zaten geri alınmış.");
  // ⚠️ KALEMSİZ OPERASYON ENGEL DEĞİLDİR (ölçüldü 2026-09-12): kaynağa işaret eden
  // HİÇBİR satır yoksa taşıma da olmaz ve defter boş kalır — geri alma o zaman
  // yalnız tombstone'u kaldırır. "Defter öncesi birleştirme" ayrı bir kümedir:
  // onların `MergeOperation` satırı HİÇ YOKTUR, yani bu uca zaten gelemezler.

  const ids = [op.survivorId, ...op.sources.map((s) => s.sourceId)];
  const rows = await db.$queryRawUnsafe<Array<{ id: string; name: string; mergedIntoId: string | null }>>(
    `SELECT id, "name", "mergedIntoId" FROM "${table}" WHERE id = ANY($1::uuid[])`,
    ids,
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const survivor = byId.get(op.survivorId);
  if (!survivor) blockers.push("Hedef kayıt bulunamadı.");
  else if (survivor.mergedIntoId) {
    blockers.push("Hedef kayıt sonradan başka bir kayda birleştirilmiş — önce onun birleştirmesi geri alınmalı.");
  }

  // LIFO: bu kayıtları ilgilendiren DAHA SONRAKİ, geri alınmamış operasyon.
  const later = await db.mergeOperation.findFirst({
    where: {
      id: { not: op.id },
      revertedAt: null,
      createdAt: { gt: op.createdAt },
      OR: [{ survivorId: { in: ids } }, { sources: { some: { sourceId: { in: ids } } } }],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });
  if (later) {
    blockers.push(
      `Bu kayıtlar daha sonra bir kez daha birleştirilmiş (${later.createdAt.toISOString().slice(0, 10)}) — ` +
        "önce o birleştirme geri alınmalı (en yenisi önce).",
    );
  }

  const liveFolds = await liveNameFolds(db, entity, table, op.sources.map((s) => s.sourceId));
  const sources: UnmergeSourcePlan[] = op.sources.map((src) => {
    const fresh = byId.get(src.sourceId);
    const stillMerged = fresh?.mergedIntoId === op.survivorId;
    const targetName = renames[src.sourceId]?.trim() || src.nameBefore;
    const clash = liveFolds.get(foldOf(entity, targetName)) ?? null;
    return {
      sourceId: src.sourceId,
      nameBefore: src.nameBefore,
      codeBefore: src.codeBefore,
      isActiveBefore: src.isActiveBefore,
      stillMerged,
      needsRename: Boolean(clash),
      collidesWith: clash,
    };
  });
  const notMerged = sources.filter((s) => !s.stillMerged);
  if (notMerged.length > 0) {
    blockers.push(
      `${notMerged.length} kaynak kayıt artık bu birleştirmenin tombstone'u değil (elle değiştirilmiş) — geri alınamaz.`,
    );
  }

  return {
    operationId: op.id,
    entity,
    survivorId: op.survivorId,
    reason: op.reason,
    createdAt: op.createdAt,
    revertedAt: op.revertedAt,
    blockers,
    sources,
    refs: op.refs.map((r) => ({
      tableName: r.tableName,
      columnName: r.columnName,
      kind: r.kind,
      count: r.count,
    })),
  };
}

