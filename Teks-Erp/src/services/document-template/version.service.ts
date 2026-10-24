// =============================================================================
// Belge şablonu SÜRÜMLERİ — kayıt, yayın, önizleme (plan §3.5, §3.10)
// =============================================================================
// Sürüm satırı DEĞİŞMEZ (DB trigger `document_template_versions_block_tamper`). Yeni kayıt
// `latestVersionNo` claim'iyle serileşir; yayın `publishedVersionId` claim'iyle. Advisory kilit
// YOK: her yarış tek satırın atomik WHERE'inde çözülür (envantere satır gerekmez).
// =============================================================================

import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { tokenReplay } from "../helpers/token-replay.helper";
import { getContract, type RegisteredContract } from "./sozlesme/kayit";
import { TemplateRenderError, renderTemplate } from "./motor/render";
import { prepareContent, versionData, VERSION_SUMMARY, type VersionContentInput } from "./version-content";

/** Yayının SoD ayarı — ham okunur, satır yoksa KAPALI (bayrak bağlantısı T1C'de). */
export const PUBLISH_SOD_SETTING_KEY = "documents.publishSodEnabled";

// ── Okuma ─────────────────────────────────────────────────────────────────────

export async function listVersions(templateId: string) {
  const t = await prisma.documentTemplate.findUnique({ where: { id: templateId }, select: { id: true, publishedVersionId: true } });
  if (!t) throw AppError.notFound("Şablon bulunamadı.", { code: "TEMPLATE_NOT_FOUND" });
  const rows = await prisma.documentTemplateVersion.findMany({
    where: { templateId },
    orderBy: [{ versionNo: "desc" }],
    select: VERSION_SUMMARY,
  });
  return rows.map((v) => ({ ...v, isPublished: v.id === t.publishedVersionId }));
}

export async function getVersion(templateId: string, versionId: string) {
  const v = await prisma.documentTemplateVersion.findFirst({ where: { id: versionId, templateId } });
  if (!v) throw AppError.notFound("Şablon sürümü bulunamadı.", { code: "TEMPLATE_VERSION_NOT_FOUND" });
  return v;
}

// ── Sürüm kaydı ───────────────────────────────────────────────────────────────

export interface SaveVersionInput extends VersionContentInput {
  baseVersionId: string;
  clientToken?: string | null;
}

export interface SaveVersionResult {
  created: boolean;
  version: { [K in keyof typeof VERSION_SUMMARY]: unknown };
  warnings: string[];
}

function saveReplay(templateId: string, input: SaveVersionInput) {
  return tokenReplay<{ id: string; templateId: string; sourceHtml: string; css: string; removedOnSave: unknown }, SaveVersionResult>({
    find: (db, clientToken) =>
      db.documentTemplateVersion.findUnique({
        where: { clientToken },
        select: { id: true, templateId: true, sourceHtml: true, css: true, removedOnSave: true },
      }),
    alive: { neverDies: "şablon sürümü değişmez ve silinmez (yalnız hiç yayınlanmamış şablonla birlikte gider)" },
    identity: (p) => [
      { ad: "templateId", mevcut: p.templateId, gelen: templateId },
      { ad: "sourceHtml", mevcut: p.sourceHtml, gelen: input.sourceHtml },
      { ad: "css", mevcut: p.css, gelen: input.css },
    ],
    collision: "Bu işlem kimliği başka bir şablon sürümüne ait; kaydı yeniden gönderin.",
    respond: async (p) => ({
      created: true,
      version: await prisma.documentTemplateVersion.findUniqueOrThrow({ where: { id: p.id }, select: VERSION_SUMMARY }),
      warnings: [],
    }),
  });
}

/** Yeni değişmez sürüm. `baseVersionId` en son sürüm değilse 409; içerik aynıysa yeni sürüm açılmaz. */
export async function saveVersion(templateId: string, input: SaveVersionInput, userId: string): Promise<SaveVersionResult> {
  return saveReplay(templateId, input).run(input.clientToken, async () => {
    const t = await prisma.documentTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, docType: true, status: true, latestVersionNo: true },
    });
    if (!t) throw AppError.notFound("Şablon bulunamadı.", { code: "TEMPLATE_NOT_FOUND" });
    if (t.status !== "ACTIVE") throw AppError.conflict("Arşivdeki şablona sürüm kaydedilemez; önce arşivden çıkarın.", { code: "TEMPLATE_ARCHIVED" });
    const base = await prisma.documentTemplateVersion.findFirst({
      where: { id: input.baseVersionId, templateId },
      select: { ...VERSION_SUMMARY },
    });
    if (!base) throw AppError.notFound("Temel alınan sürüm bu şablonda yok.", { code: "TEMPLATE_VERSION_NOT_FOUND" });
    const stale = () =>
      AppError.conflict("Şablon siz düzenlerken başka biri tarafından kaydedildi; son sürümü açıp değişikliğinizi yeniden uygulayın.", {
        code: "TEMPLATE_VERSION_STALE",
        latestVersionNo: t.latestVersionNo,
      });
    if (base.versionNo !== t.latestVersionNo) throw stale();
    const contract = getContract(t.docType);
    const content = prepareContent(contract, input);
    if (content.contentHash === base.contentHash) return { created: false, version: base, warnings: content.warnings };

    const created = await prisma.$transaction(async (tx) => {
      const claim = await tx.documentTemplate.updateMany({
        where: { id: templateId, status: "ACTIVE", latestVersionNo: base.versionNo },
        data: { latestVersionNo: { increment: 1 }, editMode: content.editMode, updatedById: userId },
      });
      if (claim.count === 0) throw stale();
      return tx.documentTemplateVersion.create({
        data: {
          templateId,
          versionNo: base.versionNo + 1,
          ...versionData(contract, content),
          clientToken: input.clientToken ?? null,
          createdById: userId,
        },
        select: VERSION_SUMMARY,
      });
    });
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "DOCUMENT_TEMPLATE_VERSION",
      recordId: created.id,
      newData: { templateId, versionNo: created.versionNo, editMode: created.editMode, kesilenler: content.removedOnSave },
    });
    return { created: true, version: created, warnings: content.warnings };
  });
}

