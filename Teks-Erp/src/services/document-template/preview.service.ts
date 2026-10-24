// =============================================================================
// Belge şablonu ÖNİZLEMESİ — kaydedilmemiş kaynak × örnek senaryo / gerçek kayıt (plan §3.10)
// =============================================================================
// Hata fırlatmaz, konumlu liste döner (editör satır/sütun gösterir). Gerçek kayıtta kaynağın
// profil ezmesi şablon ayarının ÜSTÜNE uygulanır (R4) — basımdaki katman sırasıyla aynı.
// =============================================================================

import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { DOC_CONFIG_KEYS, getRegisteredDocBuilders } from "../printed-document.service";
import { sanitizeDocumentsConfig } from "../system-setting.service";
import { getContract, unknownInternalFields, type RegisteredContract } from "./sozlesme/kayit";
import { TemplateRenderError, renderTemplate, type RenderIssue } from "./motor/render";
import { compileSource, type VersionContentInput } from "./version-content";

export type PreviewSample = { kind: "senaryo"; key: string } | { kind: "kayit"; sourceId: string };

export interface PreviewInput {
  docType: string;
  source: Omit<VersionContentInput, "projectData" | "tableBindings" | "note">;
  sample: PreviewSample;
}

export interface PreviewResult {
  html: string;
  hatalar: RenderIssue[];
  uyarilar: string[];
  kesilenler: string[];
  olcum: { ms: number; bayt: number };
}

/** Kaynağın profil ezmesi (R4): basımda şablon ayarının ÜSTÜNE uygulanır; profilsiz kaynakta null. */
async function profileOverlayFor(docType: string, sourceId: string): Promise<Record<string, unknown> | null> {
  const key = (DOC_CONFIG_KEYS as Record<string, string>)[docType];
  const resolve = getRegisteredDocBuilders().get(docType as keyof typeof DOC_CONFIG_KEYS)?.resolveProfileId;
  if (!key || !resolve) return null;
  const profileId = await resolve(prisma, sourceId);
  if (!profileId) return null;
  const p = await prisma.documentProfile.findUnique({ where: { id: profileId }, select: { config: true, isActive: true } });
  if (!p?.isActive || !p.config || typeof p.config !== "object" || Array.isArray(p.config)) return null;
  return (sanitizeDocumentsConfig(p.config as Record<string, unknown>)[key] as Record<string, unknown> | undefined) ?? null;
}

export async function previewTemplate(input: PreviewInput): Promise<PreviewResult> {
  const contract = getContract(input.docType);
  const unknown = unknownInternalFields(contract, input.source.internalFields);
  if (unknown.length) {
    throw AppError.badRequest(`Bu belge türünde olmayan iç alan: ${unknown.join(", ")}`, { code: "TEMPLATE_INTERNAL_FIELD_UNKNOWN", alanlar: unknown });
  }
  let snapshot;
  let ek;
  let settings: unknown = input.source.settings;
  if (input.sample.kind === "senaryo") {
    const key = input.sample.key;
    const s = contract.senaryolar().find((x) => x.ad === key);
    if (!s) throw AppError.notFound(`"${key}" örneği bu belge türünde yok.`, { code: "TEMPLATE_SAMPLE_NOT_FOUND" });
    snapshot = s.snapshot;
    ek = s.ek;
  } else {
    const sourceId = input.sample.sourceId;
    const doc = await prisma.printedDocument.findFirst({
      where: { docType: input.docType as keyof typeof DOC_CONFIG_KEYS, sourceId, status: "ACTIVE" },
      orderBy: [{ version: "desc" }],
      select: { snapshot: true },
    });
    if (!doc) throw AppError.notFound("Bu kayıt için basılmış etkin belge yok; önce belgeyi bir kez basın.", { code: "TEMPLATE_SAMPLE_NOT_FOUND" });
    snapshot = doc.snapshot as unknown as Parameters<RegisteredContract["insa"]>[0];
    const overlay = await profileOverlayFor(input.docType, sourceId);
    // Normalize idempotenttir: şablon ayarı + profil ezmesi yeniden tamamlanır (katman sırası §R4).
    if (overlay) settings = { ...(contract.ayarNormalize(settings) as Record<string, unknown>), ...overlay };
  }
  const compiled = compileSource(input.source.editMode, input.source.sourceHtml);
  if (compiled.errors.length) return { html: "", hatalar: compiled.errors, uyarilar: compiled.warnings, kesilenler: [], olcum: { ms: 0, bayt: 0 } };
  try {
    const r = renderTemplate(
      { compiledLiquid: compiled.liquid, css: input.source.css, pageSettings: input.source.pageSettings },
      {
        context: contract.insa(snapshot, contract.ayarNormalize(settings), input.source.internalFields, ek) as unknown as Record<string, unknown>,
        snapshot,
        overlay: null,
      },
    );
    return { html: r.html, hatalar: [], uyarilar: [...compiled.warnings, ...r.warnings], kesilenler: [...r.removed], olcum: { ms: r.metrics.ms, bayt: r.metrics.bytes } };
  } catch (e) {
    if (!(e instanceof TemplateRenderError)) throw e;
    return { html: "", hatalar: [...e.issues], uyarilar: compiled.warnings, kesilenler: [], olcum: { ms: 0, bayt: 0 } };
  }
}

/** Önizleme için seçilebilir gerçek kayıtlar (etkin basılı belge; belge no araması). */
export async function listSampleSources(docType: string, q: string | undefined) {
  if (!(docType in DOC_CONFIG_KEYS)) {
    throw AppError.badRequest(`"${docType}" türünde basılı belge kaydı yok.`, { code: "DOCUMENT_CONTRACT_UNKNOWN", docType });
  }
  return prisma.printedDocument.findMany({
    where: {
      docType: docType as keyof typeof DOC_CONFIG_KEYS,
      status: "ACTIVE",
      ...(q ? { documentNo: { contains: q, mode: "insensitive" as const } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
    select: { id: true, sourceId: true, documentNo: true, version: true, createdAt: true },
  });
}
