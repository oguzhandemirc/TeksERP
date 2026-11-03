// =============================================================================
// GELEN BELGE → İŞ EMRİ FORMU ALANLARI (K30 S16a, saf): okunan ilk bölgenin tanıtılmış alanları → form değerleri.
// =============================================================================
// Hangi yazının hangi inputa gittiğini kullanıcı tanıtmada seçer (`ASSIGNABLE_FIELDS`); burası yalnız değeri forma
// çevirir. Motor ondalık alanı kanonik ("1250.5") saklar — kanoniği yeniden `parseNumber`a VERME ("125.125" binlik
// sanılırdı); kanonik olmayan (eski/elle) değer TR biçiminden ("1.250,50") çözülür. Sıfır/negatif/çözülemeyen → alan yok.
// =============================================================================
import { parseNumber } from "./motor";

export type DesenRenkMode = "KAPALI" | "ONER" | "NOT";

export interface FormFields {
  hedefMetraj?: number;
  hedefKg?: number;
  en?: number;
  desenText?: string;
  renkText?: string;
  not?: string;
}

/** İş emri notunun üst sınırı (form ucu `notes` optText(1000)). */
export const FORM_NOTE_MAX = 1000;
const CANONICAL_NUMBER = /^\d+(\.\d+)?$/;

/** Kanonik ondalık ya da TR/EN biçimli sayı → pozitif sayı; değilse undefined. */
export function formNumber(raw: string | null | undefined): number | undefined {
  const s = raw?.trim();
  if (!s) return undefined;
  const text = CANONICAL_NUMBER.test(s) ? s : parseNumber(s).value;
  const n = text == null ? NaN : Number(text);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const text = (raw: string | null | undefined): string | undefined => {
  const s = raw?.replace(/\s+/g, " ").trim();
  return s ? s : undefined;
};

/**
 * Bölge alanları → form alanları. `NOT` kipinde okunan desen/renk yazısı notun sonuna eklenir ("Desen: … · Renk: …",
 * yalnız dolu olanlar); diğer kiplerde not yalnız tanıtılmış `not` alanıdır.
 */
export function formFieldsFromRegion(fields: Readonly<Record<string, string | null>> | null | undefined, mode: DesenRenkMode): FormFields {
  if (!fields) return {};
  const out: FormFields = {};
  const hedefMetraj = formNumber(fields.hedefMetraj);
  const hedefKg = formNumber(fields.hedefKg);
  const en = formNumber(fields.en);
  const desenText = text(fields.desen);
  const renkText = text(fields.renk);
  if (hedefMetraj !== undefined) out.hedefMetraj = hedefMetraj;
  if (hedefKg !== undefined) out.hedefKg = hedefKg;
  if (en !== undefined) out.en = en;
  if (desenText) out.desenText = desenText;
  if (renkText) out.renkText = renkText;
  const tail = mode === "NOT" ? [desenText ? `Desen: ${desenText}` : null, renkText ? `Renk: ${renkText}` : null].filter(Boolean).join(" · ") : "";
  const not = [text(fields.not), tail || undefined].filter(Boolean).join(" · ");
  if (not) out.not = not.slice(0, FORM_NOTE_MAX);
  return out;
}
