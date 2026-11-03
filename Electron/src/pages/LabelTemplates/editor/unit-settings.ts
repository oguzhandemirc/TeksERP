// Etiket şablonu birim sistemi (Gülkesim S5) — backend `config/label-units.ts` aynası.
// Biçim SUNUCUDA uygulanır; burada yalnız seçici modeli + açıklama örneği var.

export type LabelUnitSystem = "METRIC" | "US" | "BOTH";
export type LabelDecimalSep = "," | ".";

export interface LabelUnitSettings {
  system: LabelUnitSystem;
  decimals?: number | null;
  decimalSep?: LabelDecimalSep | null;
}

export const UNIT_SYSTEM_OPTIONS: ReadonlyArray<{ value: LabelUnitSystem; label: string; hint: string }> = [
  { value: "METRIC", label: "Metrik (m, cm, kg)", hint: "Bugünkü biçim." },
  { value: "US", label: "ABD (yd, in, lb)", hint: "m→yd ÷0,9144 · cm→in ÷2,54 · kg→lb ×2,20462" },
  { value: "BOTH", label: "İkisi yan yana", hint: "Ör. 150 cm / 59,06 in" },
];

/** "auto" = en çok 2 hane, sondaki sıfırlar atılır (bugünkü). */
export type DecimalsChoice = "auto" | "0" | "1" | "2" | "3";

/** Seçici durumu → kaydedilecek değer; bugünkü biçimle aynıysa null (kolon boş kalır, bayt-aynı). */
export function toUnitSettings(
  system: LabelUnitSystem,
  decimals: DecimalsChoice,
  sep: LabelDecimalSep,
): LabelUnitSettings | null {
  if (system === "METRIC" && decimals === "auto" && sep === ",") return null;
  return {
    system,
    decimals: decimals === "auto" ? null : Number(decimals),
    decimalSep: sep === "," ? null : sep,
  };
}

export function fromUnitSettings(s: LabelUnitSettings | null | undefined): {
  system: LabelUnitSystem;
  decimals: DecimalsChoice;
  sep: LabelDecimalSep;
} {
  const d = s?.decimals;
  return {
    system: s?.system ?? "METRIC",
    decimals: d == null ? "auto" : (String(d) as DecimalsChoice),
    sep: s?.decimalSep ?? ",",
  };
}

function fmt(n: number, decimals: number | null | undefined, sep: LabelDecimalSep): string {
  const txt = n.toLocaleString("tr-TR", {
    useGrouping: false,
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? 2,
  });
  return sep === "." ? txt.replace(",", ".") : txt;
}

/** Seçicinin altında görünen örnek (150 cm en) — sunucu biçimiyle aynı kurallar. */
export function unitExample(s: LabelUnitSettings | null): string {
  const sep = s?.decimalSep ?? ",";
  const metric = `${fmt(150, s?.decimals, sep)} cm`;
  const us = `${fmt(150 / 2.54, s?.decimals, sep)} in`;
  const sys = s?.system ?? "METRIC";
  return sys === "METRIC" ? metric : sys === "US" ? us : `${metric} / ${us}`;
}
