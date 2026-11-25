// =============================================================================
// KUMAŞ ENLERİ — en sıralaması uyarısı + en çekmesi + g/m² → g/mt (TEK KAYNAK)
// =============================================================================
// Beklenen sıra: mamul en ≤ ham en ≤ tarak eni. Ters giriş REDDEDİLMEZ, UYARIR (tek tezgâhta bilinçli istisna
// olabilir); eksik değer varsa o karşılaştırma yapılmaz. Mamul en = `Item.widthCm` (ayrı alan yok, dokuma.md).
// =============================================================================
import { Prisma } from "@prisma/client";
import { qtyText } from "./qty-text.helper";

type Dec = Prisma.Decimal;
const HUNDRED = new Prisma.Decimal(100);
const pos = (v: Dec | null | undefined): Dec | null => (v && v.gt(0) ? v : null);

export const WIDTH_WARNING = {
  finishedWiderThanRaw: "FINISHED_WIDER_THAN_RAW",
  rawWiderThanReed: "RAW_WIDER_THAN_REED",
} as const;

export interface FabricWidths { finishedWidthCm: Dec | null | undefined; rawWidthCm: Dec | null | undefined; reedWidthCm: Dec | null | undefined }

export function widthOrderWarnings(w: FabricWidths): Array<{ code: string; message: string }> {
  const finished = pos(w.finishedWidthCm), raw = pos(w.rawWidthCm), reed = pos(w.reedWidthCm);
  const out: Array<{ code: string; message: string }> = [];
  if (finished && raw && finished.gt(raw)) {
    out.push({ code: WIDTH_WARNING.finishedWiderThanRaw, message: `Mamul en (${qtyText(finished)} cm) ham enden (${qtyText(raw)} cm) geniş; genelde mamul en ≤ ham en olur. Değerleri kontrol edin.` });
  }
  if (raw && reed && raw.gt(reed)) {
    out.push({ code: WIDTH_WARNING.rawWiderThanReed, message: `Ham en (${qtyText(raw)} cm) tarak eninden (${qtyText(reed)} cm) geniş; genelde ham en ≤ tarak eni olur. Değerleri kontrol edin.` });
  }
  return out;
}

/** En çekmesi % = (ham en − mamul en) ÷ ham en × 100; iki en de pozitif değilse null. Negatif = mamul ham enden geniş. */
export function widthShrinkPct(rawWidthCm: Dec | null | undefined, finishedWidthCm: Dec | null | undefined): Dec | null {
  const raw = pos(rawWidthCm), finished = pos(finishedWidthCm);
  return raw && finished ? raw.minus(finished).div(raw).mul(HUNDRED) : null;
}

/** Metretül ağırlığı (g/mt) = g/m² × en (m); biri yoksa null. */
export function gramsPerLinearMetre(gsm: Dec | null | undefined, widthCm: Dec | null | undefined): Dec | null {
  const g = pos(gsm), width = pos(widthCm);
  return g && width ? g.mul(width).div(HUNDRED) : null;
}
