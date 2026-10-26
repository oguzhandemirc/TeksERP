// =============================================================================
// BEKÇİ — MIGRATION SÜPER OLMAYAN SAHİP ROLLE KOŞULABİLİR + BAKIM ROLÜ GERİ YÜKLER
// Çalıştır: npx tsx scripts/run-all-tests.ts migration_super_olmayan
// =============================================================================
// Windows'ta `migrate deploy`u koşan sahip (`tekserp`) SÜPER DEĞİL; CI ise süper
// kullanıcıyla koşar ve süper yetki isteyen bir migration'ı GÖRMEZ (2026-10-13: tanımda
// `SET "teks.audit_purge"` → 42501, 2.15.7 her Windows kurulumunda FAILED migration).
// §1 KAYNAK: migration'larda süper yetki isteyen cümle yok (fonksiyon tanımında özel
//    parametre SET'i · ALTER SYSTEM · CREATE/ALTER ROLE · ALTER DATABASE … SET).
// §2 KÜME ⭐: geçici sahip rol (NOSUPERUSER NOCREATEDB NOCREATEROLE, DB sahibi) BÜTÜN
//    migration'ları boş DB'ye `prisma migrate deploy` ile uygular; hepsi bitmiş, FAILED yok.
// §3 purge kapısı davranışı birebir: arşivleyici guard açıkken taşır, çağrı sonrası purge
//    'on' KALMAZ, doğrudan DELETE reddedilir; fonksiyon ayarlarında teks.* yok.
// §4 bakım rolü (CREATEDB, sahibe üye, süper değil) o DB'yi döker ve panel kopyasının
//    argümanlarıyla (`copyRestoreArgs`: --exit-on-error + --no-acl) geri yükler; döküm
//    kümede olmayan role GRANT taşır — §4d sondası `--no-acl`siz düştüğünü ölçer.
// Ölçülemezse (süper olmayan DATABASE_URL, PG aracı yok) yerelde ⏭, CI'da ❌.
// =============================================================================
import "dotenv/config";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { Client } from "pg";
import { cocukOrtami, fixtureHedefEngeli, hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { parseDatabaseUrl, quoteIdent, toClientConfig, withDatabase, pgToolArgs, type PgConn } from "../src/services/helpers/pg-conn.helper";
import { pgTool, runProcess, runTool } from "../src/services/helpers/pg-tool.helper";
import { copyRestoreArgs } from "../src/services/db-copy.service";

const ROOT = join(__dirname, "..");
const MIG_DIR = join(ROOT, "prisma", "migrations");
const CI = !!process.env.CI;
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}
function olculemedi(neden: string): void {
  if (CI) check(`ölçüm koşulu (CI'da atlanamaz): ${neden}`, false);
  else console.log(`⏭️  ${neden} — küme katmanı ÖLÇÜLEMEDİ`);
}

const migrations = readdirSync(MIG_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

// =============================================================================
// §1 — kaynak
// =============================================================================
function testSource(): void {
  const ihlal: string[] = [];
  for (const ad of migrations) {
    const sql = readFileSync(join(MIG_DIR, ad, "migration.sql"), "utf8").replace(/--[^\n]*/g, "");
    // Fonksiyon başlığı (CREATE … FUNCTION … AS $) içinde noktalı (özel) parametre SET'i.
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)[\s\S]*?\bAS\s+\$/gi)) {
      if (/\n\s*SET\s+"?[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*"?\s*(=|TO\b)/i.test(m[0])) ihlal.push(`${ad}: fonksiyon tanımında özel parametre SET'i`);
    }
    if (/\bALTER\s+SYSTEM\b/i.test(sql)) ihlal.push(`${ad}: ALTER SYSTEM`);
    if (/\b(CREATE|ALTER)\s+(ROLE|USER)\b/i.test(sql)) ihlal.push(`${ad}: CREATE/ALTER ROLE`);
    if (/\bALTER\s+DATABASE\b[^;]*\bSET\b/i.test(sql)) ihlal.push(`${ad}: ALTER DATABASE … SET`);
  }
  check("§1 migration'larda süper yetki isteyen cümle yok (fonksiyon-SET özel parametre · ALTER SYSTEM · ROLE · ALTER DATABASE SET)",
    ihlal.length === 0, ihlal.slice(0, 5).join(" · "));
}

