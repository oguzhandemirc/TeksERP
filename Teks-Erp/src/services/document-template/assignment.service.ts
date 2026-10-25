// =============================================================================
// Belge şablonu ATAMALARI — tür varsayılanı + müşteri/fasoncu profili (plan §3.7)
// =============================================================================
// Atama satırları saf yapılandırma pivotudur (kaldırma = satır silme). Atanan şablonun
// "ACTIVE + yayında + aynı tür" olması şablon satırındaki dokunma claim'iyle doğrulanır;
// arşiv aynı satırı claim ettiği için ikisi serileşir (arşivlenmiş şablon atanamaz).
// =============================================================================

import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { getContract } from "./sozlesme/kayit";

/** R4 (patron, 2026-10-24): atama ekranının bilgi notu. */
export const PROFILE_OVERLAY_NOTE =
  "Müşteri/fasoncu profilindeki belge ayarı, şablonlu basımda şablonun ayarının ÜSTÜNE uygulanır. Ayarlara (ayar.*) bakmayan, elle tasarlanmış şablonda profil ayarının etkisi olmaz.";

async function claimAssignable(tx: Prisma.TransactionClient, templateId: string, docType: string): Promise<void> {
  const touch = await tx.documentTemplate.updateMany({
    where: { id: templateId, status: "ACTIVE", docType, publishedVersionId: { not: null } },
    data: { updatedAt: new Date() },
  });
  if (touch.count === 0) {
    throw AppError.conflict("Yalnız bu belge türünün etkin ve yayınlanmış şablonu atanabilir.", { code: "TEMPLATE_NOT_ASSIGNABLE", templateId, docType });
  }
}

const isUniqueViolation = (e: unknown): boolean => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

const conflictRetry = () =>
  AppError.conflict("Atama aynı anda başka biri tarafından değiştirildi; listeyi yenileyip yeniden deneyin.", { code: "TEMPLATE_ASSIGNMENT_CONFLICT" });

/** Tür varsayılanı; `templateId: null` → varsayılan kaldırılır (Sistem tasarımına döner). */
export async function setDefault(docType: string, templateId: string | null, userId: string) {
  getContract(docType);
  const before = await prisma.documentTemplateDefault.findUnique({ where: { docType }, select: { id: true, templateId: true } });
  if (templateId === null) {
    await prisma.documentTemplateDefault.deleteMany({ where: { docType } });
  } else {
    try {
      await prisma.$transaction(async (tx) => {
        await claimAssignable(tx, templateId, docType);
        await tx.documentTemplateDefault.upsert({
          where: { docType },
          create: { docType, templateId, createdById: userId, updatedById: userId },
          update: { templateId, updatedById: userId },
        });
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflictRetry();
      throw e;
    }
  }
  if (before?.templateId !== (templateId ?? undefined)) {
    await AuditService.log({
      userId,
      action: templateId === null ? "DELETE" : before ? "UPDATE" : "CREATE",
      tableName: "DOCUMENT_TEMPLATE_DEFAULT",
      recordId: before?.id ?? docType,
      oldData: before ? { docType, templateId: before.templateId } : null,
      newData: templateId === null ? null : { docType, templateId },
    });
  }
  return prisma.documentTemplateDefault.findUnique({ where: { docType } });
}

/** Profil ataması; `templateId: null` → profil ezmesi kaldırılır (varsayılana düşer). */
export async function setProfileAssignment(profileId: string, docType: string, templateId: string | null, userId: string) {
  getContract(docType);
  const profile = await prisma.documentProfile.findUnique({ where: { id: profileId }, select: { id: true } });
  if (!profile) throw AppError.notFound("Belge profili bulunamadı.", { code: "DOCUMENT_PROFILE_NOT_FOUND" });
  const key = { profileId_docType: { profileId, docType } };
  const before = await prisma.documentProfileTemplate.findUnique({ where: key, select: { templateId: true } });
  if (templateId === null) {
    await prisma.documentProfileTemplate.deleteMany({ where: { profileId, docType } });
  } else {
    try {
      await prisma.$transaction(async (tx) => {
        await claimAssignable(tx, templateId, docType);
        await tx.documentProfileTemplate.upsert({
          where: key,
          create: { profileId, docType, templateId, createdById: userId, updatedById: userId },
          update: { templateId, updatedById: userId },
        });
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflictRetry();
      throw e;
    }
  }
  if (before?.templateId !== (templateId ?? undefined)) {
    await AuditService.log({
      userId,
      action: templateId === null ? "DELETE" : before ? "UPDATE" : "CREATE",
      tableName: "DOCUMENT_PROFILE_TEMPLATE",
      recordId: profileId,
      oldData: before ? { docType, templateId: before.templateId } : null,
      newData: templateId === null ? null : { docType, templateId },
    });
  }
  return prisma.documentProfileTemplate.findUnique({ where: key });
}

const TEMPLATE_BRIEF = { id: true, name: true, docType: true, status: true, publishedVersionId: true } as const;

/** Varsayılanlar + profil atamaları + her profilin etkilediği müşteri/fasoncu listesi. */
export async function listAssignments() {
  const defaults = await prisma.documentTemplateDefault.findMany({
    orderBy: [{ docType: "asc" }],
    select: { docType: true, updatedAt: true, template: { select: TEMPLATE_BRIEF } },
  });
  const profiles = await prisma.documentProfileTemplate.findMany({
    orderBy: [{ profileId: "asc" }, { docType: "asc" }],
    select: {
      docType: true,
      updatedAt: true,
      template: { select: TEMPLATE_BRIEF },
      profile: {
        select: {
          id: true,
          name: true,
          isActive: true,
          customers: { select: { id: true, name: true }, orderBy: [{ name: "asc" }] },
          subcontractors: { select: { id: true, name: true }, orderBy: [{ name: "asc" }] },
        },
      },
    },
  });
  return {
    defaults,
    profiles: profiles.map((p) => ({
      docType: p.docType,
      updatedAt: p.updatedAt,
      template: p.template,
      profile: { id: p.profile.id, name: p.profile.name, isActive: p.profile.isActive },
      affected: {
        customers: p.profile.customers,
        subcontractors: p.profile.subcontractors,
      },
    })),
    note: PROFILE_OVERLAY_NOTE,
  };
}