// ── Yayın ─────────────────────────────────────────────────────────────────────

/** Ham ayar okuması; satır yoksa ya da `true` değilse KAPALI (bugünkü davranış). */
export async function readPublishSodEnabled(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: PUBLISH_SOD_SETTING_KEY }, select: { value: true } });
  return row?.value === true;
}

interface RenderableVersion {
  id: string;
  compiledLiquid: string;
  css: string;
  pageSettings: unknown;
  settings: unknown;
  internalFields: unknown;
}

/** Sözleşmenin TÜM senaryolarında katı render + sıkı temizleyici kesinti ölçümü; düşen ilk senaryoda 400. */
export function assertPublishable(contract: RegisteredContract, v: RenderableVersion): void {
  const internalFields = Array.isArray(v.internalFields) ? (v.internalFields as string[]) : [];
  const removed = new Map<string, string[]>();
  for (const s of contract.senaryolar()) {
    let result;
    try {
      result = renderTemplate(
        { versionId: v.id, compiledLiquid: v.compiledLiquid, css: v.css, pageSettings: v.pageSettings },
        { context: contract.insa(s.snapshot, v.settings, internalFields, s.ek) as unknown as Record<string, unknown>, snapshot: s.snapshot, overlay: null },
      );
    } catch (e) {
      if (!(e instanceof TemplateRenderError)) throw e;
      throw AppError.badRequest(`Şablon "${s.ad}" örneğinde basılamadı.`, { code: "TEMPLATE_RENDER_FAILED", senaryo: s.ad, hatalar: e.issues });
    }
    if (result.removed.length) removed.set(s.ad, [...result.removed]);
  }
  if (removed.size) {
    throw AppError.badRequest("Şablonda güvenli olmayan içerik var (dış bağlantı, betik ya da izin verilmeyen öğe); kaldırıp yeniden kaydedin.", {
      code: "TEMPLATE_UNSAFE_CONTENT",
      kesilenler: Object.fromEntries(removed),
    });
  }
}

export interface PublishInput {
  versionId: string;
  /** İstemcinin gördüğü yayındaki sürüm (yoksa null) — farklıysa 409. */
  expectedPublishedVersionId: string | null;
}

export async function publishVersion(templateId: string, input: PublishInput, userId: string) {
  const t = await prisma.documentTemplate.findUnique({ where: { id: templateId }, select: { id: true, docType: true, status: true } });
  if (!t) throw AppError.notFound("Şablon bulunamadı.", { code: "TEMPLATE_NOT_FOUND" });
  if (t.status !== "ACTIVE") throw AppError.conflict("Arşivdeki şablon yayınlanamaz; önce arşivden çıkarın.", { code: "TEMPLATE_ARCHIVED" });
  const v = await getVersion(templateId, input.versionId);
  assertPublishable(getContract(t.docType), v);
  if ((await readPublishSodEnabled()) && v.createdById === userId) {
    throw AppError.forbidden("Bu sürümü siz tasarladınız; yayını başka bir yetkili yapmalı (tasarlayan ≠ yayınlayan ayarı açık).", { code: "PUBLISH_SOD" });
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const claim = await tx.documentTemplate.updateMany({
      where: { id: templateId, status: "ACTIVE", publishedVersionId: input.expectedPublishedVersionId },
      data: { publishedVersionId: v.id, updatedById: userId },
    });
    if (claim.count === 0) {
      throw AppError.conflict("Yayındaki sürüm siz bakarken değişti; listeyi yenileyip yeniden deneyin.", { code: "TEMPLATE_PUBLISH_CONFLICT" });
    }
    // Damga ilk yayının izidir: aynı sürüm yeniden yayına alınırsa dokunulmaz (trigger da bir kez izin verir).
    await tx.documentTemplateVersion.updateMany({ where: { id: v.id, publishedAt: null }, data: { publishedAt: now, publishedById: userId } });
  });
  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "DOCUMENT_TEMPLATE",
    recordId: templateId,
    oldData: { publishedVersionId: input.expectedPublishedVersionId },
    newData: { publishedVersionId: v.id, versionNo: v.versionNo },
  });
  return prisma.documentTemplate.findUniqueOrThrow({ where: { id: templateId } });
}

