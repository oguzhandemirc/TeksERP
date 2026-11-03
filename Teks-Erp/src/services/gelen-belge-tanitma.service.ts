// =============================================================================
// Gelen belge BELGE TİPİ TANITMA (S1) — tanıtma ekranının (S1b) okuma tarafı: OCR kelime kutuları + şablon önerisi
// =============================================================================
// Yazmaz: öneri yalnız şablon JSON'u ve aynı taramada önizlemesini döner; kaydetmek `POST /sablonlar/ozel`dir.
// Kutular OCR (dik) çerçevesindedir — öneri bu çerçeveyle çalışır; `photoRect` saklanan fotoğrafın üstüne çizim içindir.
// =============================================================================
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { OcrResultSchema } from "../lib/gelen-belge/okuma-istemcisi";
import { extractDocument, mergeTemplateForUpdate, suggestTemplate, validateTemplate, type DocumentTemplate, type OcrRect, type OcrResult, type TemplateSuggestInput, type UpdateKeepPart } from "../lib/gelen-belge/motor";
import { rectToPhotoFrame } from "../lib/gelen-belge/taslak-foto-cerceve";
import { draftFromExtraction } from "../lib/gelen-belge/taslak";
import { getUserTemplate, userTemplateCode } from "./gelen-belge-ozel-sablon.service";
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

/** Atamalardan şablon önerisi + aynı taramada önizleme (yalnız bu şablonla sınıflandırma; eşik altı → tanınmadı). */
export async function suggestFromScan(input: SuggestFromScanInput) {
  const ocr = await scanOcr(input.scanId);
  // "Şablonu güncelle": önizleme KAYDEDİLECEK birleşik şablonla koşar (eski şablon + yeni atamalar); istemci bunu aynen kaydeder.
  const old = input.base ? await getUserTemplate(input.base.code) : null;
  const code = old ? old.code : userTemplateCode(input.name);
  const { base, ...rest } = input;
  const s = suggestTemplate({ ...rest, code, ocr });
  if (s.errors.length) return { template: s.template, explain: s.explain, errors: s.errors, preview: null };
  let template = s.template;
  if (old && base) {
    template = mergeTemplateForUpdate({ ...(old.template as unknown as DocumentTemplate), id: old.code, version: old.version }, s.template, base.keep);
    template = { ...template, id: code, name: input.name, version: old.version };
    const v = validateTemplate(template);
    if (!v.ok) return { template, explain: s.explain, errors: v.errors, preview: null };
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
      blocks: draft.header.totalsDeclared.blocks,
      lineCount: draft.lines.length,
      warnings: draft.header.warnings,
    },
  };
}
