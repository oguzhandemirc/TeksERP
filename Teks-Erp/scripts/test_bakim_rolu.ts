// =============================================================================
// BEKÇİ — BAKIM ROLÜ: yedek / DB kopyası / takas SÜPER KULLANICI İSTEMEZ
// Çalıştır: npx tsx scripts/run-all-tests.ts bakim_rolu
//           TEST_BAKIM_ROLU=1 ile gerçek pg_dump/pg_restore katmanı da (PG_BIN_DIR sunucuyla aynı aile)
// =============================================================================
// §1 SAF: `evaluateAdminCapability` karar tablosu — süper kullanıcı her zaman açık;
//    süper olmayan kimlik ancak CREATEDB + canlı DB sahibi adına işlem (SET+USAGE) +
//    canlıdaki özel DB ayarlarına SET yetkisi + sahibine erişilemeyen nesne yokken açık;
//    her eksik kendi TALİMATINI verir (felaket günü keşfedilmesin).
// §2 KAYNAK: kod süper kullanıcı ÖNERMEZ · `deploy/bakim-rolu.ps1` rolü süper OLMADAN
//    kurar, parolayı SCRAM doğrulayıcısıyla STDIN'den verir, ölçüm geçmeden `.env`e
//    dokunmaz, sahip süperse durur · ilk-kurulum `-BakimRolu` isteğe bağlı · kur.ps1
//    yalnız söyler.
// §3 KÜME (hedef fixture değilse ❌ bağlanmadan durur; DATABASE_URL kimliği süper kullanıcıysa,
//    değilse ⏭ ölçülemedi): geçici
//    uygulama + bakım rolü ve `teks_bakimtest_*` DB'lerinde yoklama üç eksik ön koşulu
//    ayrı ayrı yakalar; tam ön koşulla bakım rolü CREATE DATABASE … OWNER · teks.audit_guard
//    yeniden kurulumu · pg_terminate_backend · RENAME · DROP … WITH (FORCE) yapar,
//    COPY … TO PROGRAM yapamaz.
// =============================================================================
import "dotenv/config";
import { readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { Client } from "pg";
import { psTara } from "./lib/ps-tarama";
import { fixtureHedefEngeli, hedefDbEngeli } from "./lib/hedef-db-kapisi";

const KOK = join(__dirname, "..", "..");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

// =============================================================================
// §1 — saf karar
// =============================================================================
async function testDecision(): Promise<void> {
  const { evaluateAdminCapability } = await import("../src/services/helpers/pg-admin-client");
  const ok = {
    user: "tekserp_bakim", isSuperuser: false, canCreateDb: true, liveDbOwner: "tekserp",
    ownerIsSuperuser: false, actsAsOwner: true, blockedParameters: [] as string[], foreignOwners: [] as string[] | null,
  };
  check("§1a süper olmayan tam ön koşullu bakım rolü → AÇIK", evaluateAdminCapability(ok).enabled);
  check("§1b süper kullanıcı her durumda AÇIK (eski kurulum: BACKUP_PG_USER=postgres)",
    evaluateAdminCapability({ ...ok, isSuperuser: true, canCreateDb: false, actsAsOwner: false, blockedParameters: ["teks.audit_guard"] }).enabled);
  const c = evaluateAdminCapability({ ...ok, canCreateDb: false });
  check("§1c CREATEDB yok → KAPALI + talimat süper kullanıcı ÖNERMEZ",
    !c.enabled && /CREATEDB/.test(c.reason ?? "") && !/BACKUP_PG_USER=postgres/.test(c.reason ?? ""), c.reason ?? "");
  const m = evaluateAdminCapability({ ...ok, actsAsOwner: false });
  check("§1d ⭐ sahip rolüne üyelik yok → KAPALI + `GRANT \"sahip\" TO \"bakım\"` talimatı",
    !m.enabled && (m.reason ?? "").includes('GRANT "tekserp" TO "tekserp_bakim";'), m.reason ?? "");
  const p = evaluateAdminCapability({ ...ok, blockedParameters: ["teks.audit_guard"] });
  check("§1e ⭐ teks.audit_guard kurulamıyor → KAPALI (kopya doğrulamadan geçemezdi) + GRANT SET ON PARAMETER",
    !p.enabled && (p.reason ?? "").includes('GRANT SET ON PARAMETER teks.audit_guard TO "tekserp_bakim";'), p.reason ?? "");
  const s = evaluateAdminCapability({ ...ok, ownerIsSuperuser: true });
  check("§1f canlı DB sahibi süper kullanıcı → KAPALI (süper role üyelik = süper yetkisi)", !s.enabled && /süper kullanıcı/.test(s.reason ?? ""));
  const f = evaluateAdminCapability({ ...ok, foreignOwners: ["postgres"] });
  check("§1g sahibine erişilemeyen nesne → KAPALI (yedek o nesnede düşerdi), sahip adıyla",
    !f.enabled && (f.reason ?? "").includes("postgres"));
  check("§1h nesne sahipliği ÖLÇÜLEMEDİ (null) → engellemez (üç sonuç)", evaluateAdminCapability({ ...ok, foreignOwners: null }).enabled);
  check("§1i sahip okunamadı → KAPALI (fail-closed)", !evaluateAdminCapability({ ...ok, liveDbOwner: null }).enabled);
}

// =============================================================================
// §2 — kaynak sözleşmeleri
// =============================================================================
function tsDosyalari(dizin: string): string[] {
  const out: string[] = [];
  for (const ad of readdirSync(dizin)) {
    const tam = join(dizin, ad);
    if (statSync(tam).isDirectory()) out.push(...tsDosyalari(tam));
    else if (ad.endsWith(".ts")) out.push(tam);
  }
  return out;
}

function testSource(): void {
  const src = join(KOK, "Teks-Erp", "src");
  const oneren = tsDosyalari(src).filter((f) => /BACKUP_PG_USER\s*=\s*postgres/.test(readFileSync(f, "utf8")));
  check("§2a ⭐ backend kodu süper kullanıcıyı (BACKUP_PG_USER=postgres) ÖNERMEZ", oneren.length === 0,
    oneren.map((f) => f.slice(KOK.length + 1)).join(", ") || "temiz");

  const t = psTara(readFileSync(join(KOK, "deploy/bakim-rolu.ps1"), "utf8"));
  const kod = t.satirlar.map((x) => x.kod);
  const ozellik = kod.find((k) => /^\s*\$ozellik\s*=/.test(k)) ?? "";
  check("§2b ⭐ bakim-rolu.ps1 rolü NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS + CREATEDB ile kurar",
    ["NOSUPERUSER", "NOCREATEROLE", "NOREPLICATION", "NOBYPASSRLS", "CREATEDB", "LOGIN"].every((w) => new RegExp(`\\b${w}\\b`).test(ozellik)) &&
      !/\bSUPERUSER\b/.test(ozellik.replace(/NOSUPERUSER/g, "")), ozellik.trim());
  const rolSql = kod.filter((k) => /ROLE \$\(Ident \$BakimKullanici\) WITH/.test(k));
  check("§2c CREATE/ALTER ROLE satırlarının hepsi `$ozellik`i taşır", rolSql.length >= 2 && rolSql.every((k) => k.includes("$ozellik")),
    `${rolSql.length} satır`);
  const parolaSql = kod.filter((k) => /\bPASSWORD\b/.test(k) && /ROLE/.test(k));
  check("§2d ⭐ parola sunucuya yalnız SCRAM doğrulayıcısı olarak gider (düz parola SQL metnine girmez)",
    parolaSql.length >= 1 && parolaSql.every((k) => k.includes("ScramDogrulayici")), `${parolaSql.length} satır`);
  const ciplak = t.satirlar.map((x) => x.ciplak);
  check("§2e SQL psql'e STDIN'den (`-f -`), `-c` ile argümandan DEĞİL",
    ciplak.some((k) => /\|\s*&\s*\$script:psql\b.*-f\s+-/.test(k)) && !ciplak.some((k) => /\$script:psql\b.*\s-c\s/.test(k)));
  const duyarsiz = t.satirlar.filter((x) => /\s-(i?match|i?replace|i?split|notmatch|inotmatch)\s/.test(x.ciplak)).map((x) => x.no);
  check("§2f ⭐ regex işleçleri büyük/küçük harf DUYARLI (-cmatch/-creplace/-csplit; tr-TR 'I' dersi)", duyarsiz.length === 0,
    duyarsiz.length ? `satır ${duyarsiz.join(", ")}` : "temiz");
  const idx = (re: RegExp) => kod.findIndex((k) => re.test(k));
  const olcumSuper = idx(/if \(\$super -cne "false"\)/);
  const sema = idx(/\$d = SemaDokumu \$BakimKullanici/);
  const envYaz = idx(/EnvGuncelle \$f \$BakimKullanici/);
  check("§2g ⭐ `.env` yalnız yeni kimlikle ölçüm (süper değil + şema dökümü) GEÇTİKTEN SONRA yazılır",
    olcumSuper >= 0 && sema > olcumSuper && envYaz > sema, `ölçüm ${olcumSuper + 1} · döküm ${sema + 1} · .env ${envYaz + 1}`);
  const sahip = idx(/if \(\$sahipSuper -ceq "true"\)/);
  check("§2h canlı DB sahibi süper kullanıcıysa DURUR (üyelik vermeden önce)",
    sahip >= 0 && kod.slice(sahip, sahip + 3).some((k) => /\bDur\b/.test(k)) && sahip < idx(/^\s*\$g = PsqlStdin .*GRANT/), `satır ${sahip + 1}`);
  check("§2i var olan rolün parolası bilerek (-ParolaYenile) olmadan DEĞİŞMEZ (aynı kümede ikinci kurulum)",
    kod.some((k) => /if \(\$rolVar -and -not \$ParolaYenile\)/.test(k)));

  const ilk = psTara(readFileSync(join(KOK, "deploy/ilk-kurulum.ps1"), "utf8")).satirlar.map((x) => x.kod);
  const adim = (re: RegExp) => ilk.findIndex((k) => /^\s*Adim\s+"/.test(k) && re.test(k));
  const bk = adim(/Bakim rolu/);
  check("§2j ilk-kurulum `-BakimRolu` İSTEĞE BAĞLI (verilmezse bugünkü davranış), adım .env'den SONRA izin daraltmadan ÖNCE",
    ilk.some((k) => /^\s*\[switch\]\$BakimRolu/.test(k)) && bk > adim(/app\\\.env/) && bk < adim(/Sir dosyalarinin izinleri/) &&
      ilk.some((k) => k.includes("if (-not $BakimRolu)")), `adım satır ${bk + 1}`);
  check("§2k ilk-kurulum yönetici parolasını bakim-rolu.ps1'e SecureString olarak süreç içinden verir (argv değil)",
    ilk.some((k) => /bakim-rolu\.ps1"\)\s.*-PostgresParolaGuvenli \$ssYonetici/.test(k)) &&
      !ilk.some((k) => /bakim-rolu\.ps1.*-PostgresParola\s+\$PostgresParola/.test(k)));
  const kur = psTara(readFileSync(join(KOK, "deploy/kur.ps1"), "utf8")).satirlar.map((x) => x.ciplak);
  check("§2l kur.ps1 bakim-rolu.ps1'i ÇAĞIRMAZ (yükseltme sır değiştirmez; yalnız söyler)", !kur.some((k) => /&.*bakim-rolu/.test(k)));
}

// =============================================================================
// §3 — gerçek küme
// =============================================================================
interface Env { url: string | undefined; user: string | undefined; pass: string | undefined }

async function testCluster(): Promise<void> {
  const { parseDatabaseUrl, toClientConfig, withDatabase, quoteIdent } = await import("../src/services/helpers/pg-conn.helper");
  const base = parseDatabaseUrl(process.env.DATABASE_URL);
  if (!base) { console.log("⏭️  §3 DATABASE_URL yok — küme katmanı ÖLÇÜLEMEDİ"); return; }
  // Küme katmanı bu kimlikle rol + DB kurar: hedef fixture değilse (fabrika kopyası) bağlanmadan DURUR.
  const engel = hedefDbEngeli() ?? fixtureHedefEngeli();
  if (engel) { check("§3 hedef kapısı: küme katmanı yalnız fixture hedefinde koşar", false, engel); return; }
  const su = new Client(toClientConfig(withDatabase(base, "postgres")));
  await su.connect();
  const yetki = (await su.query<{ s: boolean }>(`SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user`)).rows[0]?.s;
  if (!yetki) {
    await su.end();
    console.log("⏭️  §3 DATABASE_URL kimliği süper kullanıcı değil — rol kurulamaz, küme katmanı ÖLÇÜLEMEDİ");
    return;
  }
  const { probeCapabilities, withAdminClient } = await import("../src/services/helpers/pg-admin-client");
  const { buildCreateDatabaseSql } = await import("../src/services/db-copy.service");
  const { readLocaleProps, readDbGuc } = await import("../src/services/db-copy-verify.service");

  const damga = Date.now().toString(36);
  const app = `tb_app_${damga}`;
  const bk = `tb_bk_${damga}`;
  const live = `teks_bakimtest_${damga}`;
  const copy = `${live}_kopya`;
  const appPass = crypto.randomBytes(12).toString("hex");
  const bkPass = crypto.randomBytes(12).toString("hex");
  const onceki: Env = { url: process.env.DATABASE_URL, user: process.env.BACKUP_PG_USER, pass: process.env.BACKUP_PG_PASSWORD };
  const tutulan: Client[] = [];
  const appClient = async (db: string): Promise<Client> => {
    const c = new Client(toClientConfig({ ...withDatabase(base, db), user: app, password: appPass }));
    c.on("error", () => {});
    await c.connect();
    tutulan.push(c);
    return c;
  };
  const sweep = async (): Promise<void> => {
    const dbs = await su.query<{ datname: string }>(`SELECT datname FROM pg_database WHERE datname LIKE 'teks\\_bakimtest\\_%'`);
    for (const r of dbs.rows) await su.query(`DROP DATABASE IF EXISTS ${quoteIdent(r.datname)} WITH (FORCE)`).catch(() => {});
    const roles = await su.query<{ rolname: string }>(`SELECT rolname FROM pg_roles WHERE rolname ~ '^tb_(app|bk)_[0-9a-z]+$'`);
    for (const r of roles.rows) {
      await su.query(`REVOKE SET ON PARAMETER teks.audit_guard FROM ${quoteIdent(r.rolname)}`).catch(() => {});
      await su.query(`DROP ROLE IF EXISTS ${quoteIdent(r.rolname)}`).catch(() => {});
    }
  };

  try {
    await sweep();
    await su.query(`CREATE ROLE ${quoteIdent(app)} LOGIN NOSUPERUSER NOCREATEDB PASSWORD '${appPass}'`);
    await su.query(`CREATE ROLE ${quoteIdent(bk)} LOGIN CREATEDB NOSUPERUSER NOCREATEROLE PASSWORD '${bkPass}'`);
    await su.query(`CREATE DATABASE ${quoteIdent(live)} OWNER ${quoteIdent(app)} TEMPLATE template0`);
    await su.query(`ALTER DATABASE ${quoteIdent(live)} SET teks.audit_guard = 'on'`);
    await su.query(`ALTER DATABASE ${quoteIdent(live)} SET statement_timeout = '37s'`);
    const a = await appClient(live);
    await a.query(`CREATE TABLE t1 (id int PRIMARY KEY, ad text); INSERT INTO t1 VALUES (1, 'bir'), (2, 'iki')`);
    await a.end();

    process.env.DATABASE_URL = `postgresql://${app}:${appPass}@${base.host}:${base.port}/${live}`;
    process.env.BACKUP_PG_USER = bk;
    process.env.BACKUP_PG_PASSWORD = bkPass;
    const yokla = async () => {
      const c = await probeCapabilities();
      if ("error" in c) throw new Error(c.error);
      return c;
    };

    let c = await yokla();
    check("§3a ⭐ yalnız CREATEDB (üyelik yok) → KAPALI, talimat GRANT sahip",
      !c.enabled && !c.isSuperuser && !c.actsAsOwner && (c.reason ?? "").includes(`GRANT "${app}" TO "${bk}";`), c.reason ?? "");
    await su.query(`GRANT ${quoteIdent(app)} TO ${quoteIdent(bk)}`);
    c = await yokla();
    check("§3b ⭐ üyelik var, teks.audit_guard yetkisi yok → KAPALI (blockedParameters)",
      !c.enabled && c.actsAsOwner && c.blockedParameters.join() === "teks.audit_guard", JSON.stringify(c.blockedParameters));
    check("§3c statement_timeout (kullanıcı bağlamlı) engel SAYILMAZ", !c.blockedParameters.includes("statement_timeout"));
    await su.query(`GRANT SET ON PARAMETER teks.audit_guard TO ${quoteIdent(bk)}`);
    c = await yokla();
    check("§3d ⭐ tam ön koşul → AÇIK, süper kullanıcı OLMADAN", c.enabled && !c.isSuperuser && c.liveDbOwner === app &&
      Array.isArray(c.foreignOwners) && c.foreignOwners.length === 0, c.reason ?? "");

    const s = new Client(toClientConfig(withDatabase(base, live)));
    await s.connect();
    tutulan.push(s);
    await s.query(`CREATE TABLE super_t (id int)`);
    c = await yokla();
    check("§3e süper kullanıcıya ait tablo canlıda → KAPALI, sahibi adıyla", !c.enabled && (c.foreignOwners ?? []).includes(base.user),
      JSON.stringify(c.foreignOwners));
    await s.query(`DROP TABLE super_t`);

    // Zincir: bakım rolü (env override) ile, servisin yaptığı sırayla.
    const props = await withAdminClient(async (k) => {
      const v = await k.query<{ n: string }>(`SELECT current_setting('server_version_num') AS n`);
      return readLocaleProps(k, live, Number(v.rows[0]!.n));
    });
    await withAdminClient((k) => k.query(buildCreateDatabaseSql({ copyName: copy, props: props!, tablespace: null })), { statementTimeoutMs: 0 });
    const sahip = await withAdminClient(async (k) =>
      (await k.query<{ o: string }>(`SELECT pg_get_userbyid(datdba) AS o FROM pg_database WHERE datname = $1`, [copy])).rows[0]?.o);
    check("§3f ⭐ bakım rolü CREATE DATABASE … OWNER <uygulama rolü> yapabildi", sahip === app, sahip ?? "yok");
    const liveGuc = await withAdminClient((k) => readDbGuc(k, live));
    await withAdminClient(async (k) => {
      for (const kv of liveGuc) {
        const eq = kv.indexOf("=");
        await k.query(`ALTER DATABASE ${quoteIdent(copy)} SET ${kv.slice(0, eq)} = '${kv.slice(eq + 1).replace(/'/g, "''")}'`);
      }
    });
    const copyGuc = await withAdminClient((k) => readDbGuc(k, copy));
    check("§3g ⭐ canlının DB ayarları (teks.audit_guard dahil) kopyaya birebir kuruldu",
      [...liveGuc].sort().join() === [...copyGuc].sort().join() && copyGuc.includes("teks.audit_guard=on"), copyGuc.join(", "));

    await appClient(copy);
    const kesilen = await withAdminClient(async (k) =>
      (await k.query<{ n: string }>(`SELECT count(*) FILTER (WHERE pg_terminate_backend(pid))::text AS n FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [copy])).rows[0]?.n);
    check("§3h bakım rolü sahip oturumunu pg_terminate_backend ile kesebildi (takas `$force`)", kesilen === "1", kesilen ?? "");
    await withAdminClient((k) => k.query(`ALTER DATABASE ${quoteIdent(copy)} RENAME TO ${quoteIdent(`${copy}_rn`)}`));
    await withAdminClient((k) => k.query(`ALTER DATABASE ${quoteIdent(`${copy}_rn`)} RENAME TO ${quoteIdent(copy)}`));
    check("§3i bakım rolü ALTER DATABASE … RENAME yapabildi (takas)", true);
    await appClient(copy);
    await withAdminClient((k) => k.query(`DROP DATABASE ${quoteIdent(copy)} WITH (FORCE)`), { statementTimeoutMs: 0 });
    const kaldi = await withAdminClient(async (k) =>
      (await k.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [copy])).rowCount);
    check("§3j bakım rolü açık oturumlu kopyayı DROP … WITH (FORCE) ile silebildi", kaldi === 0);
    const program = await withAdminClient((k) => k.query(`COPY (SELECT 1) TO PROGRAM 'true'`)).then(() => "yapti", (e: { code?: string }) => e.code ?? "hata");
    check("§3k ⭐ bakım rolü COPY … TO PROGRAM YAPAMAZ (süper değil: 42501)", program === "42501", program);

    if (process.env.TEST_BAKIM_ROLU === "1") await testTools(live, copy, app, s);
    else console.log("⏭️  §3l pg_dump/pg_restore katmanı atlandı (TEST_BAKIM_ROLU=1 ile açılır)");
  } finally {
    for (const k of tutulan) await k.end().catch(() => {});
    process.env.DATABASE_URL = onceki.url;
    if (onceki.user === undefined) delete process.env.BACKUP_PG_USER; else process.env.BACKUP_PG_USER = onceki.user;
    if (onceki.pass === undefined) delete process.env.BACKUP_PG_PASSWORD; else process.env.BACKUP_PG_PASSWORD = onceki.pass;
    await sweep().catch(() => {});
    await su.end().catch(() => {});
  }
}

/** Gerçek araçlar: süper kullanıcının kurduğu eklentiyle bile bakım rolü döker ve sahipliği koruyarak geri yükler. */
async function testTools(live: string, copy: string, app: string, suLive: Client): Promise<void> {
  const { pgTool, runTool } = await import("../src/services/helpers/pg-tool.helper");
  const { liveConn, withAdminClient } = await import("../src/services/helpers/pg-admin-client");
  const { pgToolArgs, withDatabase, quoteIdent } = await import("../src/services/helpers/pg-conn.helper");
  const { buildCreateDatabaseSql } = await import("../src/services/db-copy.service");
  const { readLocaleProps } = await import("../src/services/db-copy-verify.service");
  const dump = join(os.tmpdir(), `${live}.dump`);
  try {
    await suLive.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    const conn = liveConn()!;
    const d = await runTool(pgTool("pg_dump"), [...pgToolArgs(conn), "-Fc", "-f", dump], conn.password);
    check("§3l ⭐ bakım rolü canlıyı pg_dump ile döktü (süper kullanıcının kurduğu eklenti dahil)", d.code === 0, d.stderr.slice(0, 160));
    const props = await withAdminClient(async (k) => {
      const v = await k.query<{ n: string }>(`SELECT current_setting('server_version_num') AS n`);
      return readLocaleProps(k, live, Number(v.rows[0]!.n));
    });
    await withAdminClient((k) => k.query(buildCreateDatabaseSql({ copyName: copy, props: props!, tablespace: null })), { statementTimeoutMs: 0 });
    const r = await runTool(pgTool("pg_restore"), [...pgToolArgs(withDatabase(conn, copy)), "--exit-on-error", dump], conn.password);
    check("§3m ⭐ bakım rolü sahipliği koruyarak (--no-owner YOK) --exit-on-error geri yükledi", r.code === 0, r.stderr.slice(0, 200));
    const satir = await withAdminClient(async (k) =>
      (await k.query<{ o: string; n: string; e: string }>(
        `SELECT pg_get_userbyid(c.relowner) AS o, (SELECT count(*)::text FROM t1) AS n,
                (SELECT count(*)::text FROM pg_extension WHERE extname = 'pg_trgm') AS e
         FROM pg_class c WHERE c.relname = 't1'`)).rows[0],
    { database: copy });
    check("§3n kopyada tablo sahibi uygulama rolü, veri tam, eklenti var", satir?.o === app && satir?.n === "2" && satir?.e === "1", JSON.stringify(satir));
    await withAdminClient((k) => k.query(`DROP DATABASE IF EXISTS ${quoteIdent(copy)} WITH (FORCE)`), { statementTimeoutMs: 0 });
  } finally {
    rmSync(dump, { force: true });
  }
}

async function main(): Promise<void> {
  console.log("=== Bakım rolü — süper kullanıcısız yedek / DB kopyası ===\n");
  await testDecision();
  testSource();
  await testCluster();
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
