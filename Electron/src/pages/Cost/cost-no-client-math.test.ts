// BEKÇİ (MAL-3): panel maliyet HESAPLAMAZ ve kuru 1 VARSAYMAZ. Maliyet sayfalarının kaynağında sayıya çevirme,
// toplama ve "kur yoksa 1" kalıpları aranır; her sayı `POST /api/cost/preview` ya da kayıtlı sürümden gelir.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = __dirname;
// D4-G3: kârlılık raporu sayfası da tarama kümesinde (panel kârlılık hesaplamaz; sayı sunucunun zarfından).
const ROOTS = [ROOT, join(ROOT, "../Reports/Maliyet")];
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const FORBIDDEN: Array<{ re: RegExp; why: string }> = [
  { re: /\.reduce\s*\(/, why: "istemci toplaması (döküm toplamı sunucunun alanıdır)" },
  { re: /\bparseFloat\s*\(|\bNumber\s*\(|\+\s*\w+\.(tutarTlM|standartTlM|hamTlM|amountPerMTry)/, why: "sayıya çevirip hesap" },
  { re: /\btoFixed\s*\(|\bMath\.round\s*\(/, why: "istemci yuvarlaması (sunum Intl ile, hesap sunucuda)" },
  { re: /(\?\?|\|\|)\s*["']?1(\.0+)?["']?(?![\d.])/, why: "kur yoksa 1 varsayımı (FX_RATE_MISSING gösterilmeli)" },
];

describe("maliyet ekranları: istemci hesap yapmaz, kur 1 varsayılmaz", () => {
  const all = ROOTS.flatMap(files);
  it("taranan dosya kümesi boş değil (körlük zemini)", () => {
    expect(all.length).toBeGreaterThanOrEqual(10);
    expect(all.some((p) => p.endsWith("ProfitabilityReportPage.tsx"))).toBe(true);
  });
  for (const f of FORBIDDEN) {
    it(`yasak kalıp yok: ${f.why}`, () => {
      const hits = all.filter((p) => f.re.test(strip(readFileSync(p, "utf8")))).map((p) => relative(ROOT, p));
      expect(hits).toEqual([]);
    });
  }
});
