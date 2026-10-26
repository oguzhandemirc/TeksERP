// =============================================================================
// BEKÇİ — G4 DB rol ayrımı: uygulama rolü tablo sahibi değil, audit'te yalnız SELECT+INSERT (2026-10-13)
// Çalıştır: npx tsx scripts/run-all-tests.ts db_rol_gocu
// =============================================================================
// KORUNAN: Docker açılışı (entrypoint §2b) `dist/tools/db-rol-gocu.cjs` ile `<sahip>_uygulama`
// rolünü kurar/onarır ve sunucuyu o rolle açar; yapılamazsa sahip rolüyle (bugünkü davranış) açılır.
// §1 statik sözleşme (entrypoint sırası + geri düşüş · araç pakette · /health ile tek yüklem · KURU
// varsayılan) · §2 KURU hiçbir şey değiştirmez · §3 ⭐ uygula: rol özellikleri, audit'te UPDATE/
// DELETE/TRUNCATE 42501, iş tablosu DML + definer arşivleyici çalışır, sır günlüğe girmez ·
// §4 idempotent · §5 ⭐ bozulmuş durum (yetki/ownership/üyelik geri geldi) ölçümde kırmızı, yeniden
// koşum onarır · §6 uygulanamaz → 2 + değişiklik yok · §7 /health yüklemi (readAuditProtection)
// uygulama rolünde writeOnly, sahip rolünde değil. §8 ⭐ WINDOWS KİPİ (`--sahip`; aktivasyon 2.15.8):
// süper olmayan sahip rolle migrate deploy edilmiş geçici DB'de süper bağlantı + açık sahip —
// REASSIGN/DEFAULT PRIVILEGES/advisory GRANT sahibe gider, sahip uyuşmazlığı · süper olmayan bağlantı ·
// yanlış sahip parolası → 2, CLI URL/parolayı yalnız ortamdan/kimlik dosyasından alır.
// Rol küme geneli: ad koşuma özgü (`_test` sonekli), finally'de DROP OWNED + DROP ROLE.
// =============================================================================
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { cocukOrtami, fixtureHedefEngeli, hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AUDIT_TAMPER_SQL } from "../src/lib/audit-koruma-sql";
import {
  EXIT_OK, EXIT_NOT_APPLICABLE, deriveAppPassword, measureRoleState, runRoleMigration, scramVerifier,
} from "../src/lib/db-rol-gocu";
import { OWNER_PASSWORD_ENV, SUPER_URL_ENV } from "../src/lib/db-rol-gocu-windows";
import { ADVISORY_FUNCTION_SQL } from "../src/lib/okuma-rolu";
import { parseDatabaseUrl, quoteIdent, toClientConfig, withDatabase } from "../src/services/helpers/pg-conn.helper";
import { runProcess } from "../src/services/helpers/pg-tool.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const ROOT = join(__dirname, "..");
const oku = (p: string) => readFileSync(join(ROOT, p), "utf8");
const pgUrl = (u: string) => { const x = new URL(u); x.searchParams.delete("schema"); return x.toString(); };

