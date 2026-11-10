// =============================================================================
// Etiket Stüdyosu — tarih alanının biçim seçicisi (saf model; backend `fmt.date`)
// =============================================================================
import type { LabelFieldDateFormat, LabelFieldFormat } from "@/types/label-canvas";
import { FIELD_DATE_FORMATS } from "@/types/label-canvas";

/** Backend `FIELD_DATE_KEYS` aynası — `fmt.date` yalnız bu alanlarda geçerli. */
export const FIELD_DATE_BINDS: readonly string[] = ["printedAt", "woundAt"];

/** Seçici değeri: "none" = saatli varsayılan (fmt yok). */
export type DateFormatChoice = "none" | LabelFieldDateFormat;

export const DATE_FORMAT_OPTIONS: ReadonlyArray<{ value: DateFormatChoice; label: string }> = [
  { value: "none", label: "Saatli (varsayılan)" },
  ...FIELD_DATE_FORMATS.map((f) => ({ value: f, label: f === "MM/DD/YYYY" ? "AA/GG/YYYY (ABD)" : f.replace(/D/g, "G").replace(/M/g, "A") })),
];

export function dateFormatChoice(fmt: LabelFieldFormat | undefined): DateFormatChoice {
  return fmt?.date ?? "none";
}

/** Seçim → yeni `fmt`; "none" alanı biçimsiz bırakır (sunucu bugünkü saatli metni basar). */
export function fmtForDateChoice(choice: DateFormatChoice): LabelFieldFormat | undefined {
  return choice === "none" ? undefined : { date: choice };
}

/** Veri alanı değişince uyumsuz `fmt` düşer — tarih biçimi yalnız tarih alanında, ölçü biçimi tarihte değil (sunucu 400 verirdi). */
export function fmtAfterBindChange(fmt: LabelFieldFormat | undefined, bind: string): LabelFieldFormat | undefined {
  if (!fmt) return undefined;
  const isDate = FIELD_DATE_BINDS.includes(bind);
  return (fmt.date !== undefined) === isDate ? fmt : undefined;
}
