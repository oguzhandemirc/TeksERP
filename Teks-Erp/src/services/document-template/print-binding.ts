// =============================================================================
// Belge basımı ↔ tasarımcı şablonu (plan §3.6, T1C)
// =============================================================================
// Freeze anında şablon çözümü (profil ataması → tür varsayılanı → Sistem) ve donmuş
// şablon sürümüyle render. Sistem yolu bu dosyaya hiç girmez: snapshot'ta `template`
// yoksa belge bugünkü renderer'la basılır (bayt-eşit, altın testler).
// =============================================================================

import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { readDocumentDesignerEnabled } from "../system-setting.service";
import { LIVE_DOC_TYPES } from "./live-binding";
import { getContract, listContracts } from "./sozlesme/kayit";
import { TemplateRenderError, renderTemplate } from "./motor/render";
import type { OverlayInput } from "./motor/overlay";
import type { PrintInput, TemplateContext } from "./sozlesme/tipler";

type Db = Pick<typeof prisma, "systemSetting" | "documentTemplate" | "documentTemplateDefault" | "documentProfileTemplate">;

/** Snapshot'a donan şablon atfı — yeniden baskı bu sürümle yapılır (D2). */
export interface FrozenTemplateRef {
  templateId: string;
  versionId: string;
  versionNo: number;
  name: string;
}

export interface TemplateResolution {
  ref: FrozenTemplateRef | null;
  /** Yayındaki sürümün dondurulmuş ayarı (`ayar`); profil ezmesi çağıranda üstüne biner (R4). */
  settings: Record<string, unknown> | null;
  warnings: string[];
}

const NONE: TemplateResolution = { ref: null, settings: null, warnings: [] };

/** Canlı türler (kart, serbest belge) ve sözleşmesi olmayanlar bu yoldan geçmez (P-e: donmazlar). */
function isTemplatable(docType: string): boolean {
  return !LIVE_DOC_TYPES.has(docType) && listContracts().some((c) => c.docType === docType);
}

/**
 * Çözüm sırası: kaynağın profil ataması → tür varsayılanı → Sistem. Atanan şablon ACTIVE
 * ve yayında değilse sıradakine geçilir ve uyarı düşer. Bayrak kapalıyken daima Sistem.
 */
export async function resolveTemplateForFreeze(db: Db, docType: string, profileId: string | null): Promise<TemplateResolution> {
  if (!isTemplatable(docType)) return NONE;
  if (!(await readDocumentDesignerEnabled(db))) return NONE;
  const warnings: string[] = [];
  const candidates: Array<{ label: string; templateId: string }> = [];
  if (profileId) {
    const a = await db.documentProfileTemplate.findUnique({
      where: { profileId_docType: { profileId, docType } },
      select: { templateId: true, profile: { select: { isActive: true } } },
    });
    if (a?.profile.isActive) candidates.push({ label: "müşteri/fasoncu ataması", templateId: a.templateId });
  }
  const d = await db.documentTemplateDefault.findUnique({ where: { docType }, select: { templateId: true } });
  if (d) candidates.push({ label: "belge türü varsayılanı", templateId: d.templateId });

  for (const c of candidates) {
    const t = await db.documentTemplate.findUnique({
      where: { id: c.templateId },
      select: { id: true, name: true, status: true, publishedVersion: { select: { id: true, versionNo: true, settings: true } } },
    });
    if (t && t.status === "ACTIVE" && t.publishedVersion) {
      const s = t.publishedVersion.settings;
      return {
        ref: { templateId: t.id, versionId: t.publishedVersion.id, versionNo: t.publishedVersion.versionNo, name: t.name },
        settings: s && typeof s === "object" && !Array.isArray(s) ? (s as Record<string, unknown>) : {},
        warnings,
      };
    }
    const why = !t ? "bulunamadı" : t.status !== "ACTIVE" ? "arşivde" : "yayında değil";
    warnings.push(`"${t?.name ?? c.templateId}" şablonu (${c.label}) ${why}; sıradaki seçenek kullanıldı.`);
  }
  if (warnings.length) warnings.push("Belge Sistem tasarımıyla basıldı.");
  return { ref: null, settings: null, warnings };
}

/** Render'a giren donmuş belge bilgisi (servis katmanının kayıttan verdiği). */
export interface TemplatedPrintRecord {
  documentNo: string;
  version: number | null;
  status: "ACTIVE" | "SUPERSEDED" | "VOIDED" | null;
  reissueReason?: string | null;
  reconstructed?: boolean;
  draft?: boolean;
}

