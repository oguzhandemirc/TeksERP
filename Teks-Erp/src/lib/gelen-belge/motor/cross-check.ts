// Çapraz doğrulama (saf, 2026-11-09): okunan metre/kg değerlerini belgenin kendi içindeki diğer rakamlarla karşılaştırır.
// Yalnız UYARI üretir ("KOD: ayrıntı"), değer değiştirmez; hangi metrenin kaynak olduğu şablonda zaten bellidir.
// Toplam ↔ satır toplamı farkı burada DEĞİL: `totals.ts` (TOTAL_MISMATCH) + canlı `totalsCheck` sahibidir.
import type { FieldResult, NoteTotalsResult, OcrResult } from "./types";
import { collectLines } from "./geometry";
import { buildRowsTilted } from "./rows-tilted";
import { parseNumber } from "./normalizers";
import { normalizeForMatch } from "./text-normalize";
import { KG_FAMILY_FIELDS, METER_FAMILY_FIELDS } from "./olcu-cakisma";

export const METER_VALUES_DIFFER = "METER_VALUES_DIFFER";
export const KG_METER_RATIO = "KG_METER_RATIO";

/** Metre etiket sözcükleri (normalize: küçük harf, aksansız). Tek "m" yok: "M" kısaltması başka anlam taşır. */
const METER_WORDS = new Set(["mt", "mtr", "metre", "metraj"]);
/** İki metre "aynı" sayılır: mutlak 0,5 m ya da %0,5 farkın altı (yuvarlama). */
const SAME_METER_ABS = 0.5;
const SAME_METER_REL = 0.005;
/** En biliniyorsa gramaj (g/m²) makul aralığı; en yoksa metretül ağırlığı (g/m). */
export const GSM_RANGE = { min: 15, max: 1500 } as const;
export const GRAM_PER_METER_RANGE = { min: 20, max: 5000 } as const;

const num = (v: string | null | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const firstValue = (fields: Record<string, FieldResult>, keys: readonly string[]): number | null => {
  for (const k of keys) {
    const n = num(fields[k]?.value);
    if (n !== null && n > 0) return n;
  }
  return null;
};
const sameMeter = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(SAME_METER_ABS, Math.max(a, b) * SAME_METER_REL);
const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "").replace(".", ","));

/**
 * Saf: satır metninde ETİKETLİ metre değerleri — sözcük dizisinde metre sözcüğünün solunda bir harf sözcüğü (etiket),
 * sağında (isteğe bağlı ":") bir sayı ("Müşteri MT 238,00", "Toplam Metre: 241"). "241,00 MT 734,00 KG" gibi birim
 * ekinden sonra gelen sayı etiketli değildir (solunda sayı var) → sayılmaz.
 */
export function labeledMeterValues(rowText: string): number[] {
  const toks = rowText.split(/\s+/).filter(Boolean);
  const out: number[] = [];
  for (let i = 1; i < toks.length - 1; i++) {
    const w = normalizeForMatch(toks[i]!).replace(/:$/, "");
    if (!METER_WORDS.has(w)) continue;
    if (!/\p{L}{2,}/u.test(toks[i - 1]!) || /\d/.test(toks[i - 1]!)) continue;
    const next = toks[i + 1] === ":" ? toks[i + 2] : toks[i + 1];
    if (!next || !/^\d[\d.,]*$/.test(next.replace(/^:/, ""))) continue;
    const v = num(parseNumber(next.replace(/^:/, "")).value);
    if (v !== null && v > 0) out.push(v);
  }
  return out;
}

/** Saf: belgedeki metre değeri ile etiketli diğer metreler farklıysa uyarı (ilk farklı değer). */
export function meterDiffWarning(meter: number, rowTexts: readonly string[]): string | null {
  for (const t of rowTexts) {
    for (const v of labeledMeterValues(t)) {
      if (!sameMeter(v, meter)) return `${METER_VALUES_DIFFER}: belgede iki farklı metre: ${fmt(v)} / ${fmt(meter)} — kaynak metreyi belgeyle karşılaştırın`;
    }
  }
  return null;
}

/** Saf: kg/metre oranı makul değilse uyarı (en biliniyorsa g/m², yoksa g/m). */
export function ratioWarning(kg: number, meter: number, widthCm: number | null): string | null {
  const gpm = (kg * 1000) / meter;
  if (widthCm !== null && widthCm > 0) {
    const gsm = gpm / (widthCm / 100);
    if (gsm < GSM_RANGE.min || gsm > GSM_RANGE.max) return `${KG_METER_RATIO}: ${fmt(kg)} kg / ${fmt(meter)} m, en ${fmt(widthCm)} cm → ${Math.round(gsm)} g/m² (makul ${GSM_RANGE.min}–${GSM_RANGE.max}) — metre ya da kg yanlış okunmuş olabilir`;
    return null;
  }
  if (gpm < GRAM_PER_METER_RANGE.min || gpm > GRAM_PER_METER_RANGE.max) return `${KG_METER_RATIO}: ${fmt(kg)} kg / ${fmt(meter)} m → ${Math.round(gpm)} g/m (makul ${GRAM_PER_METER_RANGE.min}–${GRAM_PER_METER_RANGE.max}) — metre ya da kg yanlış okunmuş olabilir`;
  return null;
}

/** Bölge çapraz doğrulaması (TEK giriş; `document.ts` alan çıkarımından sonra çağırır). Metre/kg yoksa tablo toplamı. */
export function crossCheckWarnings(ocr: OcrResult, fields: Record<string, FieldResult>, totals: NoteTotalsResult | null): string[] {
  const out: string[] = [];
  const grandM = num(totals?.grand.m), grandKg = num(totals?.grand.kg);
  const meter = firstValue(fields, METER_FAMILY_FIELDS) ?? (grandM && grandM > 0 ? grandM : null);
  const kg = firstValue(fields, KG_FAMILY_FIELDS) ?? (grandKg && grandKg > 0 ? grandKg : null);
  if (meter === null) return out;
  const diff = meterDiffWarning(meter, buildRowsTilted(collectLines(ocr)).map((r) => r.text));
  if (diff) out.push(diff);
  if (kg !== null) {
    const r = ratioWarning(kg, meter, firstValue(fields, ["en"]));
    if (r) out.push(r);
  }
  return out;
}
