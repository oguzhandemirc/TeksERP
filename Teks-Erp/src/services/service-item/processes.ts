// =============================================================================
// HİZMET KARTI ↔ SÜREÇ TÜRÜ EŞLEMESİ (`service_item_processes`, genel fason F3)
// =============================================================================
// Saf yapılandırma pivotu: yazım kart başına KÜME DEĞİŞİMİDİR (çıkan satır hard delete — serbest sınıf),
// iz audit'te (tx dışında, kart kaydına `processCategoryIds` eski/yeni). Bir süreç türü tek karta eşlenir
// (`categoryId` UNIQUE) — başka kartın türü 409 `SERVICE_PROCESS_TAKEN`. Yeni eşleme TANIMDIR:
// `assertServiceItemUsableTx(DEFINITION)` (8030 SHARED → kart FOR SHARE) altında yazılır; pasif karta
// yeni tür eklenemez, yalnız çıkarılabilir.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { assertServiceItemUsableTx } from "../helpers/item-usage.helper";
import { lockAgainstMergeTx } from "../helpers/master-data-live.helper";
import { SERVICE_ITEM_TABLE } from "../helpers/service-item-lifecycle.helper";
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";

export interface ServiceProcessRow {
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  categoryActive: boolean;
  serviceItemId: string;
  serviceItemCode: string;
  serviceItemName: string;
}

const ROW_SELECT = {
  categoryId: true,
  serviceItemId: true,
  category: { select: { code: true, name: true, isActive: true } },
  serviceItem: { select: { code: true, name: true } },
} as const;

type RawRow = Prisma.ServiceItemProcessGetPayload<{ select: typeof ROW_SELECT }>;

function toRow(r: RawRow): ServiceProcessRow {
  return {
    categoryId: r.categoryId, categoryCode: r.category.code, categoryName: r.category.name, categoryActive: r.category.isActive,
    serviceItemId: r.serviceItemId, serviceItemCode: r.serviceItem.code, serviceItemName: r.serviceItem.name,
  };
}

/** Bütün eşlemeler (süreç türü adına göre) — panel "Süreç türleri" ekranı tek istekte okur. */
export async function listServiceProcessMap(): Promise<ServiceProcessRow[]> {
  const rows = await prisma.serviceItemProcess.findMany({ select: ROW_SELECT, orderBy: [{ category: { name: "asc" } }, { id: "asc" }] });
  return rows.map(toRow);
}

async function assertServiceItemExists(serviceItemId: string): Promise<void> {
  const row = await prisma.serviceItem.findUnique({ where: { id: serviceItemId }, select: { id: true } });
  if (!row) throw AppError.notFound("Hizmet kartı bulunamadı");
}

/** Kartın eşlendiği süreç türleri. */
export async function listServiceItemProcesses(serviceItemId: string): Promise<ServiceProcessRow[]> {
  await assertServiceItemExists(serviceItemId);
  const rows = await prisma.serviceItemProcess.findMany({ where: { serviceItemId }, select: ROW_SELECT, orderBy: [{ category: { name: "asc" } }, { id: "asc" }] });
  return rows.map(toRow);
}

/**
 * Kartın süreç türü kümesini verilenle değiştirir. Bilinmeyen tür 400 `SERVICE_PROCESS_CATEGORY_INVALID`;
 * başka karta eşli tür 409 `SERVICE_PROCESS_TAKEN` (eşlendiği kart adıyla); eşzamanlı yazım unique'e
 * çarparsa da 409. Değişiklik yoksa yazmaz, audit atmaz.
 */
export async function replaceServiceItemProcesses(serviceItemId: string, categoryIds: string[], userId?: string): Promise<{ rows: ServiceProcessRow[]; changed: boolean }> {
  await assertServiceItemExists(serviceItemId);
  const want = [...new Set(categoryIds)].sort();
  const cats = want.length === 0 ? [] : await prisma.subcontractorCategory.findMany({ where: { id: { in: want } }, select: { id: true } });
  const missing = want.filter((id) => !cats.some((c) => c.id === id));
  if (missing.length > 0) throw AppError.badRequest("Süreç türü bulunamadı", { code: "SERVICE_PROCESS_CATEGORY_INVALID", categoryIds: missing });

  let before: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      // İlk ifade advisory kilit (8030 SHARED); yeni eşleme ayrıca kart kullanım kapısından (FOR SHARE) geçer.
      await lockAgainstMergeTx(tx);
      const current = await tx.serviceItemProcess.findMany({ where: { serviceItemId }, select: { categoryId: true } });
      before = current.map((r) => r.categoryId).sort();
      const added = want.filter((id) => !before.includes(id));
      if (added.length > 0) await assertServiceItemUsableTx(tx, serviceItemId, "DEFINITION");
      const taken = added.length === 0 ? [] : await sequentialTx(tx).serviceItemProcess.findMany({
        where: { categoryId: { in: added }, serviceItemId: { not: serviceItemId } },
        select: { categoryId: true, category: { select: { name: true } }, serviceItem: { select: { name: true } } },
      });
      if (taken.length > 0) {
        const t = taken[0]!;
        throw AppError.conflict(`"${t.category.name}" süreç türü zaten "${t.serviceItem.name}" hizmet kartına eşli — önce oradan kaldırın.`, {
          code: "SERVICE_PROCESS_TAKEN",
          taken: taken.map((x) => ({ categoryId: x.categoryId, categoryName: x.category.name, serviceItemName: x.serviceItem.name })),
        });
      }
      const removed = before.filter((id) => !want.includes(id));
      if (removed.length > 0) await tx.serviceItemProcess.deleteMany({ where: { serviceItemId, categoryId: { in: removed } } });
      if (added.length > 0) await tx.serviceItemProcess.createMany({ data: added.map((categoryId) => ({ serviceItemId, categoryId })) });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw AppError.conflict("Süreç türü bu sırada başka bir hizmet kartına eşlendi — ekranı yenileyip tekrar deneyin.", { code: "SERVICE_PROCESS_TAKEN" });
    }
    throw err;
  }
  const changed = before.join(",") !== want.join(",");
  if (changed) {
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: SERVICE_ITEM_TABLE,
      recordId: serviceItemId,
      oldData: { processCategoryIds: before },
      newData: { processCategoryIds: want },
    });
  }
  return { rows: await listServiceItemProcesses(serviceItemId), changed };
}
