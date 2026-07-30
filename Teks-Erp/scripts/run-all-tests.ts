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
// spawnSync varsayılanı 1 MiB; aşılınca Node çocuğu öldürüp ENOBUFS döner ve
// çıktı ORTADAN kesilir → teşhis imkânsızlaşır. Ölçüm: en konuşkan test 5 KB,
// yani mutlu yolda ulaşılmıyor. Ama hata yolunda ulaşılabilir:
// PrismaClientValidationError tüm sorguyu basar (onlarca KB), döngü içinde stack
// basan testler var, ve `env: process.env` aynen geçtiği için ortamda DEBUG açan
// biri anında 1 MiB'ı aşar. Ucuz sigorta.
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

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

  /**
   * Süreç anormal mi bitti ve neden? Tek ayırt edici `res.error.code` — ÖLÇÜLDÜ
   * (2026-07-30, macOS + Windows'ta aynı kodlar):
   *
   *   durum                 status  signal  error.code
   *   timeout (SIGTERM)      143     null    ETIMEDOUT
   *   maxBuffer taşması        0     null    ENOBUFS      ← DİKKAT: status 0!
   *   npx bulunamadı         null    null    ENOENT
   *   gerçek exit(1)           1     null    undefined
   *
   * ⚠️ `status === null` KONTROLÜ YETMEZ — araya `npx` (bir Node wrapper'ı) girdiği
   * için sinyal ölümü 128+N çıkış koduna çevriliyor ve `signal` her zaman null
   * geliyor. Bu yüzden gate YALNIZ `error.code`.
   *
   * ⚠️ Daha kötüsü: maxBuffer taşmasında `status: 0` → eski kodda `ok = (status===0)`
   * TRUE olurdu, yani çıktısı ORTADAN kesilmiş bir test "GEÇTİ" diye raporlanırdı
   * (sessiz yanlış-BAŞARI). Bu yüzden aşağıda `ok` da `!res.error` istiyor.
   *
   * `signal` Windows'ta gerçek POSIX sinyali değildir (libuv TerminateProcess
   * yaparken kullandığı killSignal adını raporlar) → varsa "biz nasıl öldürdük"
   * olarak sunulur, "OS ne gönderdi" olarak DEĞİL.
   */
  function abnormalReason(res: ReturnType<typeof spawnSync>): string | null {
    const code = (res.error as { code?: string } | undefined)?.code;
    if (!code) return null; // normal çıkış (kod 0 ya da != 0)
    const sig = res.signal ? ` (${res.signal} ile öldürüldü)` : "";
    if (code === "ETIMEDOUT")
      return (
        `ZAMAN AŞIMI ${PER_TEST_TIMEOUT_MS / 1000}s${sig}` +
        // Windows'ta shell:true cmd.exe'yi araya koyduğu için öldürülen şey
        // cmd.exe'dir; node torunu YETİM kalıp PG bağlantısı tutmaya devam
        // edebilir ve sonraki testleri "too many clients" ile zehirler.
        (IS_WIN ? " — DİKKAT: node torunu yetim kalmış olabilir (PG bağlantısı tutuyor)" : "")
      );
    if (code === "ENOBUFS") {
      const mib = MAX_OUTPUT_BYTES / 1024 / 1024;
      const limit = mib >= 1 ? `${mib} MiB` : `${MAX_OUTPUT_BYTES / 1024} KiB`;
      return `ÇIKTI TAŞMASI (${limit} maxBuffer aşıldı; çıktı KESİK)${sig}`;
    }
    if (code === "ENOENT") return `KOMUT BULUNAMADI (npx)${sig}`;
    return `ANORMAL BİTİŞ — ${code}${sig}`;
  }

  /** Tek test dosyasını koş; exit kodu + özet satırı + tam çıktıyı döndür. */
  function runOnce(file: string): {
    ok: boolean;
    status: number | null;
    summary: string;
    out: string;
    killed: string | null;
  } {
    const res = spawnSync("npx", ["tsx", join(SCRIPTS_DIR, file)], {
      encoding: "utf8",
      timeout: PER_TEST_TIMEOUT_MS,
      env: process.env,
      shell: IS_WIN, // Windows npx.cmd çözümü (bkz. IS_WIN notu)
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
    const killed = abnormalReason(res);
    // DOĞRULUK KAYNAĞI = exit kodu (her test process.exit(fail>0?1:0)) **VE**
    // `error`'ın yokluğu. `!res.error` şartı load-bearing: maxBuffer taşmasında
    // status 0 döner (ölçüldü) → o şart olmadan çıktısı kesilmiş test GEÇTİ sayılır.
    const ok = res.status === 0 && !res.error;
    // Testler farklı özet formatı kullanıyor:
    //   "Sonuç: N geçti, M başarısız" · "SONUÇ: N geçti, M kaldı" · "N/T geçti"
    const m =
      out.match(/(?:Sonuç|SONUÇ):\s*(\d+)\s*geçti,\s*(\d+)\s*(?:başarısız|kaldı)/i) ||
      out.match(/(\d+)\s*geçti,\s*(\d+)\s*(?:başarısız|kaldı)/i);
    const slash = out.match(/(\d+)\/(\d+)\s*geçti/);
    // ANORMAL BİTİŞTE KAZINAN ÖZET YALAN SÖYLER — kullanma.
    // 188/214 test `Sonuç:` satırını `await prisma.$disconnect()`'ten ÖNCE basar.
    // `$disconnect()` asılırsa (havuz drenajı / iptal edilmiş statement) süreç
    // 180sn'de SIGTERM alır ve stdout SAĞLAM kalır → regex "7 geçti, 0 başarısız"
    // bulur ve özet bloğu `❌ dosya — 7 geçti, 0 başarısız` basardı: kendi özeti
    // "hiçbir şey düşmedi" diyen bir HATA satırı. Anormal-bitiş sebebi kazınanı EZER.
    const summary = killed
      ? killed
      : m
        ? `${m[1]} geçti, ${m[2]} başarısız`
        : slash
          ? `${slash[1]}/${slash[2]} geçti`
          : ok
            ? "geçti (exit 0)"
            : "BAŞARISIZ";
    return { ok, status: res.status, summary, out, killed };
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
    let retried = false;
    let firstSummary = "";
    if (!r.ok && looksInfrastructural(r.out)) {
      console.log(`⏳ ${file.padEnd(42)} altyapı hatası (DB bağlantısı) — 1 kez yeniden deneniyor`);
      firstSummary = r.summary; // 1. denemenin teşhisi KAYBOLMASIN
      retried = true;
      const retry = runOnce(file);
      if (retry.ok) flaky = true;
      r = retry;
    }

    const ms = Date.now() - start;
    // NOT: retry olduysa `ms` İKİ denemenin toplamıdır (bu yüzden aşağıda "2 deneme"
    // etiketi basılıyor — 360sn'lik bir satır sessizce şaşırtmasın).
    const retryNote = retried ? (flaky ? " (2. denemede)" : ` (2 deneme de düştü; 1.: ${firstSummary})`) : "";
    results.push({ file, ok: r.ok, summary: r.summary + retryNote, ms, flaky });
    const icon = r.ok ? (flaky ? "⚠️" : "✅") : "❌";
    console.log(`${icon} ${file.padEnd(42)} ${(r.summary + retryNote).padEnd(24)} ${(ms / 1000).toFixed(1)}s`);
    if (!r.ok) {
      // Başarısız testin son satırlarını göster (teşhis). 16 satır: hata mesajı
      // ("Error: <mesaj>" ilk satırda) + stack + {statusCode} objesi sığsın —
      // CI'da bu blok PR yorumuna gider, tek bakışta kök neden görülsün.
      // (Eski `&& r.status !== 0` koşulu ÖLÜ kodu: `ok === (status === 0)` olduğu
      // için zaten örtük. Öldürülen testte de tail İSTİYORUZ — timeout kill'inde
      // stdout sağlam kalır, yani asılmadan hemen önceki satırlar teşhisin ta kendisi.)
      const tail = r.out.trim().split("\n").slice(-16).join("\n");
      const head = r.killed ? `   ↳ ${r.killed}` : `   ↳ çıkış kodu ${r.status}`;
      console.log(`${head}\n${tail.replace(/^/gm, "   | ")}`);
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
