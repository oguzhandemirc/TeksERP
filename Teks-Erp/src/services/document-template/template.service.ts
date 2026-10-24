// =============================================================================
// Belge ŞABLONLARI — oluşturma, meta, arşiv, silme, sözleşme/sistem görünümü (plan §3.5, P-d)
// =============================================================================
// Şablon "silinmez", arşivlenir; tek hard delete hiç yayınlanmamış TASLAK şablondur
// (taslak sınıfı — defter.md). Durum geçişleri atomik claim; atama varken arşiv 409 + liste.
// =============================================================================

import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { tokenReplay } from "../helpers/token-replay.helper";
import { readDocumentsConfig } from "../system-setting.service";
import { getSystemEquivalent, materializeEquivalent, type SystemEquivalentLookup } from "./sistem/kayit";
import { getContract, type RegisteredContract } from "./sozlesme/kayit";
import { freezeSystemSettings } from "./contract-view.service";
import { prepareContent, versionData, VERSION_SUMMARY, type VersionContentInput } from "./version-content";

export type CopyFrom = { kind: "system" } | { kind: "template"; id: string } | { kind: "blank" };

export interface CreateTemplateInput {
  docType: string;
  name: string;
  description?: string | null;
  copyFrom: CopyFrom;
  clientToken?: string | null;
}

const TEMPLATE_VIEW = {
  id: true,
  docType: true,
  name: true,
  description: true,
  status: true,
  editMode: true,
  copiedFrom: true,
  publishedVersionId: true,
  latestVersionNo: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  updatedById: true,
} as const;

const EMPTY_PAGE = {};

async function initialContent(
  contract: RegisteredContract,
  input: CreateTemplateInput,
  lookup: SystemEquivalentLookup,
): Promise<{ content: VersionContentInput; copiedFrom: string | null; warnings: string[] }> {
  const from = input.copyFrom;
  if (from.kind === "system") {
    const eq = lookup(contract.docType);
    if (!eq) {
      throw AppError.conflict("Bu belge türünün sistem tasarımı henüz kopyalanamıyor; boş şablonla başlayın.", {
        code: "NO_SYSTEM_EQUIVALENT",
        docType: contract.docType,
      });
    }
    const frozen = freezeSystemSettings(contract, await readDocumentsConfig());
    const m = materializeEquivalent(eq, frozen.settings);
    return {
      content: {
        editMode: m.editMode,
        sourceHtml: m.html,
        css: m.css,
        pageSettings: m.pageSettings,
        tableBindings: m.tableBindings,
        settings: frozen.settings,
        internalFields: frozen.internalFields,
      },
      copiedFrom: "system",
      warnings: frozen.warnings,
    };
  }
  if (from.kind === "template") {
    const src = await prisma.documentTemplate.findUnique({ where: { id: from.id }, select: { id: true, docType: true, latestVersionNo: true } });
    if (!src || src.docType !== contract.docType) {
      throw AppError.notFound("Kopyalanacak şablon bu belge türünde bulunamadı.", { code: "TEMPLATE_NOT_FOUND" });
    }
    const v = await prisma.documentTemplateVersion.findUniqueOrThrow({
      where: { templateId_versionNo: { templateId: src.id, versionNo: src.latestVersionNo } },
    });
    return {
      content: {
        editMode: v.editMode as VersionContentInput["editMode"],
        sourceHtml: v.sourceHtml,
        css: v.css,
        projectData: v.projectData ?? undefined,
        pageSettings: v.pageSettings,
        tableBindings: v.tableBindings as Record<string, unknown>,
        settings: v.settings,
        internalFields: Array.isArray(v.internalFields) ? (v.internalFields as string[]) : [],
      },
      copiedFrom: `template:${src.id}`,
      warnings: [],
    };
  }
  return {
    content: { editMode: "VISUAL", sourceHtml: "", css: "", pageSettings: EMPTY_PAGE, tableBindings: {}, settings: {}, internalFields: [] },
    copiedFrom: null,
    warnings: [],
  };
}

const copiedFromLabel = (c: CopyFrom): string | null => (c.kind === "system" ? "system" : c.kind === "template" ? `template:${c.id}` : null);

type TemplateView = Prisma.DocumentTemplateGetPayload<{ select: typeof TEMPLATE_VIEW }>;
export interface CreateTemplateResult {
  template: TemplateView;
  warnings: string[];
}

function createReplay(input: CreateTemplateInput) {
  return tokenReplay<{ id: string; docType: string; name: string; copiedFrom: string | null }, CreateTemplateResult>({
    find: (db, clientToken) =>
      db.documentTemplate.findUnique({ where: { clientToken }, select: { id: true, docType: true, name: true, copiedFrom: true } }),
    alive: { neverDies: "şablon iptal edilmez; arşivlenen yeniden açılır, silinen taslak token'ını da götürür" },
    identity: (p) => [
      { ad: "docType", mevcut: p.docType, gelen: input.docType },
      { ad: "name", mevcut: p.name, gelen: input.name },
      { ad: "copiedFrom", mevcut: p.copiedFrom, gelen: copiedFromLabel(input.copyFrom) },
    ],
    collision: "Bu işlem kimliği başka bir şablona ait; formu yeniden açıp gönderin.",
    respond: async (p) => ({ template: await prisma.documentTemplate.findUniqueOrThrow({ where: { id: p.id }, select: TEMPLATE_VIEW }), warnings: [] }),
  });
}

