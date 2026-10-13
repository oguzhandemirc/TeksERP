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
// uygulama rolünde writeOnly, sahip rolünde değil.
// Rol küme geneli: ad koşuma özgü (`_test` sonekli), finally'de DROP OWNED + DROP ROLE.
// =============================================================================
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AUDIT_TAMPER_SQL } from "../src/lib/audit-koruma-sql";
import { EXIT_OK, EXIT_NOT_APPLICABLE, runRoleMigration, measureRoleState } from "../src/lib/db-rol-gocu";
import { ADVISORY_FUNCTION_SQL } from "../src/lib/okuma-rolu";

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
}

async function hataKodu(c: Client, sql: string): Promise<string> {
  await c.query("SAVEPOINT s");
  try { await c.query(sql); await c.query("RELEASE SAVEPOINT s"); return "ok"; }
  catch (e) { await c.query("ROLLBACK TO SAVEPOINT s"); return String((e as { code?: string }).code ?? (e as Error).message); }
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

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(() => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(fail > 0 ? 1 : 0);
  });
