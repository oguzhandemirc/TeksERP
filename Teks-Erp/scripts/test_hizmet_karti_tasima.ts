// =============================================================================
// BEKÇİ — HİZMET KARTI TAŞIMA MIGRATION'I (`service_items_split`, plan D0)
// Çalıştır: npx tsx scripts/run-all-tests.ts hizmet_karti_tasima
// =============================================================================
// Migration GERİ ALINAMAZ ve canlıda bir kez koşar; davranışı ancak migration ÖNCESİ
// şemada ölçülür. Bekçi geçici bir taban DB'ye bu migration'dan ÖNCEKİ bütün migration'ları
// uygular, TEMPLATE ile senaryo kopyaları açar ve migration SQL'ini dosyadan AYNEN koşar
// (tek çoklu ifade = Prisma'nın uyguladığı gibi örtük tek tx).
// §0 kaynak: kapı DDL'den önce · fiyat taşıma DELETE'ten önce · DEFERRABLE FK'lar düşürülmüyor.
// §1 (a) BOŞ-VERİ yolu: SERVICE'siz DB (ürün + fiyat + satırlar var) 0 hizmetle geçer, kısıtlar kurulur.
// §2 (b) DOLU yol: hizmet + mezar taşı + fiyat/kademe + fatura satırı + 5 hizmet tablosu →
//    sayımlar/UUID/kod/toplamlar eşit (araç: scripts/hizmet-karti-tasima-kontrol.ts).
// §3 (c) CHECK'ler: fatura satırı üç durumu + fiyat konusu + kademe + items SERVICE reddi
//    (her red için önce GEÇERLİ pozitif kontrol — red başka sebepten gelmesin).
// §4 (d) stokta kullanılmış hizmet → migration Türkçe sayılı mesajla DURUR, hiçbir şey değişmez.
// §2g–j saf pivot (inceleme 2026-11-08): hizmete bağlı izinli renk/özellik + müşteri adı satırları kapıyı durdurmaz,
//    migration'da silinir; kontrol aracı onları ve pasif hizmete bağlı taslak fatura satırını ayrı listeler.
// §5 servis kapısı (D1a → inceleme 2026-11-08): ürün kartı SERVICE isteği DB CHECK'ine (500) inmeden hizmet kartı
//    boğazına yönlenir. Negatif sonda: `item.service.ts` yönlendirmesi kaldırılınca §5a kırmızı (CHECK 500).
// Ölçülemezse (süper olmayan DATABASE_URL) yerelde ⏭, CI'da ❌.
// =============================================================================
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { fixtureHedefEngeli, hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { parseDatabaseUrl, quoteIdent, toClientConfig, withDatabase, type PgConn } from "../src/services/helpers/pg-conn.helper";
import { PG_SESSION_OPTIONS } from "../src/lib/pg-session";
import { HIZMET_TABLOLARI, SILINEN_PIVOTLAR, karsilastir, olc } from "./hizmet-karti-tasima-kontrol";

const MIG_DIR = join(__dirname, "..", "prisma", "migrations");
const MIG_AD = "20261107202906_service_items_split";
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
  else console.log(`⏭️  ${neden} — DB katmanı ÖLÇÜLEMEDİ`);
}

const migSql = (): string => readFileSync(join(MIG_DIR, MIG_AD, "migration.sql"), "utf8");
const yorumsuz = (s: string): string => s.replace(/--[^\n]*/g, "");

