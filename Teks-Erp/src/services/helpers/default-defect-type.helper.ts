// =============================================================================
// VARSAYILAN HATA TİPİ — tipsiz hata girişinin TEK çözümü (karar A, 2026-09-14)
// =============================================================================
// Tablet "hata tipi seçilmedi" hâlinde listenin ilkini uyduruyordu (sıra bir
// karar değildir). Artık: `defectTypeId` verilmemişse kataloğun `isDefault`
// tipi seçilir; hiç yoksa 400 — sessizce ilk/rastgele tip yazılmaz.
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";

type Db = Pick<Prisma.TransactionClient, "defectType">;

export const DEFAULT_DEFECT_TYPE_MISSING = "DEFAULT_DEFECT_TYPE_MISSING";

/** Aktif varsayılan hata tipi (id + ad); yoksa null. */
export async function findDefaultDefectType(db: Db): Promise<{ id: string; name: string } | null> {
  return db.defectType.findFirst({
    where: { isDefault: true, isActive: true },
    select: { id: true, name: true },
  });
}

/**
 * Hata satırlarının `defectTypeId`si boşsa varsayılanı yazar. Varsayılan yoksa
 * ve en az bir boş satır varsa 400 `DEFAULT_DEFECT_TYPE_MISSING`.
 */
export async function resolveDefaultDefectTypeTx<T extends { defectTypeId?: string | null }>(
  db: Db,
  errors: readonly T[],
): Promise<Array<T & { defectTypeId: string }>> {
  const untyped = errors.filter((e) => !e.defectTypeId);
  if (untyped.length === 0) return errors as Array<T & { defectTypeId: string }>;
  const def = await findDefaultDefectType(db);
  if (!def) {
    throw AppError.badRequest(
      "Hata tipi seçilmedi ve kataloğda varsayılan hata tipi tanımlı değil — Kalite → Hata Tipleri'nden bir tipi varsayılan yapın ya da hata tipini seçin.",
      { code: DEFAULT_DEFECT_TYPE_MISSING },
    );
  }
  return errors.map((e) => (e.defectTypeId ? e : { ...e, defectTypeId: def.id })) as Array<T & { defectTypeId: string }>;
}

/**
 * Varsayılanı DEĞİŞTİR — tek tx: eski varsayılan(lar) düşer, hedef yükselir.
 * Partial unique (`defect_types_one_default`) DB seddidir; bu sıra onu ihlal etmez.
 * Pasif tipe varsayılan verilmez (tipsiz giriş pasife düşerdi). Audit çağıranda.
 */
export async function setDefaultDefectTypeTx(
  tx: Pick<Prisma.TransactionClient, "defectType">,
  id: string,
): Promise<{ previousId: string | null }> {
  const target = await tx.defectType.findUnique({ where: { id }, select: { id: true, isActive: true, isDefault: true } });
  if (!target) throw AppError.notFound("Hata tipi bulunamadı");
  if (!target.isActive) throw AppError.badRequest("Pasif hata tipi varsayılan yapılamaz — önce aktifleştirin.");
  const previous = await tx.defectType.findFirst({ where: { isDefault: true }, select: { id: true } });
  if (previous?.id === id) return { previousId: id };
  await tx.defectType.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  await tx.defectType.update({ where: { id }, data: { isDefault: true } });
  return { previousId: previous?.id ?? null };
}

/** Route'un tek çağrısı — tx sınırı burada (route/controller `prisma` import etmez). */
export function setDefaultDefectType(id: string): Promise<{ previousId: string | null }> {
  return prisma.$transaction((tx) => setDefaultDefectTypeTx(tx, id));
}
