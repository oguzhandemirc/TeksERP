// =============================================================================
// BEKÇİ — G5 yalnız-okuma DB rolü (2026-10-13)
// Çalıştır: npx tsx scripts/run-all-tests.ts okuma_rolu
// =============================================================================
// KORUNAN: rol göçü `<sahip>_okuma` rolünü kurar (yalnız SELECT, sır tablo/kolonları hariç, definer
// fonksiyon çağıramaz); parolayı yalnız `okuma_rolu_parola` döndürür; uç YALNIZ sistem hesabına açık;
// parola audit yüküne girmez.
// §1 statik (uç zinciri + mount) · §2 ⭐ sır adı taşıyan HER kolon sınıflandırılmış, liste bayat değil ·
// §3 göç + ihlal ölçümü boş · §4 ⭐ okuma rolüyle NEGATİF sondalar (sır SELECT · DML · definer ·
// CREATE · advisory kilit (DoS) → reddedilir; iş tabloları okunur; eski parola geçersiz; bozuk doğrulayıcı 22023) ·
// §5 ⭐ sonda: yetki kaçağı ölçümde kırmızı, yeniden koşum onarır · §6 ⭐ servis: yenile-ve-göster,
// audit yükünde parola/doğrulayıcı YOK, fonksiyon yoksa KURULUMDA_YOK + 409 · §7 ⭐ uç: fabrika
// yöneticisi (admin:settings, sistem hesabı değil) 403, sistem hesabı geçer.
// Roller küme geneli: adlar koşuma özgü (`_test`), finally'de DROP OWNED + DROP ROLE + fonksiyon DROP.
// =============================================================================
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextFunction, Request, Response } from "express";
import { Client } from "pg";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { EXIT_OK, readRoleViolations, runRoleMigration, scramVerifier } from "../src/lib/db-rol-gocu";
import {
  ADVISORY_FUNCTION_SQL, READ_ONLY_HIDDEN_COLUMNS, READ_ONLY_HIDDEN_TABLES, READ_ONLY_NOT_SECRET_COLUMNS, SECRET_NAME_PATTERN,
} from "../src/lib/okuma-rolu";
import readOnlyDbRouter from "../src/routes/read-only-db.routes";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
const ROOT = join(__dirname, "..");
const oku = (p: string) => readFileSync(join(ROOT, p), "utf8");
const pgUrl = (u: string) => { const x = new URL(u); x.searchParams.delete("schema"); return x.toString(); };
const rolUrl = (u: string, rol: string, parola: string) => {
  const x = new URL(pgUrl(u)); x.username = rol; x.password = encodeURIComponent(parola); return x.toString();
};

async function hataKodu(c: Client, sql: string): Promise<string> {
  await c.query("SAVEPOINT s");
  try { await c.query(sql); await c.query("RELEASE SAVEPOINT s"); return "ok"; }
  catch (e) { await c.query("ROLLBACK TO SAVEPOINT s"); return String((e as { code?: string }).code ?? (e as Error).message); }
}
async function baglanKodu(url: string): Promise<string> {
  const c = new Client({ connectionString: url });
  try { await c.connect(); return "ok"; }
  catch (e) { return String((e as { code?: string }).code ?? (e as Error).message); }
  finally { await c.end().catch(() => undefined); }
}