// =============================================================================
// §0 — kaynak
// =============================================================================
function testKaynak(): void {
  const s = yorumsuz(migSql());
  const kapi = s.indexOf("Hizmet kartı taşıması DURDU");
  const tablo = s.indexOf(`CREATE TABLE "service_items"`);
  const fiyat = s.search(/UPDATE\s+"item_prices"[\s\S]*?SET\s+"serviceItemId"/);
  const satir = s.search(/UPDATE\s+"invoice_lines"[\s\S]*?SET\s+"serviceItemId"/);
  const sil = s.search(/DELETE\s+FROM\s+"items"/);
  check("§0a kapı (RAISE) bütün DDL'den ÖNCE", kapi >= 0 && tablo > kapi && s.slice(0, kapi).search(/\b(CREATE|ALTER|DROP)\s+(TABLE|TYPE|INDEX)\b/) < 0);
  check("§0b fiyat ve fatura satırı taşıması items silmesinden ÖNCE (item_prices.itemId CASCADE)", fiyat > 0 && satir > 0 && sil > fiyat && sil > satir, `fiyat@${fiyat} satır@${satir} sil@${sil}`);
  check("§0c DEFERRABLE FK'lar (rolls/swatches sackId_shipmentId) düşürülmüyor", !/sackId_shipmentId_consistency_fkey/.test(s));
}

// =============================================================================
// DB katmanı
// =============================================================================
const PREFIX = "tekserp_hkt_";
type Sorgu = Pick<Client, "query">;

async function baglan(base: PgConn, db: string): Promise<Client> {
  const c = new Client({ ...toClientConfig(withDatabase(base, db)), options: PG_SESSION_OPTIONS });
  c.on("error", () => {});
  await c.connect();
  return c;
}

async function sweep(su: Client): Promise<void> {
  const dbs = await su.query<{ datname: string }>(`SELECT datname FROM pg_database WHERE datname ~ '^tekserp_hkt_[0-9a-z]+_[a-z]+_test$'`);
  for (const r of dbs.rows) await su.query(`DROP DATABASE IF EXISTS ${quoteIdent(r.datname)} WITH (FORCE)`).catch(() => {});
}