const isUniqueViolation = (e: unknown): boolean => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/**
 * Yeni şablon + v1 aynı tx'te. `systemEquivalents` yalnız bekçi içindir (sahte eşlenik enjeksiyonu);
 * üretimde `sistem/` kaydı okunur.
 */
export async function createTemplate(
  input: CreateTemplateInput,
  userId: string,
  deps: { systemEquivalents?: SystemEquivalentLookup } = {},
): Promise<CreateTemplateResult> {
  const contract = getContract(input.docType);
  return createReplay(input).run(input.clientToken, async () => {
    const init = await initialContent(contract, input, deps.systemEquivalents ?? getSystemEquivalent);
    const content = prepareContent(contract, init.content);
    let created: TemplateView;
    try {
      created = await prisma.$transaction(async (tx) => {
        const t = await tx.documentTemplate.create({
          data: {
            docType: contract.docType,
            name: input.name,
            description: input.description ?? null,
            editMode: content.editMode,
            copiedFrom: init.copiedFrom,
            latestVersionNo: 1,
            clientToken: input.clientToken ?? null,
            createdById: userId,
            updatedById: userId,
          },
          select: TEMPLATE_VIEW,
        });
        await tx.documentTemplateVersion.create({
          data: { templateId: t.id, versionNo: 1, ...versionData(contract, content), createdById: userId },
        });
        return t;
      });
    } catch (e) {
      const tokenRow = input.clientToken
        ? await prisma.documentTemplate.findUnique({ where: { clientToken: input.clientToken }, select: { id: true } })
        : null;
      // Token çakışması boğazın yeniden okumasına bırakılır; kalan P2002 (docType, name) tekilliğidir.
      if (isUniqueViolation(e) && !tokenRow) {
        throw AppError.conflict(`"${input.name}" adlı bir şablon bu belge türünde zaten var.`, { code: "TEMPLATE_NAME_TAKEN" });
      }
      throw e;
    }
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "DOCUMENT_TEMPLATE",
      recordId: created.id,
      newData: { docType: created.docType, name: created.name, copiedFrom: created.copiedFrom },
    });
    return { template: created, warnings: [...init.warnings, ...content.warnings] };
  });
}

// ── Okuma ─────────────────────────────────────────────────────────────────────

export async function listTemplates(filter: { docType?: string; status?: "ACTIVE" | "ARCHIVED" }) {
  return prisma.documentTemplate.findMany({
    where: { ...(filter.docType ? { docType: filter.docType } : {}), ...(filter.status ? { status: filter.status } : {}) },
    orderBy: [{ docType: "asc" }, { name: "asc" }, { id: "asc" }],
    select: { ...TEMPLATE_VIEW, publishedVersion: { select: { versionNo: true, publishedAt: true } } },
  });
}

export async function getTemplate(id: string) {
  const t = await prisma.documentTemplate.findUnique({
    where: { id },
    select: { ...TEMPLATE_VIEW, publishedVersion: { select: VERSION_SUMMARY } },
  });
  if (!t) throw AppError.notFound("Şablon bulunamadı.", { code: "TEMPLATE_NOT_FOUND" });
  return t;
}

export async function updateTemplateMeta(id: string, input: { name?: string; description?: string | null }, userId: string) {
  const before = await getTemplate(id);
  try {
    const n = await prisma.documentTemplate.updateMany({
      where: { id },
      data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.description !== undefined ? { description: input.description } : {}), updatedById: userId },
    });
    if (n.count === 0) throw AppError.notFound("Şablon bulunamadı.", { code: "TEMPLATE_NOT_FOUND" });
  } catch (e) {
    if (isUniqueViolation(e)) throw AppError.conflict(`"${input.name}" adlı bir şablon bu belge türünde zaten var.`, { code: "TEMPLATE_NAME_TAKEN" });
    throw e;
  }
  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "DOCUMENT_TEMPLATE",
    recordId: id,
    oldData: { name: before.name, description: before.description },
    newData: { name: input.name ?? before.name, description: input.description === undefined ? before.description : input.description },
  });
  return getTemplate(id);
}

/** Şablonun atandığı yerler (varsayılan + profil) — arşiv/silme engelinin listesi. */
export async function assignmentsOf(db: Prisma.TransactionClient, templateId: string) {
  const defaults = await db.documentTemplateDefault.findMany({ where: { templateId }, select: { docType: true } });
  const profiles = await db.documentProfileTemplate.findMany({
    where: { templateId },
    select: { docType: true, profile: { select: { id: true, name: true } } },
    orderBy: [{ profileId: "asc" }, { docType: "asc" }],
  });
  return [
    ...defaults.map((d) => ({ kind: "default" as const, docType: d.docType, profileId: null, profileName: null })),
    ...profiles.map((p) => ({ kind: "profile" as const, docType: p.docType, profileId: p.profile.id, profileName: p.profile.name })),
  ];
}

