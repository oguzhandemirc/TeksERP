// =============================================================================
// BEKÇİ — PATRON BULUTU SİLME DAMGASI (`sync_marks` tetikleyicileri + tüketim + budama)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts bulut_silme_damgasi   (kendi _test DB'si; ~15 sn)
//
// NEDEN: silme tespiti koda değil DB'ye bağlıdır — statik tarama üç biçimde kör ölçüldü
// (dinamik delegate · kaskad · dinamik tablolu birleştirme silmesi; tasarım §4.4, S1).
//   §1 ⭐ kök tablo listesi (`SYNC_ROOT_TABLES`) ↔ migration tetikleyicileri ↔ DB İKİ YÖNLÜ
//   §2 ⭐ silinen kök satır AYNI tx'te SILINDI yazar; tx geri alınınca işaret de gider
//   §3 ⭐ KASKADLA silinen çocuk da işaretlenir (sipariş → kalemler) + ebeveyn KIRLI
//   §4 ⭐ ayrılma körlüğü (§4.3a): top çuval/sevkiyat/adım değiştirince ESKİ ebeveyn KIRLI;
//      FK dışı güncelleme işaret YAZMAZ (sıcak yolda maliyet yok)
//   §5 filigransız küme (§4.3b): `shipment_orders` ekleme/silme sevkiyatı KIRLI yapar
//   §6 bekleyen adım silinince iş emri KIRLI
//   §7 ⭐ tüketim (P15 · P18): silinen satır bir sonraki turda `sil: SILINDI` ile buluta gider,
//      kaskadla silinen kalem de; bulutta satır düşer
//   §8 budama: telemetri sınıfı — yalnız eşikten ESKİ işaret gider, eşik onaylı zincire bağlı
// §2–§6 tek bir DB bağlantısında açılan tx İÇİNDE koşar ve GERİ ALINIR (kalıcı iz yok).
//
// NEGATİF SONDA — dosya DIŞI mutasyon (cp + shasum ile geri alındı; commit mesajında):
//   S1 migration'dan `invoices_sync_deleted` satırı silindi               → §1 ❌
//   S2 `sync_mark_roll_old_parents` sackId dalı kaldırıldı (DB'de yeniden kuruldu) → §4 ❌
//   S3 `scanMarks` SILINDI işaretlerini yok saydı                           → §7 ❌
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuditService } from "../src/services/audit.service";
import { SYNC_ROOT_TABLES } from "../src/cloud-sync/projections";
import { runSyncRound } from "../src/cloud-sync/sync-round";
import { egressCloudTransport } from "../src/cloud-sync/cloud-client";
import { HORIZON_BASE_MARGIN_MS } from "../src/cloud-sync/horizon";
import { markPruneCutoff, pruneSyncMarks, MARK_KEEP_DAYS, MARK_MAX_KEEP_DAYS } from "../src/cloud-sync/marks-pruning";
import { bulutLisansKur, sahteBulutBaslat, type BulutLisans, type SahteBulut } from "./lib/bulut-fikstur";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

AuditService.logEvent = async () => undefined;
AuditService.log = async () => undefined;

const TAG = `BLTS${Date.now().toString(36).toUpperCase()}`;
const DAY_MS = 86_400_000;
const MIGRATION = path.join(__dirname, "..", "prisma", "migrations", "20260929152815_patron_bulut_esitleme", "migration.sql");
const ufkuGec = (): Promise<void> => new Promise((r) => setTimeout(r, HORIZON_BASE_MARGIN_MS + 600));

async function temizleEsitlemeDurumu(): Promise<void> {
  await prisma.syncWatermark.deleteMany({});
  await prisma.syncMark.deleteMany({});
}

async function temizleFikstur(): Promise<void> {
  await prisma.$executeRawUnsafe(`DELETE FROM "orders" WHERE "orderNumber" LIKE $1`, `${TAG}%`);
  await prisma.$executeRawUnsafe(`DELETE FROM "colors" WHERE "code" LIKE $1`, `${TAG}%`);
  await prisma.$executeRawUnsafe(`DELETE FROM "items" WHERE "code" LIKE $1`, `${TAG}%`);
  await prisma.$executeRawUnsafe(`DELETE FROM "customers" WHERE "code" LIKE $1`, `${TAG}%`);
}