async function tabanKur(base: PgConn, su: Client, db: string): Promise<void> {
  await su.query(`CREATE DATABASE ${quoteIdent(db)} TEMPLATE template0 ENCODING 'UTF8'`);
  const c = await baglan(base, db);
  try {
    const adlar = readdirSync(MIG_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    for (const ad of adlar) {
      if (ad >= MIG_AD) break;
      try {
        await c.query(readFileSync(join(MIG_DIR, ad, "migration.sql"), "utf8"));
      } catch (e) {
        throw new Error(`taban kurulamadı: ${ad} — ${(e as Error).message}`);
      }
    }
  } finally {
    await c.end().catch(() => {});
  }
}

interface Kimlik { [k: string]: string }

/** Migration ÖNCESİ şemaya ham SQL tohumu. Ebeveyn (cari, müşteri, top) zinciri bu bekçinin
 *  konusu değil: `session_replication_role = replica` FK tetiklerini kapatır, CHECK'ler AÇIK kalır. */
async function tohum(c: Sorgu, hizmetli: boolean, stokta: boolean): Promise<Kimlik> {
  const id: Kimlik = {};
  for (const k of ["S1", "S2", "S3", "F1", "C1", "P1", "V1", "N1", "CT", "EA", "INV", "R1", "SBL", "R2"]) id[k] = randomUUID();
  const d = Date.now().toString(36).toUpperCase();
  await c.query("BEGIN");
  await c.query("SET LOCAL session_replication_role = replica");
  const item = (i: string, code: string, name: string, tip: string, mergedIntoId: string | null = null) =>
    c.query(`INSERT INTO "items" ("id","code","name","itemType","unit","mergedIntoId","updatedAt")
             VALUES ($1,$2,$3,$4::"ItemType",'MT',$5,now())`, [i, code, name, tip, mergedIntoId]); // tz-ok: tohum damgası
  await item(id.F1!, `TEST-HKT-F-${d}`, `TEST-HKT KUMAS ${d}`, "FABRIC");
  await item(id.C1!, `TEST-HKT-C-${d}`, `TEST-HKT SARF ${d}`, "CONSUMABLE");
  await c.query(`INSERT INTO "item_prices" ("id","itemId","kind","currency","price","updatedAt") VALUES ($1,$2,'SALE','TRY',100.25,now())`, [randomUUID(), id.F1]); // tz-ok
  await c.query(`INSERT INTO "invoices" ("id","docNo","type","cariId","issueDate","updatedAt") VALUES ($1,$2,'SALES',$3,now(),now())`, [id.INV, `TEST-HKT-${d}`, randomUUID()]); // tz-ok
  const satir = (no: number, itemId: string | null, tutar: string) =>
    c.query(`INSERT INTO "invoice_lines" ("id","invoiceId","lineNo","itemId","description","qty","unitPrice","lineTotal","vatAmount")
             VALUES ($1,$2,$3,$4,'TEST-HKT satır',1,$5,$5,0)`, [randomUUID(), id.INV, no, itemId, tutar]);
  await satir(2, id.F1!, "100.25");
  await satir(3, null, "0");
  if (hizmetli) {
    await item(id.S1!, `STK-HKT${d}`, `TEST-HKT KURSUN ${d}`, "SERVICE");
    // Mezar taşı aynı adı taşır (canlı ad tekilliği mezarı dışarıda bırakır) — soy taşınmalı.
    await item(id.S2!, `STK-HKU${d}`, `TEST-HKT KURSUN ${d}`, "SERVICE", id.S1!);
    await item(id.S3!, `STK-HKV${d}`, `TEST-HKT BRODE ${d}`, "SERVICE");
    await c.query(`UPDATE "items" SET "lifecycleStatus"='ARCHIVED', "isActive"=false WHERE "id"=$1`, [id.S3]);
    await c.query(`INSERT INTO "fabric_properties" ("id","code","name","updatedAt","serviceItemId") VALUES ($1,$2,$3,now(),$4)`, [id.P1, `HKT${d}`, `TEST-HKT KURSUN ${d}`, id.S1]); // tz-ok
    await c.query(`INSERT INTO "fabric_property_values" ("id","propertyId","code","name","updatedAt","serviceItemId","consumableItemId") VALUES ($1,$2,'K40','40 gr',now(),$3,$4)`, [id.V1, id.P1, id.S1, id.C1]); // tz-ok
    await c.query(`INSERT INTO "service_consumable_norms" ("id","serviceItemId","consumableItemId","qtyPerM","unit","clientToken","updatedAt") VALUES ($1,$2,$3,0.5,'ADET',$4,now())`, [id.N1, id.S1, id.C1, randomUUID()]); // tz-ok
    await c.query(`INSERT INTO "cash_transactions" ("id","docNo","kind","direction","amount","amountTry","txnDate","cashBoxId","updatedAt") VALUES ($1,$2,'EXPENSE','OUT',10,10,now(),$3,now())`, [id.CT, `TEST-HKT-K-${d}`, randomUUID()]); // tz-ok
    await c.query(`INSERT INTO "expense_allocations" ("id","cashTransactionId","serviceItemId","sharePct","clientToken","updatedAt") VALUES ($1,$2,$3,50,$4,now())`, [id.EA, id.CT, id.S1, randomUUID()]); // tz-ok
    await c.query(`INSERT INTO "rolls" ("id","itemId","initialQty","currentQty","updatedAt") VALUES ($1,$2,10,10,now())`, [id.R1, id.F1]); // tz-ok
    await c.query(`INSERT INTO "service_billing_links" ("id","invoiceId","rollId","serviceItemId","billedMeters","meterBasis","unitPrice","currency","serviceAt","updatedAt") VALUES ($1,$2,$3,$4,10,'OUT',12.5,'TRY',now(),now())`, [id.SBL, id.INV, id.R1, id.S1]); // tz-ok
    const fiyat = (itemId: string, kind: string, price: string, pv: string | null, cust: string | null) =>
      c.query(`INSERT INTO "item_prices" ("id","itemId","kind","currency","price","propertyValueId","customerId","updatedAt") VALUES ($1,$2,$3::"PriceKind",'TRY',$4,$5,$6,now())`, [randomUUID(), itemId, kind, price, pv, cust]); // tz-ok
    await fiyat(id.S1!, "SALE", "12.5000", null, null);
    await fiyat(id.S1!, "SALE", "15.0000", id.V1!, null);
    await fiyat(id.S1!, "SALE", "14.0000", null, randomUUID());
    await fiyat(id.S3!, "PURCHASE", "7.7500", null, null);
    await satir(1, id.S1!, "125.00");
    // Pasif (ARCHIVED) hizmete bağlı TASLAK satır — kontrol aracı ayrıca sayar, taşıma değiştirmez.
    await satir(4, id.S3!, "7.75");
    // Saf yapılandırma pivotları (defter ③b): kapıyı DURDURMAZ, migration 0(d) siler.
    await c.query(`INSERT INTO "item_allowed_colors" ("id","itemId","colorId") VALUES ($1,$2,$3)`, [randomUUID(), id.S1, randomUUID()]);
    await c.query(`INSERT INTO "item_allowed_properties" ("id","itemId","propertyId") VALUES ($1,$2,$3)`, [randomUUID(), id.S1, id.P1]);
    await c.query(`INSERT INTO "customer_item_aliases" ("id","customerId","itemId","alias","updatedAt") VALUES ($1,$2,$3,'HKT AD',now())`, [randomUUID(), randomUUID(), id.S1]); // tz-ok
    await c.query(`INSERT INTO "customer_item_color_aliases" ("id","customerId","itemId","colorId","alias","updatedAt") VALUES ($1,$2,$3,$4,'HKT RENK',now())`, [randomUUID(), randomUUID(), id.S1, randomUUID()]); // tz-ok
  }
  if (stokta) await c.query(`INSERT INTO "rolls" ("id","itemId","initialQty","currentQty","updatedAt") VALUES ($1,$2,10,10,now())`, [id.R2, id.S1]); // tz-ok
  await c.query("COMMIT");
  return id;
}

async function kisitlar(c: Sorgu): Promise<Set<string>> {
  const r = await c.query<{ n: string }>(`SELECT conname AS n FROM pg_constraint WHERE connamespace = 'public'::regnamespace`);
  return new Set(r.rows.map((x) => x.n));
}

async function kopyala(su: Client, taban: string, ad: string): Promise<void> {
  await su.query(`CREATE DATABASE ${quoteIdent(ad)} TEMPLATE ${quoteIdent(taban)}`);
}

// ── §1 boş-veri ─────────────────────────────────────────────────────────────
async function testBos(base: PgConn, db: string): Promise<void> {
  const c = await baglan(base, db);
  try {
    await tohum(c, false, false);
    const once = await olc(c);
    await c.query(migSql());
    const sonra = await olc(c);
    check("§1a SERVICE'siz DB'de migration geçti, 0 hizmet taşındı", once.faz === "ONCE" && sonra.faz === "SONRA" && sonra.sayim.kart === 0);
    const f = karsilastir(once, sonra);
    check("§1b önce ↔ sonra eşit (kontrol aracı)", f.length === 0, f.join(" · "));
    const k = await kisitlar(c);
    const beklenen = ["items_no_service_ck", "invoice_lines_line_type_ck", "item_prices_subject_ck", "item_prices_tier_service_ck", "service_items_lifecycle_isactive_ck", "invoice_lines_serviceItemId_fkey", "item_prices_serviceItemId_fkey"];
    const eksik = beklenen.filter((n) => !k.has(n));
    check("§1c kısıtlar kuruldu", eksik.length === 0, eksik.join(", "));
    const hedef = await c.query<{ t: string }>(
      `SELECT conrelid::regclass::text AS t FROM pg_constraint WHERE contype='f' AND confrelid='public.service_items'::regclass AND conname LIKE '%serviceItemId_fkey'`);
    const hedefler = new Set(hedef.rows.map((x) => x.t));
    check("§1d beş hizmet tablosunun FK'sı service_items'a döndü", HIZMET_TABLOLARI.every((t) => hedefler.has(t)), [...hedefler].join(","));
    const tip = await c.query<{ lineType: string; dolu: boolean }>(`SELECT "lineType"::text AS "lineType", ("itemId" IS NOT NULL) AS dolu FROM "invoice_lines" ORDER BY "lineNo"`);
    check("§1e ürün satırı PRODUCT, açıklama satırı TEXT olarak dolduruldu",
      tip.rows.length === 2 && tip.rows[0]!.lineType === "PRODUCT" && tip.rows[0]!.dolu && tip.rows[1]!.lineType === "TEXT", JSON.stringify(tip.rows));
    const urunFiyat = await c.query<{ n: string }>(`SELECT count(*) AS n FROM "item_prices" WHERE "itemId" IS NOT NULL AND "serviceItemId" IS NULL`);
    check("§1f ürün fiyatı yerinde (itemId)", urunFiyat.rows[0]!.n === "1");
  } finally {
    await c.end().catch(() => {});
  }
}

// ── §2 dolu + §3 CHECK ───────────────────────────────────────────────────────
async function testDolu(base: PgConn, db: string): Promise<void> {
  const c = await baglan(base, db);
  try {
    const id = await tohum(c, true, false);
    const once = await olc(c);
    check("§2a körlük zemini: tohum ölçüldü (3 kart, 1 mezar, her bağlı tabloda ≥1, 4 fiyat, 1 kademe, 2 satır)",
      once.sayim.kart === 3 && once.sayim.kartMezar === 1 && HIZMET_TABLOLARI.every((t) => (once.sayim[t] ?? 0) >= 1)
      && once.sayim.item_prices === 4 && once.sayim.item_prices_kademe === 1 && once.sayim.invoice_lines === 2,
      JSON.stringify(once.sayim));
    const pivotlar = SILINEN_PIVOTLAR.map(([t, k]) => `${t}.${k}`);
    check("§2g ⭐ saf pivot satırları ENGEL değil, SİLİNECEK listesinde (4 tablo × 1 satır)",
      once.engeller.length === 0 && once.silinecek.length === 4 && once.silinecek.every((e) => e.sayi === 1 && pivotlar.includes(`${e.tablo}.${e.kolon}`)),
      JSON.stringify({ engel: once.engeller, sil: once.silinecek.map((e) => `${e.tablo}=${e.sayi}`) }));
    check("§2h kontrol aracı pasif hizmete bağlı taslak satırı saydı (1)", once.sayim.taslak_satir_pasif_hizmet === 1, String(once.sayim.taslak_satir_pasif_hizmet));
    await c.query(migSql());
    const sonra = await olc(c);
    const f = karsilastir(once, sonra);
    check("§2b ⭐ önce ↔ sonra eşit: sayımlar, UUID + eski STK- kodu, fiyat ve satır toplamları", f.length === 0, f.join(" · "));
    const fiyat = await c.query<{ n: string; t: string }>(`SELECT count(*) AS n, COALESCE(sum("price"),0)::text AS t FROM "item_prices" WHERE "serviceItemId" = ANY($1::uuid[])`, [[id.S1, id.S3]]);
    check("§2c hizmet fiyatları kaybolmadı (4 satır, toplam 49.2500)", fiyat.rows[0]!.n === "4" && fiyat.rows[0]!.t === "49.2500", JSON.stringify(fiyat.rows[0]));
    const soy = await c.query<{ m: string | null; f: string | null }>(`SELECT "mergedIntoId"::text AS m, "nameFold" AS f FROM "service_items" WHERE "id" = $1`, [id.S2]);
    check("§2d mezar taşının soyu taşındı, nameFold DB'de üretildi", soy.rows[0]?.m === id.S1 && !!soy.rows[0]?.f);
    const arsiv = await c.query<{ s: string; a: boolean }>(`SELECT "lifecycleStatus"::text AS s, "isActive" AS a FROM "service_items" WHERE "id" = $1`, [id.S3]);
    check("§2e yaşam döngüsü taşındı (ARCHIVED + pasif)", arsiv.rows[0]?.s === "ARCHIVED" && arsiv.rows[0]?.a === false);
    const kalan = await c.query<{ n: string }>(`SELECT count(*) AS n FROM "items" WHERE "id" = ANY($1::uuid[])`, [[id.F1, id.C1]]);
    check("§2f ürün ve sarf kartları items'ta kaldı", kalan.rows[0]!.n === "2");
    const pivotKalan = await c.query<{ n: string }>(
      `SELECT ((SELECT count(*) FROM "item_allowed_colors" WHERE "itemId" = $1) + (SELECT count(*) FROM "item_allowed_properties" WHERE "itemId" = $1)
             + (SELECT count(*) FROM "customer_item_aliases" WHERE "itemId" = $1) + (SELECT count(*) FROM "customer_item_color_aliases" WHERE "itemId" = $1))::text AS n`, [id.S1]);
    check("§2i ⭐ hizmete bağlı pivot satırları migration'da silindi", pivotKalan.rows[0]!.n === "0", pivotKalan.rows[0]!.n);
    check("§2j pasif hizmete bağlı taslak satır taşındı, sayı aynı (1)", sonra.sayim.taslak_satir_pasif_hizmet === 1, String(sonra.sayim.taslak_satir_pasif_hizmet));
    await testCheck(c, id);
  } finally {
    await c.end().catch(() => {});
  }
}

async function dene(c: Sorgu, sql: string, params: unknown[]): Promise<{ ok: boolean; kod?: string; kisit?: string }> {
  await c.query("SAVEPOINT s");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT s");
    return { ok: true };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT s");
    const pe = e as { code?: string; constraint?: string };
    return { ok: false, kod: pe.code, kisit: pe.constraint };
  }
}

