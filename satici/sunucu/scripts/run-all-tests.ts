// =============================================================================
// Satıcı bekçi koşucusu — scripts/test_*.ts dosyalarını SIRAYLA koşturur (aynı _test DB'sini
// paylaşırlar; paralel koşum fikstür çakıştırır). Ad parçası verilirse yalnız eşleşenler.
//   npx tsx scripts/run-all-tests.ts [ad-parçası]
// Hedef DB kapısı koşucuda da: DB adı `_test` ile bitmeli, `tekserp_fabrika_*` ASLA (fail-closed).
// Ağır koşum makine semaforundan geçer: node ../../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts
// =============================================================================
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { macIsiBul } from "./lib/ci-mac-isi";
import { hedefDbKapisi } from "./lib/test-ortam";
// Bekçi/koşucu gerçek Anahtar Zinciri'ne GİTMEZ: parola okuyan araçlar kasa yerine stdin/dosya kullanır (scripts/lib/parola-kasasi.mjs).
process.env.TEKSERP_PAROLA_KASASI = "kapali";

const DIZIN = __dirname;
const SURE_SINIRI_MS = 180_000;
// Uçtan uca tören bekçisi her tören koşumunda bütün süreçlerin argv/env'ini tarar (parola sızıntısı): tek başına ~15 dk (§9 ile, ölçüm 925 sn).
const OZEL_SURE_MS: Readonly<Record<string, number>> = { "test_uretim_toren.ts": 1_500_000 };

// Yalnız macOS'ta ölçülebilen bekçi: ayrı birim hdiutil RAM diskidir (/Volumes) ve tören aracının /Volumes kuralı
// darwin'e özgüdür. Linux CI bunu ci.yml'deki macOS işine bırakır — ama yalnız o iş beyanlıysa; değilse koşar (KIRMIZI).
const MAC_BEKCISI = "test_uretim_toren.ts";
const MAC_ISI_ORTAMI = "SATICI_TOREN_MAC_ISINDE";

const db = hedefDbKapisi();
const filtre = process.argv[2];
const kirmizi: string[] = [];
let macaBirakilan: string | null = null;
if (process.platform !== "darwin" && process.env[MAC_ISI_ORTAMI] === "1") {
  const ciYol = path.resolve(DIZIN, "..", "..", "..", ".github", "workflows", "ci.yml");
  const is = existsSync(ciYol) ? macIsiBul(readFileSync(ciYol, "utf8"), MAC_BEKCISI) : null;
  if (is) macaBirakilan = is;
  else {
    console.log(`❌ ${MAC_ISI_ORTAMI}=1 ama ci.yml'de ${MAC_BEKCISI}'i koşturan macOS işi yok — bekçi hiçbir yerde koşmazdı`);
    kirmizi.push(`${MAC_ISI_ORTAMI} beyanı`);
  }
}
const dosyalar = readdirSync(DIZIN)
  .filter((f) => /^test_[a-z0-9_]+\.ts$/.test(f))
  .filter((f) => !filtre || f.includes(filtre))
  .filter((f) => !(macaBirakilan && f === MAC_BEKCISI))
  .sort();
if (macaBirakilan) console.log(`⏭ ${MAC_BEKCISI} bu koşumda değil — ci.yml macOS işi "${macaBirakilan}" koşturur (RAM diski)`);
if (dosyalar.length === 0) {
  console.error(`⛔ Koşulacak bekçi yok${filtre ? ` ("${filtre}" eşleşmedi)` : ""}`);
  process.exit(2);
}
console.log(`Satıcı bekçileri — hedef DB ${db} — ${dosyalar.length} dosya\n`);
for (const d of dosyalar) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ["--import", "tsx", path.join(DIZIN, d)], {
    cwd: path.resolve(DIZIN, ".."),
    env: process.env,
    encoding: "utf8",
    timeout: OZEL_SURE_MS[d] ?? SURE_SINIRI_MS,
    maxBuffer: 32 * 1024 * 1024,
  });
  const sn = ((Date.now() - t0) / 1000).toFixed(1);
  const ok = r.status === 0 && !r.error;
  console.log(`${ok ? "✅" : "❌"} ${d} (${sn}s)`);
  if (!ok) {
    kirmizi.push(d);
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    const satirlar = out.split("\n").filter((l) => /❌|Error|HATA|hata/.test(l)).slice(0, 12);
    for (const s of satirlar) console.log(`     ↳ ${s.trim().slice(0, 300)}`);
    if (r.error) console.log(`     ↳ ${r.error.message}`);
  }
}
console.log(`\n=== ${dosyalar.length - kirmizi.length}/${dosyalar.length} yeşil${kirmizi.length ? ` — kırmızı: ${kirmizi.join(", ")}` : ""} ===`);
process.exit(kirmizi.length > 0 ? 1 : 0);
