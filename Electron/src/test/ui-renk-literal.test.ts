// =============================================================================
// Bekçi: ortak bileşenlerde sabit renk yok — tema/kişiselleştirme her yüzeye ulaşsın
// =============================================================================
// Kişiselleştirme (hazır tema, özel renk, menü stili, zemin tonu) yalnız CSS değişkenleri üzerinden
// çalışır. Ortak bileşende ham `#hex`, `rgb()/hsl(<sayı>)` ya da Tailwind'in sabit paleti
// (`bg-amber-500`, `text-sky-600`…) seçilen temayı DELER: o parça hep aynı renkte kalır.
// Ölçülen kökler: components/ui · layout · data-table · hub · insight · record · pages/Dashboard · pages/Reports/_hub · pages/Reports/_v2/view (+ FILES) · pages/Definitions/cariler. `hsl(var(--…))` serbest; perde (scrim)
// için `bg-black/NN` serbest (karartma temadan bağımsız siyahtır).
// =============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SRC = path.dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const ROOTS = ["components/ui", "components/layout", "components/data-table", "components/hub", "components/insight", "components/record", "pages/Dashboard", "pages/Reports/_hub", "pages/Reports/_v2/view", "pages/Definitions/cariler"];
/** Kökü taranmayan dizindeki tek dosyalar (rapor v2 ekran iskeleti; PDF/baskı paleti `_v2/grafik/tema.ts` bilerek dışarıda). */
const FILES = [
  "pages/Reports/_v2/ReportV2Page.tsx",
  "pages/Reports/_v2/ParamChips.tsx",
  "pages/Reports/_v2/ReportBody.tsx",
  "pages/Reports/_v2/HeadlineCard.tsx",
  "pages/Reports/_v2/NarrativeBox.tsx",
  "pages/Reports/_v2/figures.ts",
  "pages/Reports/_v2/SmallMultiples.tsx",
  "pages/Reports/_v2/PeriodCompareTable.tsx",
  "pages/Reports/_components/ReportExportBar.tsx",
];

/** Bilinçli istisnalar — yol `src`ye göre; gerekçesiyle. Liste yalnız DARALIR. */
const EXEMPT: Record<string, string> = {};

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const RULES: [string, RegExp][] = [
  ["hex", /(?<![\w&])#[0-9a-fA-F]{3,8}\b(?![\w-])/],
  ["rgb/hsl literal", /\b(?:rgba?|hsla?)\(\s*[\d.]/],
  ["Tailwind sabit paleti", new RegExp(`\\b(?:bg|text|border|ring|from|via|to|fill|stroke|outline|decoration|divide|shadow|accent|caret)-(?:${PALETTE})-\\d{2,3}\\b`)],
  ["beyaz/siyah yazı-zemin", /\b(?:text-white|bg-white|text-black)\b/],
];

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !p.includes(".test.")) out.push(p);
  }
  return out;
}

/** Kaynak metindeki ihlaller: `kural@satır`. Yorum satırları ölçülmez. */
export function colorLiterals(source: string): string[] {
  const hits: string[] = [];
  source.split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "").replace(/\/\*.*?\*\//g, "");
    for (const [name, re] of RULES) if (re.test(code)) hits.push(`${name}@${i + 1}`);
  });
  return hits;
}

describe("ortak bileşenlerde sabit renk yok", () => {
  const files = [...ROOTS.flatMap((r) => walk(path.join(SRC, r))), ...FILES.map((f) => path.join(SRC, f))];
  const found = new Map<string, string[]>();
  for (const f of files) {
    const rel = path.relative(SRC, f);
    const hits = colorLiterals(readFileSync(f, "utf8"));
    if (hits.length) found.set(rel, hits);
  }

  it("⭐ ham renk / sabit palet yok (belirteç kullan: bg-warning-soft, text-primary…)", () => {
    const yeni = [...found.keys()].filter((f) => !(f in EXEMPT));
    expect(yeni.map((f) => `${f} ${found.get(f)?.join(",")}`)).toEqual([]);
  });

  it("istisna listesi bayat değil", () => {
    expect(Object.keys(EXEMPT).filter((f) => !found.has(f))).toEqual([]);
  });

  it("ölçer tanır (sonda)", () => {
    expect(colorLiterals(`const a = "#7c5cff";`)).toEqual(["hex@1"]);
    expect(colorLiterals(`style={{ color: "rgb(1,2,3)" }}`)).toEqual(["rgb/hsl literal@1"]);
    expect(colorLiterals(`className="bg-amber-500/10"`)).toEqual(["Tailwind sabit paleti@1"]);
    expect(colorLiterals(`className="text-white"`)).toEqual(["beyaz/siyah yazı-zemin@1"]);
    expect(colorLiterals(`className="bg-[hsl(var(--primary))] bg-black/50 text-primary"`)).toEqual([]);
    expect(colorLiterals(`// #fff yorum`)).toEqual([]);
  });
});
