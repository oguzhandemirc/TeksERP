// =============================================================================
// Belge şablonu sürüm İÇERİĞİ — doğrulama, derleme, özet (sürüm kaydı + kopyalama ortak yolu)
// =============================================================================
// Aynı içerik aynı `contentHash`i verir (anahtar sıralı JSON); kayıt yolu bununla "değişiklik
// yok"u ayırır. Kesilenler sıkı temizleyiciyle ölçülür, yayında 400'e dönüşür.
// =============================================================================

import { createHash } from "node:crypto";
import { version as LIQUID_VERSION } from "liquidjs";
import type { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { sanitizeCss } from "../document-render/template-html.css";
import { sanitizeUserHtml, stripRawMarkers } from "../document-render/template-html.sanitize";
import { unknownInternalFields, type RegisteredContract } from "./sozlesme/kayit";
import { LiquidTemplateError, parseLiquid } from "./motor/liquid";
import type { RenderIssue } from "./motor/render";
import { normalizePageSettings, PageSettingsError } from "./motor/sayfa";
import { compileDirectives, textPosition } from "./motor/yonerge";

/** Sürümün damgaladığı motor kimliği (ayrıştırıcı sürümü değişince eski sürüm ayırt edilir). */
export const TEMPLATE_ENGINE_VERSION = `liquidjs@${LIQUID_VERSION}`;

export type EditMode = "VISUAL" | "CODE";

/** Kaydedilecek sürüm içeriği (istemci gövdesi ya da kopyalama kaynağı). */
export interface VersionContentInput {
  editMode: EditMode;
  sourceHtml: string;
  css: string;
  projectData?: unknown;
  pageSettings: unknown;
  tableBindings: Record<string, unknown>;
  settings: unknown;
  internalFields: string[];
  note?: string | null;
}

/** Doğrulanmış, derlenmiş içerik — sürüm satırının içerik kolonları. */
export interface PreparedContent {
  editMode: EditMode;
  sourceHtml: string;
  css: string;
  compiledLiquid: string;
  projectData: Prisma.InputJsonValue | null;
  pageSettings: Prisma.InputJsonValue;
  tableBindings: Prisma.InputJsonValue;
  settings: Prisma.InputJsonValue;
  internalFields: string[];
  contentHash: string;
  removedOnSave: string[];
  warnings: string[];
  note: string | null;
}

const asJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;

/** Anahtarları sıralı JSON — aynı içerik her zaman aynı özeti verir. */
function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

const issueList = (issues: ReadonlyArray<{ satir: number | null; sutun: number | null; mesaj: string }>): RenderIssue[] =>
  issues.map((i) => ({ satir: i.satir, sutun: i.sutun, mesaj: i.mesaj }));

/** Kaynağı derler; hata varsa konumlu liste döner (fırlatmaz — önizleme de kullanır). */
export function compileSource(editMode: EditMode, sourceHtml: string): { liquid: string; errors: RenderIssue[]; warnings: string[] } {
  const clean = stripRawMarkers(sourceHtml);
  if (editMode === "VISUAL") {
    const c = compileDirectives(clean, "VISUAL");
    if (c.errors.length) return { liquid: "", errors: issueList(c.errors), warnings: [...c.warnings] };
    try {
      parseLiquid(c.liquid);
    } catch (e) {
      if (!(e instanceof LiquidTemplateError)) throw e;
      const p = e.record.offset === null ? null : c.sourcePosition(e.record.offset);
      return { liquid: "", errors: [{ satir: p?.satir ?? null, sutun: p?.sutun ?? null, mesaj: e.record.message }], warnings: [...c.warnings] };
    }
    return { liquid: c.liquid, errors: [], warnings: [...c.warnings] };
  }
  try {
    parseLiquid(clean);
  } catch (e) {
    if (!(e instanceof LiquidTemplateError)) throw e;
    const p = e.record.offset === null ? null : textPosition(clean, e.record.offset);
    return { liquid: "", errors: [{ satir: p?.satir ?? null, sutun: p?.sutun ?? null, mesaj: e.record.message }], warnings: [] };
  }
  return { liquid: clean, errors: [], warnings: [] };
}

/** Sürüm içeriğini doğrular + derler + özetler. Hatalı içerik 400 (Türkçe, konumlu). */
export function prepareContent(contract: RegisteredContract, input: VersionContentInput): PreparedContent {
  let pageSettings;
  try {
    pageSettings = normalizePageSettings(input.pageSettings);
  } catch (e) {
    if (!(e instanceof PageSettingsError)) throw e;
    throw AppError.badRequest(`Sayfa ayarı geçersiz: ${e.messages.join("; ")}`, { code: "TEMPLATE_PAGE_SETTINGS_INVALID", hatalar: e.messages });
  }
  const unknown = unknownInternalFields(contract, input.internalFields);
  if (unknown.length) {
    throw AppError.badRequest(`Bu belge türünde olmayan iç alan: ${unknown.join(", ")}`, { code: "TEMPLATE_INTERNAL_FIELD_UNKNOWN", alanlar: unknown });
  }
  const compiled = compileSource(input.editMode, input.sourceHtml);
  if (compiled.errors.length) {
    throw AppError.badRequest("Şablon derlenemedi; hatalı satırları düzeltin.", { code: "TEMPLATE_COMPILE_FAILED", hatalar: compiled.errors });
  }
  const settings = asJson(contract.ayarNormalize(input.settings));
  const internalFields = [...new Set(input.internalFields)].sort();
  const removed = new Set([
    ...sanitizeUserHtml(input.sourceHtml, { strict: true }).removed,
    ...sanitizeCss(input.css, { strict: true }).removed,
  ]);
  const content = {
    editMode: input.editMode,
    sourceHtml: input.sourceHtml,
    css: input.css,
    projectData: input.projectData === undefined ? null : asJson(input.projectData),
    pageSettings: asJson(pageSettings),
    tableBindings: asJson(input.tableBindings),
    settings,
    internalFields,
  };
  return {
    ...content,
    compiledLiquid: compiled.liquid,
    contentHash: createHash("sha256").update(canonicalJson(content)).digest("hex"),
    removedOnSave: [...removed].sort(),
    warnings: compiled.warnings,
    note: input.note ?? null,
  };
}

/** Sürüm satırının yazılacak alanları (içerik + damgalar). */
export function versionData(contract: RegisteredContract, c: PreparedContent) {
  return {
    editMode: c.editMode,
    sourceHtml: c.sourceHtml,
    css: c.css,
    compiledLiquid: c.compiledLiquid,
    projectData: c.projectData ?? undefined,
    pageSettings: c.pageSettings,
    tableBindings: c.tableBindings,
    settings: c.settings,
    internalFields: c.internalFields,
    contractVersion: contract.contractVersion,
    engineVersion: TEMPLATE_ENGINE_VERSION,
    contentHash: c.contentHash,
    note: c.note,
    removedOnSave: c.removedOnSave,
  };
}

export const VERSION_SUMMARY = {
  id: true,
  templateId: true,
  versionNo: true,
  editMode: true,
  contractVersion: true,
  engineVersion: true,
  contentHash: true,
  note: true,
  removedOnSave: true,
  createdById: true,
  createdAt: true,
  publishedAt: true,
  publishedById: true,
} as const;