// =============================================================================
// §2–§4 — küme
// =============================================================================
async function testCluster(): Promise<void> {
  const base = parseDatabaseUrl(process.env.DATABASE_URL);
  if (!base) return olculemedi("DATABASE_URL yok");
  // Rol + DB kurar: hedef fixture değilse (fabrika kopyası) bağlanmadan DURUR.
  const engel = hedefDbEngeli() ?? fixtureHedefEngeli();
  if (engel) { check("§2 hedef kapısı: küme katmanı yalnız fixture hedefinde koşar", false, engel); return; }
  const su = new Client(toClientConfig(withDatabase(base, "postgres")));
  await su.connect();
  try {
    const s = (await su.query<{ s: boolean }>(`SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user`)).rows[0]?.s;
    if (!s) return olculemedi("DATABASE_URL kimliği süper kullanıcı değil, rol kurulamaz");
    const arac = await runTool(pgTool("pg_restore"), ["--version"], "");
    if (arac.spawnError || arac.code !== 0) return olculemedi(`pg_restore çalışmıyor (${arac.spawnError ?? arac.code}; PG_BIN_DIR?)`);
    await kume(su, base);
  } finally {
    await su.end().catch(() => {});
  }
}

const PREFIX = "tekserp_mso_";
async function sweep(su: Client): Promise<void> {
  const dbs = await su.query<{ datname: string }>(`SELECT datname FROM pg_database WHERE datname ~ '^tekserp_mso_[0-9a-z]+_[a-z]+_test$'`);
  for (const r of dbs.rows) await su.query(`DROP DATABASE IF EXISTS ${quoteIdent(r.datname)} WITH (FORCE)`).catch(() => {});
  const roles = await su.query<{ rolname: string }>(`SELECT rolname FROM pg_roles WHERE rolname ~ '^tekserp_mso_[0-9a-z]+_[a-z]+_test$' ORDER BY rolname`);
  // Bakım rolü önce (sahibe üye); sahip DB'ler düştükten sonra boştur.
  for (const r of roles.rows.sort((a, b) => Number(b.rolname.includes("_bakim_")) - Number(a.rolname.includes("_bakim_")))) {
    await su.query(`DROP ROLE IF EXISTS ${quoteIdent(r.rolname)}`).catch(() => {});
  }
}