/** Servisi verilen URL'le ayrı süreçte koşar (prisma tekili açılışta DATABASE_URL okur). */
function servis(url: string, ifade: string): { ok: boolean; out: unknown; err?: string } {
  try {
    const out = execFileSync("npx", ["tsx", "-e",
      `const s=require("./src/services/read-only-db.service");Promise.resolve(${ifade}).then(r=>{console.log("SONUC"+JSON.stringify({ok:true,out:r}));process.exit(0)},e=>{console.log("SONUC"+JSON.stringify({ok:false,err:(e.details&&e.details.code)||e.message}));process.exit(0)})`],
    { cwd: ROOT, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const m = /SONUC(\{.*\})/.exec(out);
    return m ? JSON.parse(m[1]) : { ok: false, out: null, err: "çıktı yok" };
  } catch (e) { return { ok: false, out: null, err: (e as Error).message }; }
}

function statik(): void {
  const r = oku("src/routes/read-only-db.routes.ts");
  check("§1a ⭐ uç zinciri router.use(verifyToken, requirePermission(admin:settings), requireSystemAccountOr404)",
    /router\.use\(verifyToken, requirePermission\("admin:settings"\), requireSystemAccountOr404\);/.test(r)
    && !/requireSystemAccountWhenPresent/.test(r));
  const app = oku("src/app.ts");
  const i = app.indexOf('app.use("/api/admin/read-only-db", readOnlyDbRoutes)');
  check("§1b genel /api/admin router'ından ÖNCE mount", i > 0 && i < app.indexOf('app.use("/api/admin", adminRoutes)'));
  const s = oku("src/services/read-only-db.service.ts");
  check("§1c servis parolayı saklamaz (prisma yazma çağrısı yok, yalnız definer fonksiyon)",
    !/prisma\.\w+\.(create|update|upsert)/.test(s) && /okuma_rolu_parola\(\$\{verifier\}\)/.test(s));
}

/** Uç zincirini sahte istekle koşar: ilk hata ya da "geçti". */
async function ucKapisi(isSystemAccount: boolean): Promise<number> {
  const stack = readOnlyDbRouter.stack;
  const req = { user: { userId: "00000000-0000-4000-8000-000000000001", permissions: ["admin:settings", "admin:users"] },
    isSystemAccount, headers: {}, params: {}, query: {}, body: {} } as unknown as Request;
  for (const l of stack.filter((x) => !x.route).slice(1)) { // [0] = verifyToken; kimlik burada simüle
    const e = await new Promise<unknown>((res) => { void l.handle(req, {} as Response, ((err?: unknown) => res(err ?? null)) as NextFunction); });
    if (e) return e instanceof AppError ? e.statusCode : 500;
  }
  return 200;
}

async function main(): Promise<void> {
  console.log("=== G5 yalnız-okuma DB rolü ===\n");
  statik();
  check("§7a ⭐ fabrika yöneticisi (admin:settings, sistem hesabı değil) → 403", (await ucKapisi(false)) === 403);
  check("§7b sistem hesabı kapıdan geçer", (await ucKapisi(true)) === 200);

  const engel = hedefDbEngeli();
  if (engel) { check("hedef DB kapısı", false, engel); return; }
  const ownerUrl = process.env.DATABASE_URL as string;
  const uyg = `tekserp_g5u${process.pid}_test`;
  const okr = `tekserp_g5o${process.pid}_test`;
  const sahip = new Client({ connectionString: pgUrl(ownerUrl) });
  await sahip.connect();
  const roleExists = async (ad: string) => (await sahip.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [ad])).rowCount === 1;
  try {
    // ── §2 sır sınıflandırması (göç uygulanmış şema) ──
    const kol = (await sahip.query(`SELECT c.relname AS t, a.attname AS k FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m')
      AND a.attnum > 0 AND NOT a.attisdropped`)).rows as Array<{ t: string; k: string }>;
    const siniflanmamis = kol.filter(({ t, k }) => SECRET_NAME_PATTERN.test(k) && !READ_ONLY_HIDDEN_TABLES.includes(t)
      && !(READ_ONLY_HIDDEN_COLUMNS[t] ?? []).includes(k) && !READ_ONLY_NOT_SECRET_COLUMNS.includes(k)).map(({ t, k }) => `${t}.${k}`);
    check("§2a ⭐ sır adı taşıyan her kolon sınıflandırılmış (hariç ya da SIR_DEGIL)", siniflanmamis.length === 0, siniflanmamis.join(", "));
    const tablolar = new Set(kol.map((x) => x.t));
    const bayat = [
      ...READ_ONLY_HIDDEN_TABLES.filter((t) => !tablolar.has(t)),
      ...Object.entries(READ_ONLY_HIDDEN_COLUMNS).flatMap(([t, ks]) => ks.filter((k) => !kol.some((x) => x.t === t && x.k === k)).map((k) => `${t}.${k}`)),
      ...READ_ONLY_NOT_SECRET_COLUMNS.filter((k) => !kol.some((x) => x.k === k)),
    ];
    check("§2b listelerde bayat ad yok (şemada olmayan tablo/kolon)", bayat.length === 0, bayat.join(", "));

    // ── §3 göç ──
    const log: string[] = [];
    const g = await runRoleMigration({ ownerUrl, rol: uyg, readRole: okr, uygula: true, log: (m) => log.push(m) });
    check("§3a göç çıkış 0, okuma rolü 'hazir'", g.kod === EXIT_OK && g.readResult === "ready", `${g.kod}/${g.readResult}`);
    check("§3b ihlal ölçümü boş", (await readRoleViolations(sahip, okr)).length === 0);
    const appUrl = g.appUrl ?? "";

    // Parola: uygulama rolüyle definer fonksiyon (servisin yolu).
    const parola1 = "Bekci-G5-" + process.pid + "-birinci";
    const u = new Client({ connectionString: pgUrl(appUrl) });
    await u.connect();
    let p2 = "";
    try {
      await u.query("SELECT okuma_rolu_parola($1)", [scramVerifier(parola1)]);
      await u.query("BEGIN");
      const enj = await hataKodu(u, `SELECT okuma_rolu_parola('x'' SUPERUSER; --')`);
      await u.query("ROLLBACK");
      check("§4a ⭐ bozuk doğrulayıcı (enjeksiyon) → 22023", enj === "22023", enj);
      const o = new Client({ connectionString: rolUrl(ownerUrl, okr, parola1) });
      await o.connect();
      try {
        await o.query("BEGIN READ WRITE"); // salt-okur varsayılanı aşılsa bile yetki tutmalı
        for (const [ad, sql] of [
          ["SELECT users.passwordHash", `SELECT "passwordHash" FROM users LIMIT 1`],
          ["SELECT users.totpSecret", `SELECT "totpSecret" FROM users LIMIT 1`],
          ["SELECT users.quickPinDigest", `SELECT "quickPinDigest" FROM users LIMIT 1`],
          ["SELECT users.systemAccountSeal", `SELECT "systemAccountSeal" FROM users LIMIT 1`],
          ["SELECT * FROM users", `SELECT * FROM users LIMIT 1`],
          ["SELECT system_settings", `SELECT * FROM system_settings LIMIT 1`],
          ["SELECT totp_enrollments", `SELECT * FROM totp_enrollments LIMIT 1`],
          ["SELECT devices.proofSalt", `SELECT "proofSalt" FROM devices LIMIT 1`],
          ["SELECT machine_collectors.secretSeed", `SELECT "secretSeed" FROM machine_collectors LIMIT 1`],
          ["INSERT customers", `INSERT INTO customers (id, name, "updatedAt") VALUES (gen_random_uuid(), 'x', now())`],
          ["UPDATE users", `UPDATE users SET "fullName" = 'x' WHERE false`],
          ["DELETE rolls", `DELETE FROM rolls WHERE false`],
          ["INSERT system_logs", `INSERT INTO system_logs (id, category, action, "tableName", "recordId") VALUES (gen_random_uuid(), 'SYSTEM', 'X', 'X', 'x')`],
          ["TRUNCATE system_log_archives", `TRUNCATE system_log_archives`],
          ["definer audit_arsivle", `SELECT audit_arsivle(now() - interval '100 years', 1)`], // tz-ok: bekçi
          ["definer audit_arsiv_buda", `SELECT audit_arsiv_buda(now() - interval '100 years')`], // tz-ok: bekçi
          ["definer okuma_rolu_parola (kendi parolası)", `SELECT okuma_rolu_parola('x')`],
          ["CREATE TABLE", `CREATE TABLE g5_okuma_sonda (x int)`],
          // Kilit DoS: fabrika uzayını (8039 audit zinciri, 8023 sevkiyat kapsamı) oturum boyu tutamaz.
          ["pg_advisory_lock(8039, 0)", `SELECT pg_advisory_lock(8039, 0)`],
          ["pg_advisory_lock(bigint)", `SELECT pg_advisory_lock(8023::bigint)`],
          ["pg_advisory_lock_shared(8039, 0)", `SELECT pg_advisory_lock_shared(8039, 0)`],
          ["pg_try_advisory_lock(8039, 0)", `SELECT pg_try_advisory_lock(8039, 0)`],
          ["pg_advisory_xact_lock(8039, 0)", `SELECT pg_advisory_xact_lock(8039, 0)`],
          ["pg_advisory_unlock_all()", `SELECT pg_advisory_unlock_all()`],
        ] as const) {
          const k = await hataKodu(o, sql);
          check(`§4b ⭐ okuma rolü: ${ad} → reddedilir (42501)`, k === "42501", k);
        }
        check("§4c iş tabloları okunur (rolls · system_logs · users kimlik kolonları)",
          await hataKodu(o, `SELECT count(*) FROM rolls`) === "ok"
          && await hataKodu(o, `SELECT count(*) FROM system_logs`) === "ok"
          && await hataKodu(o, `SELECT id, username, "fullName", "isActive" FROM users LIMIT 1`) === "ok");
        await o.query("ROLLBACK");
        const ro = (await o.query("SHOW default_transaction_read_only")).rows[0].default_transaction_read_only;
        check("§4d savunma katmanı: varsayılan işlem salt-okur", ro === "on", ro);
      } finally { await o.end(); }
      await u.query("BEGIN");
      const ak = await hataKodu(u, `SELECT pg_advisory_xact_lock(8039, 0), pg_try_advisory_lock(8039::bigint), pg_advisory_unlock(8039::bigint)`);
      await u.query("ROLLBACK");
      check("§4f ⭐ uygulama rolü advisory kilit alır/bırakır (açık GRANT)", ak === "ok", ak);
      p2 = "Bekci-G5-" + process.pid + "-ikinci";
      await u.query("SELECT okuma_rolu_parola($1)", [scramVerifier(p2)]);
      check("§4e ⭐ yenileme eski parolayı geçersiz kılar (28P01), yenisi girer",
        await baglanKodu(rolUrl(ownerUrl, okr, parola1)) === "28P01" && await baglanKodu(rolUrl(ownerUrl, okr, p2)) === "ok");
    } finally { await u.end(); }

    // ── §5 sonda: kaçak ölçülür, yeniden koşum onarır ──
    await sahip.query(`GRANT SELECT ("passwordHash") ON users TO "${okr}"`);
    await sahip.query(`GRANT INSERT ON rolls TO "${okr}"`);
    await sahip.query(`GRANT EXECUTE ON FUNCTION audit_arsivle(timestamptz, integer) TO PUBLIC`);
    await sahip.query(`GRANT EXECUTE ON FUNCTION pg_catalog.pg_advisory_lock(bigint) TO PUBLIC`);
    const ih = await readRoleViolations(sahip, okr);
    check("§5a ⭐ sonda: sır kolonu · DML · PUBLIC definer · PUBLIC advisory kaçağı ölçümde görünür",
      ih.includes("sir-kolon:users.passwordHash") && ih.includes("yazma:rolls") && ih.some((x) => x.startsWith("definer:audit_arsivle"))
      && ih.includes("advisory:pg_advisory_lock(bigint)"), ih.join(", "));
    const g2 = await runRoleMigration({ ownerUrl, rol: uyg, readRole: okr, uygula: true, log: () => undefined });
    check("§5b ⭐ yeniden koşum onarır (ihlal 0) ve parolaya dokunmaz",
      g2.readResult === "ready" && (await readRoleViolations(sahip, okr)).length === 0 && await baglanKodu(rolUrl(ownerUrl, okr, p2)) === "ok");

    // ── §6 servis (uygulama rolüyle) ──
    const aktor = (await sahip.query(`SELECT id FROM users WHERE "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1`)).rows[0]?.id as string | undefined;
    const s1 = servis(appUrl, `s.rotateReadOnlyDbPassword(${aktor ? JSON.stringify(aktor) : "undefined"}, "127.0.0.1")`);
    const out = s1.out as { password?: string; status?: { state?: string; role?: string; passwordRotatedAt?: string | null } } | null;
    const yeni = out?.password ?? "";
    check("§6a ⭐ yenile-ve-göster: parola döner, rol HAZIR, damga dolu, parola girer",
      s1.ok && yeni.length >= 32 && out?.status?.state === "HAZIR" && out.status.role === okr && !!out.status.passwordRotatedAt
      && await baglanKodu(rolUrl(ownerUrl, okr, yeni)) === "ok", JSON.stringify({ ok: s1.ok, err: s1.err, st: out?.status?.state }));
    const satir = (await sahip.query(`SELECT row_to_json(l)::text AS j FROM system_logs l
      WHERE action = 'READ_ONLY_DB_PASSWORD_ROTATED' AND "recordId" = $1 ORDER BY "createdAt" DESC LIMIT 1`, [okr])).rows[0]?.j ?? "";
    check("§6b ⭐ audit satırı var; parola ve SCRAM doğrulayıcısı audit'e GİRMEZ",
      satir.length > 0 && !!yeni && !satir.includes(yeni) && !satir.includes("SCRAM-SHA-256"), satir ? "" : "satır yok");
    const durum = servis(appUrl, "s.getReadOnlyDbStatus()");
    check("§6c durum yanıtı parola taşımaz", durum.ok && !!yeni && !JSON.stringify(durum.out).includes(yeni));
    await sahip.query(`DROP FUNCTION IF EXISTS public.okuma_rolu_parola(text)`);
    const yok = servis(appUrl, "s.getReadOnlyDbStatus()");
    const yok2 = servis(appUrl, "s.rotateReadOnlyDbPassword(undefined, null)");
    check("§6d fonksiyon yoksa KURULUMDA_YOK ve yenileme 409 READ_ONLY_DB_UNAVAILABLE",
      (yok.out as { state?: string } | null)?.state === "KURULUMDA_YOK" && !yok2.ok && yok2.err === "READ_ONLY_DB_UNAVAILABLE",
      JSON.stringify({ d: (yok.out as { state?: string } | null)?.state, e: yok2.err }));
  } finally {
    await sahip.query(`DROP FUNCTION IF EXISTS public.okuma_rolu_parola(text)`).catch(() => undefined);
    // Test DB'yi bulunduğu gibi bırak: aynı DB'de sonraki bekçilerin rolleri advisory kilidi PUBLIC'ten alır.
    for (const r of (await sahip.query(ADVISORY_FUNCTION_SQL)).rows) {
      await sahip.query(`GRANT EXECUTE ON FUNCTION pg_catalog.${String(r.f)} TO PUBLIC`).catch(() => undefined);
    }
    for (const r of [okr, uyg]) {
      if (await roleExists(r)) {
        await sahip.query(`DROP OWNED BY "${r}"`).catch(() => undefined);
        await sahip.query(`DROP ROLE "${r}"`).catch((e) => console.log(`! ${r} silinemedi: ${(e as Error).message}`));
      }
    }
    check("temizlik: test rolleri yok", !(await roleExists(okr)) && !(await roleExists(uyg)));
    await sahip.end();
  }
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(() => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