async function testCheck(c: Sorgu, id: Kimlik): Promise<void> {
  await c.query("BEGIN");
  try {
    let no = 100;
    const satir = (tip: string, itemId: string | null, sid: string | null) => dene(c,
      `INSERT INTO "invoice_lines" ("id","invoiceId","lineNo","lineType","itemId","serviceItemId","description","qty","unitPrice","lineTotal","vatAmount")
       VALUES ($1,$2,$3,$4::"InvoiceLineType",$5,$6,'TEST-HKT',1,1,1,0)`, [randomUUID(), id.INV, no++, tip, itemId, sid]);
    const red = (r: { ok: boolean; kod?: string; kisit?: string }, kisit: string) => !r.ok && r.kod === "23514" && r.kisit === kisit;
    const ll = "invoice_lines_line_type_ck";
    const pozitif = [await satir("PRODUCT", id.F1!, null), await satir("SERVICE", null, id.S1!), await satir("TEXT", null, null)];
    check("§3a pozitif kontrol: geçerli PRODUCT / SERVICE / TEXT satırları kabul", pozitif.every((r) => r.ok), JSON.stringify(pozitif));
    check("§3b PRODUCT + serviceItemId reddedildi", red(await satir("PRODUCT", id.F1!, id.S1!), ll));
    check("§3c PRODUCT FK'sız reddedildi", red(await satir("PRODUCT", null, null), ll));
    check("§3d SERVICE + itemId reddedildi", red(await satir("SERVICE", id.F1!, null), ll));
    check("§3e SERVICE + iki FK reddedildi", red(await satir("SERVICE", id.F1!, id.S1!), ll));
    check("§3f TEXT + itemId reddedildi", red(await satir("TEXT", id.F1!, null), ll));
    check("§3g TEXT + serviceItemId reddedildi", red(await satir("TEXT", null, id.S1!), ll));

    const fiyat = (itemId: string | null, sid: string | null, pv: string | null, cur: string) => dene(c,
      `INSERT INTO "item_prices" ("id","itemId","serviceItemId","propertyValueId","kind","currency","price","updatedAt") VALUES ($1,$2,$3,$4,'SALE',$5::"Currency",1,now())`, // tz-ok
      [randomUUID(), itemId, sid, pv, cur]);
    const fp = [await fiyat(null, id.S3!, null, "EUR"), await fiyat(id.F1!, null, null, "EUR"), await fiyat(null, id.S1!, id.V1!, "USD")];
    check("§3h pozitif kontrol: hizmet / ürün / kademeli hizmet fiyatı kabul", fp.every((r) => r.ok), JSON.stringify(fp));
    check("§3i fiyatta iki konu dolu reddedildi", red(await fiyat(id.F1!, id.S1!, null, "GBP"), "item_prices_subject_ck"));
    check("§3j fiyatta konu boş reddedildi", red(await fiyat(null, null, null, "GBP"), "item_prices_subject_ck"));
    check("§3k ürün fiyatında kademe reddedildi", red(await fiyat(id.F1!, null, id.V1!, "GBP"), "item_prices_tier_service_ck"));
    const tekil = await fiyat(null, id.S1!, null, "TRY");
    check("§3l hizmet varsayılan fiyatı tekil (item_price_default_uq COALESCE konu)", !tekil.ok && tekil.kod === "23505", JSON.stringify(tekil));

    const urun = (tip: string) => dene(c, `INSERT INTO "items" ("id","code","name","itemType","updatedAt") VALUES ($1,$2,$3,$4::"ItemType",now())`, // tz-ok
      [randomUUID(), `TEST-HKT-X${tip}${Date.now()}`, `TEST-HKT X ${tip} ${Date.now()}`, tip]);
    check("§3m pozitif kontrol: FABRIC kart kabul", (await urun("FABRIC")).ok);
    check("§3n items'a SERVICE kart reddedildi (items_no_service_ck)", red(await urun("SERVICE"), "items_no_service_ck"));
  } finally {
    await c.query("ROLLBACK").catch(() => {});
  }
}

