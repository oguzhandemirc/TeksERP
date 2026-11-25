// Tarak numarası birimi (K9, 2026-11-25) — TEK çeviri noktası. Saklama birimi SABİT diş/10 cm
// (`WarpSpec.reedNo`); firma ayarı diş/cm ise gösterimde ÷10, girişte ×10. Varsayılanda değer aynen geçer.
import type { DevereReedNumberUnit } from "@/services/featureFlagService";
import { formatQty } from "@/lib/format";

export type ReedUnit = DevereReedNumberUnit;
export const DEFAULT_REED_UNIT: ReedUnit = "DENTS_PER_10CM";

export const reedUnitLabel = (unit: ReedUnit): string => (unit === "DENTS_PER_CM" ? "diş/cm" : "diş/10 cm");

const trim = (n: number, digits: number): string => String(Number(n.toFixed(digits)));
const parse = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Saklı değer (diş/10 cm) → gösterim sayısı; boş/çöp null. */
export function reedDisplayNumber(stored: string | number | null | undefined, unit: ReedUnit): number | null {
  const n = parse(stored);
  if (n === null) return null;
  return unit === "DENTS_PER_CM" ? Number((n / 10).toFixed(3)) : n;
}

/** Saklı değer → form metni (düzenleme açılışı). Varsayılan birimde metin aynen döner. */
export function reedToDisplay(stored: string | number | null | undefined, unit: ReedUnit): string {
  if (unit !== "DENTS_PER_CM") return stored === null || stored === undefined ? "" : String(stored);
  const n = reedDisplayNumber(stored, unit);
  return n === null ? "" : trim(n, 3);
}

/** Form metni → saklama metni (diş/10 cm, Decimal(6,2)); boş null, çöp aynen (doğrulamayı sunucu/şema yapar). */
export function reedFromInput(text: string | null | undefined, unit: ReedUnit): string | null {
  const t = (text ?? "").trim();
  if (t === "") return null;
  if (unit !== "DENTS_PER_CM") return t;
  const n = parse(t);
  return n === null ? t : trim(n * 10, 2);
}

/** Liste/özet/basım metni: saklı değer firma biriminde, Türkçe sayı biçimi; boşsa null. */
export function formatReedNo(stored: string | number | null | undefined, unit: ReedUnit): string | null {
  const n = reedDisplayNumber(stored, unit);
  return n === null ? null : formatQty(n, unit === "DENTS_PER_CM" ? 3 : 2, 0);
}

/** Form metni → diş/cm (taraktan tel önerisi hesabı). */
export function reedDentsPerCm(text: string | null | undefined, unit: ReedUnit): number | null {
  const n = parse(text);
  if (n === null) return null;
  return unit === "DENTS_PER_CM" ? n : n / 10;
}
