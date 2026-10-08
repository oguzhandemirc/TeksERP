// =============================================================================
// Satıcı bekçi koşucusu — scripts/test_*.ts dosyalarını SIRAYLA koşturur (aynı _test DB'sini
// paylaşırlar; paralel koşum fikstür çakıştırır). Ad parçası verilirse yalnız eşleşenler.
//   npx tsx scripts/run-all-tests.ts [ad-parçası]
// Hedef DB kapısı koşucuda da: DB adı `_test` ile bitmeli, `tekserp_fabrika_*` ASLA (fail-closed).
// Ağır koşum makine semaforundan geçer: node ../../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts
// =============================================================================
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { hedefDbKapisi } from "./lib/test-ortam";
// Bekçi/koşucu gerçek Anahtar Zinciri'ne GİTMEZ: parola okuyan araçlar kasa yerine stdin/dosya kullanır (scripts/lib/parola-kasasi.mjs).
process.env.TEKSERP_PAROLA_KASASI = "kapali";

const DIZIN = __dirname;
const SURE_SINIRI_MS = 180_000;
// Uçtan uca tören bekçisi her tören koşumunda bütün süreçlerin argv/env'ini tarar (parola sızıntısı): tek başına ~15 dk (§9 ile, ölçüm 925 sn).
const OZEL_SURE_MS: Readonly<Record<string, number>> = { "test_uretim_toren.ts": 1_500_000 };

const db = hedefDbKapisi();
const filtre = process.argv[2];
const dosyalar = readdirSync(DIZIN)
  .filter((f) => /^test_[a-z0-9_]+\.ts$/.test(f))
  .filter((f) => !filtre || f.includes(filtre))
  .sort();
if (dosyalar.length === 0) {
  console.error(`⛔ Koşulacak bekçi yok${filtre ? ` ("${filtre}" eşleşmedi)` : ""}`);
  process.exit(2);
}
console.log(`Satıcı bekçileri — hedef DB ${db} — ${dosyalar.length} dosya\n`);
const kirmizi: string[] = [];
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