function statik(): void {
  const ep = oku("docker/entrypoint.sh");
  const iArac = ep.indexOf("node dist/tools/db-rol-gocu.cjs --uygula --url-yaz");
  const iSeed = ep.indexOf("node dist/tools/seed.cjs");
  const iExec = ep.indexOf("exec tini -s -- node dist/server.js");
  check("§1a ⭐ entrypoint rol göçünü seed'den SONRA, sunucudan ÖNCE koşar", iArac > iSeed && iSeed > 0 && iExec > iArac);
  const blok = ep.slice(iArac, iExec);
  check("§1b geri düşüş fabrikayı durdurmaz (blokta exit yok) ve URL yalnız doğrulanınca alınır",
    !/\bexit\b/.test(blok) && /if UYG_URL=\$\(node dist\/tools\/db-rol-gocu\.cjs --uygula --url-yaz\) && \[ -n "\$UYG_URL" \]/.test(ep)
    && /auditProtection: kismi/.test(blok));
  check("§1c araç iki pakette: build-araclar (korumalı/Windows) + korumasız Dockerfile",
    oku("scripts/build-araclar.mjs").includes('{ giris: "src/lib/db-rol-gocu.ts", cikti: "dist/tools/db-rol-gocu.cjs" }')
    && /esbuild src\/lib\/db-rol-gocu\.ts[\s\S]{0,120}--outfile=dist\/tools\/db-rol-gocu\.cjs/.test(oku("Dockerfile")));
  const arac = oku("src/lib/db-rol-gocu.ts");
  check("§1d /health ve araç AYNI yüklemi koşar (AUDIT_TAMPER_SQL tek kaynak)",
    /\$queryRawUnsafe<.+>\(AUDIT_TAMPER_SQL\)/.test(oku("src/services/audit-chain.service.ts"))
    && /c\.query\(AUDIT_TAMPER_SQL\)/.test(arac));
  check("§1e araç KURU varsayılan (--uygula olmadan yazmaz)", /const uygula = argv\.includes\("--uygula"\)/.test(arac)
    && /if \(!s\.uygula\) \{[\s\S]{0,120}return/.test(arac));
  // Windows kipi: süper URL ve sahip parolası argv'den ALINMAZ (süreç listesinde görünür).
  const argvBayraklari = [...`${arac}\n${oku("src/lib/db-rol-gocu-windows.ts")}`.matchAll(/argv\.(?:indexOf|includes)\("(--[a-z-]+)"\)/g)].map((m) => m[1]);
  check("§1f Windows kipi: argv'de URL/parola bayrağı yok, süper URL yalnız ortamdan",
    argvBayraklari.length > 0 && argvBayraklari.every((b) => !/^--(url|super|super-url|parola|pass|password|sahip-parola|baglanti)$/.test(b))
    && /const superUrl = env\[SUPER_URL_ENV\]/.test(oku("src/lib/db-rol-gocu-windows.ts")), argvBayraklari.join(" "));
  // Bugün hiçbir kurulum betiği Windows kipini çağırmaz (aktivasyon 2.15.8).
  const betikler = ["../deploy/kur.ps1", "../deploy/kurulum/kurulum.ps1", "../deploy/ilk-kurulum.ps1"]
    .filter((b) => oku(b).includes("db-rol-gocu"));
  check("§1g Windows kipi bu sürümde hiçbir kurulum betiğinden çağrılmaz (aktivasyon 2.15.8)", betikler.length === 0, betikler.join(" "));
}

async function hataKodu(c: Client, sql: string): Promise<string> {
  await c.query("SAVEPOINT s");
  try { await c.query(sql); await c.query("RELEASE SAVEPOINT s"); return "ok"; }
  catch (e) { await c.query("ROLLBACK TO SAVEPOINT s"); return String((e as { code?: string }).code ?? (e as Error).message); }
}

/** Transaction dışında tek ifade: "ok" ya da hata kodu. */
async function tekKod(c: Client, sql: string): Promise<string> {
  try { await c.query(sql); return "ok"; } catch (e) { return String((e as { code?: string }).code ?? (e as Error).message); }
}

async function kurcalayabilir(url: string): Promise<boolean> {
  const c = new Client({ connectionString: pgUrl(url) });
  await c.connect();
  try { return (await c.query(AUDIT_TAMPER_SQL)).rows[0].tamper === true; } finally { await c.end(); }
}

/** /health'in kendi okuyucusu, verilen URL'le ayrı süreçte (prisma tekili açılışta DATABASE_URL okur). */
function korumaOku(url: string): { level: string; writeOnly: boolean } | null {
  try {
    const out = execFileSync("npx", ["tsx", "-e",
      'require("./src/services/audit-chain.service").readAuditProtection().then(r=>{console.log("SONUC"+JSON.stringify(r));process.exit(0)})'],
    { cwd: ROOT, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const m = /SONUC(\{.*\})/.exec(out);
    return m ? JSON.parse(m[1]) : null;
  } catch { return null; }
}

async function main(): Promise<void> {
  console.log("=== G4 DB rol ayrımı ===\n");
  statik();
  const engel = hedefDbEngeli();
  if (engel) { check("hedef DB kapısı", false, engel); return; }
  const ownerUrl = process.env.DATABASE_URL as string;
  const rol = `tekserp_g4rol${process.pid}_test`;
  const yabanci = `tekserp_g4yab${process.pid}_test`;
  // G5: rol göçü okuma rolünü de kurar — küme geneli ad koşuma özgü olmalı (varsayılan `<sahip>_okuma` değil).
  const okr = `tekserp_g4okr${process.pid}_test`;
  const tmpTablo = `g4rol_tmp_${process.pid}`;
  const sahip = new Client({ connectionString: pgUrl(ownerUrl) });
  await sahip.connect();
  const roleExists = async (ad: string) => (await sahip.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [ad])).rowCount === 1;
  try {
    // ── §2 KURU ──
    const kuruLog: string[] = [];
    const kuru = await runRoleMigration({ ownerUrl, readRole: okr, rol, uygula: false, log: (m) => kuruLog.push(m) });
    check("§2a KURU çıkış 0 ve ifade listesini basar", kuru.kod === EXIT_OK && kuruLog.some((l) => l.includes(`CREATE ROLE "${rol}"`)));
    check("§2b KURU rolü yaratmaz", !(await roleExists(rol)));

    // ── §3 uygula ──
    const log: string[] = [];
    const s1 = await runRoleMigration({ ownerUrl, readRole: okr, rol, uygula: true, log: (m) => log.push(m) });
    check("§3a ⭐ uygula çıkış 0, doğrulanmış uygulama URL'i döner", s1.kod === EXIT_OK && !!s1.appUrl, String(s1.kod));
    const url = s1.appUrl ?? "";
    const parola = url ? decodeURIComponent(new URL(url).password) : "";
    check("§3b sır günlüğe girmez (parola · SCRAM doğrulayıcısı · URL)", parola.length === 64 &&
      !log.some((l) => l.includes(parola) || l.includes("SCRAM-SHA-256$") || l.includes("postgresql://")));
    const a = (await sahip.query(
      `SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolcanlogin,
              (SELECT count(*)::int FROM pg_auth_members m WHERE m.member = r.oid) AS uye
       FROM pg_roles r WHERE rolname = $1`, [rol])).rows[0];
    check("§3c rol: LOGIN, süper/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS değil, üyeliksiz",
      !!a && a.rolcanlogin && !a.rolsuper && !a.rolcreatedb && !a.rolcreaterole && !a.rolreplication && !a.rolbypassrls && a.uye === 0);
    if (url) {
      const u = new Client({ connectionString: pgUrl(url) });
      await u.connect();
      try {
        await u.query("BEGIN");
        check("§3d uygulama rolü audit'e EKLER (definer trigger zinciri bağlar)", await hataKodu(u,
          `INSERT INTO system_logs (id, category, action, "tableName", "recordId", "createdAt")
           VALUES (gen_random_uuid(), 'SYSTEM', 'BEKCI_G4ROL', 'BEKCI_G4ROL', 'x', now())`) === "ok");
        for (const [ad, sql] of [
          ["UPDATE system_logs", `UPDATE system_logs SET "recordId" = 'y' WHERE "tableName" = 'BEKCI_G4ROL'`],
          ["DELETE system_logs", `DELETE FROM system_logs WHERE "tableName" = 'BEKCI_G4ROL'`],
          ["TRUNCATE system_logs", "TRUNCATE system_logs"],
          ["DELETE system_log_archives", "DELETE FROM system_log_archives"],
          ["TRUNCATE system_log_archives", "TRUNCATE system_log_archives"],
        ] as const) {
          const k = await hataKodu(u, sql);
          check(`§3e ⭐ ${ad} → 42501`, k === "42501", k);
        }
        check("§3f iş tablosunda DML çalışır (system_settings ekle/sil)",
          await hataKodu(u, `INSERT INTO system_settings (key, value, "updatedAt") VALUES ('bekci.g4rol', '1', now())`) === "ok"
          && await hataKodu(u, `DELETE FROM system_settings WHERE key = 'bekci.g4rol'`) === "ok");
        check("§3g definer arşivleyici çağrılabilir (audit_arsivle)",
          await hataKodu(u, `SELECT audit_arsivle(now() - interval '100 years', 1)`) === "ok"); // tz-ok: bekçi
        check("§3h uygulama rolü yeni nesne yaratamaz (şema sahibi değil)",
          await hataKodu(u, `CREATE TABLE ${tmpTablo}_u (x int)`) === "42501");
      } finally {
        await u.query("ROLLBACK").catch(() => undefined);
        await u.end();
      }
      check("§3i ölçüm (/health yüklemi) uygulama rolünde: kurcalayamaz", !(await kurcalayabilir(url)));
    }

    // ── §4 idempotent ──
    const s2 = await runRoleMigration({ ownerUrl, readRole: okr, rol, uygula: true, log: () => undefined });
    check("§4a ikinci koşum çıkış 0, rolü yeniden yaratmaz, aynı URL", s2.kod === EXIT_OK
      && !(s2.statements ?? []).some((q) => q.startsWith("CREATE ROLE")) && s2.appUrl === url);

    // ── §5 bozulmuş durum → ölçüm kırmızı → yeniden koşum onarır ──
    await sahip.query(`GRANT UPDATE, DELETE ON system_logs TO "${rol}"`);
    check("§5a ⭐ sonda: DELETE/UPDATE yetkisi geri gelince ölçüm 'kurcalayabilir' der", url ? await kurcalayabilir(url) : false);
    await sahip.query(`CREATE TABLE "${tmpTablo}" (x int)`);
    await sahip.query(`ALTER TABLE "${tmpTablo}" OWNER TO "${rol}"`);
    const sahipAdi = (await sahip.query("SELECT current_user AS u")).rows[0].u as string;
    await sahip.query(`GRANT "${sahipAdi}" TO "${rol}"`);
    const bozuk = await measureRoleState(sahip, rol);
    check("§5b sonda: ownership + üyelik ölçülür", bozuk.canTamper && bozuk.ownedObjects >= 1 && bozuk.memberships.includes(sahipAdi));
    const s3 = await runRoleMigration({ ownerUrl, readRole: okr, rol, uygula: true, log: () => undefined });
    const onarik = await measureRoleState(sahip, rol);
    const tOwner = (await sahip.query(`SELECT pg_get_userbyid(relowner) AS o FROM pg_class WHERE relname = $1`, [tmpTablo])).rows[0]?.o;
    check("§5c ⭐ yeniden koşum onarır: yetki · ownership · üyelik", s3.kod === EXIT_OK && !onarik.canTamper
      && onarik.ownedObjects === 0 && onarik.memberships.length === 0 && tOwner === sahipAdi, `sahip=${tOwner}`);

    // ── §6 uygulanamaz ──
    if (url) {
      const s4 = await runRoleMigration({ ownerUrl: url, readRole: okr, rol: yabanci, uygula: true, log: () => undefined });
      check("§6a ⭐ sahip/süper olmayan bağlantı → 2, hiçbir şey yaratılmaz", s4.kod === EXIT_NOT_APPLICABLE && !(await roleExists(yabanci)));
    }
    const s5 = await runRoleMigration({ ownerUrl, readRole: okr, rol: "Kotu-Ad", uygula: true, log: () => undefined });
    check("§6b geçersiz rol adı → 2", s5.kod === EXIT_NOT_APPLICABLE);

    // ── §7 /health okuyucusu ──
    const p1 = url ? korumaOku(url) : null;
    check("§7a ⭐ readAuditProtection uygulama rolünde writeOnly=true", p1?.writeOnly === true, JSON.stringify(p1));
    const p2 = korumaOku(ownerUrl);
    check("§7b sahip rolünde (geri düşüş) writeOnly=false → 'kismi'", p2?.writeOnly === false && p2.level === "kismi", JSON.stringify(p2));
  } finally {
    await sahip.query(`DROP TABLE IF EXISTS "${tmpTablo}"`).catch(() => undefined);
    await sahip.query(`DROP FUNCTION IF EXISTS public.okuma_rolu_parola(text)`).catch(() => undefined);
    // Göç advisory kilitlerini PUBLIC'ten aldı; test DB'si sonraki bekçiler için eski hâline döner.
    for (const r of (await sahip.query(ADVISORY_FUNCTION_SQL)).rows) {
      await sahip.query(`GRANT EXECUTE ON FUNCTION pg_catalog.${String(r.f)} TO PUBLIC`).catch(() => undefined);
    }
    for (const r of [okr, rol, yabanci]) {
      if (await roleExists(r)) {
        await sahip.query(`DROP OWNED BY "${r}"`).catch(() => undefined);
        await sahip.query(`DROP ROLE "${r}"`).catch((e) => console.log(`! ${r} silinemedi: ${(e as Error).message}`));
      }
    }
    check("temizlik: test rolleri yok", !(await roleExists(rol)) && !(await roleExists(yabanci)) && !(await roleExists(okr)));
    await sahip.end();
  }
}

// =============================================================================
// §8 — Windows kipi: süper bağlantı + açık sahip (`--sahip`)
// =============================================================================
const W8 = "tekserp_w8";
async function w8Sweep(su: Client): Promise<void> {
  const dbs = await su.query<{ d: string }>(`SELECT datname AS d FROM pg_database WHERE datname ~ '^tekserp_w8[0-9a-z]+_[a-z]+_test$'`);
  for (const r of dbs.rows) await su.query(`DROP DATABASE IF EXISTS ${quoteIdent(r.d)} WITH (FORCE)`).catch(() => undefined);
  const roles = await su.query<{ r: string }>(`SELECT rolname AS r FROM pg_roles WHERE rolname ~ '^tekserp_w8[0-9a-z]+_[a-z]+_test(_uygulama|_okuma)?$'`);
  for (const r of roles.rows) await su.query(`DROP ROLE IF EXISTS ${quoteIdent(r.r)}`).catch(() => undefined);
}

function cli(args: string[], env: NodeJS.ProcessEnv): { kod: number | null; cikti: string } {
  const r = spawnSync("npx", ["tsx", "src/lib/db-rol-gocu.ts", ...args], { cwd: ROOT, env, encoding: "utf8" });
  return { kod: r.status, cikti: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

async function windowsKipi(baseUrl: string): Promise<void> {
  console.log("\n=== §8 Windows kipi (--sahip) ===");
  const base = parseDatabaseUrl(baseUrl);
  if (!base) { check("§8 DATABASE_URL çözülemedi", false); return; }
  const engel = fixtureHedefEngeli();
  if (engel) { check("§8 hedef kapısı: küme katmanı yalnız fixture hedefinde koşar", false, engel); return; }
  const su = new Client(toClientConfig(withDatabase(base, "postgres")));
  await su.connect();
  if (!(await su.query(`SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user`)).rows[0]?.s) {
    await su.end();
    if (process.env.CI) check("§8 ölçüm koşulu (CI'da atlanamaz): DATABASE_URL süper değil", false);
    else console.log("⏭️  §8 DATABASE_URL süper değil — Windows kipi ÖLÇÜLEMEDİ");
    return;
  }
  const damga = `${process.pid.toString(36)}${Date.now().toString(36)}`;
  const sahip = `${W8}${damga}_sahip_test`;
  const baska = `${W8}${damga}_baska_test`;
  const rol = `${W8}${damga}_uyg_test`;
  const okr = `${W8}${damga}_okr_test`;
  const db = `${W8}${damga}_db_test`;
  const sahipPass = randomBytes(12).toString("hex");
  const baskaPass = randomBytes(12).toString("hex");
  const kimlik = join(tmpdir(), `${db}-kimlik.json`);
  const hp = (rolAdi: string, parola: string) => `postgresql://${rolAdi}:${parola}@${base.host}:${base.port}/${db}`;
  const superUrl = `postgresql://${encodeURIComponent(base.user)}:${encodeURIComponent(base.password ?? "")}@${base.host}:${base.port}/${db}`;
  const sahipUrl = hp(sahip, sahipPass);
  const roleExists = async (ad: string) => (await su.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [ad])).rowCount === 1;
  const baglan = async (url: string) => { const c = new Client({ connectionString: url }); c.on("error", () => undefined); await c.connect(); return c; };
  try {
    await w8Sweep(su);
    // Windows `tekserp` eşdeğeri: süper değil, DB/rol yaratamaz; yalnız DB sahibi, göçü o koşar.
    await su.query(`CREATE ROLE ${quoteIdent(sahip)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${sahipPass}'`);
    await su.query(`CREATE ROLE ${quoteIdent(baska)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${baskaPass}'`);
    await su.query(`CREATE DATABASE ${quoteIdent(db)} OWNER ${quoteIdent(sahip)} TEMPLATE template0 ENCODING 'UTF8'`);
    const dep = await runProcess(process.execPath, [join(ROOT, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"],
      { timeoutMs: 10 * 60 * 1000, env: cocukOrtami({ DATABASE_URL: `${sahipUrl}?schema=public` }), captureStdout: true });
    check("§8a süper olmayan sahip bütün migration'ları uyguladı (Windows düzeni)", dep.code === 0, dep.code === 0 ? "" : dep.stderr.slice(-300));
    if (dep.code !== 0) return;

    // ── KURU: varsayılan adlar ve sahip kavramı --sahip'ten, bağlanan süper kullanıcıdan DEĞİL ──
    const kuruLog: string[] = [];
    const kuru = await runRoleMigration({ ownerUrl: superUrl, sahip: { ad: sahip, parola: sahipPass }, uygula: false, log: (m) => kuruLog.push(m) });
    const q = kuru.statements ?? [];
    const rq = kuru.readStatements ?? [];
    check("§8b ⭐ KURU: sahip = --sahip (bağlanan süper değil), varsayılan adlar ondan türer, hiçbir rol doğmaz",
      kuru.kod === EXIT_OK && kuru.state?.sahip === sahip && kuru.state?.baglanan === base.user
      && q.includes(`CREATE ROLE "${sahip}_uygulama"`) && rq.includes(`CREATE ROLE "${sahip}_okuma"`)
      && !(await roleExists(`${sahip}_uygulama`)) && !(await roleExists(`${sahip}_okuma`)), `kod ${kuru.kod}`);
    const yanlisaGiden = [...q, ...rq].filter((x) => x.includes(`FOR ROLE "${base.user}"`) || x.includes(`TO "${base.user}"`));
    check("§8c ⭐ DEFAULT PRIVILEGES / advisory GRANT sahibe, süper kullanıcıya hiçbir ifade gitmez",
      q.some((x) => x.startsWith(`ALTER DEFAULT PRIVILEGES FOR ROLE "${sahip}"`)) && yanlisaGiden.length === 0
      && rq.some((x) => /^GRANT EXECUTE ON FUNCTION pg_catalog\.pg_advisory_lock\(bigint\) TO /.test(x) && x.includes(`"${sahip}"`)),
    yanlisaGiden.slice(0, 2).join(" | "));

    // ── uygulanamaz: sahip uyuşmazlığı · süper olmayan bağlantı · yanlış parola ──
    const bos = () => undefined;
    const u1 = await runRoleMigration({ ownerUrl: superUrl, sahip: { ad: baska, parola: baskaPass }, rol, readRole: okr, uygula: true, log: bos });
    const u2 = await runRoleMigration({ ownerUrl: superUrl, sahip: { ad: base.user, parola: base.password ?? "" }, rol, readRole: okr, uygula: true, log: bos });
    check("§8d ⭐ sahip uyuşmazlığı (başka rol · süper kullanıcının kendisi) → 2, rol doğmaz",
      u1.kod === EXIT_NOT_APPLICABLE && u2.kod === EXIT_NOT_APPLICABLE && !(await roleExists(rol)) && !(await roleExists(okr)), `${u1.kod}/${u2.kod}`);
    const u3 = await runRoleMigration({ ownerUrl: sahipUrl, sahip: { ad: sahip, parola: sahipPass }, rol, readRole: okr, uygula: true, log: bos });
    check("§8e ⭐ süper olmayan bağlantı (sahibin kendisi) → 2 uygulanamaz, rol doğmaz", u3.kod === EXIT_NOT_APPLICABLE && !(await roleExists(rol)), String(u3.kod));
    let trust = false;
    try { const t = await baglan(hp(sahip, "yanlis-parola")); trust = true; await t.end(); } catch { /* beklenen: 28P01 */ }
    if (trust) console.log("⏭️  §8f küme parola istemiyor (trust) — yanlış parola ölçülemedi");
    else {
      const u4 = await runRoleMigration({ ownerUrl: superUrl, sahip: { ad: sahip, parola: "yanlis-parola" }, rol, readRole: okr, uygula: true, log: bos });
      check("§8f yanlış sahip parolası → 2, rol doğmaz (türetilen uygulama parolası tutmazdı)", u4.kod === EXIT_NOT_APPLICABLE && !(await roleExists(rol)), String(u4.kod));
    }

    // ── uygula ──
    const log: string[] = [];
    const s1 = await runRoleMigration({ ownerUrl: superUrl, sahip: { ad: sahip, parola: sahipPass }, rol, readRole: okr, uygula: true, log: (m) => log.push(m) });
    const appUrl = s1.appUrl ?? "";
    const appPass = appUrl ? decodeURIComponent(new URL(appUrl).password) : "";
    check("§8g ⭐ uygula çıkış 0, okuma rolü hazır, uygulama parolası SAHİP parolasından türer",
      s1.kod === EXIT_OK && s1.readResult === "ready" && appPass === deriveAppPassword(sahipPass, rol), `kod ${s1.kod} okuma ${s1.readResult}`);
    // Süper parola rol/DB adının parçası olabilir (yerel `tekserp`); yalnız ad dışı bir dizgeyse aranır.
    const superSir = base.password && ![base.user, sahip, db].some((x) => x.includes(base.password as string)) ? base.password : "";
    const sizinti = [sahipPass, appPass, superSir, "postgresql://", "SCRAM-SHA-256$"].filter((x) => x && log.some((l) => l.includes(x)));
    check("§8h sır günlüğe girmez (sahip/uygulama/süper parolası · URL · SCRAM)", appPass.length === 64 && sizinti.length === 0,
      sizinti.length ? `${sizinti.length} sızıntı` : "");
    if (!appUrl) return;
    const sc = await baglan(sahipUrl);
    const uc = await baglan(appUrl);
    try {
      const sahiplik = (await sc.query(`
        SELECT (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relkind IN ('r','p','S','v','m') AND pg_get_userbyid(c.relowner) <> $1) AS yabanci,
               (SELECT array_agg(DISTINCT pg_get_userbyid(defaclrole)::text) FROM pg_default_acl) AS dacl`, [sahip])).rows[0];
      check("§8i ⭐ tablolar yine sahipte, varsayılan ayrıcalık yalnız sahip adına (süper kullanıcıya gitmedi)",
        sahiplik.yabanci === 0 && JSON.stringify(sahiplik.dacl) === JSON.stringify([sahip]), JSON.stringify(sahiplik));
      await uc.query("BEGIN");
      try {
        check("§8j uygulama rolü audit'e EKLER", await hataKodu(uc, `INSERT INTO system_logs (id, category, action, "tableName", "recordId", "createdAt")
           VALUES (gen_random_uuid(), 'SYSTEM', 'BEKCI_W8', 'BEKCI_W8', 'x', now())`) === "ok");
        const k = [await hataKodu(uc, `DELETE FROM system_logs WHERE "tableName" = 'BEKCI_W8'`),
          await hataKodu(uc, `UPDATE system_logs SET "recordId" = 'y' WHERE "tableName" = 'BEKCI_W8'`),
          await hataKodu(uc, "TRUNCATE system_log_archives")];
        check("§8k ⭐ uygulama rolüyle DELETE/UPDATE system_logs + TRUNCATE arşiv → 42501", k.every((x) => x === "42501"), k.join(","));
        check("§8l uygulama rolü advisory kilit alır (açık GRANT)", await hataKodu(uc, "SELECT pg_advisory_xact_lock(8039, 0)") === "ok");
      } finally { await uc.query("ROLLBACK").catch(() => undefined); }
      // Okuma rolüne parola uygulama rolünün yetkili yolundan (süper sahipli definer) verilir.
      const okuParola = randomBytes(16).toString("hex");
      const pr = await tekKod(uc, `SELECT okuma_rolu_parola('${scramVerifier(okuParola)}')`);
      const oc = pr === "ok" ? await baglan(hp(okr, okuParola)).catch(() => null) : null;
      if (oc) {
        try {
          await oc.query("BEGIN");
          const a = await hataKodu(oc, "SELECT pg_advisory_lock(8039, 0)");
          const okunur = await hataKodu(oc, "SELECT count(*) FROM _prisma_migrations");
          await oc.query("ROLLBACK");
          check("§8m ⭐ okuma rolüyle pg_advisory_lock reddedilir (42501), gizli olmayan tablo okunur", a === "42501" && okunur === "ok", `${a}/${okunur}`);
        } finally { await oc.end().catch(() => undefined); }
      } else check("§8m okuma rolüne parola verilip bağlanılamadı", false, pr);
      // Sonraki göç sahibin işi: advisory kilit ve yeni tablonun uygulama rolüne açılması.
      await sc.query(`CREATE TABLE w8_yeni (x int)`);
      check("§8n sahibin yeni tablosu uygulama rolüne kendiliğinden açılır; sahip advisory kilit alır",
        await tekKod(uc, "INSERT INTO w8_yeni VALUES (1)") === "ok" && (await sc.query("SELECT pg_try_advisory_lock(72707369) AS k")).rows[0].k === true);
    } finally {
      await sc.end().catch(() => undefined);
      await uc.end().catch(() => undefined);
    }
    const dep2 = await runProcess(process.execPath, [join(ROOT, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"],
      { timeoutMs: 5 * 60 * 1000, env: cocukOrtami({ DATABASE_URL: `${sahipUrl}?schema=public` }), captureStdout: true });
    check("§8o rol göçünden sonra sahip `migrate deploy` koşabilir (advisory REVOKE göçü kırmaz)", dep2.code === 0, dep2.stderr.slice(-200));
    const s2 = await runRoleMigration({ ownerUrl: superUrl, sahip: { ad: sahip, parola: sahipPass }, rol, readRole: okr, uygula: true, log: bos });
    check("§8p idempotent: ikinci koşum 0, rolü yeniden yaratmaz, aynı URL",
      s2.kod === EXIT_OK && !(s2.statements ?? []).some((x) => x.startsWith("CREATE ROLE")) && s2.appUrl === appUrl);
    const p = korumaOku(appUrl);
    check("§8q readAuditProtection Windows kipi uygulama rolünde writeOnly=true", p?.writeOnly === true, JSON.stringify(p));

    // ── CLI: URL/parola yalnız ortamdan ya da kimlik dosyasından ──
    const env = cocukOrtami({ [SUPER_URL_ENV]: superUrl, [OWNER_PASSWORD_ENV]: undefined, DATABASE_URL: sahipUrl });
    delete env[OWNER_PASSWORD_ENV];
    writeFileSync(kimlik, `\uFEFF${JSON.stringify({ db, port: base.port, user: sahip, pass: sahipPass })}`, { mode: 0o600 });
    const c1 = cli(["--sahip", sahip, "--kimlik", kimlik, "--rol", rol, "--okuma-rol", okr], env);
    check("§8r CLI kimlik dosyasıyla KURU 0, çıktıda parola yok", c1.kod === 0 && !c1.cikti.includes(sahipPass) && /KURU/.test(c1.cikti), `kod ${c1.kod}`);
    writeFileSync(kimlik, JSON.stringify({ db, port: base.port, user: baska, pass: baskaPass }), { mode: 0o600 });
    const c2 = cli(["--sahip", sahip, "--kimlik", kimlik], env);
    const c3 = cli(["--sahip", sahip, "--kimlik", kimlik], { ...env, [OWNER_PASSWORD_ENV]: sahipPass });
    const envsiz = { ...env };
    delete envsiz[SUPER_URL_ENV];
    const c4 = cli(["--sahip", sahip], { ...envsiz, [OWNER_PASSWORD_ENV]: sahipPass });
    check("§8s ⭐ CLI: kimlik kullanıcısı ≠ --sahip · iki parola kaynağı · süper URL ortamda yok (DATABASE_URL olsa da) → 2",
      c2.kod === 2 && c3.kod === 2 && c4.kod === 2, `${c2.kod}/${c3.kod}/${c4.kod}`);
  } finally {
    rmSync(kimlik, { force: true });
    await su.query(`DROP DATABASE IF EXISTS ${quoteIdent(db)} WITH (FORCE)`).catch(() => undefined);
    for (const r of [rol, okr, `${sahip}_uygulama`, `${sahip}_okuma`, baska, sahip]) {
      await su.query(`DROP ROLE IF EXISTS ${quoteIdent(r)}`).catch((e) => console.log(`! ${r} silinemedi: ${(e as Error).message}`));
    }
    const kalan = await su.query(`SELECT count(*)::int AS n FROM pg_roles WHERE rolname LIKE $1`, [`${W8}${damga}%`]);
    check("§8 temizlik: geçici DB ve roller yok", kalan.rows[0].n === 0);
    await su.end();
  }
}

main()
  .then(async () => { if (!hedefDbEngeli()) await windowsKipi(process.env.DATABASE_URL as string); })
  .catch((e) => { console.error(e); fail++; })
  .finally(() => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
