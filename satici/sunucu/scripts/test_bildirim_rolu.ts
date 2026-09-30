// =============================================================================
// BİLDİRİM GÖNDERİCİ ROLÜ — en az yetki (göç `20261001130000`): `satici_bildirim` YALNIZ `bildirim`de SELECT +
// durum kolonlarında UPDATE taşır; gönderici yan konteyner bu rolle (ya da üyesiyle) bağlanır.
//   §1 rol öznitelikleri: süper kullanıcı · RLS atlama · rol/DB yaratma YOK
//   §2 statik: göçün kolon listesi = koddaki `SENDER_UPDATE_COLUMNS` (gönderici yalnız bunları yazar)
//   §3 yetki ızgarası (üyelikten gelenler dahil): HER tablo × HER tablo yetkisi (türler sunucu kataloğundan) · her
//      kolon UPDATE'i · her dizi — beklenen TAM küme dışında hiçbir şey
//   §4 canlı: rolün bağlantısı `bildirim`i okur, durum kolonunu günceller; kurulum/destek/göç tablosu okuma, satır
//      ekleme/silme, gövde yazma, TRUNCATE, dizi, tablo yaratma → 42501
//   §5 girişi açan yol (`enableSenderLogin` / `role-cli`): parola stdin'den, SCRAM istemcide (sunucu düz parola
//      görmez; kayıtlı doğrulayıcı SCRAM), biçimsiz parola ve üye olmayan rol RED, parola döndürme eskisini düşürür
//   §6 göçün rol bölümü İKİNCİ kez koşar (aynı kümede başka DB) — hata yok, yetki aynı
// ⭐ KALICI SONDA ✓K (her koşumda): fazladan TEK yetki (kurulum SELECT) verilmiş üye rolde giriş AÇILMAZ ve ızgara
//    o yetkiyi adıyla bulur — ölçüm kör olsaydı giriş açılırdı.
// NEGATİF SONDA (DB'de GRANT/REVOKE ya da dosya DIŞI cp + shasum ile geri alındı): R1 role `govde` UPDATE +
//   `destek_talebi` SELECT verildi → §3a ❌ (gönderici rolü de açılmadı) · R2 ızgara `kurulum`u atlar → §5d ❌ ·
//   R4 SCRAM anahtarları yer değiştirir → giriş 28P01 ❌ · R5 göçün rol bölümü koşulsuz CREATE ROLE → §6a ❌.
// Koşum: npx tsx scripts/test_bildirim_rolu.ts   (yalnız *_test DB)
// =============================================================================
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { SENDER_ROLE, SENDER_UPDATE_COLUMNS, enableSenderLogin, privilegeReport } from "../src/notifications/sender-role";
import { gondericiRoluKur, sahipIstemci, type GondericiRolu } from "./lib/bildirim-rolu";
import { SATICI_KOKU, hedefDbKapisi, kontrol, sonuc } from "./lib/test-ortam";

const GOC = path.join(SATICI_KOKU, "prisma", "migrations", "20261001130000_bildirim_giden_kutusu", "migration.sql");
/** Gönderici rolüne kolon yetkisi veren göçler (sırayla); `SENDER_UPDATE_COLUMNS` bunların birleşimidir. */
const YETKI_GOCLERI = ["20261001130000_bildirim_giden_kutusu", "20261001130100_bildirim_sohbet_tasinmasi"].map((d) => path.join(SATICI_KOKU, "prisma", "migrations", d, "migration.sql"));

async function yetkiHatasi(c: Client, sql: string): Promise<string> {
  try {
    await c.query(sql);
    return "İZİNLİ";
  } catch (err) {
    return (err as { code?: string }).code ?? "HATA";
  }
}

async function baglan(url: string): Promise<Client> {
  const c = new Client({ connectionString: url });
  await c.connect();
  return c;
}

