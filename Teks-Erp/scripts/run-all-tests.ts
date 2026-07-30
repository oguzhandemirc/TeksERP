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

// Windows'ta `npx` = `npx.cmd`; spawnSync onu shell olmadan çözemez (ENOENT →
// her test 0.0s'de "çıkış kodu null" ile düşer). shell:true Windows'ta npx'i
// cmd.exe üzerinden çözer; Linux/CI'da (shell:false) doğrudan çalışır.
const IS_WIN = process.platform === "win32";

function main() {
  // Opsiyonel filtre: `npx tsx scripts/run-all-tests.ts <substring>` → yalnız
  // adı eşleşen test'leri koşar (tek test/alt-küme doğrulaması için).
  const filter = process.argv[2];
  const files = readdirSync(SCRIPTS_DIR)
    .filter((f) => /^test_.*\.ts$/.test(f))
    .filter((f) => !filter || f.includes(filter))
    .sort();

  if (files.length === 0) {
    console.error("Hiç test_*.ts bulunamadı.");
    process.exit(1);
  }

  console.log(`\n=== Backend test suite — ${files.length} dosya ===\n`);

  const results: { file: string; ok: boolean; summary: string; ms: number; flaky: boolean }[] = [];

  /** Tek test dosyasını koş; exit kodu + özet satırı + tam çıktıyı döndür. */
  function runOnce(file: string): { ok: boolean; status: number | null; summary: string; out: string } {
    const res = spawnSync("npx", ["tsx", join(SCRIPTS_DIR, file)], {
      encoding: "utf8",
      timeout: PER_TEST_TIMEOUT_MS,
      env: process.env,
      shell: IS_WIN, // Windows npx.cmd çözümü (bkz. IS_WIN notu)
    });
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
    return { ok, status: res.status, summary, out };
  }

  /** Başarısız çıktı ALTYAPI arızası mı (DB bağlantısı) yoksa gerçek assertion mı? */
  function looksInfrastructural(out: string): boolean {
    return /timeout exceeded when trying to connect|ECONNREFUSED|too many clients|Can't reach database server/i.test(
      out,
    );
  }

  for (const file of files) {
    const start = Date.now();
    let r = runOnce(file);
    let flaky = false;

    // TEK YENİDEN DENEME — yalnız altyapı arızasında. 199 test process'i sırayla
    // yerel Postgres'e havuz açıyor; makine yüklüyken (dev sunucu + Electron +
    // Expo) pool'un connectionTimeoutMillis=5s'i ara sıra aşılıyor ve konuyla
    // ilgisiz bir test düşüyor. Assertion hatası ASLA yeniden denenmez — gerçek
    // regresyonu maskelemesin.
    if (!r.ok && looksInfrastructural(r.out)) {
      console.log(`⏳ ${file.padEnd(42)} altyapı hatası (DB bağlantısı) — 1 kez yeniden deneniyor`);
      const retry = runOnce(file);
      if (retry.ok) flaky = true;
      r = retry;
    }

    const ms = Date.now() - start;
    results.push({ file, ok: r.ok, summary: r.summary, ms, flaky });
    const icon = r.ok ? (flaky ? "⚠️" : "✅") : "❌";
    const label = flaky ? `${r.summary} (2. denemede)` : r.summary;
    console.log(`${icon} ${file.padEnd(42)} ${label.padEnd(24)} ${(ms / 1000).toFixed(1)}s`);
    if (!r.ok && r.status !== 0) {
      // Başarısız testin son satırlarını göster (teşhis). 16 satır: hata mesajı
      // ("Error: <mesaj>" ilk satırda) + stack + {statusCode} objesi sığsın —
      // CI'da bu blok PR yorumuna gider, tek bakışta kök neden görülsün.
      const tail = r.out.trim().split("\n").slice(-16).join("\n");
      console.log(`   ↳ çıkış kodu ${r.status}\n${tail.replace(/^/gm, "   | ")}`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  const flakes = results.filter((r) => r.flaky);
  const totalMs = results.reduce((s, r) => s + r.ms, 0);
  console.log(`\n=== ÖZET: ${results.length - failed.length}/${results.length} dosya geçti · ${(totalMs / 1000).toFixed(0)}s ===`);
  if (failed.length > 0) {
    console.log("Başarısız:");
    for (const f of failed) console.log(`  ❌ ${f.file} — ${f.summary}`);
  }
  // Flake'ler exit kodunu düşürmez ama GİZLENMEZ — hangi test kaç kez koştu görünsün.
  if (flakes.length > 0) {
    console.log(`Altyapı flake'i (2. denemede geçti — DB bağlantı timeout'u): ${flakes.length}`);
    for (const f of flakes) console.log(`  ⚠️  ${f.file}`);
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

main();
