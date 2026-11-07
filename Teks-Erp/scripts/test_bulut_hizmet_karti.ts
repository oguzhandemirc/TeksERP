// =============================================================================
// BEKÇİ — PATRON BULUTU: hizmet kartı ayrımı (`service_items`, 2026-11-08)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_bulut_hizmet_karti.ts   (kendi _test DB'si; patron sunucusu DEĞİŞMEZ)
//
// Hizmet kartı `items`'tan `service_items`'a AYNI UUID ile taşındı; bulut onu bugünkü gibi `urun` satırı görmeli:
//   §1 ⭐ `urun` projeksiyonu hizmet kartını kurar: `tur: SERVICE`, kod/ad/birim/durum kendi kolonlarından;
//      ürün kartı yanında bayt-aynı tel şekli (aynı anahtar kümesi)
//   §2 ⭐ `fiyat` ve `fatura-kalemi` hizmet satırında `urunId = serviceItemId` (ürün satırında itemId)
//   §3 ⭐ silme işareti: `items` kökünde SILINDI işaretli ama `service_items`'ta yaşayan id → SILINDI DEĞİL, yeniden
//      kurulur (taşıma); gerçekten silinen id SILINDI kalır; `service_items` silmesi kendi tetiğiyle SILINDI yazar
//   §4 uzlaştırma küme özeti iki kökün birleşimini sayar (hizmet kartı `membershipIds`te)
//   §5 migration: `items` SERVICE silmesi tetik KAPALIYKEN (buluta mezar yazmaz), sonra tetik yeniden AÇIK;
//      `service_items_sync_deleted` kurulu ve etkin
//   §6 ⭐ hizmet kartı ad değişikliği ve pasife alma (servis yazarıyla) → `urun` kirli, SILINDI değil, sync_marks
//      mezarı yok; tel satırı yeni ad + `aktif:false` (inceleme 2026-11-08, ikinci tur)
//
// NEGATİF SONDA (dosya dışı mutasyon, geri alındı; commit mesajında):
//   N1 `urun.extraRoots` kaldırıldı → §1 ❌ (hizmet SILINDI) · N2 `scanMarks` canlılık taşıması kaldırıldı → §3a ❌
//   N3 `DERIVERS.fiyat` `itemId`ye indirildi → §2a ❌
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { findRecordProjection } from "../src/cloud-sync/projections";
import { buildRecords } from "../src/cloud-sync/record-builder";
import { collectProjectionChanges } from "../src/cloud-sync/change-scan";
import { membershipIds } from "../src/cloud-sync/reconcile";
import { wmKey, type StoredWatermark } from "../src/cloud-sync/watermarks";
import { serviceItemService } from "../src/services/service-item.service";


let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

const MIG = path.resolve(__dirname, "..", "prisma", "migrations", "20261107202906_service_items_split", "migration.sql");
const D = randomUUID().slice(0, 6).toUpperCase();
const ids = { actor: randomUUID(), svc: randomUUID(), item: randomUUID(), gone: randomUUID(), price: randomUUID(), cari: randomUUID(), inv: randomUUID(), line: randomUUID() };

function proj(name: string) {
  const p = findRecordProjection(name);
  if (!p) throw new Error(`projeksiyon yok: ${name}`);
  return p;
}

/** İşaret kaynağı `at`tan; kaynaklar `kaynakAt`tan (verilmezse şimdiki ufuk — yalnız işaretler taranır). */
async function marksFrom(name: string, at: Date, kaynakAt?: Date): Promise<Map<string, StoredWatermark>> {
  const p = proj(name);
  const now = kaynakAt ?? (await prisma.$queryRawUnsafe<Array<{ t: Date }>>(`SELECT now() AS t`))[0]!.t;
  const m = new Map<string, StoredWatermark>();
  const put = (source: string, a: Date) => m.set(source, { source, at: a, tie: null, catalogVersion: p.catalogVersion, digest: null, retentionFrom: null });
  for (const s of p.sources) put(wmKey.source(p.name, s.table, s.watermark), now);
  put(wmKey.marks(p.name), at);
  put(wmKey.merge(p.name, "createdAt"), now);
  put(wmKey.merge(p.name, "revertedAt"), now);
  return m;
}

async function dbNow(): Promise<Date> {
  return (await prisma.$queryRawUnsafe<Array<{ t: Date }>>(`SELECT now() AS t`))[0]!.t;
}

