// =============================================================================
// DERLEME TAZELİĞİ KAPISI — sürücü `out/`u yükler; `out/` kaynaktan eskiyse tur ESKİ paneli ölçer.
// =============================================================================
// Üç sonuç: TAZE · BAYAT (kaynak derlemeden yeni) · ÖLÇÜLEMEDİ (derleme yok). Yalnız TAZE'de tur başlar.
// Ölçüt dosya zamanıdır: merge/checkout değişen kaynağın mtime'ını ileri alır, derleme almaz.
// Kaçış `GUZERGAH_BAYAT_DERLEME=1` (bilerek eski paneli ölçmek için) — çıktıya yine basılır.
// =============================================================================
import fs from "node:fs";
import path from "node:path";

const KAYNAK_KOKLERI = ["src", "electron.vite.config.ts", "electron.vite.config.mjs", "package.json", "index.html"];
const DERLEME = ["out/main/main.js", "out/renderer/index.html", "out/preload"];

function enYeni(yol) {
  let st;
  try { st = fs.statSync(yol); } catch { return null; }
  if (!st.isDirectory()) return { yol, ms: st.mtimeMs };
  let best = null;
  for (const ad of fs.readdirSync(yol)) {
    if (ad === "node_modules" || ad.startsWith(".")) continue;
    const alt = enYeni(path.join(yol, ad));
    if (alt && (!best || alt.ms > best.ms)) best = alt;
  }
  return best;
}

/** { durum: "TAZE"|"BAYAT"|"ÖLÇÜLEMEDİ", derleme, kaynak } — kök = Electron/. */
export function derlemeTazeligi(kok) {
  const derlemeler = DERLEME.map((d) => enYeni(path.join(kok, d)));
  if (derlemeler.some((d) => !d)) return { durum: "ÖLÇÜLEMEDİ", neden: `derleme eksik: ${DERLEME.filter((_, i) => !derlemeler[i]).join(", ")}` };
  // Derlemenin EN ESKİ çıktısı referanstır: yarım derleme de bayat sayılır.
  const derleme = derlemeler.reduce((a, b) => (b.ms < a.ms ? b : a));
  const kaynak = KAYNAK_KOKLERI.map((k) => enYeni(path.join(kok, k))).filter(Boolean).reduce((a, b) => (b.ms > a.ms ? b : a), { yol: "—", ms: 0 });
  const iso = (ms) => new Date(ms).toISOString();
  return {
    durum: kaynak.ms > derleme.ms ? "BAYAT" : "TAZE",
    derleme: { yol: path.relative(kok, derleme.yol), zaman: iso(derleme.ms) },
    kaynak: { yol: path.relative(kok, kaynak.yol), zaman: iso(kaynak.ms) },
  };
}

/** Tur başında çağrılır: TAZE değilse çıkar (kaçış açıksa uyarıp devam eder). */
export function derlemeKapisi(kok) {
  const t = derlemeTazeligi(kok);
  if (t.durum === "TAZE") { console.log(`derleme taze: out ${t.derleme.zaman} ≥ kaynak ${t.kaynak.zaman}`); return t; }
  const msj = t.durum === "BAYAT"
    ? `ÖLÇÜLEMEDİ — panel derlemesi bayat: ${t.kaynak.yol} (${t.kaynak.zaman}) > ${t.derleme.yol} (${t.derleme.zaman}). Önce: cd Electron && npx electron-vite build`
    : `ÖLÇÜLEMEDİ — ${t.neden}. Önce: cd Electron && npx electron-vite build`;
  if (process.env.GUZERGAH_BAYAT_DERLEME === "1") { console.warn(`⚠ ${msj} (GUZERGAH_BAYAT_DERLEME=1 — yine de koşuluyor)`); return t; }
  console.error(msj);
  process.exit(2);
}
