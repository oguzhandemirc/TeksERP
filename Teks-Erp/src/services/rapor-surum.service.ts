// =============================================================================
// KAYITLI RAPOR SÜRÜMLERİ — değişmez sürüm satırı + yürürlükteki sürüm claim'i (R1-KAYIT)
// =============================================================================
// Sürüm satırı ne güncellenir ne silinir; yeni sürüm `activeVersionId` claim'iyle yürürlüğe girer
// (beklenen sürüm değilse 409). Uç idempotenttir: `clientToken @unique` + token-replay boğazı.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { tokenReplay } from "./helpers/token-replay.helper";
import { factoryDateTimeTr } from "../constants/time";
import { stableStringify } from "./reports/semantik/onbellek";
import { assertValidBody, loadEditable, loadVisible, type Actor } from "./rapor-tanimi.service";

export async function listVersions(id: string, a: Actor) {
  const row = await loadVisible(id, a);
  const rows = await prisma.reportDefinitionVersion.findMany({
    where: { definitionId: id },
    orderBy: { versionNo: "desc" },
    select: { id: true, versionNo: true, note: true, createdAt: true, createdBy: { select: { fullName: true } } },
  });
  return rows.map((v) => ({
    id: v.id, no: v.versionNo, not: v.note, tarih: v.createdAt.toISOString(), tarihMetni: factoryDateTimeTr(v.createdAt),
    yazan: v.createdBy?.fullName ?? null, aktif: v.id === row.activeVersionId,
  }));
}

export async function getVersion(id: string, versionId: string, a: Actor) {
  await loadVisible(id, a);
  const v = await prisma.reportDefinitionVersion.findFirst({ where: { id: versionId, definitionId: id }, select: { id: true, versionNo: true, body: true, note: true, createdAt: true } });
  if (!v) throw AppError.notFound("Rapor sürümü bulunamadı.", { code: "RAPOR_SURUMU_YOK" });
  return { id: v.id, no: v.versionNo, govde: v.body, not: v.note, tarih: v.createdAt.toISOString() };
}

export interface NewVersionInput {
  govde: unknown;
  beklenenSurumId: string;
  not?: string | null;
  clientToken?: string | null;
}

/** Yeni DEĞİŞMEZ sürüm + aktif sürüm claim'i (`WHERE {id, activeVersionId: beklenen}` → 0 ise 409). */
function versionReplay(id: string, a: Actor, input: NewVersionInput) {
  return tokenReplay<{ id: string; versionNo: number; definitionId: string; createdById: string | null; body: unknown }, { id: string; no: number }>({
    find: (db, clientToken) =>
      db.reportDefinitionVersion.findUnique({ where: { clientToken }, select: { id: true, versionNo: true, definitionId: true, createdById: true, body: true } }),
    alive: { neverDies: "rapor sürümü değişmez ve silinmez (RAPOR_SURUMU_DEGISMEZ)" },
    identity: (p) => [
      { ad: "definitionId", mevcut: p.definitionId, gelen: id },
      { ad: "createdById", mevcut: p.createdById, gelen: a.userId },
      { ad: "govde", mevcut: stableStringify(p.body), gelen: stableStringify(assertValidBody(input.govde).body) },
    ],
    collision: "Bu işlem kimliği başka bir rapor sürümüne ait; kaydı yeniden gönderin.",
    respond: (p) => ({ id: p.id, no: p.versionNo }),
  });
}

export async function saveNewVersion(id: string, input: NewVersionInput, a: Actor) {
  await loadEditable(id, a);
  const { body, permissions } = assertValidBody(input.govde);
  return versionReplay(id, a, input).run(input.clientToken, async () => {
    const conflict = () =>
      AppError.conflict("Rapor siz düzenlerken başka biri tarafından kaydedildi; son sürümü açıp değişikliğinizi yeniden uygulayın.", { code: "RAPOR_SURUM_CAKISMASI" });
    const created = await prisma.$transaction(async (tx) => {
      const last = await tx.reportDefinitionVersion.findFirst({ where: { definitionId: id }, orderBy: { versionNo: "desc" }, select: { versionNo: true } });
      const v = await tx.reportDefinitionVersion.create({
        data: {
          definitionId: id, versionNo: (last?.versionNo ?? 0) + 1, body: body as Prisma.InputJsonValue, requiredPermissions: permissions,
          createdById: a.userId, note: input.not ?? null, clientToken: input.clientToken ?? null,
        },
        select: { id: true, versionNo: true },
      });
      const claim = await tx.reportDefinition.updateMany({
        where: { id, activeVersionId: input.beklenenSurumId, status: { not: "ARSIV" } },
        data: { activeVersionId: v.id, isBroken: false, updatedById: a.userId },
      });
      if (claim.count === 0) throw conflict();
      return v;
    }).catch((e: unknown) => {
      // Aynı anda iki kayıt aynı numarayı almaya çalıştı: kaybeden de çakışmadır.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict();
      throw e;
    });
    await AuditService.log({
      userId: a.userId, action: "CREATE", tableName: "REPORT_DEFINITION_VERSION", recordId: created.id,
      newData: { tanimId: id, surumNo: created.versionNo, oncekiSurumId: input.beklenenSurumId },
    });
    return { id: created.id, no: created.versionNo };
  });
}

/** Sürüm satırı değişmez ve silinmez — uç bunu açıkça söyler (sessiz 404 değil). */
export async function refuseVersionRemoval(id: string, versionId: string, a: Actor): Promise<never> {
  await getVersion(id, versionId, a);
  throw AppError.conflict("Rapor sürümleri silinmez; eski hâline dönmek için o sürümü yeni sürüm olarak kaydedin.", { code: "RAPOR_SURUMU_DEGISMEZ" });
}