/** Renderer meta'sının şablon bağlamına giden alt kümesi (canlı ad rejimi, notlar, damga). */
export interface TemplatedPrintMeta {
  voidReason?: string | null;
  logoDataUrl?: string | null;
  qrDataUrl?: string | null;
  printedBy?: string | null;
  printNote?: string | null;
  [k: string]: unknown;
}

const STATUS_LABEL: Record<string, string> = { ACTIVE: "Geçerli", SUPERSEDED: "Eski sürüm", VOIDED: "İptal" };

/**
 * Donmuş şablonlu belgenin Liquid bağlamı — PDF (`renderFrozenTemplate`) ve Excel (`/tables`,
 * `template-tables.ts`) AYNI fonksiyondan okur ki iki çıktı aynı değeri taşısın (plan Z5).
 */
export function frozenTemplateContext(
  docType: string,
  snapshot: { docConfigOverride: unknown } & Record<string, unknown>,
  input: { meta: TemplatedPrintMeta; rec: TemplatedPrintRecord; internalFields: readonly string[] },
): TemplateContext {
  const { meta, rec } = input;
  const contract = getContract(docType);
  const baski: PrintInput = {
    surum: rec.version,
    durum: rec.status,
    taslak: rec.draft === true,
    iptalNedeni: meta.voidReason ?? null,
    zaman: new Date().toISOString(),
    basan: meta.printedBy ?? null,
    not: meta.printNote ?? null,
    logo: meta.logoDataUrl ?? null,
    qr: meta.qrDataUrl ?? null,
  };
  return contract.insa(snapshot as never, contract.ayarNormalize(snapshot.docConfigOverride), input.internalFields, { baski, canli: meta });
}

/**
 * Donmuş şablon sürümüyle basım. Bağlam `insa(snapshot, ayar, internalFields)` ile kurulur;
 * filigran + künye üst katmanı renderer'ın işidir (şablon CSS'i gizleyemez). Hata 422.
 */
export async function renderFrozenTemplate(
  docType: string,
  snapshot: { template?: FrozenTemplateRef; docConfigOverride: unknown } & Record<string, unknown>,
  meta: TemplatedPrintMeta,
  rec: TemplatedPrintRecord,
): Promise<{ html: string; ref: FrozenTemplateRef }> {
  const ref = snapshot.template;
  if (!ref) throw AppError.internal("Şablonsuz belge şablon yolundan basılamaz.");
  const v = await prisma.documentTemplateVersion.findUnique({
    where: { id: ref.versionId },
    select: { id: true, compiledLiquid: true, css: true, pageSettings: true, internalFields: true },
  });
  // Sürüm silinmez (FK Restrict + trigger); yoksa veri bozulmuştur — sessizce Sistem'e düşülmez.
  if (!v) throw templateFailed(`Belgenin şablon sürümü bulunamadı (${ref.name} v${ref.versionNo}).`, []);
  const internalFields = Array.isArray(v.internalFields) ? (v.internalFields as string[]) : [];
  const overlay: OverlayInput = {
    watermark: rec.draft ? "DRAFT" : rec.status === "VOIDED" ? "VOIDED" : rec.status === "SUPERSEDED" ? "SUPERSEDED" : null,
    imprint:
      rec.draft || rec.version == null
        ? null
        : {
            docNo: rec.documentNo,
            versionNo: rec.version,
            status: STATUS_LABEL[rec.status ?? "ACTIVE"] ?? "Geçerli",
            reviseReason: rec.reissueReason ?? null,
            reconstructed: rec.reconstructed === true,
          },
  };
  try {
    const r = renderTemplate(
      { versionId: v.id, compiledLiquid: v.compiledLiquid, css: v.css, pageSettings: v.pageSettings },
      {
        context: frozenTemplateContext(docType, snapshot, { meta, rec, internalFields }) as unknown as Record<string, unknown>,
        snapshot: snapshot as never,
        overlay,
      },
    );
    return { html: r.html, ref };
  } catch (e) {
    if (e instanceof TemplateRenderError) throw templateFailed(`"${ref.name}" şablonu (v${ref.versionNo}) bu belgeyi basamadı.`, e.issues);
    throw e;
  }
}

function templateFailed(message: string, issues: readonly unknown[]): AppError {
  return new AppError(`${message} Sistem tasarımıyla basmak için "Sistem şablonuyla bas" seçeneğini kullanın.`, 422, true, {
    code: "TEMPLATE_RENDER_FAILED",
    hatalar: issues,
  });
}