// ── §4 stokta kullanılmış hizmet ─────────────────────────────────────────────
async function testStok(base: PgConn, db: string): Promise<void> {
  const c = await baglan(base, db);
  try {
    const id = await tohum(c, true, true);
    const once = await olc(c);
    const engel = once.engeller.find((e) => e.tablo === "rolls" && e.kolon === "itemId");
    check("§4a kontrol aracı engeli LİSTELEDİ (rolls.itemId, top id'siyle)", !!engel && engel.sayi === 1 && engel.ornekIdler[0] === id.R2, JSON.stringify(once.engeller));
    let mesaj = "";
    try { await c.query(migSql()); } catch (e) { mesaj = (e as Error).message; }
    check("§4b ⭐ migration DURDU, mesaj Türkçe ve sayılı", /taşıması DURDU: 1 kayıt/.test(mesaj) && mesaj.includes("rolls.itemId=1"), mesaj.slice(0, 200));
    const yok = await c.query<{ v: boolean }>(`SELECT to_regclass('public.service_items') IS NULL AS v`);
    const durum = await c.query<{ k: string; p: string }>(
      `SELECT (SELECT count(*) FROM "items" WHERE "itemType"='SERVICE')::text AS k, (SELECT count(*) FROM "item_prices" WHERE "itemId" = $1)::text AS p`, [id.S1]);
    check("§4c hiçbir şey değişmedi (service_items yok, 3 hizmet ve fiyatları yerinde)", yok.rows[0]!.v && durum.rows[0]!.k === "3" && durum.rows[0]!.p === "3", JSON.stringify(durum.rows[0]));
  } finally {
    await c.end().catch(() => {});
  }
}

