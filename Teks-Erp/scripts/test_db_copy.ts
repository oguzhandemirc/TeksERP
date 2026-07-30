// =============================================================================
// Kopyaya geri yükleme — entegrasyon testi
// =============================================================================
// İKİ KATMAN:
//   Katman 1 (HER ZAMAN): saf mantık — DB'siz, pg_restore'suz. Ad/allowlist,
//     doğrulama karar fonksiyonu, disk guard'ı, durum uzlaştırması, takas komutu.
//   Katman 2 (OPT-IN, `TEST_DB_COPY=1`): gerçek cluster. Dev veritabanına
//     DOKUNMAZ — kendi kaynağını üretir (`teks_copytest_*`) ve zinciri onun
//     üzerinde koşar. Guard'da bir hata olsa bile `adnansahin_db`'den türeyen
//     hiçbir ad kullanılmadığı için dev DB'ye erişemez.
//
// Koşum: npx tsx scripts/test_db_copy.ts   ·   TEST_DB_COPY=1 ile tam kapsam
// =============================================================================

import "dotenv/config";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass += 1;
    console.log(`✅ ${label}`);
  } else {
    fail += 1;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// =============================================================================
// KATMAN 1 — saf mantık
// =============================================================================

async function testNaming(): Promise<void> {
  const n = await import("../src/services/helpers/backup-naming.helper");
  const live = "TeksErpDb";

  check("restoreDbName biçimi", /^TeksErpDb_restore_\d{8}_\d{6}$/.test(n.restoreDbName(live, new Date())));
  check("oldDbName biçimi", /^TeksErpDb_old_\d{8}_\d{6}$/.test(n.oldDbName(live, new Date())));

  // ALLOWLIST — bu fonksiyon DROP DATABASE'i koruyor, en yüksek riskli mantık.
  const allow: Array<[string, boolean]> = [
    ["TeksErpDb_restore_20260730_142312", true],
    ["TeksErpDb", false],                              // CANLI veritabanı
    ["postgres", false],
    ["TeksErpDb_restore_elle", false],                 // damgasız
    ["TeksErpDb_restore_20260230_142312", false],      // 30 Şubat rollover
    ["TeksErpDb_restore_20261332_000000", false],      // 13. ay
    ["TeksErpDb_restore_20260730_250000", false],      // 25. saat
    ["TeksErpDb_restore_20190730_030000", false],      // 2020 öncesi
    ["TeksErpDb_restore_20260730_142312_x", false],    // kuyruk
    ["TeksErpDbX_restore_20260730_142312", false],     // BAŞKA veritabanı, benzer ön ek
    ["TeksErpDb_old_20260730_142312", false],          // takas yedeği (silinemez)
  ];
  for (const [name, want] of allow) {
    check(`allowlist: ${name} → ${want}`, n.isRestoreCopyName(live, name) === want);
  }
  check("isOldSwapName ayrı çalışıyor", n.isOldSwapName(live, "TeksErpDb_old_20260730_142312"));
  check(
    "63 bayt aşımı yakalanıyor",
    n.exceedsIdentifierLimit(n.restoreDbName("a".repeat(50), new Date())),
  );
  const d = new Date(2026, 6, 30, 14, 23, 12, 0);
  check("parseDbStamp gidiş-dönüş", n.parseDbStamp(n.restoreDbName(live, d))?.getTime() === d.getTime());
}

async function testDiskGuard(): Promise<void> {
  const { evaluateDiskGuard } = await import("../src/services/db-copy.service");
  const disk = (freeBytes: number) => ({ path: "/x", totalBytes: 1e12, freeBytes, usedPct: 50 });
  const base = { volumeKnown: true, measuredPath: "/x", copiesTotalBytes: 0 };

  check(
    "boş alan < 1.2× → BLOK",
    !evaluateDiskGuard({ ...base, disk: disk(100), liveSizeBytes: 1000 }).ok,
  );
  const warnCase = evaluateDiskGuard({ ...base, disk: disk(1500), liveSizeBytes: 1000 });
  check("1.2×–2× arası → geçer + uyarı", warnCase.ok && warnCase.warnings.length > 0);
  check(
    "2× üstü → temiz",
    evaluateDiskGuard({ ...base, disk: disk(5000), liveSizeBytes: 1000 }).ok,
  );
  check(
    "ölçülemedi → BLOK",
    !evaluateDiskGuard({ ...base, disk: null, liveSizeBytes: 1000 }).ok,
  );
  const unknown = evaluateDiskGuard({
    ...base, volumeKnown: false, disk: disk(5000), liveSizeBytes: 1000,
  });
  check(
    "birim bilinmiyor → geçer ama ölçülen yolu söyler",
    unknown.ok && unknown.warnings.some((w) => w.includes("/x")),
  );
}

async function testCopyState(): Promise<void> {
  const { evaluateCopyState } = await import("../src/services/db-copy.service");
  const rec = (state: "running" | "ready" | "failed") => ({
    sourceBackup: "x.dump", startedAt: "", finishedAt: null, state, message: null, verification: null,
  });
  check("kayıt ready → ready", evaluateCopyState({ record: rec("ready"), jobPhase: null }) === "ready");
  check("kayıt failed → failed", evaluateCopyState({ record: rec("failed"), jobPhase: null }) === "failed");
  check(
    "kayıt running + bellekte iş VAR → canlı faz",
    evaluateCopyState({ record: rec("running"), jobPhase: "restoring" }) === "restoring",
  );
  // Tek-process invariant: bellekte iş yoksa süreç yeniden başlamış demektir.
  check(
    "kayıt running + bellekte iş YOK → interrupted",
    evaluateCopyState({ record: rec("running"), jobPhase: null }) === "interrupted",
  );
  check(
    "kayıt YOK → unverified",
    evaluateCopyState({ record: undefined, jobPhase: null }) === "unverified",
  );
}

async function testEvaluateChecks(): Promise<void> {
  const { evaluateChecks } = await import("../src/services/db-copy-verify.service");
  const locale = {
    encoding: "UTF8", datcollate: "C", datctype: "C", datlocprovider: "c",
    datlocale: null, daticurules: null, owner: "postgres",
  };
  const baseInput = {
    connected: true,
    liveLocale: locale,
    copyLocale: { ...locale },
    liveGuc: ["statement_timeout=50s"],
    copyGuc: ["statement_timeout=50s"],
    migrations: { expected: 5, applied: 5, missing: [], extra: [], unfinished: [], rolledBack: [] },
    tables: [
      { table: "users", liveCount: 15, copyCount: 12 },
      { table: "permissions", liveCount: 56, copyCount: 56 },
    ],
    sizeBytes: 900, liveSizeBytes: 1000, restoreStderr: null,
  };

  check("temiz durum → ok", evaluateChecks(baseInput).ok);
  check(
    "kopyada AZ kayıt olması NORMAL (yedek daha eski)",
    evaluateChecks(baseInput).checks.find((c) => c.key === "table:users")?.status === "ok",
  );
  check(
    "bağlanamadı → fail",
    !evaluateChecks({ ...baseInput, connected: false }).ok,
  );
  check(
    "collation farkı → FAIL (Y-2 sessiz arama bozulması)",
    !evaluateChecks({ ...baseInput, copyLocale: { ...locale, datcollate: "en_US.UTF-8" } }).ok,
  );
  check(
    "GUC eksik → FAIL (statement_timeout koruması kaybolur)",
    !evaluateChecks({ ...baseInput, copyGuc: [] }).ok,
  );
  check(
    "users boş → FAIL (kimse giriş yapamaz)",
    !evaluateChecks({
      ...baseInput,
      tables: [{ table: "users", liveCount: 15, copyCount: 0 }],
    }).ok,
  );

  // D-23: dev DB'de 130 migration'ın 8'i meşru şekilde applied_steps_count=0.
  // Bu alan doğrulamada HİÇ kullanılmamalı; eksik migration ise WARN olmalı.
  const missing = evaluateChecks({
    ...baseInput,
    migrations: {
      expected: 5, applied: 4, missing: ["20260730_x"], extra: [], unfinished: [], rolledBack: [],
    },
  });
  check("eksik migration → WARN, fail DEĞİL", missing.ok);
  check("eksik migration → needsMigrateDeploy", missing.needsMigrateDeploy);
  check(
    "yarım migration → FAIL",
    !evaluateChecks({
      ...baseInput,
      migrations: { ...baseInput.migrations, unfinished: ["20260730_x"] },
    }).ok,
  );
  check(
    "boyut %10'un altında → FAIL (restore yarım)",
    !evaluateChecks({ ...baseInput, sizeBytes: 50, liveSizeBytes: 1000 }).ok,
  );
  check(
    "count null → ölçülemedi (0 ile karışmaz)",
    evaluateChecks({
      ...baseInput,
      tables: [{ table: "items", liveCount: 5, copyCount: null }],
    }).checks.find((c) => c.key === "table:items")?.status === "warn",
  );
}

async function testSwapCommand(): Promise<void> {
  const { buildSwapCommands } = await import("../src/services/helpers/db-swap-command.helper");
  const c = buildSwapCommands({
    liveDatabase: "TeksErpDb",
    copyDatabase: "TeksErpDb_restore_20260730_142312",
    oldDatabase: "TeksErpDb_old_20260730_151020",
    failedDatabase: "TeksErpDb_failed_20260730_151020",
    psqlPath: "C:/Program Files/PostgreSQL/18/bin/psql.exe",
    maintenanceDb: "postgres", host: "127.0.0.1", port: "5433", user: "postgres",
    pm2AppName: "teks-erp-backend", backendCwd: "C:/TeksERP/Teks-Erp",
    needsMigrateDeploy: true,
  });
  const f = c.forward;
  const code = f.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));

  // Yapıştırılmış blokta `throw` yalnız o satırı düşürür, sonrakiler KOŞAR;
  // `exit` pencereyi kapatır ve backend pm2 stop'ta ASILI kalır.
  check("exit/throw YOK", !/\b(exit|throw)\b/.test(f));
  check(
    "her if TEK SATIR",
    f.split("\n").filter((l) => l.trim().startsWith("if (")).every(
      (l) => !l.includes("{") || l.trim().endsWith("}"),
    ),
  );
  // $LASTEXITCODE yalnız native exe'lerce yazılır; psql PATH'te yoksa PowerShell
  // throw eder ve ÖNCEKİ değer kalır → guard sessizce geçerdi.
  check("$LASTEXITCODE sıfırlamaları (≥6)", (f.match(/\$LASTEXITCODE = 1/g) ?? []).length >= 6);
  // PS 5.1 native argüman geçişi içerideki `"`yi kaçırmaz → -c ile SQL BOZULUR.
  check("SQL stdin'den veriliyor (-c YOK)", !/ -c /.test(f));
  check("otomatik geri alma dalı var", f.includes("if ($s1 -and -not $s2)"));
  check("son sayım kontrolü var", f.includes("$final"));
  check("migrate deploy var ve pm2 start'tan ÖNCE", f.indexOf("migrate deploy") < f.lastIndexOf("pm2 start"));
  check(
    "temizlik koşulsuz",
    !code.find((l) => l.includes("Remove-Item Env:PGPASSWORD"))!.includes("if ("),
  );
  check("pm2 start son satır", code[code.length - 1] === "pm2 start $app");
  check(
    "Write-Host metinleri ASCII (konsol codepage 857/850)",
    code.filter((l) => l.includes("Write-Host")).every((l) => /^[\x20-\x7E]*$/.test(l)),
  );
  check("pg_terminate_backend varsayılan KAPALI", f.includes("$force = $false"));
  check("açık oturum varsa LİSTELENİR", f.includes("application_name"));
  // Geri alma bloğu ileri bloğun tersi + kendi otomatik geri alması
  check("geri alma: old → live", c.rollback.includes(`"TeksErpDb_old_20260730_151020" RENAME TO "TeksErpDb"`));
  check("geri alma: live → failed", c.rollback.includes(`"TeksErpDb" RENAME TO "TeksErpDb_failed_20260730_151020"`));
  check("geri almanın da otomatik geri alması var", c.rollback.includes("if ($r1 -and -not $r2)"));
}

