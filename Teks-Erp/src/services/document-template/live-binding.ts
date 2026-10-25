// =============================================================================
// Canlı çözülen türler ↔ tasarımcı şablonu (plan §2 P-e, T11)
// =============================================================================
// Refakat kartı ve serbest belge DONMAZ: her basımda türün varsayılanı yeniden çözülür,
// belgeye yalnız İZ (`designTemplate`) düşer. Bayrak kapalı ya da varsayılan yoksa null —
// çağıran bugünkü renderer'la basar (bayt-eşit).
// =============================================================================

import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { readDocumentDesignerEnabled } from "../system-setting.service";
import type { FrozenTemplateRef } from "./print-binding";
import type { OverlayInput, WatermarkKind } from "./motor/overlay";
import { TemplateRenderError, renderTemplate } from "./motor/render";
import { getContract } from "./sozlesme/kayit";
import type { PrintInput } from "./sozlesme/tipler";

/** Tasarımcıya bağlı ama dondurulmayan türler (P-e). */
export const LIVE_DOC_TYPES: ReadonlySet<string> = new Set(["TRAVELER_CARD", "FREE_DOCUMENT"]);

/** Basım anında çözülen yayındaki sürüm — iz `ref`, render girdisi kalanı. */
export interface LiveTemplate {
  ref: FrozenTemplateRef;
  /** Şablonun dondurulmuş ayarı (P-d: kopya kendi `ayar`ını taşır). */
  settings: Record<string, unknown>;
  compiledLiquid: string;
  css: string;
  pageSettings: unknown;
  internalFields: string[];
}

type Db = Pick<typeof prisma, "systemSetting" | "documentTemplate" | "documentTemplateDefault">;

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Zincir: tasarımcı varsayılanı (`DocumentTemplateDefault[docType]`, ACTIVE + yayında) →
 * null (bugünkü yol). Atanmış ama basılamaz şablon uyarı bırakır, basımı düşürmez.
 */
export async function resolveLiveTemplate(docType: string, db: Db = prisma): Promise<{ template: LiveTemplate | null; warnings: string[] }> {
  if (!LIVE_DOC_TYPES.has(docType) || !(await readDocumentDesignerEnabled(db))) return { template: null, warnings: [] };
  const d = await db.documentTemplateDefault.findUnique({ where: { docType }, select: { templateId: true } });
  if (!d) return { template: null, warnings: [] };
  const t = await db.documentTemplate.findUnique({
    where: { id: d.templateId },
    select: {
      id: true,
      name: true,
      status: true,
      publishedVersion: { select: { id: true, versionNo: true, settings: true, compiledLiquid: true, css: true, pageSettings: true, internalFields: true } },
    },
  });
  const v = t?.publishedVersion;
  if (!t || t.status !== "ACTIVE" || !v) {
    const why = !t ? "bulunamadı" : t.status !== "ACTIVE" ? "arşivde" : "yayında değil";
    return { template: null, warnings: [`"${t?.name ?? d.templateId}" şablonu (belge türü varsayılanı) ${why}; Sistem tasarımıyla basıldı.`] };
  }
  return {
    template: {
      ref: { templateId: t.id, versionId: v.id, versionNo: v.versionNo, name: t.name },
      settings: asRecord(v.settings),
      compiledLiquid: v.compiledLiquid,
      css: v.css,
      pageSettings: v.pageSettings,
      internalFields: Array.isArray(v.internalFields) ? (v.internalFields as string[]) : [],
    },
    warnings: [],
  };
}

/** Canlı türün kâğıt durumu → filigran (iptal / eski kopya); geçerli kâğıt temiz basılır. */
export function liveWatermark(status: string | null | undefined, draft = false): WatermarkKind | null {
  if (draft) return "DRAFT";
  if (status === "VOIDED") return "VOIDED";
  if (status === "REPRINTED" || status === "SUPERSEDED") return "SUPERSEDED";
  return null;
}

export interface LiveRenderInput {
  /** Sözleşmenin kaynağı (kart: `TravelerCardSource`, serbest belge: snapshot). */
  source: Record<string, unknown>;
  /** Şablon ayarının üstüne binen basım ezmesi (ör. tek seferlik sayfa boyutu). */
  settingsOverlay?: Record<string, unknown>;
  baski: PrintInput;
  watermark: WatermarkKind | null;
}

/** Yayındaki sürümle basım; künye canlı türde yok (sürüm kartın kendi alanında). Hata 422. */
export function renderLiveTemplate(docType: string, tpl: LiveTemplate, input: LiveRenderInput): string {
  const contract = getContract(docType);
  const overlay: OverlayInput = { watermark: input.watermark, imprint: null };
  const settings = contract.ayarNormalize({ ...tpl.settings, ...(input.settingsOverlay ?? {}) });
  try {
    return renderTemplate(
      { versionId: tpl.ref.versionId, compiledLiquid: tpl.compiledLiquid, css: tpl.css, pageSettings: tpl.pageSettings },
      {
        context: contract.insa(input.source, settings, tpl.internalFields, { baski: input.baski }) as unknown as Record<string, unknown>,
        snapshot: input.source as { numberRounding?: unknown },
        overlay,
      },
    ).html;
  } catch (e) {
    if (!(e instanceof TemplateRenderError)) throw e;
    throw new AppError(`"${tpl.ref.name}" şablonu (v${tpl.ref.versionNo}) bu belgeyi basamadı.`, 422, true, {
      code: "TEMPLATE_RENDER_FAILED",
      hatalar: e.issues,
    });
  }
}