async function roleCli(rol: string, stdin: string): Promise<{ kod: number | null; cikti: string }> {
  const s = spawn(process.execPath, ["--import", "tsx", "src/notifications/role-cli.ts", `--rol=${rol}`], {
    cwd: SATICI_KOKU,
    env: { PATH: process.env.PATH ?? "", DATABASE_URL: process.env.DATABASE_URL ?? "" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let cikti = "";
  s.stdout!.on("data", (c: Buffer) => (cikti += c.toString("utf8")));
  s.stderr!.on("data", (c: Buffer) => (cikti += c.toString("utf8")));
  s.stdin!.end(stdin);
  const kod = await new Promise<number | null>((r) => s.once("exit", (k) => r(k)));
  return { kod, cikti };
}

async function main(): Promise<void> {
  const db = hedefDbKapisi();
  const sahip = await sahipIstemci();
  const roller: string[] = [];
  let rol: GondericiRolu | null = null;
  try {
    console.log("\n§1 rol öznitelikleri");
    const a = (await sahip.query<{ s: boolean; b: boolean; c: boolean; d: boolean }>("SELECT rolsuper AS s, rolbypassrls AS b, rolcreaterole AS c, rolcreatedb AS d FROM pg_roles WHERE rolname = $1", [SENDER_ROLE])).rows[0];
    kontrol("§1a satici_bildirim var; süper kullanıcı · RLS atlama · rol/DB yaratma YOK", !!a && !a.s && !a.b && !a.c && !a.d, JSON.stringify(a));

    console.log("\n§2 statik");
    const goc = readFileSync(GOC, "utf8");
    const metinler = YETKI_GOCLERI.map((p) => readFileSync(p, "utf8"));
    const kolonlar = metinler.flatMap((m) => [...m.matchAll(/GRANT UPDATE \(([^)]+)\) ON "bildirim"/g)].flatMap((g) => [...g[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!)));
    kontrol("§2a göçlerin UPDATE kolonları (birleşim, sırayla) = SENDER_UPDATE_COLUMNS", JSON.stringify(kolonlar) === JSON.stringify([...SENDER_UPDATE_COLUMNS]), kolonlar.join(","));
    const hepsi = metinler.join("\n");
    kontrol("§2b göçler tabloyu yalnız SELECT ile verir (INSERT/DELETE/tam UPDATE yok)", /GRANT SELECT ON "bildirim" TO "satici_bildirim";/.test(goc) && !/GRANT (INSERT|DELETE|ALL)/.test(hepsi) && !/GRANT UPDATE ON/.test(hepsi));

    console.log("\n§3 yetki ızgarası");
    const temel = await privilegeReport(sahip, SENDER_ROLE);
    kontrol("§3a satici_bildirim: fazla yok · eksik yok (her tablo × her yetki · kolon · dizi)", temel.extra.length === 0 && temel.missing.length === 0 && temel.tables >= 30, `${temel.tables} tablo · fazla ${temel.extra.join(",") || "-"} · eksik ${temel.missing.join(",") || "-"}`);
    rol = await gondericiRoluKur();
    roller.push(rol.rol);
    const uye = await privilegeReport(sahip, rol.rol);
    kontrol("§3b üye rol (bekçinin gönderici rolü) aynı küme — yetki yalnız üyelikten", uye.extra.length === 0 && uye.missing.length === 0, `${uye.extra.join(",")}`);

    console.log("\n§4 canlı sorgular (rolün kendi bağlantısı)");
    const c = await baglan(rol.url);
    try {
      const izinli = [
        await yetkiHatasi(c, `SELECT count(*) FROM "bildirim"`),
        await yetkiHatasi(c, `UPDATE "bildirim" SET "durum" = 'HATA', "sonHata" = 'X' WHERE false`),
      ];
      kontrol("§4a bildirim okunur, durum kolonları güncellenir", izinli.every((x) => x === "İZİNLİ"), izinli.join(","));
      const yasak = {
        kurulum: await yetkiHatasi(c, `SELECT count(*) FROM "kurulum"`),
        destek: await yetkiHatasi(c, `SELECT "aciklama" FROM "destek_talebi" LIMIT 1`),
        goc: await yetkiHatasi(c, `SELECT count(*) FROM "_prisma_migrations"`),
        ekle: await yetkiHatasi(c, `INSERT INTO "bildirim" ("id","olay","kanal","tekillikAnahtari","govde","updatedAt") VALUES (gen_random_uuid(),'DENEME','EPOSTA','DENEME:x','{"portalYolu":"/"}',now())`),
        govde: await yetkiHatasi(c, `UPDATE "bildirim" SET "govde" = '{}' WHERE false`),
        olay: await yetkiHatasi(c, `UPDATE "bildirim" SET "olay" = 'DENEME' WHERE false`),
        sil: await yetkiHatasi(c, `DELETE FROM "bildirim" WHERE false`),
        bosalt: await yetkiHatasi(c, `TRUNCATE "bildirim"`),
        dizi: await yetkiHatasi(c, `SELECT nextval('destek_talep_no_seq')`),
        tablo: await yetkiHatasi(c, `CREATE TABLE "bekci_yasak" (x int)`),
      };
      kontrol("§4b başka tablo · ekleme · silme · gövde/olay yazımı · TRUNCATE · dizi · tablo yaratma → 42501", Object.values(yasak).every((x) => x === "42501"), JSON.stringify(yasak));
    } finally {
      await c.end();
    }

    console.log("\n§5 girişi açan yol");
    const kayitli = (await sahip.query<{ p: string | null }>("SELECT rolpassword AS p FROM pg_authid WHERE rolname = $1", [rol.rol])).rows[0]?.p ?? "";
    kontrol("§5a kayıtlı parola SCRAM doğrulayıcısı (düz parola sunucuda YOK)", /^SCRAM-SHA-256\$4096:/.test(kayitli) && !kayitli.includes(rol.parola));
    const hatali = async (g: { role: string; password: string }): Promise<string> => {
      try {
        await enableSenderLogin(sahip, g);
        return "AÇILDI";
      } catch (err) {
        return (err as Error).message;
      }
    };
    const kisa = await hatali({ role: rol.rol, password: "abc" });
    const tirnak = await hatali({ role: rol.rol, password: `${"a".repeat(40)}'; DROP ROLE x; --` });
    kontrol("§5b biçimsiz parola (kısa · harf/rakam dışı) RED — rol değişmez", /32–128/.test(kisa) && /32–128/.test(tirnak));
    const yabanci = `sat_bld_${randomBytes(5).toString("hex")}`;
    roller.push(yabanci);
    await sahip.query(`CREATE ROLE "${yabanci}" NOLOGIN`);
    kontrol("§5c satici_bildirim üyesi olmayan role giriş AÇILMAZ", /üyesi değil/.test(await hatali({ role: yabanci, password: randomBytes(20).toString("hex") })));
    const fazla = `sat_bld_${randomBytes(5).toString("hex")}`;
    roller.push(fazla);
    await sahip.query(`CREATE ROLE "${fazla}" NOLOGIN IN ROLE "${SENDER_ROLE}"`);
    await sahip.query(`GRANT SELECT ON "kurulum" TO "${fazla}"`);
    const fazlaMesaj = await hatali({ role: fazla, password: randomBytes(20).toString("hex") });
    const girisAcik = (await sahip.query<{ l: boolean }>("SELECT rolcanlogin AS l FROM pg_roles WHERE rolname = $1", [fazla])).rows[0]?.l;
    kontrol("§5d ✓K fazladan TEK yetki (kurulum SELECT) → giriş AÇILMAZ, ızgara yetkiyi adıyla bulur", /fazla: kurulum:SELECT/.test(fazlaMesaj) && girisAcik === false, fazlaMesaj.slice(0, 120));
    const yeni = randomBytes(24).toString("hex");
    const cli = await roleCli(rol.rol, `${yeni}\n`);
    const eski = new URL(rol.url);
    const yeniUrl = new URL(rol.url);
    yeniUrl.password = yeni;
    const eskiyle = await baglan(eski.toString()).then((k) => k.end().then(() => "BAGLANDI"), (err: { code?: string }) => err.code ?? "HATA");
    const yeniyle = await baglan(yeniUrl.toString()).then((k) => k.end().then(() => "BAGLANDI"), (err: { code?: string }) => err.code ?? "HATA");
    kontrol(
      "§5e role-cli (parola stdin'den): giriş açık, parola döner — yeni parola bağlanır, eskisi 28P01; çıktıda parola YOK",
      cli.kod === 0 && /giriş açık/.test(cli.cikti) && !cli.cikti.includes(yeni) && yeniyle === "BAGLANDI" && eskiyle === "28P01",
      `${cli.kod} · eski=${eskiyle} yeni=${yeniyle} · ${cli.cikti.trim()}`,
    );
    const bos = await roleCli(rol.rol, "");
    kontrol("§5f role-cli boş stdin → RED (çıkış 1)", bos.kod === 1 && /32–128/.test(bos.cikti), bos.cikti.trim());

    console.log("\n§6 göçün rol bölümü ikinci kez");
    // İlk göçün rol bölümü + sonraki göçlerin GRANT satırları, göç sırasıyla (başka DB'de koşan zincirin benzetimi).
    const rolBolumu = [goc.slice(goc.indexOf("DO $$")), ...metinler.slice(1).map((m) => m.split("\n").filter((l) => l.startsWith("GRANT ")).join("\n"))].join("\n");
    let ikinci = "TEMIZ";
    try {
      await sahip.query(rolBolumu);
    } catch (err) {
      ikinci = (err as Error).message;
    }
    const sonra = await privilegeReport(sahip, SENDER_ROLE);
    kontrol(`§6a rol bölümü aynı kümede ikinci kez (başka DB benzetimi, ${db}) hatasız, yetki kümesi aynı`, ikinci === "TEMIZ" && sonra.extra.length === 0 && sonra.missing.length === 0, ikinci);
  } catch (err) {
    kontrol("beklenmeyen hata", false, err instanceof Error ? (err.stack ?? err.message) : String(err));
  } finally {
    for (const r of roller) {
      await sahip.query(`DROP OWNED BY "${r}"`).catch(() => undefined);
      await sahip.query(`DROP ROLE IF EXISTS "${r}"`).catch((err: Error) => console.error(`rol kaldırılamadı (${r}): ${err.message}`));
    }
    await sahip.end();
  }
  sonuc();
}

void main();