// ── Arşiv ─────────────────────────────────────────────────────────────────────

export async function archiveTemplate(id: string, userId: string) {
  await prisma.$transaction(async (tx) => {
    // Claim önce: satır kilidi atama yazarlarının "dokunma" claim'iyle serileşir (atama arşivle yarışamaz).
    const claim = await tx.documentTemplate.updateMany({
      where: { id, status: "ACTIVE" },
      data: { status: "ARCHIVED", archivedAt: new Date(), updatedById: userId },
    });
    if (claim.count === 0) {
      const exists = await tx.documentTemplate.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw AppError.notFound("Şablon bulunamadı.", { code: "TEMPLATE_NOT_FOUND" });
      throw AppError.conflict("Şablon zaten arşivde.", { code: "TEMPLATE_NOT_ACTIVE" });
    }
    const assigned = await assignmentsOf(tx, id);
    if (assigned.length) {
      throw AppError.conflict("Şablon atanmış; önce aşağıdaki atamaları başka şablona çevirin ya da kaldırın.", {
        code: "TEMPLATE_ASSIGNED",
        atamalar: assigned,
      });
    }
  });
  await AuditService.log({ userId, action: "UPDATE", tableName: "DOCUMENT_TEMPLATE", recordId: id, oldData: { status: "ACTIVE" }, newData: { status: "ARCHIVED" } });
  return getTemplate(id);
}

export async function unarchiveTemplate(id: string, userId: string) {
  const claim = await prisma.documentTemplate.updateMany({
    where: { id, status: "ARCHIVED" },
    data: { status: "ACTIVE", archivedAt: null, updatedById: userId },
  });
  if (claim.count === 0) {
    await getTemplate(id);
    throw AppError.conflict("Şablon arşivde değil.", { code: "TEMPLATE_NOT_ARCHIVED" });
  }
  await AuditService.log({ userId, action: "UPDATE", tableName: "DOCUMENT_TEMPLATE", recordId: id, oldData: { status: "ARCHIVED" }, newData: { status: "ACTIVE" } });
  return getTemplate(id);
}

// ── Silme (yalnız hiç yayınlanmamış taslak) ───────────────────────────────────

export async function deletePreview(id: string) {
  const t = await getTemplate(id);
  const versions = await prisma.documentTemplateVersion.findMany({
    where: { templateId: id },
    orderBy: [{ versionNo: "asc" }],
    select: { id: true, versionNo: true, createdAt: true, publishedAt: true },
  });
  const assigned = await assignmentsOf(prisma, id);
  const published = t.publishedVersionId !== null || versions.some((v) => v.publishedAt !== null);
  return {
    template: { id: t.id, docType: t.docType, name: t.name, status: t.status },
    versions,
    assignments: assigned,
    deletable: !published && assigned.length === 0,
    reason: published
      ? "Şablon en az bir kez yayınlandı; basılmış belgeler sürümüne bağlı olabilir — silinemez, arşivlenir."
      : assigned.length
        ? "Şablon atanmış; önce atamaları kaldırın."
        : null,
  };
}

export async function deleteTemplate(id: string, userId: string) {
  const removed = await prisma.$transaction(async (tx) => {
    // Satır kilidi + yüklem tek ifadede: yayınla/kaydet yarışı bu satırda serileşir.
    const lock = await tx.documentTemplate.updateMany({ where: { id, publishedVersionId: null }, data: { updatedById: userId } });
    if (lock.count === 0) {
      const exists = await tx.documentTemplate.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw AppError.notFound("Şablon bulunamadı.", { code: "TEMPLATE_NOT_FOUND" });
      throw AppError.conflict("Yayınlanmış şablon silinemez; arşivleyin.", { code: "TEMPLATE_PUBLISHED" });
    }
    const everPublished = await tx.documentTemplateVersion.count({ where: { templateId: id, publishedAt: { not: null } } });
    if (everPublished > 0) throw AppError.conflict("Yayınlanmış şablon silinemez; arşivleyin.", { code: "TEMPLATE_PUBLISHED" });
    const assigned = await assignmentsOf(tx, id);
    if (assigned.length) throw AppError.conflict("Şablon atanmış; önce atamaları kaldırın.", { code: "TEMPLATE_ASSIGNED", atamalar: assigned });
    const versions = await tx.documentTemplateVersion.deleteMany({ where: { templateId: id } });
    const t = await tx.documentTemplate.delete({ where: { id }, select: { docType: true, name: true } });
    return { ...t, versionCount: versions.count };
  });
  await AuditService.log({ userId, action: "DELETE", tableName: "DOCUMENT_TEMPLATE", recordId: id, oldData: removed });
  return { id, deleted: true };
}
