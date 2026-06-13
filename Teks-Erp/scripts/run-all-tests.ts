// =============================================================================
// Backend test koşucusu — TÜM scripts/test_*.ts'i SIRAYLA çalıştırır, sonuçları
// toplar, özet basar, herhangi biri başarısızsa exit 1.
// Çalıştır: npx tsx scripts/run-all-tests.ts   (veya npm test)
//
// NEDEN sıralı: testler aynı dev DB'sini paylaşır; her biri kendi business-key
// fixture'ını yaratıp finally'de temizler. Paralel koşum fixture çakışması
// yaratabilir → sıralı koşum güvenli. (jest/vitest YOK — CLAUDE.md kuralı.)
// =============================================================================
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const SCRIPTS_DIR = join(__dirname);
const PER_TEST_TIMEOUT_MS = 180_000;

function main() {
  const files = readdirSync(SCRIPTS_DIR)
    .filter((f) => /^test_.*\.ts$/.test(f))
    .sort();

  if (files.length === 0) {
    console.error("Hiç test_*.ts bulunamadı.");
    process.exit(1);
  }

  console.log(`\n=== Backend test suite — ${files.length} dosya ===\n`);

  const results: { file: string; ok: boolean; summary: string; ms: number }[] = [];

  for (const file of files) {
    const start = Date.now();
    const res = spawnSync("npx", ["tsx", join(SCRIPTS_DIR, file)], {
      encoding: "utf8",
      timeout: PER_TEST_TIMEOUT_MS,
      env: process.env,
    });
    const ms = Date.now() - start;
    const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
    // DOĞRULUK KAYNAĞI = exit kodu (her test process.exit(fail>0?1:0)). Özet
    // satırı yalnız görüntü; testler farklı format kullanıyor:
    //   "Sonuç: N geçti, M başarısız" · "SONUÇ: N geçti, M kaldı" · "N/T geçti"
    const m =
      out.match(/(?:Sonuç|SONUÇ):\s*(\d+)\s*geçti,\s*(\d+)\s*(?:başarısız|kaldı)/i) ||
      out.match(/(\d+)\s*geçti,\s*(\d+)\s*(?:başarısız|kaldı)/i);
    const slash = out.match(/(\d+)\/(\d+)\s*geçti/);
    const ok = res.status === 0;
    const summary = m
      ? `${m[1]} geçti, ${m[2]} başarısız`
      : slash
        ? `${slash[1]}/${slash[2]} geçti`
        : ok
          ? "geçti (exit 0)"
          : "BAŞARISIZ";
    results.push({ file, ok, summary, ms });
    const icon = ok ? "✅" : "❌";
    console.log(`${icon} ${file.padEnd(42)} ${summary.padEnd(24)} ${(ms / 1000).toFixed(1)}s`);
    if (!ok && res.status !== 0) {
      // Başarısız testin son satırlarını göster (teşhis).
      const tail = out.trim().split("\n").slice(-6).join("\n");
      console.log(`   ↳ çıkış kodu ${res.status}\n${tail.replace(/^/gm, "   | ")}`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  const totalMs = results.reduce((s, r) => s + r.ms, 0);
  console.log(`\n=== ÖZET: ${results.length - failed.length}/${results.length} dosya geçti · ${(totalMs / 1000).toFixed(0)}s ===`);
  if (failed.length > 0) {
    console.log("Başarısız:");
    for (const f of failed) console.log(`  ❌ ${f.file} — ${f.summary}`);
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

main();
