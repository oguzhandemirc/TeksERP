// =============================================================================
// GELEN BELGE — cihaz okumasının SUNUCU TAMAMLAMASI (saf): tabletin okuması bir şablona sınıflanıp başlık alanı boş
// kaldıysa sunucu aynı fotoğrafı okur; YALNIZ boş alanlar sunucunun değeriyle dolar, cihazın dolu bulduğu ezilmez.
// Birleşim çıkarım (`DocumentExtraction`) düzeyindedir: taslak/parti/metre türetimi tamamlanmış alanı olağan yoldan görür.
// =============================================================================
import type { DocumentExtraction, RegionExtraction } from "./motor";
import type { DocumentTemplate, FieldResult, OcrRect, OcrResult } from "./motor/types";
import { upperTr } from "../../utils/tr-case";
import { BATCH_KEYS } from "./taslak";

/** Başlığı taşıyan ilk bölge gerçek bir şablona sınıflandıysa (yedek şablon değil) o bölge; aksi null. */
function headerRegion(ex: DocumentExtraction, fallbackId: string | null): RegionExtraction | null {
  const r = ex.regions[0];
  return r?.templateId && r.templateId !== fallbackId && r.fields ? r : null;
}

/** İlk bölgenin şablon alanlarından değeri BOŞ kalanlar (sınıflanmamış/yedek şablonda boş liste — tamamlama koşmaz). */
export function missingHeaderFields(ex: DocumentExtraction, fallbackId: string | null): string[] {
  const r = headerRegion(ex, fallbackId);
  if (!r?.fields) return [];
  return Object.values(r.fields.fields).filter((f) => f.value === null || f.value.trim() === "").map((f) => f.key);
}

const batchKey = (v: string) => upperTr(v).replace(/[\s*]+/g, "");

/** İki okumanın parti no'su (boşluk/büyük-küçük/barkod yıldızı dışında) farklı mı. */
export function batchNosDiffer(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a?.trim() && !!b?.trim() && batchKey(a) !== batchKey(b);
}

/** Günlük dilde uyarı metni (`uyari.ts` `BATCH_NO_DIFFERS`). */
export function batchDiffWarning(kept: string, other: string): string {
  return `BATCH_NO_DIFFERS: parti no farklı okundu: ${kept.trim()} / ${other.trim()} — belgeyle kontrol edin`;
}

/** Sunucu çerçevesindeki kutu cihaz çerçevesine: aynı dönüşte oransal ölçek; dönüş farklıysa kutu taşınmaz (yanlış vurgu yerine yok). */
function toDeviceFrame(rect: OcrRect | undefined, device: OcrResult, server: OcrResult): OcrRect | undefined {
  if (!rect || (device.rotation ?? 0) !== (server.rotation ?? 0)) return undefined;
  const sx = device.imageWidth / server.imageWidth;
  const sy = device.imageHeight / server.imageHeight;
  return { x: rect.x * sx, y: rect.y * sy, width: rect.width * sx, height: rect.height * sy };
}

export interface CompletionResult {
  extraction: DocumentExtraction;
  /** Sunucudan doldurulan alan anahtarları (künye). */
  filled: string[];
}

/**
 * Cihaz çıkarımının ilk bölgesinin BOŞ alanlarını sunucu çıkarımının AYNI şablona sınıflanmış bölgesinden doldurur.
 * Dolu alan ezilmez; parti no iki okumada farklıysa cihazınki kalır, uyarı düşer. Dolan alan + uyarı ilk bölgeye yazılır.
 */
export function completeExtraction(
  device: { ocr: OcrResult; ex: DocumentExtraction },
  server: { ocr: OcrResult; ex: DocumentExtraction },
  opts: { fallbackId: string | null; templates: readonly DocumentTemplate[] },
): CompletionResult {
  const d = headerRegion(device.ex, opts.fallbackId);
  const s = d ? server.ex.regions.find((r) => r.templateId === d.templateId && r.fields) : undefined;
  if (!d?.fields || !s?.fields) return { extraction: device.ex, filled: [] };
  const fields: Record<string, FieldResult> = { ...d.fields.fields };
  const filled: string[] = [];
  const warnings: string[] = [];
  for (const [key, f] of Object.entries(fields)) {
    const sv = s.fields.fields[key];
    if (!sv?.value?.trim()) continue;
    if (f.value === null || f.value.trim() === "") {
      fields[key] = { ...sv, source: { ...sv.source, rect: toDeviceFrame(sv.source.rect, device.ocr, server.ocr) }, issues: [...sv.issues, "server-completed"] };
      filled.push(key);
    } else if (BATCH_KEYS.includes(key) && batchNosDiffer(f.value, sv.value)) {
      warnings.push(batchDiffWarning(f.value, sv.value));
    }
  }
  if (filled.length) {
    const tpl = opts.templates.find((t) => t.id === d.templateId);
    const labels = filled.map((k) => tpl?.fields.find((f) => f.key === k)?.label ?? k);
    warnings.unshift(`SERVER_COMPLETED: cihaz okumasında boş kalan alanlar sunucu okumasıyla dolduruldu: ${labels.join(", ")}`);
  }
  if (!filled.length && !warnings.length) return { extraction: device.ex, filled };
  const region: RegionExtraction = { ...d, fields: { ...d.fields, fields }, warnings: [...d.warnings, ...warnings] };
  return { extraction: { ...device.ex, regions: [region, ...device.ex.regions.slice(1)] }, filled };
}
