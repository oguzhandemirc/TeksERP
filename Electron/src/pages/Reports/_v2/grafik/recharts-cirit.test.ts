// =============================================================================
// CIRCIR — Recharts emekliye ayrılıyor (R0-GRAFIK, KUTUPHANELER §9 echarts kaydı):
// `Electron/src/**` altında recharts import eden dosya sayısı TABANI AŞAMAZ.
//   ARTIŞ (gerçek > taban): her kipte SERT — yeni grafik `_v2/grafik` sarmalıyla çizilir.
//   DÜŞÜŞ (gerçek < taban): CI/elle koşumda SERT ("tabanı düşür"), commit kapısında
//   ⚠️ uyarı — borcu kapatan oturum kilitlenmesin (RECETELER § Yeni bekçi md. 22–23).
// Sondalar (2026-10-24): yeni dosyaya recharts import'u → ARTIŞ 1 ❌;
// SimplePieChart'tan import kaldırıldı → "tabanı düşür" 1 ❌; ikisi de md5 ile geri alındı.
// =============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Taban: 2026-10-24 ölçümü (Sparkline, SimpleBar/Line/PieChart). Yalnız DÜŞÜRÜLÜR. */
const RECHARTS_TABANI = 4;

const SRC = resolve(__dirname, "../../../..");
const PAKET = "rech" + "arts"; // bu dosya kendi desenini saymasın
const IMPORT = new RegExp(`(?:from\\s+|import\\s*\\(\\s*|require\\s*\\(\\s*)["']${PAKET}(?:/[^"']*)?["']`);

function dosyalar(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) dosyalar(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) out.push(p);
  }
  return out;
}

const kullananlar = dosyalar(SRC)
  .filter((p) => IMPORT.test(readFileSync(p, "utf8")))
  .map((p) => relative(SRC, p))
  .sort();

describe("recharts cırcırı", () => {
  it("körlük zemini: tarama kaynak ağacını gerçekten okudu", () => {
    expect(dosyalar(SRC).length).toBeGreaterThan(500);
  });

  it("⭐ ARTIŞ yok — yeni grafik ECharts sarmalıyla (`_v2/grafik/RaporGrafik`) çizilir", () => {
    expect(kullananlar.length, `recharts import eden dosyalar: ${kullananlar.join(", ")}`).toBeLessThanOrEqual(RECHARTS_TABANI);
  });

  it("⭐ DÜŞÜŞ tabanı düşürmeyi ister", () => {
    if (kullananlar.length >= RECHARTS_TABANI) return;
    const mesaj = `recharts kullanan dosya ${kullananlar.length}'e indi — RECHARTS_TABANI'nı ${kullananlar.length} yap (tabanı düşür).`;
    if (process.env.TEKSERP_KAPI_ADIMI === "commit") {
      console.warn(`⚠️ ${mesaj}`);
      return;
    }
    expect.fail(mesaj);
  });
});