async function kume(su: Client, base: PgConn): Promise<void> {
  const damga = Date.now().toString(36);
  const sahip = `${PREFIX}${damga}_sahip_test`;
  const bakim = `${PREFIX}${damga}_bakim_test`;
  const db = `${PREFIX}${damga}_ana_test`;
  const kopya = `${PREFIX}${damga}_kopya_test`;
  const yok = `${PREFIX}${damga}_yok_test`;
  const sahipPass = crypto.randomBytes(12).toString("hex");
  const bakimPass = crypto.randomBytes(12).toString("hex");
  const sahipConn: PgConn = { ...withDatabase(base, db), user: sahip, password: sahipPass };
  const bakimConn: PgConn = { ...withDatabase(base, db), user: bakim, password: bakimPass };
  const dump = join(os.tmpdir(), `${db}.dump`);
  const sahipSorgu = async (hedef: string, sql: string): Promise<Array<Record<string, string>>> => {
    const c = new Client(toClientConfig(withDatabase(sahipConn, hedef)));
    c.on("error", () => {});
    await c.connect();
    try { return (await c.query<Record<string, string>>(sql)).rows; } finally { await c.end().catch(() => {}); }
  };
  try {
    await sweep(su);
    // Windows `tekserp` eşdeğeri: süper değil, DB yaratamaz, rol yaratamaz; yalnız DB sahibi.
    await su.query(`CREATE ROLE ${quoteIdent(sahip)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${sahipPass}'`);
    await su.query(`CREATE DATABASE ${quoteIdent(db)} OWNER ${quoteIdent(sahip)} TEMPLATE template0 ENCODING 'UTF8'`);

    // ── §2 migrate deploy sahip rolle ─────────────────────────────────────────
    const url = `postgresql://${encodeURIComponent(sahip)}:${sahipPass}@${base.host}:${base.port}/${db}?schema=public`;
    const t0 = Date.now();
    const dep = await runProcess(process.execPath, [join(ROOT, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], {
      timeoutMs: 10 * 60 * 1000,
      env: cocukOrtami({ DATABASE_URL: url }),
      captureStdout: true,
    });
    const satirlar = `${dep.stderr}\n${dep.stdout ?? ""}`.split("\n");
    const hata = [...satirlar.filter((l) => /42501|permission denied|Migration name/i.test(l)), ...satirlar.filter((l) => /error/i.test(l))]
      .slice(0, 4).join(" | ");
    check(`§2a ⭐ süper olmayan sahip rol BÜTÜN migration'ları uyguladı (prisma migrate deploy, ${((Date.now() - t0) / 1000).toFixed(0)} sn)`,
      dep.code === 0 && !dep.spawnError, dep.code === 0 ? "" : hata || dep.spawnError || `kod ${dep.code}`);
    const sc = new Client(toClientConfig(sahipConn));
    sc.on("error", () => {});
    await sc.connect();
    try {
      const m = (await sc.query<{ bitti: string; yarim: string }>(
        `SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text AS bitti,
                count(*) FILTER (WHERE finished_at IS NULL)::text AS yarim FROM _prisma_migrations`)).rows[0];
      check("§2b bitmiş migration sayısı = dizin sayısı, FAILED/yarım yok",
        Number(m?.bitti) === migrations.length && m?.yarim === "0", `${m?.bitti}/${migrations.length} bitmiş, ${m?.yarim} yarım`);
      if (dep.code !== 0) return;

      // ── §3 purge kapısı davranışı ───────────────────────────────────────────
      const cfg = (await sc.query<{ c: string }>(
        `SELECT coalesce(array_to_string(proconfig, ','), '') AS c FROM pg_proc WHERE proname IN ('audit_arsivle', 'audit_arsiv_buda')`)).rows;
      check("§3a arşiv/budama fonksiyon ayarlarında teks.* yok (kapı gövdede)", cfg.length === 2 && cfg.every((r) => !r.c.includes("teks.")), cfg.map((r) => r.c).join(" ; "));
      await sc.query("BEGIN");
      try {
        await sc.query("SET LOCAL teks.audit_guard = 'on'");
        await sc.query(`INSERT INTO "system_logs" ("id", "category", "action", "tableName", "recordId", "createdAt")
                        VALUES (gen_random_uuid(), 'SYSTEM', 'BEKCI_MSO', 'BEKCI_MSO', '-', now() - interval '2 months')`); // tz-ok: an aritmetiği
        const n = (await sc.query<{ n: number }>(`SELECT "audit_arsivle"(now() - interval '1 month 1 day', 1000) AS n`)).rows[0]?.n; // tz-ok
        const purge = (await sc.query<{ p: string | null }>(`SELECT current_setting('teks.audit_purge', true) AS p`)).rows[0]?.p;
        check("§3b sahip rol guard açıkken arşivledi, çağrıdan sonra purge 'on' KALMADI", Number(n) >= 1 && purge !== "on", `taşınan ${n}, purge=${purge}`);
        await sc.query(`SELECT "audit_arsiv_buda"(now() - interval '2 years')`); // tz-ok
        const purge2 = (await sc.query<{ p: string | null }>(`SELECT current_setting('teks.audit_purge', true) AS p`)).rows[0]?.p;
        await sc.query("SAVEPOINT sil");
        let red = "";
        try { await sc.query(`DELETE FROM "system_logs" WHERE false`); } catch (e) { red = (e as { code?: string }).code ?? "?"; }
        await sc.query("ROLLBACK TO SAVEPOINT sil");
        check("§3c budamadan sonra da purge kapalı, doğrudan DELETE reddedildi (42501)", purge2 !== "on" && red === "42501", `purge=${purge2}, kod=${red || "yok"}`);
      } finally {
        await sc.query("ROLLBACK").catch(() => {});
      }
    } finally {
      await sc.end().catch(() => {});
    }

    // ── §4 bakım rolü döker + panel kopyası argümanlarıyla geri yükler ────────
    // Döküm, hedef kümede OLMAYAN bir role GRANT taşır (başka kümeden gelen yedek):
    // panel kopyası `--no-acl` ile geçer, onsuz "role does not exist" ile düşer (§4d sonda).
    await su.query(`CREATE ROLE ${quoteIdent(bakim)} LOGIN NOSUPERUSER CREATEDB NOCREATEROLE PASSWORD '${bakimPass}'`);
    await su.query(`GRANT ${quoteIdent(sahip)} TO ${quoteIdent(bakim)}`);
    await su.query(`CREATE ROLE ${quoteIdent(yok)} NOLOGIN`);
    await sahipSorgu(db, `GRANT SELECT ON "system_logs" TO ${quoteIdent(yok)}`);
    const d = await runTool(pgTool("pg_dump"), [...pgToolArgs(bakimConn), "-Fc", "-f", dump], bakimPass);
    check("§4a bakım rolü sahip DB'yi pg_dump ile döktü", d.code === 0, d.stderr.slice(0, 200));
    await sahipSorgu(db, `REVOKE ALL ON "system_logs" FROM ${quoteIdent(yok)}`);
    await su.query(`DROP ROLE ${quoteIdent(yok)}`);
    const yeniKopya = async (ad: string): Promise<void> => {
      const bc = new Client(toClientConfig(withDatabase(bakimConn, "postgres")));
      bc.on("error", () => {});
      await bc.connect();
      try {
        await bc.query(`CREATE DATABASE ${quoteIdent(ad)} OWNER ${quoteIdent(sahip)} TEMPLATE template0 ENCODING 'UTF8'`);
      } finally {
        await bc.end().catch(() => {});
      }
    };
    await yeniKopya(kopya);
    const args = copyRestoreArgs(withDatabase(bakimConn, kopya), dump);
    const r = await runTool(pgTool("pg_restore"), args, bakimPass);
    check("§4b ⭐ bakım rolü (süper değil) panel kopyası argümanlarıyla geri yükledi (rolü olmayan GRANT dahil)",
      r.code === 0 && args.includes("--exit-on-error"), r.stderr.trim().slice(0, 300));
    const k = await sahipSorgu(kopya, `SELECT count(*)::text AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`);
    check("§4c kopyada migration defteri tam", Number(k[0]?.n) === migrations.length, `${k[0]?.n}/${migrations.length}`);
    // Sonda geçerliliği: senaryo gerçekten ACL'de kırılıyor mu (`--no-acl` olmadan).
    const kopya2 = kopya.replace("_kopya_", "_acl_");
    await yeniKopya(kopya2);
    const r2 = await runTool(pgTool("pg_restore"), copyRestoreArgs(withDatabase(bakimConn, kopya2), dump).filter((a) => a !== "--no-acl"), bakimPass);
    check("§4d sonda: --no-acl olmadan aynı döküm 'role does not exist' ile düşer", r2.code !== 0 && /does not exist/.test(r2.stderr), r2.stderr.trim().slice(0, 160));
  } finally {
    rmSync(dump, { force: true });
    await sweep(su).catch(() => {});
  }
}

async function main(): Promise<void> {
  console.log("=== Migration — süper olmayan sahip rolle koşulabilirlik ===\n");
  testSource();
  await testCluster();
}

main()
  .catch((err) => {
    console.error("Test çalıştırılamadı:", err);
    fail += 1;
  })
  .finally(() => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