async function kur(): Promise<void> {
  // §6 yazarı: iş anahtarlı geçici kullanıcı (ortamdaki kullanıcıya bağlanılmaz); temizlikte silinir.
  await prisma.user.create({ data: { id: ids.actor, username: `tst-bhk-${D.toLowerCase()}`, fullName: `TST BHK ${D}`, passwordHash: "x", isActive: false } });
  await prisma.serviceItem.create({ data: { id: ids.svc, code: `TST-BHK-S${D}`, name: `TST BHK HIZMET ${D}`, unit: "KG" } });
  await prisma.item.create({ data: { id: ids.item, code: `TST-BHK-U${D}`, name: `TST BHK KUMAS ${D}`, itemType: "FABRIC", unit: "MT" } });
  await prisma.itemPrice.create({ data: { id: ids.price, serviceItemId: ids.svc, kind: "SALE", currency: "TRY", price: "12.5" } });
  // Onaylı fatura + hizmet satırı: ebeveyn zinciri (cari) bu bekçinin konusu değil → replica oturumunda ham SQL.
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query(`INSERT INTO "invoices" ("id","docNo","type","status","confirmedAt","cariId","issueDate","updatedAt") VALUES ($1,$2,'SALES','CONFIRMED',now(),$3,now(),now())`, [ids.inv, `TST-BHK-${D}`, ids.cari]); // tz-ok: fikstür damgası
    await c.query(`INSERT INTO "invoice_lines" ("id","invoiceId","lineNo","lineType","serviceItemId","description","qty","unitPrice","lineTotal","vatAmount")
                   VALUES ($1,$2,1,'SERVICE',$3,'TST BHK',1,10,10,0)`, [ids.line, ids.inv, ids.svc]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

async function temizle(): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query(`DELETE FROM "invoice_lines" WHERE "id" = $1`, [ids.line]);
    await c.query(`DELETE FROM "invoices" WHERE "id" = $1`, [ids.inv]);
    await c.query("COMMIT");
  } catch {
    await c.query("ROLLBACK").catch(() => {});
  } finally {
    c.release();
  }
  await prisma.itemPrice.deleteMany({ where: { id: ids.price } });
  await prisma.serviceItem.deleteMany({ where: { id: ids.svc } });
  await prisma.item.deleteMany({ where: { id: ids.item } });
  await prisma.systemLog.deleteMany({ where: { OR: [{ userId: ids.actor }, { recordId: ids.svc }] } });
  await prisma.user.deleteMany({ where: { id: ids.actor } });
  await prisma.$executeRawUnsafe(`DELETE FROM "sync_marks" WHERE "rowId" = ANY($1::uuid[])`, Object.values(ids));
}

