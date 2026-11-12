// =============================================================================
// GELEN BELGE — CANLI OKUMA (kamera açıkken kare okuma, L1 sunucu; Gülkesim 2026-11-05)
// =============================================================================
// Tablet ~saniyede 1 o anki karenin ML Kit kelime listesini (`ClientOcr` tel biçimi) gönderir; sunucu BUGÜNKÜ şablon
// motoruyla belge türünü + başlık alanlarını döner. HİÇBİR ŞEY YAZMAZ: tarama/taslak/şablon satırı doğmaz, şablon
// isabeti sayılmaz, audit yok (salt okuma — istasyon eşleme okuması ve `extractDraft` gibi). Tablo satırları dönmez.
// Alan çıkarımının tek kaynağı motordur; tablet yalnız oylar/kilitler (L3).
// =============================================================================
import { AppError } from "../utils/app-error";
import { ClientOcrSchema, clientOcrToResult } from "../lib/gelen-belge/istemci-ocr";
import { rectToSource, uprightClientOcr, type OrientationTransform } from "../lib/gelen-belge/sayfa-yonu";
import { extractDocument, type DocumentTemplate, type OcrRect } from "../lib/gelen-belge/motor";
import { engineTemplates } from "./gelen-belge-ozel-sablon.service";
import { FALLBACK_TEMPLATE_CODE } from "./gelen-belge-sablon.service";

export interface LiveReadBox { x: number; y: number; w: number; h: number }

export interface LiveReadField {
  key: string;
  label: string;
  value: string | null;
  needsReview: boolean;
  issues?: string[];
  /** Değer kelimelerinin birleşik kutusu — gönderilen karenin (width × height) piksel çerçevesinde. */
  box?: LiveReadBox;
}

export interface LiveReadResult {
  template: { code: string; name: string; version: number } | null;
  score: number;
  fields: LiveReadField[];
  /** Motor süresi (ms) — ölçüm/teşhis; tablet istek aralığını buna göre seyreltebilir. */
  engineMs: number;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

/** Biçim kuralını çiğneyen değer canlı okumada oy değildir (tablet kilitlemesin); fotoğraf yolu aynı değeri gözden geçirmeye düşürür. */
const LIVE_FORMAT_ISSUES = new Set(["pattern-mismatch", "date-invalid", "enum-no-match", "out-of-range", "too-long"]);

/** Katı ayrıştırma (`istemci-ocr.ts` tavanları); ihlal 400 `LIVE_FRAME_INVALID`. */
function parseFrame(raw: unknown) {
  const parsed = ClientOcrSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
    throw AppError.badRequest(`Canlı okuma karesi geçersiz${where}.`, { code: "LIVE_FRAME_INVALID" });
  }
  // Kâğıt kadrajda herhangi bir açıyla durabilir: alanlar dik çerçevede çıkarılır, kutular kareye geri çevrilir.
  const up = uprightClientOcr(parsed.data, "ANY");
  return { ocr: clientOcrToResult(up.ocr), transform: up.transform };
}

/** Bölge çerçevesindeki kutu → kare çerçevesi (bölgeler yalnız dikey kaydırılır, `splitRegions`; dikleştirildiyse geri döndürülür). */
function toFrameBox(rect: OcrRect | undefined, regionTop: number, t: OrientationTransform | null): LiveReadBox | undefined {
  if (!rect || rect.width <= 0 || rect.height <= 0) return undefined;
  const up = { ...rect, y: rect.y + regionTop };
  const f = t ? rectToSource(up, t) : up;
  return { x: r1(f.x), y: r1(f.y), w: r1(f.width), h: r1(f.height) };
}

/**
 * Kare → belge türü + başlık alanları. GENEL yedek sözlük canlı okumada "tanındı" sayılmaz (template null): panel
 * yalnız tanıtılmış/dosya şablonunun alanlarını gösterir. Şablonun TÜM alanları döner; bulunamayan `value: null`.
 */
export async function liveReadFrame(raw: unknown): Promise<LiveReadResult> {
  const { ocr, transform } = parseFrame(raw);
  const templates: DocumentTemplate[] = (await engineTemplates()).filter((t) => t.id !== FALLBACK_TEMPLATE_CODE);
  const t0 = performance.now();
  const region = extractDocument(ocr, templates, null).regions[0];
  const engineMs = Math.round(performance.now() - t0);
  const template = region?.templateId ? templates.find((t) => t.id === region.templateId) ?? null : null;
  if (!region || !template || !region.fields) return { template: null, score: r1(region?.classificationScore ?? 0), fields: [], engineMs };
  const got = region.fields.fields;
  const fields = template.fields.map((spec): LiveReadField => {
    const f = got[spec.key];
    // Etiket/makul olmayan değer motorda zaten boşalır (label-guard · value-guard); biçim ihlali burada boşaltılır, kod issues'ta kalır.
    const value = f?.issues.some((i) => LIVE_FORMAT_ISSUES.has(i)) ? null : f?.value ?? null;
    const box = value === null ? undefined : toFrameBox(f?.source.rect, region.region.rect.y, transform);
    const issues = f?.issues.length ? f.issues : value === null ? ["not-found"] : undefined;
    return { key: spec.key, label: spec.label, value, needsReview: f?.needsReview ?? true, ...(issues ? { issues } : {}), ...(box ? { box } : {}) };
  });
  return { template: { code: template.id, name: template.name, version: template.version }, score: Math.round(region.classificationScore * 10000) / 10000, fields, engineMs };
}
