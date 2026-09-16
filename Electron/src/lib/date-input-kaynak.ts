// =============================================================================
// TAKVİM GİRDİSİ CIRCIRI — sayaç (saf): test dışı kaynakta yerleşik `type="date"|"datetime-local"|"month"`
// =============================================================================
// Kullanıcı 2026-09-17: "takvimle ilgili yerlerde hep eski sistem kullanılmış" — panelin tek takvim girdisi
// `DatePickerInput` (+ `DateRangeInput` · `DateTimeInput`). Yerleşik tarih girdisi sayısı TABANDAN aşağı
// iner, yukarı çıkamaz (`lib/__tests__/date-input-kaynak.test.ts`). Yorumlar ÖNCE soyulur: `.ts` dosyalarında
// `<input type="date">` sözü dokümantasyondur, ihlal değil (ilk ölçümde 76 satırın 14'ü yorumdu).
// =============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const NATIVE_DATE_INPUT_RE = /type=["'](date|datetime-local|month)["']/g;

// Yorumları soyar: satır yorumu, blok yorumu ve JSX içindeki blok yorumu (üçü de).
export function yorumlariSoy(src: string): string {
  return src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Gerekçeli muafiyet — dosya yolu (src'ye göre) → neden. Yalnız yerleşik girdiyi SARMALAYAN bileşenler. */
export const MUAF: ReadonlyMap<string, string> = new Map([
  ["components/forms/DateTimeInput.tsx", "Saat parçası yerleşik <input type=\"time\"> — tarih parçası DatePickerInput; takvim yok."],
]);

export interface DateInputHit {
  file: string;
  count: number;
}

export function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      walk(p, out);
    } else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\.[tj]sx?$/.test(name)) out.push(p);
  }
  return out;
}

/** src altındaki test dışı dosyalarda yerleşik tarih girdisi sayımı (yorumsuz), muaf dosyalar hariç. */
export function nativeDateInputHits(srcRoot: string): DateInputHit[] {
  const hits: DateInputHit[] = [];
  for (const file of walk(srcRoot)) {
    const rel = path.relative(srcRoot, file).split(path.sep).join("/");
    if (MUAF.has(rel)) continue;
    const count = (yorumlariSoy(readFileSync(file, "utf8")).match(NATIVE_DATE_INPUT_RE) ?? []).length;
    if (count > 0) hits.push({ file: rel, count });
  }
  return hits.sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
}