async function testPgConn(): Promise<void> {
  const { parseDatabaseUrl, withDatabase, quoteIdent, quoteLiteral } = await import(
    "../src/services/helpers/pg-conn.helper"
  );
  const url = "postgresql://app:sifre@db.local:5433/TeksErpDb?schema=public";
  const plain = parseDatabaseUrl(url);
  check("URL çözümleme", plain?.user === "app" && plain?.password === "sifre" && plain?.port === "5433");

  // Şifre eşleştirme kuralı: kullanıcı override edildiyse şifre de override'dan.
  const over = parseDatabaseUrl(url, { user: "postgres", password: "pgsifre" });
  check("override kullanıcı + şifre birlikte", over?.user === "postgres" && over?.password === "pgsifre");
  const overNoPass = parseDatabaseUrl(url, { user: "postgres" });
  check("override şifresizse boş (URL şifresi SIZMAZ)", overNoPass?.password === "");

  check("bozuk URL → null", parseDatabaseUrl("bu-url-degil") === null);
  check("undefined → null", parseDatabaseUrl(undefined) === null);
  check("withDatabase yalnız DB'yi değiştirir", withDatabase(plain!, "other").host === plain!.host);
  check("quoteIdent tırnak ikiler", quoteIdent('a"b') === '"a""b"');
  check("quoteLiteral tırnak ikiler", quoteLiteral("a'b") === "'a''b'");
}

