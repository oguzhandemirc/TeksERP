// =============================================================================
// Gelen belge BELGE TİPİ TANITMA (S1) — tanıtma ekranının (S1b) okuma tarafı: OCR kelime kutuları + şablon önerisi
// =============================================================================
// Yazmaz: öneri yalnız şablon JSON'u ve aynı taramada önizlemesini döner; kaydetmek `POST /sablonlar/ozel`dir.
// Kutular OCR (dik) çerçevesindedir — öneri bu çerçeveyle çalışır; `photoRect` saklanan fotoğrafın üstüne çizim içindir.
// =============================================================================
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { OcrResultSchema } from "../lib/gelen-belge/okuma-istemcisi";
import { extractDocument, meterKgClashErrors, mergeTemplateForUpdate, suggestTemplate, templatesOverThreshold, validateTemplate, type DocumentTemplate, type OcrRect, type OcrResult, type RegionExtraction, type TemplateSuggestInput, type UpdateKeepPart } from "../lib/gelen-belge/motor";
import { rectToPhotoFrame } from "../lib/gelen-belge/taslak-foto-cerceve";
import { draftFromExtraction } from "../lib/gelen-belge/taslak";
import { getUserTemplate, loadUserTemplates, userTemplateCode } from "./gelen-belge-ozel-sablon.service";
import { photoPurgedError } from "./gelen-belge-foto-saklama.service";

export interface ScanWord {
  text: string;
  rect: OcrRect;
  photoRect: OcrRect;
  lineNo: number;
  confidence: number | null;
}

/** Taramanın saklı OCR sonucu; okunmamış/şema dışı → 409 (FAIL-CLOSED). */
async function scanOcr(scanId: string): Promise<OcrResult> {
  const scan = await prisma.documentScan.findUnique({ where: { id: scanId }, select: { ocrResult: true, contentState: true } });
  if (!scan) throw AppError.notFound("Belge taraması bulunamadı.", { code: "DOCUMENT_SCAN_NOT_FOUND" });
  // K28: tanıtma kutuları fotoğrafın üstüne çizilir — SİLİNDİ'de kapalı; KÜÇÜK'te kutular oranla çizilir (en iyi çaba).
  if (scan.contentState === "PURGED") throw photoPurgedError();
  const env = scan.ocrResult;
  const ocr = env !== null && typeof env === "object" && !Array.isArray(env) ? (env as Record<string, unknown>).ocr : undefined;
  const parsed = OcrResultSchema.safeParse(ocr);
  if (!parsed.success) throw AppError.conflict("Bu fotoğraf henüz okunmadı; önce okumaya gönderin.", { code: "DOCUMENT_SCAN_NOT_READ" });
  return parsed.data as OcrResult;
}

/** Kelime kutuları (satır sırasıyla) + görüntü boyutu. */
export async function getScanWords(scanId: string) {
  const ocr = await scanOcr(scanId);
  const words: ScanWord[] = [];
  let lineNo = 0;
  for (const b of ocr.blocks) {
    for (const l of b.lines) {
      lineNo += 1;
      for (const e of l.elements) {
        words.push({ text: e.text, rect: e.rect, photoRect: rectToPhotoFrame(e.rect, ocr.rotation, ocr.imageWidth, ocr.imageHeight), lineNo, confidence: e.confidence });
      }
    }
  }
  return { imageWidth: ocr.imageWidth, imageHeight: ocr.imageHeight, rotation: ocr.rotation ?? 0, words };
}

export type SuggestFromScanInput = Omit<TemplateSuggestInput, "ocr" | "code"> & { scanId: string; base?: { code: string; keep: UpdateKeepPart[] } };

/**
 * K30-B tel sözleşmesi madde 3: bu taramada kimlik eşiğini (motorun `templateMinScore`u) geçen MEVCUT aktif kullanıcı
 * şablonları, güncellenen şablon hariç, skor azalan — çalışan aynı belgeyi ikinci kez tanıtmasın diye uyarı kaynağı.
 */
export async function similarUserTemplates(ocr: OcrResult, excludeCode: string | null): Promise<Array<{ kod: string; ad: string; skor: number }>> {
  const user = (await loadUserTemplates()).filter((t) => t.id !== excludeCode);
  return templatesOverThreshold(ocr, user).map(({ template, score }) => ({ kod: template.id, ad: template.name || template.id, skor: score }));
}

/** Okunan değerlerin kutuları sayfa (OCR) çerçevesinde — tanıtma ekranı eski şablonun alanlarını belge üstünde işaretler. */
function fieldRectsOf(region: RegionExtraction | undefined): Record<string, OcrRect> {
  const out: Record<string, OcrRect> = {};
  if (!region?.fields) return out;
  const dy = region.region.rect.y;
  for (const [k, f] of Object.entries(region.fields.fields)) {
    const r = f.value != null ? f.source.rect : undefined;
    if (r) out[k] = { x: r.x, y: r.y + dy, width: r.width, height: r.height };
  }
  return out;
}

/** Atamalardan şablon önerisi + aynı taramada önizleme (yalnız bu şablonla sınıflandırma; eşik altı → tanınmadı). */
export async function suggestFromScan(input: SuggestFromScanInput) {
  const ocr = await scanOcr(input.scanId);
  // "Şablonu güncelle": önizleme KAYDEDİLECEK birleşik şablonla koşar (eski şablon + yeni atamalar); istemci bunu aynen kaydeder.
  const old = input.base ? await getUserTemplate(input.base.code) : null;
  const code = old ? old.code : userTemplateCode(input.name);
  const { base, ...rest } = input;
  const s = suggestTemplate({ ...rest, code, ocr });
  const benzerSablonlar = await similarUserTemplates(ocr, input.base?.code ?? null);
  // Güncellemede doğrulanan KAYDEDİLECEK birleşik şablondur (yalnız yeni parçası boş/eksik olabilir: atanmayan eski alan korunur).
  if (s.errors.length && !(old && base)) return { template: s.template, explain: s.explain, errors: s.errors, preview: null, benzerSablonlar };
  let template = s.template;
  if (old && base) {
    template = mergeTemplateForUpdate({ ...(old.template as unknown as DocumentTemplate), id: old.code, version: old.version }, s.template, base.keep);
    template = { ...template, id: code, name: input.name, version: old.version };
    // Birleşik şablon da metre ↔ kg hücre kapısından geçer (eski kg alanı yeni metre alanıyla aynı hücreyi okumasın).
    const errors = [...validateTemplate(template).errors, ...meterKgClashErrors(template)];
    if (errors.length) return { template, explain: s.explain, errors, preview: null, benzerSablonlar };
  }
  const doc = extractDocument(ocr, [template], null);
  const draft = draftFromExtraction(doc, { templates: [template] });
  const region = doc.regions[0];
  return {
    template,
    explain: s.explain,
    errors: [] as string[],
    preview: {
      matched: region?.templateId === code,
      score: region ? Math.round(region.classificationScore * 10000) / 10000 : 0,
      fields: draft.header.regions[0]?.fields ?? {},
      fieldRects: fieldRectsOf(region),
      blocks: draft.header.totalsDeclared.blocks,
      lineCount: draft.lines.length,
      warnings: draft.header.warnings,
    },
    benzerSablonlar,
  };
}
