import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_NUM_FMTS } from "@/lib/number-format";

/**
 * RAPOR SPEC'LERİNİN SAYI BİÇİMİ ENVANTERİ — bilinmeyen biçim kırmızı.
 *
 * Rapor motoru (`reportExport`) PDF metnini ve Excel biçimini `lib/number-format`ten
 * türetir; eşitlik bekçisi (`lib/number-format.test.ts`) yalnız `REPORT_NUM_FMTS`
 * kümesini ölçer. Kümede olmayan bir biçim (ör. "0.00%" ya da tarih biçimi) bir spec'e
 * yazılırsa PDF ile Excel yine sessizce ayrışabilir — bu yüzden motoru içe aktaran HER
 * dosyadaki `numFmt` değeri (literal ya da aynı dosyadaki sabit) kümede olmalı.
 *
 * Negatif sonda (commit mesajında): bir spec'e "0.00%" yazıldı → kırmızı.
 */

const SRC = resolve(__dirname, "../../..");
const ENGINE_IMPORT = /from "(?:\.\.\/_components\/|\.\/|@\/pages\/Reports\/_components\/)reportExport"/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

interface Kullanim {
  dosya: string;
  deger: string;
}

function envanter(): { dosyalar: string[]; kullanimlar: Kullanim[]; cozulemeyen: Kullanim[] } {
  const dosyalar = walk(SRC).filter((p) => ENGINE_IMPORT.test(readFileSync(p, "utf8")));
  const kullanimlar: Kullanim[] = [];
  const cozulemeyen: Kullanim[] = [];
  for (const p of dosyalar) {
    const src = readFileSync(p, "utf8");
    const dosya = relative(SRC, p);
    const sabitler = new Map([...src.matchAll(/const ([A-Z][A-Z0-9_]*) = "([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
    for (const m of src.matchAll(/numFmt: ("([^"]*)"|[A-Za-z_][A-Za-z0-9_.]*)/g)) {
      if (m[2] !== undefined) kullanimlar.push({ dosya, deger: m[2] });
      else if (sabitler.has(m[1]!)) kullanimlar.push({ dosya, deger: sabitler.get(m[1]!)! });
      else cozulemeyen.push({ dosya, deger: m[1]! });
    }
  }
  return { dosyalar, kullanimlar, cozulemeyen };
}

describe("rapor spec'lerinin sayı biçimi kapalı kümede", () => {
  const { dosyalar, kullanimlar, cozulemeyen } = envanter();

  it("körlük zemini: motoru kullanan dosyalar ve biçim kullanımları gerçekten okundu", () => {
    expect(dosyalar.length).toBeGreaterThanOrEqual(30);
    expect(kullanimlar.length).toBeGreaterThanOrEqual(200);
  });

  it("⭐ her biçim REPORT_NUM_FMTS kümesinde (bilinmeyen biçim PDF↔Excel eşitliği ölçülmeden çıkar)", () => {
    const bilinen = new Set<string>(REPORT_NUM_FMTS);
    const disarida = kullanimlar.filter((k) => !bilinen.has(k.deger)).map((k) => `${k.dosya}: "${k.deger}"`);
    expect(disarida).toEqual([]);
  });

  it("çözülemeyen biçim ifadesi yalnız motorun kendi geçişinde", () => {
    // `numFmt: c.numFmt` motorun spec'ten sayfaya aktarımıdır; başka bir yerde değişken
    // biçim görülürse değeri ölçülemez — kümeye bağlı bir sabitle yazılmalı.
    expect(cozulemeyen.map((k) => `${k.dosya}: ${k.deger}`)).toEqual([]);
  });

  it("kümenin her elemanı gerçekten kullanılıyor (ölü biçim kümeyi şişirmez)", () => {
    const kullanilan = new Set(kullanimlar.map((k) => k.deger));
    expect(REPORT_NUM_FMTS.filter((f) => !kullanilan.has(f))).toEqual([]);
  });
});
