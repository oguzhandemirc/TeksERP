// =============================================================================
// KAYITLI RAPOR PAYLAŞIMI — görünürlük + kullanıcı pivotu (R1-KAYIT)
// =============================================================================
// Paylaşım görünürlük verir, veri yetkisi VERMEZ (blok izinleri koşuda). Pivot saf yapılandırmadır:
// replace = deleteMany + createMany tek tx'te; HERKES görünürlüğü yalnız `report:publish`.
// =============================================================================
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { matchesPermission } from "../middlewares/rbac.middleware";
import { REPORT_PUBLISH_PERMISSION } from "../constants/permission-catalog";
import { loadVisible, type Actor, type Visibility } from "./rapor-tanimi.service";

/** Paylaşım diyaloğunun aday listesi: etkin kullanıcıların yalnız kimliği ve adı (yönetici listesi değil). */
export async function listShareCandidates(a: Actor, term: string | undefined) {
  const q = term?.trim();
  const rows = await prisma.user.findMany({
    where: { isActive: true, deletedAt: null, id: { not: a.userId }, ...(q ? { fullName: { contains: q, mode: "insensitive" as const } } : {}) },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
    take: 200,
  });
  return rows.map((u) => ({ id: u.id, ad: u.fullName }));
}

export interface ShareInput {
  gorunurluk: Visibility;
  paylasimlar: Array<{ kullaniciId: string; yetki: "GOR" | "DUZENLE" }>;
}

export async function listShares(id: string, a: Actor) {
  const row = await loadVisible(id, a);
  const rows = await prisma.reportShare.findMany({ where: { definitionId: id }, select: { userId: true, access: true, user: { select: { fullName: true } } }, orderBy: { createdAt: "asc" } });
  return { gorunurluk: row.visibility, paylasimlar: rows.map((r) => ({ kullaniciId: r.userId, ad: r.user.fullName, yetki: r.access })) };
}

/** Saf pivot replace + görünürlük; yalnız sahip ya da `report:publish`; HERKES yalnız `report:publish`. */
export async function replaceShares(id: string, input: ShareInput, a: Actor) {
  const row = await loadVisible(id, a);
  if (row.kind !== "OZEL" || row.status === "ARSIV") throw AppError.conflict("Bu rapor paylaşılamaz.", { code: "RAPOR_PAYLASILAMAZ" });
  const publisher = matchesPermission(a.permissions, REPORT_PUBLISH_PERMISSION);
  if (row.ownerId !== a.userId && !publisher) throw AppError.forbidden("Raporu yalnız sahibi paylaşabilir.", { code: "RAPOR_PAYLASIM_YETKISI_YOK" });
  if (input.gorunurluk === "HERKES" && !publisher) {
    throw AppError.forbidden("Raporu herkese açmak için rapor yayınlama yetkisi gerekir.", { code: "RAPOR_YAYIN_YETKISI_YOK" });
  }
  const ids = [...new Set(input.paylasimlar.map((p) => p.kullaniciId))].filter((u) => u !== row.ownerId);
  if (ids.length) {
    const found = await prisma.user.count({ where: { id: { in: ids }, isActive: true, deletedAt: null } });
    if (found !== ids.length) throw AppError.badRequest("Paylaşılan kullanıcılardan biri bulunamadı ya da pasif.", { code: "RAPOR_PAYLASIM_KULLANICI_YOK" });
  }
  const before = await listShares(id, a);
  await prisma.$transaction(async (tx) => {
    await tx.reportShare.deleteMany({ where: { definitionId: id } });
    if (ids.length) {
      await tx.reportShare.createMany({ data: ids.map((u) => ({ definitionId: id, userId: u, access: input.paylasimlar.find((p) => p.kullaniciId === u)!.yetki })) });
    }
    await tx.reportDefinition.updateMany({ where: { id }, data: { visibility: input.gorunurluk, updatedById: a.userId } });
  });
  await AuditService.log({
    userId: a.userId, action: "UPDATE", tableName: "REPORT_SHARE", recordId: id,
    oldData: { gorunurluk: before.gorunurluk, paylasimlar: before.paylasimlar.map((p) => ({ kullaniciId: p.kullaniciId, yetki: p.yetki })) },
    newData: { gorunurluk: input.gorunurluk, paylasimlar: ids.map((u) => ({ kullaniciId: u, yetki: input.paylasimlar.find((p) => p.kullaniciId === u)!.yetki })) },
  });
  return listShares(id, a);
}
