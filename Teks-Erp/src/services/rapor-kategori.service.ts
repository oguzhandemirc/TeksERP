// =============================================================================
// RAPOR KATEGORİLERİ — en çok iki seviye, yalnız boş kategori pasife (R1-KAYIT; plan §3.3)
// =============================================================================
// KATALOG sınıfı: "sil" = pasife alma durum geçişidir ve yalnız İÇİ BOŞ (arşivde olmayan tanım ya da
// aktif alt kategori yok) kategoride olur — koşul atomik WHERE'in içindedir. Sistem kategorileri
// (`code` dolu) boot uzlaştırmasının malıdır: adı/yeri panelden değişmez. Yazım `report:publish`.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";

/** Kategorisiz kaydedilen özel raporun evi (boot'ta doğar). */
export const DEFAULT_CATEGORY_CODE = "kayitli";

const CATEGORY_SELECT = { id: true, code: true, name: true, parentId: true, sortOrder: true, isActive: true } satisfies Prisma.ReportCategorySelect;
type CategoryRow = Prisma.ReportCategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;

export interface ReportCategoryDto {
  id: string;
  kod: string | null;
  ad: string;
  ustId: string | null;
  sira: number;
  aktif: boolean;
  sistem: boolean;
}

const toDto = (c: CategoryRow): ReportCategoryDto => ({
  id: c.id, kod: c.code, ad: c.name, ustId: c.parentId, sira: c.sortOrder, aktif: c.isActive, sistem: c.code !== null,
});

export async function listCategories(includeInactive: boolean): Promise<ReportCategoryDto[]> {
  const rows = await prisma.reportCategory.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: CATEGORY_SELECT,
  });
  return rows.map(toDto);
}

/** Üst kategori aktif ve kendisi kök olmalı (≤2 seviye). */
async function assertParent(parentId: string | null | undefined, selfId?: string): Promise<void> {
  if (!parentId) return;
  if (parentId === selfId) throw AppError.badRequest("Kategori kendi altına taşınamaz.", { code: "RAPOR_KATEGORI_DERINLIK" });
  const p = await prisma.reportCategory.findFirst({ where: { id: parentId, isActive: true }, select: { parentId: true } });
  if (!p) throw AppError.badRequest("Üst kategori bulunamadı ya da pasif.", { code: "RAPOR_KATEGORI_YOK" });
  if (p.parentId) throw AppError.badRequest("Kategoriler en çok iki seviyedir; alt kategorinin altına kategori açılamaz.", { code: "RAPOR_KATEGORI_DERINLIK" });
  if (selfId) {
    const kids = await prisma.reportCategory.count({ where: { parentId: selfId, isActive: true } });
    if (kids) throw AppError.badRequest("Alt kategorisi olan kategori başka bir kategorinin altına taşınamaz.", { code: "RAPOR_KATEGORI_DERINLIK" });
  }
}

export interface CategoryInput {
  ad: string;
  ustId?: string | null;
  sira?: number;
}

export async function createCategory(input: CategoryInput, userId: string): Promise<ReportCategoryDto> {
  await assertParent(input.ustId);
  const row = await prisma.reportCategory.create({
    data: { name: input.ad.trim(), parentId: input.ustId ?? null, sortOrder: input.sira ?? 100, createdById: userId, updatedById: userId },
    select: CATEGORY_SELECT,
  });
  await AuditService.log({ userId, action: "CREATE", tableName: "REPORT_CATEGORY", recordId: row.id, newData: { ad: row.name, ustId: row.parentId, sira: row.sortOrder } });
  return toDto(row);
}

export async function updateCategory(id: string, input: Partial<CategoryInput>, userId: string): Promise<ReportCategoryDto> {
  const before = await prisma.reportCategory.findUnique({ where: { id }, select: CATEGORY_SELECT });
  if (!before) throw AppError.notFound("Kategori bulunamadı.", { code: "RAPOR_KATEGORI_YOK" });
  if (before.code !== null) throw AppError.conflict("Sistem kategorisi değiştirilemez.", { code: "RAPOR_KATEGORI_SISTEM" });
  if (input.ustId !== undefined) await assertParent(input.ustId, id);
  const data = {
    ...(input.ad !== undefined ? { name: input.ad.trim() } : {}),
    ...(input.ustId !== undefined ? { parentId: input.ustId } : {}),
    ...(input.sira !== undefined ? { sortOrder: input.sira } : {}),
  };
  const n = await prisma.reportCategory.updateMany({ where: { id, isActive: true, code: null }, data: { ...data, updatedById: userId } });
  if (n.count === 0) throw AppError.conflict("Kategori pasif; değiştirilemez.", { code: "RAPOR_KATEGORI_PASIF" });
  await AuditService.log({ userId, action: "UPDATE", tableName: "REPORT_CATEGORY", recordId: id, oldData: { ad: before.name, ustId: before.parentId, sira: before.sortOrder }, newData: data });
  return toDto(await prisma.reportCategory.findUniqueOrThrow({ where: { id }, select: CATEGORY_SELECT }));
}

/** Pasife alma: boşluk koşulu claim'in WHERE'inde (arada rapor eklenirse 0 satır → 409). */
export async function deactivateCategory(id: string, userId: string): Promise<ReportCategoryDto> {
  const before = await prisma.reportCategory.findUnique({ where: { id }, select: CATEGORY_SELECT });
  if (!before) throw AppError.notFound("Kategori bulunamadı.", { code: "RAPOR_KATEGORI_YOK" });
  if (before.code !== null) throw AppError.conflict("Sistem kategorisi pasife alınamaz.", { code: "RAPOR_KATEGORI_SISTEM" });
  const n = await prisma.reportCategory.updateMany({
    where: {
      id, isActive: true, code: null,
      definitions: { none: { status: { not: "ARSIV" } } },
      children: { none: { isActive: true } },
    },
    data: { isActive: false, updatedById: userId },
  });
  if (n.count === 0) {
    throw AppError.conflict("Kategori boş değil (içinde rapor ya da alt kategori var) ya da zaten pasif; önce raporları başka kategoriye taşıyın.", { code: "RAPOR_KATEGORI_BOS_DEGIL" });
  }
  await AuditService.log({ userId, action: "UPDATE", tableName: "REPORT_CATEGORY", recordId: id, oldData: { aktif: true }, newData: { aktif: false } });
  return toDto({ ...before, isActive: false });
}