async function testDb(): Promise<void> {
  const base = parseDatabaseUrl(process.env.DATABASE_URL);
  if (!base) return olculemedi("DATABASE_URL yok");
  const engel = hedefDbEngeli() ?? fixtureHedefEngeli();
  if (engel) { check("hedef kapısı: DB katmanı yalnız fixture hedefinde koşar", false, engel); return; }
  const su = await baglan(base, "postgres");
  const damga = Date.now().toString(36);
  const taban = `${PREFIX}${damga}_taban_test`;
  try {
    const s = (await su.query<{ s: boolean }>(`SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user`)).rows[0]?.s;
    if (!s) return olculemedi("DATABASE_URL kimliği süper kullanıcı değil (DB kurma + replica tohumu)");
    await sweep(su);
    const t0 = Date.now();
    await tabanKur(base, su, taban);
    console.log(`   taban: ${MIG_AD} öncesi migration'lar ${((Date.now() - t0) / 1000).toFixed(0)} sn`);
    const ad = (k: string) => `${PREFIX}${damga}_${k}_test`;
    for (const k of ["bos", "dolu", "stok"]) await kopyala(su, taban, ad(k));
    const senaryolar: Array<[string, (b: PgConn, d: string) => Promise<void>, string]> = [
      ["§1 (a) boş-veri yolu", testBos, "bos"],
      ["§2 (b) dolu yol + §3 (c) CHECK'ler", testDolu, "dolu"],
      ["§4 (d) stokta kullanılmış hizmet", testStok, "stok"],
    ];
    for (const [baslik, fn, k] of senaryolar) {
      console.log(`=== ${baslik} ===`);
      try { await fn(base, ad(k)); } catch (e) { check(`${baslik} beklenmedik hata`, false, (e as Error).message.slice(0, 300)); }
    }
  } finally {
    await sweep(su).catch(() => {});
    await su.end().catch(() => {});
  }
}