/** `sonra` PG metni olarak taşınır: JS `Date` milisaniyeye keser, aynı ms'deki ÖNCEKİ işaret sayılırdı (aralıklı kırmızı). */
async function isaretler(c: PoolClient, sonra: Date | string): Promise<Array<{ tableName: string; rowId: string; kind: string }>> {
  const r = await c.query<{ tableName: string; rowId: string; kind: string }>(
    `SELECT "tableName", "rowId"::text AS "rowId", "kind"::text AS kind FROM "sync_marks" WHERE "createdAt" >= $1::timestamptz ORDER BY "createdAt", "id"`,
    [sonra],
  );
  return r.rows;
}
const var_ = (l: Array<{ tableName: string; rowId: string; kind: string }>, t: string, id: string, k: string): boolean =>
  l.some((m) => m.tableName === t && m.rowId === id && m.kind === k);

async function envanterBolumu(): Promise<void> {
  console.log("\n§1 — kök tablo ↔ migration ↔ DB (iki yönlü)");
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const migrasyon = new Set([...sql.matchAll(/CREATE TRIGGER "(\w+)_sync_deleted" AFTER DELETE ON "(\w+)" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted\(/g)].map((m) => (m[1] === m[2] ? m[1] : `UYUMSUZ:${m[1]}/${m[2]}`)));
  const kok = new Set(SYNC_ROOT_TABLES);
  check("§1a körlük zemini: 24 kök tablo, tekrar yok", SYNC_ROOT_TABLES.length === 24 && kok.size === 24, `${SYNC_ROOT_TABLES.length}/${kok.size}`);
  const eksik = [...kok].filter((t) => !migrasyon.has(t));
  const fazla = [...migrasyon].filter((t) => !kok.has(t));
  check("§1b ⭐ her kök tablonun migration'da silme tetikleyicisi var (ve fazlası yok)", eksik.length === 0 && fazla.length === 0,
    [eksik.length ? `eksik: ${eksik.join(",")}` : "", fazla.length ? `fazla: ${fazla.join(",")}` : ""].filter(Boolean).join(" · ") || `${migrasyon.size} tetikleyici`);
  const db = await prisma.$queryRawUnsafe<Array<{ tgname: string; relname: string; tgenabled: string }>>(
    `SELECT t.tgname::text AS tgname, c.relname::text AS relname, t.tgenabled::text AS tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal AND t.tgname LIKE '%\\_sync\\_%'`,
  );
  const dbKok = new Set(db.filter((r) => r.tgname === `${r.relname}_sync_deleted` && r.tgenabled !== "D").map((r) => r.relname));
  const dbEksik = [...kok].filter((t) => !dbKok.has(t));
  check("§1c ⭐ DB'de her kök tablonun tetikleyicisi KURULU ve etkin (elle restore kopukluğu)", dbEksik.length === 0, dbEksik.length ? `eksik: ${dbEksik.join(",")}` : `${dbKok.size} etkin`);
  const yardimci = ["rolls_sync_parent_moved", "sacks_sync_parent_moved", "shipment_orders_sync_dirty", "work_order_steps_sync_deleted"];
  check("§1d ayrılma/küme/çocuk tetikleyicileri DB'de", yardimci.every((n) => db.some((r) => r.tgname === n)), yardimci.filter((n) => !db.some((r) => r.tgname === n)).join(",") || "4/4");
}

async function txBolumleri(): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const t0 = (await c.query<{ t: Date }>("SELECT now() AS t")).rows[0]!.t;
    // Fikstür tx içinde İŞ ANAHTARIYLA kurulur ve tx ile birlikte geri alınır.
    const musteri = randomUUID();
    const urun = randomUUID();
    const istasyonlar = [randomUUID(), randomUUID()];
    await c.query(`INSERT INTO "customers" ("id", "code", "name", "updatedAt") VALUES ($1, $2, $3, now())`, [musteri, `${TAG}TM`, `${TAG} tx müşteri`]);
    await c.query(`INSERT INTO "items" ("id", "code", "name", "itemType", "updatedAt") VALUES ($1, $2, $3, 'FABRIC', now())`, [urun, `${TAG}TU`, `${TAG} tx ürün`]);
    await c.query(
      `INSERT INTO "stations" ("id", "code", "name", "type", "updatedAt") VALUES ($1, $3, $4, 'INTERNAL', now()), ($2, $5, $6, 'INTERNAL', now())`,
      [istasyonlar[0], istasyonlar[1], `${TAG}I1`, `${TAG} istasyon 1`, `${TAG}I2`, `${TAG} istasyon 2`],
    );

    console.log("\n§2 — kök satır silme (aynı tx)");
    const renk = randomUUID();
    await c.query(`INSERT INTO "colors" ("id", "code", "name", "updatedAt") VALUES ($1, $2, $3, now())`, [renk, `${TAG}R`, `${TAG} renk`]);
    await c.query(`DELETE FROM "colors" WHERE "id" = $1`, [renk]);
    check("§2a ⭐ silinen renk AYNI tx'te SILINDI işareti yazdı", var_(await isaretler(c, t0), "colors", renk, "DELETED"));

    console.log("\n§3 — kaskad silme");
    const siparis = randomUUID();
    const k1 = randomUUID();
    const k2 = randomUUID();
    await c.query(`INSERT INTO "orders" ("id", "orderNumber", "customerId", "updatedAt") VALUES ($1, $2, $3, now())`, [siparis, `${TAG}S`, musteri]);
    await c.query(`INSERT INTO "order_lines" ("id", "orderId", "itemId", "quantity", "updatedAt") VALUES ($1, $3, $4, 10, now()), ($2, $3, $4, 20, now())`, [k1, k2, siparis, urun]);
    await c.query(`DELETE FROM "orders" WHERE "id" = $1`, [siparis]);
    const m3 = await isaretler(c, t0);
    check("§3a ⭐ ebeveyn silindi → SILINDI", var_(m3, "orders", siparis, "DELETED"));
    check("§3b ⭐ KASKADLA silinen iki kalem de SILINDI (statik taramanın kör olduğu yol)", var_(m3, "order_lines", k1, "DELETED") && var_(m3, "order_lines", k2, "DELETED"));
    check("§3c silinen kalem ebeveynini KIRLI yaptı (toplam değişti)", var_(m3, "orders", siparis, "DIRTY"));

    console.log("\n§4 — ayrılma körlüğü (eski ebeveyn)");
    const [cA, cB, s1, s2, is1, st1, st2, top] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await c.query(`INSERT INTO "shipments" ("id", "shipmentNo", "customerId", "updatedAt") VALUES ($1, $3, $5, now()), ($2, $4, $5, now())`, [s1, s2, `${TAG}V1`, `${TAG}V2`, musteri]);
    await c.query(`INSERT INTO "sacks" ("id", "sackNo", "shipmentId", "updatedAt") VALUES ($1, $3, $5, now()), ($2, $4, NULL, now())`, [cA, cB, `${TAG}C1`, `${TAG}C2`, s1]);
    await c.query(`INSERT INTO "work_orders" ("id", "workOrderNumber", "updatedAt") VALUES ($1, $2, now())`, [is1, `${TAG}W`]);
    await c.query(`INSERT INTO "work_order_steps" ("id", "workOrderId", "stationId", "stepSequence", "updatedAt") VALUES ($1, $3, $4, 1, now()), ($2, $3, $5, 2, now())`, [st1, st2, is1, istasyonlar[0], istasyonlar[1]]);
    await c.query(
      `INSERT INTO "rolls" ("id", "itemId", "initialQty", "currentQty", "sackId", "shipmentId", "currentStepId", "producedInStepId", "updatedAt") VALUES ($1, $2, 50, 50, $3, $4, $5, $5, now())`,
      [top, urun, cA, s1, st1],
    );
    const t4 = (await c.query<{ t: string }>("SELECT clock_timestamp()::text AS t")).rows[0]!.t;
    await c.query(`UPDATE "rolls" SET "currentQty" = 49 WHERE "id" = $1`, [top]);
    check("§4a ⭐ FK dışı güncelleme işaret YAZMAZ (tetikleyici yalnız ebeveyn değişince)", (await isaretler(c, t4)).length === 0);
    await c.query(`UPDATE "rolls" SET "sackId" = $2 WHERE "id" = $1`, [top, cB]);
    await c.query(`UPDATE "rolls" SET "shipmentId" = $2 WHERE "id" = $1`, [top, s2]);
    await c.query(`UPDATE "rolls" SET "currentStepId" = $2 WHERE "id" = $1`, [top, st2]);
    await c.query(`UPDATE "sacks" SET "shipmentId" = $2 WHERE "id" = $1`, [cA, s2]);
    const m4 = await isaretler(c, t4);
    check("§4b ⭐ top çuvaldan çıktı → ESKİ çuval KIRLI", var_(m4, "sacks", cA, "DIRTY") && !var_(m4, "sacks", cB, "DIRTY"));
    check("§4c ⭐ top sevkiyattan çıktı → ESKİ sevkiyat KIRLI", var_(m4, "shipments", s1, "DIRTY"));
    check("§4d ⭐ top adım değiştirdi → iş emri KIRLI", var_(m4, "work_orders", is1, "DIRTY"));
    check("§4e çuval sevkiyattan çıktı → ESKİ sevkiyat KIRLI", m4.filter((m) => m.tableName === "shipments" && m.rowId === s1).length >= 2);

    console.log("\n§5 — filigransız küme (shipment_orders)");
    const siparis2 = randomUUID();
    await c.query(`INSERT INTO "orders" ("id", "orderNumber", "customerId", "updatedAt") VALUES ($1, $2, $3, now())`, [siparis2, `${TAG}S2`, musteri]);
    const t5 = (await c.query<{ t: string }>("SELECT clock_timestamp()::text AS t")).rows[0]!.t;
    await c.query(`INSERT INTO "shipment_orders" ("shipmentId", "orderId") VALUES ($1, $2)`, [s1, siparis2]);
    const e5 = (await isaretler(c, t5)).filter((m) => m.tableName === "shipments" && m.rowId === s1).length;
    await c.query(`DELETE FROM "shipment_orders" WHERE "shipmentId" = $1 AND "orderId" = $2`, [s1, siparis2]);
    const d5 = (await isaretler(c, t5)).filter((m) => m.tableName === "shipments" && m.rowId === s1).length;
    check("§5a ⭐ küme satırı eklenince sevkiyat KIRLI", e5 === 1, String(e5));
    check("§5b küme satırı silinince sevkiyat yine KIRLI (deleteMany + yeniden yazım)", d5 === 2, String(d5));

    console.log("\n§6 — bekleyen adım silme");
    const t6 = (await c.query<{ t: string }>("SELECT clock_timestamp()::text AS t")).rows[0]!.t;
    await c.query(`UPDATE "rolls" SET "currentStepId" = NULL, "producedInStepId" = NULL WHERE "id" = $1`, [top]);
    await c.query(`DELETE FROM "work_order_steps" WHERE "id" = $1`, [st2]);
    check("§6a adım silindi → iş emri KIRLI (adım kök değil)", var_(await isaretler(c, t6), "work_orders", is1, "DIRTY"));
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    c.release();
  }
  const kalan = await prisma.syncMark.count({ where: { rowId: { in: [] } } });
  const sonra = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "orders" WHERE "orderNumber" LIKE $1`, `${TAG}%`);
  check("§2b ⭐ tx geri alındı → işaretler de fikstür de yok (işaret silmeyle birlikte commit/rollback)", (sonra[0]?.n ?? -1) === 0 && kalan === 0 && (await prisma.syncMark.count()) === 0,
    `işaret ${await prisma.syncMark.count()}`);
}

async function tuketimBolumu(lisans: BulutLisans, bulut: SahteBulut): Promise<void> {
  console.log("\n§7 — tüketim: sil → bulut (P15 · P18)");
  // Fikstür İŞ ANAHTARIYLA kurulur (ortamda "herhangi bir kayıt" aranmaz).
  const musteri = randomUUID();
  const urun = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO "customers" ("id", "code", "name", "updatedAt") VALUES ($1::uuid, $2, $3, now())`, musteri, `${TAG}M`, `${TAG} müşteri`);
  await prisma.$executeRawUnsafe(`INSERT INTO "items" ("id", "code", "name", "itemType", "updatedAt") VALUES ($1::uuid, $2, $3, 'FABRIC', now())`, urun, `${TAG}U`, `${TAG} ürün`);
  const renk = randomUUID();
  const siparis = randomUUID();
  const kalem = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO "colors" ("id", "code", "name", "updatedAt") VALUES ($1::uuid, $2, $3, now())`, renk, `${TAG}T`, `${TAG} tüketim`);
  await prisma.$executeRawUnsafe(`INSERT INTO "orders" ("id", "orderNumber", "customerId", "updatedAt") VALUES ($1::uuid, $2, $3::uuid, now())`, siparis, `${TAG}T`, musteri);
  await prisma.$executeRawUnsafe(`INSERT INTO "order_lines" ("id", "orderId", "itemId", "quantity", "updatedAt") VALUES ($1::uuid, $2::uuid, $3::uuid, 5, now())`, kalem, siparis, urun);
  await ufkuGec();
  const o1 = await runSyncRound({ kind: "ARTIMLI", cadences: new Set() }, { transport: egressCloudTransport });
  check("§7a taban tur (TAM) TAMAM, satırlar bulutta", o1.status === "TAMAM" && !!bulut.satirlar.get("renk")?.has(renk) && !!bulut.satirlar.get("siparis-kalemi")?.has(kalem), `${o1.status} ${o1.reason ?? ""}`);
  await prisma.$executeRawUnsafe(`DELETE FROM "colors" WHERE "id" = $1::uuid`, renk);
  await prisma.$executeRawUnsafe(`DELETE FROM "orders" WHERE "id" = $1::uuid`, siparis);
  await ufkuGec();
  const n0 = bulut.paketler.length;
  const o2 = await runSyncRound({ kind: "ARTIMLI", cadences: new Set() }, { transport: egressCloudTransport });
  const kayitlar = bulut.paketler.slice(n0).flatMap((p) => p.kayitlar);
  const silindi = (ad: string, id: string): boolean => kayitlar.some((k) => k.projeksiyon === ad && k.sil.some((s) => s.id === id && s.neden === "SILINDI"));
  check("§7b ⭐ silinen renk `sil: SILINDI` ile gitti (tetikleyici yolu — uygulama kodu yazmadı)", o2.status === "TAMAM" && silindi("renk", renk), `${o2.status}`);
  check("§7c ⭐ kaskadla silinen kalem de gitti (sipariş + kalem)", silindi("siparis", siparis) && silindi("siparis-kalemi", kalem));
  check("§7d bulutta satırlar düştü (silindi damgalı)", !!bulut.satirlar.get("renk")?.get(renk)?.silindi && !!bulut.satirlar.get("siparis-kalemi")?.get(kalem)?.silindi);
  void lisans;
}

async function budamaBolumu(): Promise<void> {
  console.log("\n§8 — budama (telemetri sınıfı)");
  const now = Date.now();
  check("§8a zincir yokken eşik 7 gün", markPruneCutoff(now, null).getTime() === now - MARK_KEEP_DAYS * DAY_MS);
  check("§8b ⭐ onaylı zincir geride kaldıysa eşik zincir (onaylanmamış işaret budanmaz)", markPruneCutoff(now, now - 10 * DAY_MS).getTime() === now - 10 * DAY_MS);
  check("§8c eşitleme uzun süre durduysa 30 gün tavanı (kaçan silmeyi uzlaştırma onarır)", markPruneCutoff(now, now - 90 * DAY_MS).getTime() === now - MARK_MAX_KEEP_DAYS * DAY_MS);
  await prisma.syncWatermark.deleteMany({ where: { source: { startsWith: "zincir|" } } });
  const eski = randomUUID();
  const yeni = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "sync_marks" ("tableName", "rowId", "kind", "createdAt") VALUES ('colors', $1::uuid, 'DELETED', now() - interval '8 days'), ('colors', $2::uuid, 'DELETED', now() - interval '1 day')`,
    eski, yeni,
  );
  const n = await pruneSyncMarks();
  const kalan = await prisma.syncMark.findMany({ where: { rowId: { in: [eski, yeni] } }, select: { rowId: true } });
  check("§8d ⭐ 7 günden eski işaret budandı, yenisi kaldı", n >= 1 && kalan.length === 1 && kalan[0]!.rowId === yeni, `${n} budandı · kalan ${kalan.map((k) => k.rowId.slice(0, 8)).join(",")}`);
}

async function main(): Promise<void> {
  console.log(`=== PATRON BULUTU SİLME DAMGASI (${TAG}) ===`);
  let bulut: SahteBulut | null = null;
  let lisans: BulutLisans | null = null;
  try {
    await temizleEsitlemeDurumu();
    await envanterBolumu();
    await txBolumleri();
    lisans = await bulutLisansKur();
    bulut = await sahteBulutBaslat(lisans.x);
    await tuketimBolumu(lisans, bulut);
    await budamaBolumu();
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    await bulut?.kapat();
    await temizleFikstur().catch(() => undefined);
    await temizleEsitlemeDurumu().catch(() => undefined);
    if (lisans) fs.rmSync(lisans.dizin, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end().catch(() => undefined);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
