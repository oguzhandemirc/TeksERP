import axios from "axios";
import type { AssignmentRef, DocumentTemplateRow, TemplateAssignments } from "@/services/documentTemplateService";

// Şablon listesi / sürümler / yayın / atama ekranlarının SAF kuralları (plan §4, §3.5, P-b).
// React'siz: vitest aynı fonksiyonları ölçer.

export type BadgeTone = "default" | "secondary" | "outline" | "muted" | "destructive";
export interface TemplateBadge {
  key: "default" | "published" | "draft" | "archived" | "code" | "profiles";
  label: string;
  tone: BadgeTone;
}

/** Bir şablonun atandığı profil sayısı (aynı profil farklı türde iki kez sayılmaz). */
export function profileCountOf(templateId: string, a: TemplateAssignments | undefined): number {
  return new Set((a?.profiles ?? []).filter((p) => p.template.id === templateId).map((p) => p.profile.id)).size;
}

export function isTypeDefault(t: Pick<DocumentTemplateRow, "id" | "docType">, a: TemplateAssignments | undefined): boolean {
  return (a?.defaults ?? []).some((d) => d.docType === t.docType && d.template.id === t.id);
}

/** Rozetler: Varsayılan · Yayında vN · Taslak vM · Arşiv · Kod kipi · N profile atalı. */
export function templateBadges(t: DocumentTemplateRow, a: TemplateAssignments | undefined): TemplateBadge[] {
  const out: TemplateBadge[] = [];
  if (isTypeDefault(t, a)) out.push({ key: "default", label: "Varsayılan", tone: "default" });
  const pub = t.publishedVersion?.versionNo ?? null;
  if (pub !== null) out.push({ key: "published", label: `Yayında v${pub}`, tone: "secondary" });
  const latest = t.latestVersionNo ?? 0;
  // Son sürüm yayındakinden yeniyse ya da hiç yayın yoksa yayınlanmamış taslak vardır.
  if (latest > 0 && (pub === null || latest > pub)) out.push({ key: "draft", label: `Taslak v${latest}`, tone: "outline" });
  if (t.status === "ARCHIVED") out.push({ key: "archived", label: "Arşiv", tone: "muted" });
  if (t.editMode === "CODE") out.push({ key: "code", label: "Kod kipi", tone: "outline" });
  const n = profileCountOf(t.id, a);
  if (n > 0) out.push({ key: "profiles", label: `${n} profile atalı`, tone: "outline" });
  return out;
}

// ── İzin yüzeyi ──────────────────────────────────────────────────────────────

export const READ_ONLY_REASON = "Salt-okunur: şablon tasarlamak için `document-template:design` yetkisi gerekir.";
export const PUBLISH_PERMISSION_REASON = "Yayınlamak için `document-template:publish` yetkisi gerekir.";
export const SOD_REASON = "Bu sürümü siz tasarladınız; tasarlayan ≠ yayınlayan ayarı açık — yayını başka bir yetkili yapmalı.";

export interface DesignerAccess {
  canDesign: boolean;
  canPublish: boolean;
  /** Düzenleme denetimleri GİZLENMEZ; pasif + bu gerekçe (null = serbest). */
  designBlock: string | null;
}

export function designerAccess(canDesign: boolean, canPublish: boolean): DesignerAccess {
  return { canDesign, canPublish, designBlock: canDesign ? null : READ_ONLY_REASON };
}

/** Yayın düğmesinin pasiflik gerekçesi: izin → arşiv → kaydedilmemiş değişiklik → SoD (P-b). */
export function publishBlockReason(opts: {
  canPublish: boolean;
  archived: boolean;
  dirty?: boolean;
  sodEnabled: boolean;
  me: string | null | undefined;
  versionAuthor: string | null | undefined;
}): string | null {
  if (!opts.canPublish) return PUBLISH_PERMISSION_REASON;
  if (opts.archived) return "Arşivdeki şablon yayınlanamaz; önce arşivden çıkarın.";
  if (opts.dirty) return "Kaydedilmemiş değişiklik var; önce taslağı kaydedin.";
  if (opts.sodEnabled && opts.me && opts.versionAuthor && opts.me === opts.versionAuthor) return SOD_REASON;
  return null;
}