// ── §5 servis kapısı ─────────────────────────────────────────────────────────
async function testServisKapisi(): Promise<void> {
  const engel = hedefDbEngeli() ?? fixtureHedefEngeli();
  if (engel) { check("§5 hedef kapısı: servis kapısı yalnız fixture hedefinde koşar", false, engel); return; }
  const { itemService } = await import("../src/routes/item.routes");
  const { default: prisma, pool } = await import("../src/lib/prisma");
  const ad = `TEST-HKT KAPI ${Date.now()}`;
  let sonuc: { id?: string; itemType?: string; hata?: string } = {};
  let svc: { code: string } | null = null;
  let item: { id: string } | null = null;
  // Aktör iş anahtarıyla kurulur (ortamdaki "herhangi bir kullanıcı"ya yaslanmaz); sonda kart silinince silinir.
  const aktor = await prisma.user.create({
    data: { username: `tst-hkt-${Date.now().toString(36)}`, fullName: "TEST-HKT aktör", passwordHash: "x", isActive: false },
    select: { id: true },
  });
  try {
    const r = (await itemService.create({ name: ad, itemType: "SERVICE", unit: "MT" }, aktor.id)) as { data?: { id?: string; itemType?: string } };
    sonuc = { id: r.data?.id, itemType: r.data?.itemType };
    if (sonuc.id) {
      svc = await prisma.serviceItem.findUnique({ where: { id: sonuc.id }, select: { code: true } });
      item = await prisma.item.findUnique({ where: { id: sonuc.id }, select: { id: true } });
      await prisma.systemLog.deleteMany({ where: { recordId: sonuc.id } });
      await prisma.serviceItem.deleteMany({ where: { id: sonuc.id } });
    }
  } catch (e) {
    sonuc = { hata: (e as Error).message };
  } finally {
    await prisma.systemLog.deleteMany({ where: { userId: aktor.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: aktor.id } }).catch(() => undefined);
    await pool.end().catch(() => {});
  }
  check("§5a ⭐ ürün kartı ucunun Hizmet isteği hizmet kartı boğazına yönlenir (service_items satırı, items'ta satır yok)",
    sonuc.itemType === "SERVICE" && svc !== null && /^HZM-/.test(svc.code) && item === null, JSON.stringify({ ...sonuc, svc, item }).slice(0, 200));
}

async function main(): Promise<void> {
  console.log("=== §0 kaynak ===");
  testKaynak();
  await testDb();
  console.log("=== §5 servis kapısı ===");
  await testServisKapisi();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
