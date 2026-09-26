// =============================================================================
// ELLE YAZILAN MIGRATION UYGULAYICI — dört adımlı sıra TEK KOMUTTA
// =============================================================================
// Çalıştırma: npx tsx scripts/apply-migration.ts <migration_adı> [--apply]
//   (varsayılan DRY-RUN: ne yapılacağını söyler, hiçbir şey yazmaz)
//
// NEDEN VAR (2026-08-13 vakası): `prisma db execute` hatalı argümanla ÇALIŞMADI
// (yardım metni basıp çıktı), ardından koşulan `migrate resolve --applied` yine
// de "uygulandı" yazdı — RUB enum'a hiç eklenmemişken defter "tamam" diyordu.
// `resolve`, adının aksine SQL'e HİÇ bakmaz; yalnız `_prisma_migrations`'a satır
// yazar. Bu canlıda olsaydı: deploy "başarılı", defter dolu, kolonu okuyan her
// yol P2022 — ve `migrate deploy` o dosyaya bir daha dönmez çünkü defter dolu.
//
// CLAUDE.md'nin sırası zaten yazılıydı (git add → db execute → resolve →
// DOĞRULA) ama dört ayrı elle adımdı ve tam ortasından kırıldı. Bu script sırayı
// MEKANİK yapar ve iki kilit özelliği vardır:
//   ① SQL'in GERÇEK çıkış kodu kontrol edilir — başarısızsa resolve HİÇ koşmaz.
//   ② resolve'dan sonra hüküm scriptin sözüne bırakılmaz: schema-drift +
//      migration-hijyen bekçileri koşar (nesne-düzeyi bağımsız doğrulama).
//
// ⚠️ Bu script YALNIZ elle yazılmış migration'lar içindir (partial index, enum,
// trigger…). `prisma migrate dev`'in kendisi ürettiği ve uyguladığı migration'a
// gerek yok. Canlı fabrika deploy'unda da kullanılabilir — dry-run önce.
// =============================================================================
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseEnv } from "dotenv";

const ROOT = join(__dirname, "..");