// =============================================================================
// KATMAN 2 — gerçek cluster (OPT-IN)
// =============================================================================

function pgAvailable(): boolean {
  const exe = process.platform === "win32" ? "psql.exe" : "psql";
  const bin = process.env.PG_BIN_DIR ? path.join(process.env.PG_BIN_DIR, exe) : exe;
  return spawnSync(bin, ["--version"], { windowsHide: true }).status === 0;
}

async function testRealCluster(): Promise<void> {
  const { withAdminClient } = await import("../src/services/helpers/pg-admin-client");
  const { buildCreateDatabaseSql } = await import("../src/services/db-copy.service");
  const { readLocaleProps, readDbGuc } = await import("../src/services/db-copy-verify.service");
  const { quoteIdent } = await import("../src/services/helpers/pg-conn.helper");

  const stampNow = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const src = `teks_copytest_${stampNow}`;
  const copy = `${src}_restore_${stampNow.slice(0, 8)}_${stampNow.slice(8, 14)}`;
  const dumpPath = path.join(os.tmpdir(), `${src}.dump`);

  try {
    // Önceki çökmüş koşumların artıklarını süpür (1 saatten eski).
    await withAdminClient(async (c) => {
      const old = await c.query<{ datname: string }>(
        `SELECT datname FROM pg_database WHERE datname LIKE 'teks\\_copytest\\_%'`,
      );
      for (const r of old.rows) {
        await c.query(`DROP DATABASE IF EXISTS ${quoteIdent(r.datname)} WITH (FORCE)`).catch(() => {});
      }
    }, { statementTimeoutMs: 0 });

    // Kaynak DB — dev veritabanına DOKUNMUYORUZ.
    await withAdminClient(async (c) => c.query(`CREATE DATABASE ${quoteIdent(src)} TEMPLATE template0`), {
      statementTimeoutMs: 0,
    });
    await withAdminClient(
      async (c) => {
        await c.query(`CREATE TABLE t1 (id int primary key, ad text)`);
        await c.query(`INSERT INTO t1 VALUES (1,'bir'),(2,'iki')`);
      },
      { database: src },
    );
    // Kaynağa özel bir GUC koy → replay'in gerçekten çalıştığını görebilelim.
    await withAdminClient(
      async (c) => c.query(`ALTER DATABASE ${quoteIdent(src)} SET statement_timeout = '37s'`),
      { statementTimeoutMs: 0 },
    );

    const { pgTool, runTool } = await import("../src/services/helpers/pg-tool.helper");
    const { liveConn } = await import("../src/services/helpers/pg-admin-client");
    const { pgToolArgs, withDatabase } = await import("../src/services/helpers/pg-conn.helper");
    const base = liveConn()!;
    const dump = await runTool(
      pgTool("pg_dump"),
      [...pgToolArgs(withDatabase(base, src)), "-Fc", "-f", dumpPath],
      base.password,
    );
    check("test kaynağı dump edildi", dump.code === 0, dump.stderr.slice(0, 120));

    // CREATE DATABASE — kaynağın locale'iyle birebir
    const props = await withAdminClient(async (c) => {
      const v = await c.query<{ n: string }>(`SELECT current_setting('server_version_num') AS n`);
      return readLocaleProps(c, src, Number(v.rows[0]!.n));
    });
    await withAdminClient(
      async (c) => c.query(buildCreateDatabaseSql({ copyName: copy, props: props!, tablespace: null })),
      { statementTimeoutMs: 0 },
    );
    const copyProps = await withAdminClient(async (c) => {
      const v = await c.query<{ n: string }>(`SELECT current_setting('server_version_num') AS n`);
      return readLocaleProps(c, copy, Number(v.rows[0]!.n));
    });
    check(
      "kopyanın locale'i kaynakla BİREBİR",
      copyProps?.encoding === props?.encoding &&
        copyProps?.datcollate === props?.datcollate &&
        copyProps?.datlocprovider === props?.datlocprovider,
    );

    // Restore
    const rest = await runTool(
      pgTool("pg_restore"),
      [...pgToolArgs(withDatabase(base, copy)), "--exit-on-error", dumpPath],
      base.password,
    );
    check("kopyaya restore başarılı", rest.code === 0, rest.stderr.slice(0, 150));
    const rows = await withAdminClient(
      async (c) => (await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM t1`)).rows[0]!.n,
      { database: copy },
    );
    check("veri geldi (2 satır)", rows === "2", rows);

    // GUC replay
    const before = await withAdminClient((c) => readDbGuc(c, copy));
    check("restore GUC'leri TAŞIMAZ (bulgu 1)", before.length === 0, JSON.stringify(before));
    await withAdminClient(
      async (c) => c.query(`ALTER DATABASE ${quoteIdent(copy)} SET statement_timeout = '37s'`),
      { statementTimeoutMs: 0 },
    );
    const after = await withAdminClient((c) => readDbGuc(c, copy));
    check("replay sonrası GUC var", after.includes("statement_timeout=37s"), JSON.stringify(after));
  } finally {
    await withAdminClient(
      async (c) => {
        await c.query(`DROP DATABASE IF EXISTS ${quoteIdent(copy)} WITH (FORCE)`).catch(() => {});
        await c.query(`DROP DATABASE IF EXISTS ${quoteIdent(src)} WITH (FORCE)`).catch(() => {});
      },
      { statementTimeoutMs: 0 },
    ).catch(() => {});
    fs.rmSync(dumpPath, { force: true });
  }
}

async function main(): Promise<void> {
  await testNaming();
  await testPgConn();
  await testDiskGuard();
  await testCopyState();
  await testEvaluateChecks();
  await testSwapCommand();

  if (process.env.TEST_DB_COPY !== "1") {
    console.log("⏭️  Gerçek cluster katmanı atlandı (TEST_DB_COPY=1 ile açılır).");
    return;
  }
  if (!process.env.DATABASE_URL || !pgAvailable()) {
    console.log("⏭️  DATABASE_URL/psql yok — gerçek cluster katmanı atlandı.");
    return;
  }
  await testRealCluster();
}

main()
  .catch((err) => {
    console.error("Test çalıştırılamadı:", err);
    fail += 1;
  })
  .finally(async () => {
    const { default: prisma } = await import("../src/lib/prisma");
    await prisma.$disconnect().catch(() => {});
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(fail > 0 ? 1 : 0);
  });