// ── Sunucu hatası (`details.code`) ───────────────────────────────────────────

export interface TemplateApiError {
  status: number | null;
  code: string | null;
  message: string | null;
  details: Record<string, unknown>;
}

export function readTemplateError(error: unknown): TemplateApiError {
  if (!axios.isAxiosError(error)) return { status: null, code: null, message: null, details: {} };
  const body = error.response?.data as { message?: unknown; details?: Record<string, unknown> } | undefined;
  const details = body?.details && typeof body.details === "object" ? body.details : {};
  return {
    status: error.response?.status ?? null,
    code: typeof details.code === "string" ? details.code : null,
    message: typeof body?.message === "string" ? body.message : null,
    details,
  };
}

/** Kod → kullanıcıya Türkçe açıklama (sunucu cümlesi ek bilgi olarak altında kalır). */
export const TEMPLATE_ERROR_TEXT: Record<string, string> = {
  TEMPLATE_PUBLISH_CONFLICT: "Başkası bu şablonu siz bakarken yayınladı. Listeyi yenileyip yeniden deneyin.",
  TEMPLATE_UNSAFE_CONTENT: "Şablonda güvenli olmayan içerik var; aşağıdaki kesilen öğeleri kaldırıp yeniden kaydedin.",
  TEMPLATE_RENDER_FAILED: "Şablon örnek senaryolardan birinde basılamadı; hata satırını düzeltip yeniden kaydedin.",
  PUBLISH_SOD: SOD_REASON,
  TEMPLATE_ARCHIVED: "Arşivdeki şablon yayınlanamaz; önce arşivden çıkarın.",
  TEMPLATE_ASSIGNED: "Şablon atanmış; önce aşağıdaki atamaları başka şablona çevirin ya da kaldırın.",
  TEMPLATE_PUBLISHED: "Yayınlanmış şablon silinemez; arşivleyin.",
  TEMPLATE_NAME_TAKEN: "Bu belge türünde aynı adlı bir şablon zaten var; başka bir ad seçin.",
  NO_SYSTEM_EQUIVALENT: "Bu belge türü için kopyalanabilir tasarım henüz yok.",
  TEMPLATE_VERSION_STALE: "Şablon siz düzenlerken başka biri tarafından kaydedildi; sürümleri yenileyin.",
  TEMPLATE_NOT_ASSIGNABLE: "Yalnız bu belge türünün etkin ve yayınlanmış şablonu atanabilir.",
  TEMPLATE_ASSIGNMENT_CONFLICT: "Atama aynı anda başka biri tarafından değiştirildi; yenileyip yeniden deneyin.",
  DOCUMENT_DESIGNER_DISABLED: "Belge tasarımcısı bu kurulumda kapalı.",
};

export function templateErrorText(e: TemplateApiError, fallback: string): string {
  const known = e.code ? TEMPLATE_ERROR_TEXT[e.code] : undefined;
  if (known) return known;
  if (e.status === 409) return e.message ?? "Kayıt siz bakarken değişti; yenileyip yeniden deneyin.";
  return e.message ?? fallback;
}

/** `TEMPLATE_UNSAFE_CONTENT.kesilenler` → "senaryo: öğe" satırları. */
export function unsafeContentLines(details: Record<string, unknown>): string[] {
  const k = details.kesilenler;
  if (!k || typeof k !== "object") return [];
  return Object.entries(k as Record<string, unknown>).flatMap(([senaryo, list]) =>
    (Array.isArray(list) ? list : []).map((item) => `${senaryo}: ${String(item)}`),
  );
}

/** `TEMPLATE_ASSIGNED.atamalar` → okunur satırlar. */
export function assignmentLines(details: Record<string, unknown>, label: (docType: string) => string): string[] {
  const list = Array.isArray(details.atamalar) ? (details.atamalar as AssignmentRef[]) : [];
  return list.map((a) => (a.kind === "default" ? `${label(a.docType)} · tür varsayılanı` : `${label(a.docType)} · ${a.profileName ?? "profil"}`));
}