async function main(): Promise<void> {
  console.log("=== Patron bulutu — hizmet kartı ayrımı ===");
  const engel = hedefDbEngeli();
  if (engel) { check("hedef DB test DB'si", false, engel); return; }
  await kur();
  try {
    console.log("\n── §1 urun projeksiyonu ──");
    const urun = proj("urun");
    const b1 = await buildRecords(urun, [ids.svc, ids.item], Date.now());
    const rows = b1.rows.get("urun") ?? [];
    const s = rows.find((r) => r.id === ids.svc);
    const u = rows.find((r) => r.id === ids.item);
    check("§1a ⭐ hizmet kartı urun satırı olarak kuruldu (SILINDI değil)", !!s && !b1.removed.some((r) => r.id === ids.svc), JSON.stringify(b1.removed));
    check("§1b hizmet satırı tur SERVICE, kod/ad/birim/durum kendi kolonundan",
      s?.tur === "SERVICE" && s?.kod === `TST-BHK-S${D}` && s?.ad === `TST BHK HIZMET ${D}` && s?.birim === "KG" && s?.yasamDurumu === "ACTIVE" && s?.aktif === true && s?.birlestigiKayit === null,
      JSON.stringify(s));
    check("§1c ürün ve hizmet satırı aynı tel anahtar kümesi (bayt-aynı şekil)",
      !!u && JSON.stringify(Object.keys(u).sort()) === JSON.stringify(Object.keys(s ?? {}).sort()) && u.tur === "FABRIC", `${Object.keys(u ?? {}).join(",")} | ${Object.keys(s ?? {}).join(",")}`);

    console.log("\n── §2 fiyat / fatura kalemi urunId ──");
    const f = await buildRecords(proj("fiyat"), [ids.price], Date.now());
    const fr = (f.rows.get("fiyat") ?? []).find((r) => r.id === ids.price);
    check("§2a ⭐ hizmet fiyatı urunId = serviceItemId", fr?.urunId === ids.svc, JSON.stringify(fr));
    const k = await buildRecords(proj("fatura-kalemi"), [ids.line], Date.now());
    const kr = (k.rows.get("fatura-kalemi") ?? []).find((r) => r.id === ids.line);
    check("§2b ⭐ hizmet fatura satırı urunId = serviceItemId", kr?.urunId === ids.svc, JSON.stringify(kr ?? k.removed));

    console.log("\n── §3 silme işareti ──");
    const t0 = await dbNow();
    // Taşıma benzetimi: items kökünde SILINDI işareti, kimlik service_items'ta yaşıyor; ve gerçekten silinmiş bir id.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "sync_marks" ("id","tableName","rowId","kind") VALUES (gen_random_uuid(),'items',$1::uuid,'DELETED'),(gen_random_uuid(),'items',$2::uuid,'DELETED')`,
      ids.svc, ids.gone);
    const ch = await collectProjectionChanges(urun, await marksFrom("urun", t0), new Date((await dbNow()).getTime() + 1000));
    check("§3a ⭐ taşınan kimlik SILINDI değil, yeniden kurulacaklar arasında", !ch.deleted.has(ids.svc) && ch.dirty.has(ids.svc), `deleted=${ch.deleted.has(ids.svc)} dirty=${ch.dirty.has(ids.svc)}`);
    check("§3b gerçekten yok olan kimlik SILINDI kalır", ch.deleted.has(ids.gone) && !ch.dirty.has(ids.gone));
    const t1 = await dbNow();
    const tmp = randomUUID();
    await prisma.serviceItem.create({ data: { id: tmp, code: `TST-BHK-T${D}`, name: `TST BHK GECICI ${D}` } });
    await prisma.serviceItem.delete({ where: { id: tmp } });
    const ch2 = await collectProjectionChanges(urun, await marksFrom("urun", t1), new Date((await dbNow()).getTime() + 1000));
    check("§3c service_items silmesi kendi tetiğiyle SILINDI yazar, urun bunu görür", ch2.deleted.has(tmp), `deleted=${[...ch2.deleted].length}`);
    await prisma.$executeRawUnsafe(`DELETE FROM "sync_marks" WHERE "rowId" = $1::uuid`, tmp);

    console.log("\n── §4 uzlaştırma kümesi ──");
    const uye = await membershipIds(urun, { retentionFrom: null, createdBefore: null });
    check("§4a küme iki kökün birleşimi (hizmet + ürün kartı)", uye.includes(ids.svc) && uye.includes(ids.item));
    check("§4b küme kimlik tekrarı içermez (UUID uzayı ortak)", new Set(uye).size === uye.length);

    console.log("\n── §5 migration tetikleri ──");
    const sql = fs.readFileSync(MIG, "utf8");
    const off = sql.indexOf(`ALTER TABLE "items" DISABLE TRIGGER "items_sync_deleted"`);
    const del = sql.search(/DELETE FROM "items" WHERE "itemType" = 'SERVICE'/);
    const on = sql.indexOf(`ALTER TABLE "items" ENABLE TRIGGER "items_sync_deleted"`);
    check("§5a ⭐ items SERVICE silmesi tetik kapalıyken (kapat < sil < aç)", off >= 0 && del > off && on > del, `kapat@${off} sil@${del} aç@${on}`);
    const tg = await prisma.$queryRawUnsafe<Array<{ t: string; e: string }>>(
      `SELECT tgname::text AS t, tgenabled::text AS e FROM pg_trigger WHERE tgname IN ('items_sync_deleted','service_items_sync_deleted')`);
    const durum = new Map(tg.map((r) => [r.t, r.e]));
    check("§5b DB'de items_sync_deleted yeniden etkin, service_items_sync_deleted kurulu ve etkin",
      durum.get("items_sync_deleted") === "O" && durum.get("service_items_sync_deleted") === "O", JSON.stringify(Object.fromEntries(durum)));

    console.log("\n── §6 hizmet kartı düzenleme + pasife alma ──");
    const t6 = await dbNow();
    await new Promise((r) => setTimeout(r, 20));
    await serviceItemService.update(ids.svc, { name: `TST BHK HIZMET YENI ${D}` }, ids.actor);
    const c6a = await collectProjectionChanges(urun, await marksFrom("urun", t6, t6), new Date((await dbNow()).getTime() + 1000));
    check("§6a ⭐ ad değişikliği urun projeksiyonunda kirli (service_items kaynağı), SILINDI değil",
      c6a.dirty.has(ids.svc) && !c6a.deleted.has(ids.svc), `dirty=${c6a.dirty.has(ids.svc)} deleted=${c6a.deleted.has(ids.svc)}`);
    const t6b = await dbNow();
    await new Promise((r) => setTimeout(r, 20));
    await serviceItemService.update(ids.svc, { isActive: false }, ids.actor);
    const c6b = await collectProjectionChanges(urun, await marksFrom("urun", t6b, t6b), new Date((await dbNow()).getTime() + 1000));
    check("§6b ⭐ pasife alma urun projeksiyonunda kirli, SILINDI değil", c6b.dirty.has(ids.svc) && !c6b.deleted.has(ids.svc),
      `dirty=${c6b.dirty.has(ids.svc)} deleted=${c6b.deleted.has(ids.svc)}`);
    const mezar = await prisma.syncMark.count({ where: { rowId: ids.svc, createdAt: { gte: t6 } } });
    check("§6c düzenleme/pasife alma silme damgası (sync_marks) yazmaz", mezar === 0, String(mezar));
    const b6 = await buildRecords(urun, [ids.svc], Date.now());
    const s6 = (b6.rows.get("urun") ?? []).find((r) => r.id === ids.svc);
    check("§6d tel satırı yeni ad + aktif:false + ARCHIVED (kaldırılmadı)",
      !!s6 && s6.ad === `TST BHK HIZMET YENI ${D}` && s6.aktif === false && s6.yasamDurumu === "ARCHIVED" && !b6.removed.some((r) => r.id === ids.svc),
      JSON.stringify(s6 ?? b6.removed));
  } finally {
    await temizle();
  }
}

main()
  .catch((e: unknown) => {
    fail++;
    console.error(e);
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect().catch(() => {});
    await pool.end().catch(() => {});
    process.exitCode = fail > 0 ? 1 : 0;
  });
