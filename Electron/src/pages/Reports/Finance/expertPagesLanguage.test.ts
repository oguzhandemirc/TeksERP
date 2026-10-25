// Muhasebe uzman araçları (Kasa & Banka · KDV · Kur Farkı): sayfa metninde formül dili ve
// rapor v2 yasak sözcükleri yok; "Ne görüyoruz?" kutusu sunucunun `anlati`sını basar.
// Yasak liste TEK kaynaktan okunur (backend `anlati/yasak-sozcuk.ts`); istemcide kopyası yok.
// Negatif sonda: sayfaya "medyan" yaz → §1 kırmızı.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FX_DIFF_NOTES } from "./fxDiffService";
import { lowerTr } from "@/lib/tr-case";

const FINANCE = __dirname;
const PAGES = ["CashBookPage.tsx", "VatSummaryPage.tsx", "FxDiffPage.tsx"];
const BANNED_SOURCE = join(FINANCE, "..", "..", "..", "..", "..", "Teks-Erp", "src", "services", "reports", "anlati", "yasak-sozcuk.ts");

/** `{ sozcuk: "…", desen: sinirli("…") | /…/u }` satırlarından desen kur (backend ile aynı sınır kuralı). */
function bannedWords(): { word: string; re: RegExp }[] {
  const src = readFileSync(BANNED_SOURCE, "utf8");
  const out: { word: string; re: RegExp }[] = [];
  for (const m of src.matchAll(/sozcuk:\s*"([^"]+)",\s*desen:\s*(?:sinirli\("((?:[^"\\]|\\.)+)"\)|\/((?:[^/\\]|\\.)+)\/u)/g)) {
    const body = m[2] !== undefined ? m[2].replace(/\\\\/g, "\\") : undefined;
    const re = body !== undefined ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, "u") : new RegExp(m[3]!, "u");
    out.push({ word: m[1]!, re });
  }
  return out;
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

describe("uzman araç sayfaları — günlük dil", () => {
  const banned = bannedWords();
  it("§0 körlük zemini: yasak liste okundu", () => {
    expect(banned.length).toBeGreaterThanOrEqual(8);
    expect(banned.map((b) => b.word)).toContain("medyan");
  });
  it("§1 ⭐ sayfa metinleri + kur farkı notları yasak sözcük ve formül işareti taşımaz", () => {
    const texts = [...PAGES.map((p) => stripComments(readFileSync(join(FINANCE, p), "utf8"))), ...FX_DIFF_NOTES];
    const offenders: string[] = [];
    texts.forEach((t, i) => {
      const folded = lowerTr(t);
      for (const b of banned) if (b.re.test(folded) || b.re.test(t)) offenders.push(`${PAGES[i] ?? `not ${i}`}: ${b.word}`);
      if (/[×Σ∑]/u.test(t)) offenders.push(`${PAGES[i] ?? `not ${i}`}: formül işareti`);
    });
    expect(offenders, offenders.join(" · ")).toEqual([]);
  });
  it("§2 ⭐ üç sayfa da 'Ne görüyoruz?' kutusunu sunucunun anlatısıyla çizer", () => {
    for (const p of PAGES) expect(readFileSync(join(FINANCE, p), "utf8"), p).toMatch(/<NarrativeBox sentences=\{\w+\.anlati\}/);
  });
});
