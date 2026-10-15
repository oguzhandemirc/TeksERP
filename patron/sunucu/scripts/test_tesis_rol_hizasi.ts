// =============================================================================
// TESİS ROL PAROLASI HİZASI BEKÇİSİ (PATRON-TESIS-DB §3; `lib/tesis-rol-hizasi.ts`, CLI `tesis-db.ts rol-hizala`).
// Kurgu: A ve B tesisleri eski anahtar K1 ile HAZIR; yeni anahtar K2.
//   §1 anahtar dosyası YOK (açık yol da, dizin yolu da) → çıkış 1, dosya ÜRETİLMEZ, hiçbir rol yazılmaz
//   §2 kuru koşum: A ve B'nin dört rolü uyumsuz listelenir, HİÇ yazmaz, çıktı sırsız
//   §3 uygula: dört rol K2 ile girer, K1 ile 28P01; tesis rolü kendi DB'sine bağlanır, öteki tesisinkine bağlanamaz
//   §4 ikinci koşum zararsız: uyumsuz=0, degisen=0, doğrulayıcılar bayt-eşit (yeniden yazılmadı)
//   §5 HAZIR olmayan tesis (ISTENDI) atlanır, çıkış 1; HAZIR tesisler yine uyumlu
//   §6 doğrulayıcı karşılaştırıcısı: SCRAM + md5 doğru/yanlış parola, boş/tanınmayan biçim uyumsuz
// Uçtan uca (sunucu girişi + ozet-yenile) `test_kimlik_ozet_yenile` §5'tedir.
// Koşum: npx tsx scripts/test_tesis_rol_hizasi.ts
// =============================================================================
import { spawnSync } from "node:child_process";
import crypto, { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import { FacilityDbKey } from "../src/auth/facility-db-key";
import { PG_SESSION_OPTIONS } from "../src/lib/pg-session";
import { requestFacilityDb } from "../src/lib/tesis-db-hazirlik";
import { databaseOf, facilityDbName, facilityRoles, withDatabase } from "../src/lib/tesis-db-ad";
import { verifierMatches } from "../src/lib/tesis-rol-hizasi";
import { dropTestFacilityDb } from "./lib/tesis-db-temizlik";
import { PATRON_KOKU, kontrol, ortamKur, sonuc, temizleTesis, tesisKur, type Ortam } from "./lib/test-ortam";

// Ortam `ortamKur` içinde yüklenir; URL geç okunur.
const goc = (): string => process.env.GOC_DATABASE_URL!;
const dizin = mkdtempSync(path.join(os.tmpdir(), "patron-rol-hiza-"));
process.on("exit", () => rmSync(dizin, { recursive: true, force: true }));
const K2_DOSYA = path.join(dizin, "yeni-tesis-db.key");
const K2 = FacilityDbKey.load(K2_DOSYA, { create: true });

function cli(apply: boolean, env: Record<string, string> = { TESIS_ROL_ANAHTARI_DOSYASI: K2_DOSYA }): { code: number; out: string } {
  const r = spawnSync("npx", ["tsx", "scripts/tesis-db.ts", "rol-hizala", ...(apply ? ["--apply"] : [])], { cwd: PATRON_KOKU, encoding: "utf8", env: { ...process.env, ...env } });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}
const sirsiz = (out: string) => !/[0-9a-f]{64}/.test(out) && !out.includes("SCRAM-SHA-256$");
const rolleri = (tesisId: string) => {
  const r = facilityRoles(facilityDbName(databaseOf(goc()), tesisId));
  return [r.app, r.sync];
};

async function dogrulayicilar(roles: readonly string[]): Promise<string> {
  const c = new Client({ connectionString: goc(), options: PG_SESSION_OPTIONS });
  await c.connect();
  try {
    const r = await c.query<{ rolname: string; rolpassword: string | null }>(`SELECT rolname, rolpassword FROM pg_authid WHERE rolname = ANY($1::text[]) ORDER BY rolname`, [roles]);
    return JSON.stringify(r.rows);
  } finally {
    await c.end();
  }
}

/** Rolün türetilmiş parolasıyla tesis DB'sine giriş: "ok" ya da PG hata kodu. */
async function baglan(tesisId: string, role: string, key: FacilityDbKey, hedefTesis = tesisId): Promise<string> {
  const url = withDatabase(goc(), facilityDbName(databaseOf(goc()), hedefTesis), { user: role, password: key.rolePassword(role) });
  const c = new Client({ connectionString: url, options: PG_SESSION_OPTIONS });
  try {
    await c.connect();
    await c.query("SELECT 1");
    return "ok";
  } catch (err) {
    return (err as { code?: string }).code ?? "?";
  } finally {
    await c.end().catch(() => undefined);
  }
}

async function anahtarYok(roles: readonly string[]): Promise<void> {
  console.log("\n§1 anahtar dosyası yoksa durur");
  const once = await dogrulayicilar(roles);
  const yok = path.join(dizin, "olmayan.key");
  const r1 = cli(true, { TESIS_ROL_ANAHTARI_DOSYASI: yok });
  kontrol("§1a ⭐ açık yol yok → çıkış 1, dosya üretilmedi", r1.code === 1 && !existsSync(yok) && r1.out.includes("Tesis DB anahtarı yok"), r1.out.slice(-200));
  const bos = mkdtempSync(path.join(dizin, "bos-"));
  const r2 = cli(true, { TESIS_ROL_ANAHTARI_DOSYASI: "", ANAHTAR_DIZINI: bos });
  kontrol("§1b ⭐ dizin yolu (açık sır yok) da ÜRETMEZ → çıkış 1, dosya yok", r2.code === 1 && !existsSync(path.join(bos, "patron-tesis-db.key")), r2.out.slice(-200));
  kontrol("§1c hiçbir rol yazılmadı", (await dogrulayicilar(roles)) === once);
}

async function kuru(a: string, b: string, roles: readonly string[]): Promise<void> {
  console.log("\n§2 kuru koşum");
  const once = await dogrulayicilar(roles);
  const r = cli(false);
  const satir = (t: string, rol: string) => r.out.includes(`uyumsuz ${t} `) && r.out.includes(`rol=${rol}`);
  kontrol("§2a ⭐ A ve B'nin dört rolü uyumsuz listelenir · çıkış 0 · `kip=kuru`", r.code === 0 && rolleri(a).every((x) => satir(a, x)) && rolleri(b).every((x) => satir(b, x)) && r.out.includes("PATRON_ROL_HIZALA kip=kuru"), r.out.slice(-400));
  kontrol("§2b ⭐ kuru koşum HİÇ yazmadı (doğrulayıcılar bayt-eşit)", (await dogrulayicilar(roles)) === once);
  kontrol("§2c çıktı sırsız (parola/doğrulayıcı yok)", sirsiz(r.out));
  kontrol("§2d K2 ile giriş hâlâ 28P01 (ölçüm sondası: PG parola istiyor)", (await baglan(a, rolleri(a)[0]!, K2)) === "28P01");
}

async function uygula(o: Ortam, a: string, b: string): Promise<void> {
  console.log("\n§3 uygula");
  const r = cli(true);
  kontrol("§3a uygula çıkış 0 · degisen ≥ 4 · uyumsuz=0", r.code === 0 && /kip=uygula .*uyumsuz=0 .*degisen=([4-9]|\d{2,})/.test(r.out), r.out.slice(-300));
  kontrol("§3b çıktı sırsız", sirsiz(r.out));
  const yeni = await Promise.all([...rolleri(a).map((x) => baglan(a, x, K2)), ...rolleri(b).map((x) => baglan(b, x, K2))]);
  kontrol("§3c ⭐ dört rol K2 parolasıyla kendi tesis DB'sine girer", yeni.every((x) => x === "ok"), yeni.join(","));
  const eski = await Promise.all(rolleri(a).map((x) => baglan(a, x, o.anahtar)));
  kontrol("§3d ⭐ K1 parolası artık 28P01", eski.every((x) => x === "28P01"), eski.join(","));
  const capraz = await baglan(a, rolleri(a)[0]!, K2, b);
  kontrol("§3e A'nın rolü B'nin DB'sine bağlanamaz (CONNECT yetkisi korunur)", capraz === "42501", capraz);
}

async function ikinci(roles: readonly string[]): Promise<void> {
  console.log("\n§4 ikinci koşum zararsız");
  const once = await dogrulayicilar(roles);
  const k = cli(false);
  kontrol("§4a kuru: uyumsuz=0", k.code === 0 && k.out.includes("uyumsuz=0"), k.out.slice(-200));
  const u = cli(true);
  kontrol("§4b ⭐ uygula: degisen=0 · çıkış 0", u.code === 0 && u.out.includes("degisen=0"), u.out.slice(-200));
  kontrol("§4c ⭐ doğrulayıcılar bayt-eşit (rol yeniden yazılmadı)", (await dogrulayicilar(roles)) === once);
}

async function hazirDegil(a: string): Promise<void> {
  console.log("\n§5 HAZIR olmayan tesis atlanır");
  const t = randomUUID();
  const c = new Client({ connectionString: goc(), options: PG_SESSION_OPTIONS });
  await c.connect();
  try {
    await requestFacilityDb(c, t);
  } finally {
    await c.end();
  }
  try {
    const k = cli(false);
    kontrol("§5a ⭐ kuru: ISTENDI tesis atlandı listede · çıkış 1", k.code === 1 && k.out.includes(`atlandı ${t}`) && k.out.includes("durum=ISTENDI"), k.out.slice(-300));
    const u = cli(true);
    kontrol("§5b ⭐ uygula: atlandı · çıkış 1 · HAZIR tesisler yine uyumlu", u.code === 1 && u.out.includes(`atlandı ${t}`) && (await baglan(a, rolleri(a)[0]!, K2)) === "ok", u.out.slice(-300));
  } finally {
    await dropTestFacilityDb(goc(), t);
  }
}

function karsilastirici(): void {
  console.log("\n§6 doğrulayıcı karşılaştırıcısı");
  const rol = "bekci_rol";
  const parola = K2.rolePassword(rol);
  const salt = crypto.randomBytes(16);
  const salted = crypto.pbkdf2Sync(parola, salt, 4096, 32, "sha256");
  const stored = crypto.createHash("sha256").update(crypto.createHmac("sha256", salted).update("Client Key").digest()).digest();
  const server = crypto.createHmac("sha256", salted).update("Server Key").digest();
  const scram = `SCRAM-SHA-256$4096:${salt.toString("base64")}$${stored.toString("base64")}:${server.toString("base64")}`;
  const md5 = `md5${crypto.createHash("md5").update(`${parola}${rol}`).digest("hex")}`;
  kontrol("§6a SCRAM doğru parola uyumlu, yanlış uyumsuz", verifierMatches(scram, rol, parola) && !verifierMatches(scram, rol, `${parola}x`));
  kontrol("§6b md5 doğru parola uyumlu, yanlış rol adı uyumsuz", verifierMatches(md5, rol, parola) && !verifierMatches(md5, "baska_rol", parola));
  kontrol("§6c boş/tanınmayan biçim uyumsuz", !verifierMatches(null, rol, parola) && !verifierMatches("", rol, parola) && !verifierMatches(parola, rol, parola));
}

async function main(): Promise<void> {
  karsilastirici();
  const o = await ortamKur();
  const tesisler: string[] = [];
  try {
    const a = (await tesisKur(o, { ad: "Rol Alfa" })).tesisId;
    tesisler.push(a);
    const b = (await tesisKur(o, { ad: "Rol Beta" })).tesisId;
    tesisler.push(b);
    const roles = [...rolleri(a), ...rolleri(b)];
    kontrol("§0 kurgu: roller K1 ile girer", (await baglan(a, rolleri(a)[0]!, o.anahtar)) === "ok");
    await anahtarYok(roles);
    await kuru(a, b, roles);
    await uygula(o, a, b);
    await ikinci(roles);
    await hazirDegil(a);
  } finally {
    for (const t of tesisler) await temizleTesis(o, t);
    await o.kapat();
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
