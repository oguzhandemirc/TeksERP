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
//   §7 ızgaranın ötesi (girişi açan yol ve göndericinin açılış kapısı AYNI ölçüm): REPLICATION özniteliği · önceden
//      tanımlı rol üyeliği (pg_read/write_server_files · pg_execute_server_program) ve herhangi bir rol üyeliği · public
//      dışı şema USAGE / public CREATE · public dışı şemada fonksiyon · public'te SECURITY DEFINER ya da açık GRANT'lı
//      fonksiyon · veritabanında CREATE → giriş AÇILMAZ; girişi açık rol sonradan üyelik kazanırsa gönderici DURUR
// ⭐ KALICI SONDA ✓K (her koşumda): fazladan TEK yetki (kurulum SELECT) verilmiş üye rolde giriş AÇILMAZ ve ızgara
//    o yetkiyi adıyla bulur — ölçüm kör olsaydı giriş açılırdı · §7'nin on bir sondası adıyla · §7k geri alınınca TAM küme
//    (kör RED değil) · §7l açılış kapısı temizde GEÇER.
// NEGATİF SONDA (DB'de GRANT/REVOKE ya da dosya DIŞI cp + shasum ile geri alındı): R1 role `govde` UPDATE +
//   `destek_talebi` SELECT verildi → §3a ❌ (gönderici rolü de açılmadı) · R2 ızgara `kurulum`u atlar → §5d ❌ ·
//   R4 SCRAM anahtarları yer değiştirir → giriş 28P01 ❌ · R5 göçün rol bölümü koşulsuz CREATE ROLE → §6a ❌ · R6 eski
//   sender-role + sender-db (yalnız ızgara) → §7'nin on iki satırı ❌ (giriş AÇILDI, açılış kapısı GEÇTİ).
// Koşum: npx tsx scripts/test_bildirim_rolu.ts   (yalnız *_test DB)
// =============================================================================
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { assertLeastPrivilege, openSenderDb } from "../src/notifications/sender-db";
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
  const temizlik: string[] = [];
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

    console.log("\n§7 öznitelik · üyelik · şema · fonksiyon · veritabanı yetkisi");
    const ek = randomBytes(4).toString("hex");
    const sema = `bekci_sema_${ek}`;
    temizlik.push(`DROP SCHEMA IF EXISTS "${sema}" CASCADE`, `DROP FUNCTION IF EXISTS public."bekci_tanimlayici_${ek}"()`, `DROP FUNCTION IF EXISTS public."bekci_acik_${ek}"()`);
    const sondalar: [string, (r: string) => string[], RegExp, string[]][] = [
      ["REPLICATION özniteliği", (r) => [`ALTER ROLE "${r}" REPLICATION`], /çoğaltma yapan olamaz/, []],
      ["pg_read_server_files üyeliği", (r) => [`GRANT pg_read_server_files TO "${r}"`], /fazla: [^·]*üyelik pg_read_server_files/, []],
      ["pg_write_server_files üyeliği", (r) => [`GRANT pg_write_server_files TO "${r}"`], /fazla: [^·]*üyelik pg_write_server_files/, []],
      ["pg_execute_server_program üyeliği", (r) => [`GRANT pg_execute_server_program TO "${r}"`], /fazla: [^·]*üyelik pg_execute_server_program/, []],
      ["herhangi bir rol üyeliği", (r) => [`CREATE ROLE "${r}_ust" NOLOGIN`, `GRANT "${r}_ust" TO "${r}"`], /fazla: [^·]*üyelik sat_bld_[0-9a-f]+_ust/, []],
      ["public dışı şemada USAGE", (r) => [`CREATE SCHEMA "${sema}"`, `GRANT USAGE ON SCHEMA "${sema}" TO "${r}"`], new RegExp(`fazla: [^·]*şema ${sema}:USAGE`), [`DROP SCHEMA "${sema}" CASCADE`]],
      ["public şemasında CREATE", (r) => [`GRANT CREATE ON SCHEMA public TO "${r}"`], /fazla: [^·]*şema public:CREATE/, []],
      ["public dışı şemada fonksiyon (PUBLIC EXECUTE)", () => [`CREATE SCHEMA "${sema}"`, `CREATE FUNCTION "${sema}".f() RETURNS int LANGUAGE sql AS 'SELECT 1'`], new RegExp(`fazla: [^·]*fonksiyon ${sema}\\.f:EXECUTE`), [`DROP SCHEMA "${sema}" CASCADE`]],
      ["public'te SECURITY DEFINER fonksiyon", () => [`CREATE FUNCTION public."bekci_tanimlayici_${ek}"() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'`], /fazla: [^·]*\(SECURITY DEFINER\)/, [`DROP FUNCTION public."bekci_tanimlayici_${ek}"()`]],
      ["public'te açık GRANT'lı fonksiyon", (r) => [`CREATE FUNCTION public."bekci_acik_${ek}"() RETURNS int LANGUAGE sql AS 'SELECT 1'`, `REVOKE EXECUTE ON FUNCTION public."bekci_acik_${ek}"() FROM PUBLIC`, `GRANT EXECUTE ON FUNCTION public."bekci_acik_${ek}"() TO "${r}"`], /fazla: [^·]*\(açık yetki\)/, [`DROP FUNCTION public."bekci_acik_${ek}"()`]],
      ["veritabanında CREATE", (r) => [`GRANT CREATE ON DATABASE "${db}" TO "${r}"`], /fazla: [^·]*veritabanı CREATE/, []],
    ];
    for (const [ad, kur, desen, geriAl] of sondalar) {
      const r = `sat_bld_${randomBytes(5).toString("hex")}`;
      roller.push(r, `${r}_ust`);
      await sahip.query(`CREATE ROLE "${r}" NOLOGIN IN ROLE "${SENDER_ROLE}"`);
      for (const sql of kur(r)) await sahip.query(sql);
      const mesaj = await hatali({ role: r, password: randomBytes(20).toString("hex") });
      const rapor = await privilegeReport(sahip, r);
      const giris = (await sahip.query<{ l: boolean }>("SELECT rolcanlogin AS l FROM pg_roles WHERE rolname = $1", [r])).rows[0]?.l;
      for (const sql of geriAl) await sahip.query(sql);
      const raporda = ad.startsWith("REPLICATION") ? rapor.extra.includes("öznitelik REPLICATION") : rapor.extra.length > 0;
      kontrol(`§7 ${ad} → giriş AÇILMAZ, ölçüm fazlayı adıyla bulur (açılış kapısının raporunda da)`, desen.test(mesaj) && giris === false && raporda, `${mesaj.slice(0, 150)} · rapor ${rapor.extra.slice(0, 3).join(",")}`);
    }
    const temiz = await privilegeReport(sahip, SENDER_ROLE);
    kontrol("§7k ✓K sondalar geri alınınca satici_bildirim yine TAM küme (ölçüm her şeyi reddeden kör kapı değil)", temiz.extra.length === 0 && temiz.missing.length === 0, temiz.extra.join(","));

    // Açılış kapısı: girişi AÇIK rol sonradan önceden tanımlı role üye yapılırsa gönderici DURUR (aynı ölçüm, kendi bağlantısından).
    const acik = await gondericiRoluKur();
    roller.push(acik.rol);
    const kapi = async (): Promise<string> => {
      const g = openSenderDb(acik.url);
      try {
        await assertLeastPrivilege(g.prisma);
        return "GECTI";
      } catch (err) {
        return (err as Error).message;
      } finally {
        await g.close();
      }
    };
    const once = await kapi();
    await sahip.query(`GRANT pg_read_server_files TO "${acik.rol}"`);
    const sonra7 = await kapi();
    await sahip.query(`REVOKE pg_read_server_files FROM "${acik.rol}"`);
    await sahip.query(`ALTER ROLE "${acik.rol}" REPLICATION`);
    const cogaltma = await kapi();
    kontrol(
      "§7l açılış kapısı (göndericinin kendi bağlantısı): temiz rol GEÇER · sonradan pg_read_server_files üyeliği → DURUR · REPLICATION → DURUR",
      once === "GECTI" && /FAZLA yetkili \([^)]*üyelik pg_read_server_files/.test(sonra7) && /FAZLA yetkili \([^)]*öznitelik REPLICATION/.test(cogaltma),
      `${once} · ${sonra7.slice(0, 110)} · ${cogaltma.slice(0, 110)}`,
    );
  } catch (err) {
    kontrol("beklenmeyen hata", false, err instanceof Error ? (err.stack ?? err.message) : String(err));
  } finally {
    for (const sql of temizlik) await sahip.query(sql).catch(() => undefined);
    for (const r of roller) {
      await sahip.query(`DROP OWNED BY "${r}"`).catch(() => undefined);
      await sahip.query(`DROP ROLE IF EXISTS "${r}"`).catch((err: Error) => console.error(`rol kaldırılamadı (${r}): ${err.message}`));
    }
    await sahip.end();
  }
  sonuc();
}

void main();