function run(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; input?: string } = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...opts.env },
    ...(opts.input === undefined ? {} : { input: opts.input }),
  });
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function fail(msg: string): never {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

/**
 * Hedef URL — ÖNCE `process.env.DATABASE_URL`, YEDEK olarak `.env` dosyası.
 *
 * ⚠️ BÖLÜNMÜŞ YAZMA (2026-09-12 vakası): burada yalnız `.env` DOSYASI okunuyordu,
 * `process.env`e hiç bakılmıyordu. `migrate resolve` adımı ise Prisma üzerinden
 * koştuğu için `process.env.DATABASE_URL`i onurlandırıyordu ⇒ SQL bir
 * veritabanına, defter işareti BAŞKA veritabanına gidiyordu. Vakada DDL
 * fabrikanın canlı yedeğine uygulandı, oysa hedef bir test DB'siydi.
 *
 * `psql` `?schema=public` parametresini tanımaz (arama dizgisi atılır); Prisma
 * tanır, o yüzden iki biçim de döner ve İKİSİ DE AYNI kaynaktan gelir.
 */
function resolveDbUrl(): { psqlUrl: string; prismaUrl: string; kaynak: string } {
  const ortam = process.env.DATABASE_URL?.trim();
  let ham: string;
  let kaynak: string;
  if (ortam) {
    ham = ortam;
    kaynak = "process.env.DATABASE_URL";
  } else {
    // Backend'in okuduğu ayrıştırıcıyla (dotenv): tek/çift tırnaklı ve tırnaksız değer aynı sonucu verir.
    const envUrl = parseEnv(readFileSync(join(ROOT, ".env"), "utf8")).DATABASE_URL?.trim();
    if (!envUrl) fail("DATABASE_URL ne ortamda ne de .env içinde bulundu.");
    ham = envUrl;
    kaynak = ".env dosyası (ortamda DATABASE_URL yok)";
  }
  const url = new URL(ham);
  url.search = "";
  return { psqlUrl: url.toString(), prismaUrl: ham, kaynak };
}

/**
 * `psql` ÇÖZÜCÜSÜ — host'ta yoksa Docker'daki Postgres'e düşer.
 *
 * Geliştirme makinesinde Postgres bir container'da koşuyor ve `psql` istemcisi
 * host'a kurulu OLMAYABİLİR; o zaman bu betik "DB'ye bağlanılamadı" ile durur ve
 * kullanıcı elle `docker exec` yazmak zorunda kalır (2026-09-11'de yaşandı,
 * migration defterde "uygulandı" görünürken kolonlar yoktu).
 *
 * ⚠️ Container'ın İÇİNDE host `localhost:<yayınlanan port>` yoktur — URL
 * `localhost:5432`ye yeniden yazılır ve SQL dosyası `-f` yerine STDIN'den
 * verilir (dosya container'da bulunmaz).
 */
function resolvePsql(dbUrl: string): { cmd: string; pre: string[]; url: string; useStdin: boolean } | null {
  if (run("which", ["psql"]).code === 0) {
    return { cmd: "psql", pre: [], url: dbUrl, useStdin: false };
  }
  const hostPort = new URL(dbUrl).port || "5432";
  const ps = run("docker", ["ps", "--format", "{{.Names}}\t{{.Ports}}"]);
  if (ps.code !== 0) return null;
  const line = ps.out.split("\n").find((l) => l.includes(`:${hostPort}->`));
  if (!line) return null;
  const container = line.split("\t")[0]?.trim();
  if (!container) return null;
  const inner = new URL(dbUrl);
  inner.hostname = "localhost";
  inner.port = "5432";
  return { cmd: "docker", pre: ["exec", "-i", container, "psql"], url: inner.toString(), useStdin: true };
}

function main(): void {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const name = args.find((a) => !a.startsWith("--"));
  if (!name) fail("Kullanım: npx tsx scripts/apply-migration.ts <migration_adı> [--apply]");

  const dir = join(ROOT, "prisma", "migrations", name);
  const sqlPath = join(dir, "migration.sql");
  console.log(`=== Migration uygulayıcı — ${name} ${apply ? "(UYGULA)" : "(dry-run)"} ===\n`);

  // ── 0) Dosya var mı ───────────────────────────────────────────────────────
  if (!existsSync(sqlPath)) fail(`Bulunamadı: prisma/migrations/${name}/migration.sql`);
  const sql = readFileSync(sqlPath, "utf8");
  console.log(`✓ SQL bulundu (${sql.split("\n").length} satır)`);

  // ── 1) GIT KAPISI — commit edilmemiş SQL uygulanmaz ──────────────────────
  // 2026-07-30 vakası: üç migration dev'e uygulandı ama git'e hiç girmedi;
  // `migrate deploy` yalnız dizindeki dosyaları uygular → production'da kolon
  // hiç oluşmadı. Sıranın İLK adımı bu yüzden git'tir ve atlanamaz.
  const tracked = run("git", ["ls-files", "--error-unmatch", `prisma/migrations/${name}/migration.sql`]);
  if (tracked.code !== 0) {
    fail(
      `Migration git'e eklenmemiş. Önce:\n   git add prisma/migrations/${name}\n` +
        `(Kural: git add → execute → resolve → doğrula. Sıra pazarlık dışı.)`,
    );
  }
  console.log("✓ git'te izleniyor");

  // ── 2) Defter durumu — zaten resolve edilmişse ikinci kez yazılmaz ───────
  const { psqlUrl: dbUrl, prismaUrl, kaynak: urlKaynagi } = resolveDbUrl();
  const hedefAd = decodeURIComponent(new URL(dbUrl).pathname.replace(/^\//, "")) || "(isimsiz)";
  // Geri alınamaz yazma yapan yol hedefini ADIYLA beyan eder — dry-run'da da.
  console.log(`🎯 Hedef veritabanı: ${hedefAd} @ ${new URL(dbUrl).host}  (kaynak: ${urlKaynagi})`);
  const psql = resolvePsql(dbUrl);
  if (!psql) {
    fail(
      "psql bulunamadı — ne host'ta kurulu ne de DB portunu yayınlayan bir Docker container var.\n" +
        "   Ya `psql` kur, ya DB container'ını çalıştır.",
    );
  }
  if (psql.cmd === "docker") console.log(`✓ psql host'ta yok → Docker container üzerinden koşulacak`);
  const ledger = run(psql.cmd, [
    ...psql.pre,
    psql.url,
    "-tAc",
    `SELECT count(*) FROM _prisma_migrations WHERE migration_name = '${name}'`,
  ]);
  if (ledger.code !== 0) fail(`DB'ye bağlanılamadı:\n${ledger.out}`);

  // ⚠️ BAĞLANILAN veritabanı, HEDEF sanılanla aynı mı? URL'yi okumak yetmez:
  // Docker dalı host/port'u yeniden yazar ve yanlış container'a düşmek mümkündür.
  // Bunu SQL'den soruyoruz — cevap URL'nin yolundaki adla birebir olmalı.
  const gercekDb = run(psql.cmd, [...psql.pre, psql.url, "-tAc", "SELECT current_database()"]);
  if (gercekDb.code !== 0) fail(`Hedef doğrulanamadı (current_database okunamadı):\n${gercekDb.out}`);
  if (gercekDb.out.trim() !== hedefAd) {
    fail(
      `HEDEF ÇELİŞKİSİ — URL '${hedefAd}' diyor ama bağlanılan veritabanı '${gercekDb.out.trim()}'.\n` +
        "   SQL bir veritabanına, defter işareti başkasına gidebilirdi; durduruldu.",
    );
  }
  console.log(`✓ bağlanılan veritabanı doğrulandı: ${gercekDb.out.trim()}`);

  const alreadyResolved = ledger.out.trim() === "1";
  console.log(alreadyResolved ? "⚠ defterde ZATEN kayıtlı (resolve atlanacak; SQL idempotentse sorun değil)" : "✓ defterde yok");

  if (!apply) {
    console.log(`\nDRY-RUN bitti — uygulamak için:\n   npx tsx scripts/apply-migration.ts ${name} --apply`);
    return;
  }

  // ── 3) SQL'İ KOŞ — gerçek çıkış koduyla ──────────────────────────────────
  // ON_ERROR_STOP olmadan psql hatalı ifadeyi atlayıp devam eder ve exit 0
  // döner — "yarım uygulanmış ama başarılı görünen" migration üretir.
  const exec = psql.useStdin
    ? run(psql.cmd, [...psql.pre, psql.url, "-v", "ON_ERROR_STOP=1"], {
        input: readFileSync(sqlPath, "utf8"),
      })
    : run(psql.cmd, [...psql.pre, psql.url, "-v", "ON_ERROR_STOP=1", "-f", sqlPath]);
  console.log(exec.out.trim().split("\n").slice(-5).join("\n"));
  if (exec.code !== 0) {
    fail(`SQL BAŞARISIZ (exit=${exec.code}) — resolve KOŞULMADI, defter temiz. Hatayı düzeltip tekrar dene.`);
  }
  console.log(`✓ SQL uygulandı (exit=0)`);

  // ── 4) RESOLVE ───────────────────────────────────────────────────────────
  if (!alreadyResolved) {
    // ⚠️ AYNI URL ZORUNLU: resolve Prisma üzerinden koşar ve kendi başına
    // `process.env.DATABASE_URL`i ya da `.env`i çözer. SQL'i uyguladığımız
    // hedefi AÇIKÇA geçiriyoruz — "SQL bir DB'ye, defter başka DB'ye" ancak
    // böyle imkânsız olur (2026-09-12 vakasının kök sebebi tam buydu).
    const res = run("npx", ["prisma", "migrate", "resolve", "--applied", name], {
      env: { DATABASE_URL: prismaUrl },
    });
    if (res.code !== 0) fail(`resolve başarısız:\n${res.out}`);
    console.log(`✓ defterde işaretlendi (resolve → ${hedefAd})`);
  }

  // ── 5) BAĞIMSIZ DOĞRULAMA — hüküm bu scriptin sözü değil, bekçilerin ─────
  // resolve SQL'in koştuğunu kanıtlamaz; kanıt, şemanın ve defterin bağımsız
  // ölçümüdür. Drift bekçisi "DB'de yok ama şemada var" farkını, hijyen
  // bekçisi defter tutarsızlığını yakalar.
  console.log("\n— doğrulama: schema-drift + migration-hijyen bekçileri —");
  let verifyFail = 0;
  for (const guard of ["test_schema_drift.ts", "test_migration_hygiene.ts"]) {
    const g = run("npx", ["tsx", `scripts/${guard}`], { env: { SKIP_TYPECHECK: "1" } });
    const last = g.out.trim().split("\n").filter((l) => l.includes("Sonuç")).pop() ?? "(çıktı yok)";
    console.log(`  ${g.code === 0 ? "✓" : "❌"} ${guard} — ${last.replace(/=+/g, "").trim()}`);
    if (g.code !== 0) verifyFail++;
  }
  if (verifyFail > 0) {
    fail(
      "Doğrulama KIRMIZI — SQL koştu ve defter işaretlendi ama şema/defter beklenen durumda değil.\n" +
        "Bekçi çıktısını incele; muhtemel sebepler: SQL şemadaki tanımla birebir değil, ya da\n" +
        "beklenen listeye (test_db_invariants) yazılmamış yeni bir şema-dışı nesne var.",
    );
  }
  console.log(`\n✅ ${name} uygulandı ve BAĞIMSIZ doğrulandı.`);
}

main();
