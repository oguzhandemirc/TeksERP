// =============================================================================
// BEKÇİ — PATRON BULUTU: hizmet kartı `hizmet` boyutu (`service_items`, D3 2026-11-08)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_bulut_hizmet_karti.ts   (kendi _test DB'si)
//
// Hizmet kartı `items`'tan `service_items`'a AYNI UUID ile taşındı (D0); D3'te bulut onu ayrı `hizmet` boyutunda görür:
//   §1 ⭐ `hizmet` projeksiyonu hizmet kartını kurar (kod/ad/birim/durum); `urun` hizmet kimliğini KURMAZ (sızma yok),
//      ürün kartı `urun`da bugünkü gibi
//   §2 ⭐ `fiyat` / `fatura-kalemi`: hizmet satırında `hizmetId = serviceItemId`, `urunId = null`; ürün satırında (eski
//      satır, serviceItemId NULL) `urunId = itemId`, `hizmetId = null`, `satirTipi = PRODUCT`; açıklama satırı ikisi boş
//   §3 silme işareti: `service_items` silmesi (kodda yolu yok → katalog `YOK`; tetik kurulu) `hizmet`te SILINDI;
//      `urun` `service_items` işaretini görmez
//   §4 uzlaştırma kümeleri ayrık: `urun` yalnız ürün, `hizmet` yalnız hizmet
//   §5 migration: `items` SERVICE silmesi tetik KAPALIYKEN (buluta mezar yazmaz); iki tetik etkin
//   §6 ⭐ hizmet kartı ad değişikliği ve pasife alma → `hizmet` kirli (SILINDI değil, mezar yok), `urun` kirli DEĞİL
//   §7 katalog sürümleri: `urun` 2 · `fatura-kalemi` 2 · `fiyat` 3 (bulut TAM ister → v1'de `urun`a giden hizmet
//      satırları TAM süpürmesiyle düşer, eski kalem/fiyat satırları yeni alanlarla dolar) · `hizmet` 1
//
// NEGATİF SONDA (dosya dışı mutasyon, geri alındı; commit mesajında):
//   N1 `urun.sources`a `service_items` geri eklendi → §1e/§6b ❌ · N2 `fatura-kalemi` `hizmetId` kolonu çıkarıldı →
//   §2b–§2d ❌ · N3 `urun` catalogVersion 1'e indirildi → §7a ❌ (geri alındı, sha eşit)
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
const ids = {
  actor: randomUUID(), svc: randomUUID(), item: randomUUID(), svcPrice: randomUUID(), itemPrice: randomUUID(), cari: randomUUID(),
  inv: randomUUID(), svcLine: randomUUID(), itemLine: randomUUID(), textLine: randomUUID(),
};

function proj(name: string) {
  const p = findRecordProjection(name);
  if (!p) throw new Error(`projeksiyon yok: ${name}`);
  return p;
}

/** İşaret kaynağı `at`tan; kaynaklar `kaynakAt`tan (verilmezse şimdiki ufuk — yalnız işaretler taranır). */
async function marksFrom(name: string, at: Date, kaynakAt?: Date): Promise<Map<string, StoredWatermark>> {
  const p = proj(name);
  const now = kaynakAt ?? (await dbNow());
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

const ufukSonrasi = async (): Promise<Date> => new Date((await dbNow()).getTime() + 1000);

async function kur(): Promise<void> {
  // §6 yazarı: iş anahtarlı geçici kullanıcı (ortamdaki kullanıcıya bağlanılmaz); temizlikte silinir.
  await prisma.user.create({ data: { id: ids.actor, username: `tst-bhk-${D.toLowerCase()}`, fullName: `TST BHK ${D}`, passwordHash: "x", isActive: false } });
  await prisma.serviceItem.create({ data: { id: ids.svc, code: `TST-BHK-S${D}`, name: `TST BHK HIZMET ${D}`, unit: "KG" } });
  await prisma.item.create({ data: { id: ids.item, code: `TST-BHK-U${D}`, name: `TST BHK KUMAS ${D}`, itemType: "FABRIC", unit: "MT" } });
  await prisma.itemPrice.create({ data: { id: ids.svcPrice, serviceItemId: ids.svc, kind: "SALE", currency: "TRY", price: "12.5" } });
  await prisma.itemPrice.create({ data: { id: ids.itemPrice, itemId: ids.item, kind: "SALE", currency: "TRY", price: "40" } });
  // Onaylı fatura + üç satır tipi: ebeveyn zinciri (cari) bu bekçinin konusu değil → replica oturumunda ham SQL.
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query(`INSERT INTO "invoices" ("id","docNo","type","status","confirmedAt","cariId","issueDate","updatedAt") VALUES ($1,$2,'SALES','CONFIRMED',now(),$3,now(),now())`, [ids.inv, `TST-BHK-${D}`, ids.cari]); // tz-ok: fikstür damgası
    await c.query(`INSERT INTO "invoice_lines" ("id","invoiceId","lineNo","lineType","itemId","serviceItemId","description","qty","unitPrice","lineTotal","vatAmount")
                   VALUES ($1,$2,1,'SERVICE',NULL,$3,'TST BHK H',1,10,10,0), ($4,$2,2,'PRODUCT',$5,NULL,'TST BHK U',1,20,20,0), ($6,$2,3,'TEXT',NULL,NULL,'TST BHK NOT',1,0,0,0)`,
      [ids.svcLine, ids.inv, ids.svc, ids.itemLine, ids.item, ids.textLine]);
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
    await c.query(`DELETE FROM "invoice_lines" WHERE "id" = ANY($1::uuid[])`, [[ids.svcLine, ids.itemLine, ids.textLine]]);
    await c.query(`DELETE FROM "invoices" WHERE "id" = $1`, [ids.inv]);
    await c.query("COMMIT");
  } catch {
    await c.query("ROLLBACK").catch(() => {});
  } finally {
    c.release();
  }
  await prisma.itemPrice.deleteMany({ where: { id: { in: [ids.svcPrice, ids.itemPrice] } } });
  await prisma.serviceItem.deleteMany({ where: { id: ids.svc } });
  await prisma.item.deleteMany({ where: { id: ids.item } });
  await prisma.systemLog.deleteMany({ where: { OR: [{ userId: ids.actor }, { recordId: { in: [ids.svc, ids.item] } }] } });
  await prisma.user.deleteMany({ where: { id: ids.actor } });
  await prisma.$executeRawUnsafe(`DELETE FROM "sync_marks" WHERE "rowId" = ANY($1::uuid[])`, Object.values(ids));
}

async function main(): Promise<void> {
  console.log("=== Patron bulutu — hizmet kartı `hizmet` boyutu ===");
  const engel = hedefDbEngeli();
  if (engel) { check("hedef DB test DB'si", false, engel); return; }
  await kur();
  try {
    const urun = proj("urun");
    const hizmet = proj("hizmet");

    console.log("\n── §1 hizmet / urun boyutu ──");
    const h1 = await buildRecords(hizmet, [ids.svc, ids.item], Date.now());
    const hs = (h1.rows.get("hizmet") ?? []).find((r) => r.id === ids.svc);
    check("§1a ⭐ hizmet kartı `hizmet` satırı olarak kuruldu",
      !!hs && hs.kod === `TST-BHK-S${D}` && hs.ad === `TST BHK HIZMET ${D}` && hs.birim === "KG" && hs.yasamDurumu === "ACTIVE" && hs.aktif === true && hs.birlestigiKayit === null,
      JSON.stringify(hs ?? h1.removed));
    check("§1b `hizmet` satırı ürün alanı (`tur`) taşımaz; ürün kimliği `hizmet`te kurulmaz",
      !!hs && !("tur" in hs) && !(h1.rows.get("hizmet") ?? []).some((r) => r.id === ids.item));
    const u1 = await buildRecords(urun, [ids.svc, ids.item], Date.now());
    const urows = u1.rows.get("urun") ?? [];
    check("§1c ⭐ `urun` hizmet kimliğini KURMAZ (sızma yok; SILINDI düşer)",
      !urows.some((r) => r.id === ids.svc) && u1.removed.some((r) => r.id === ids.svc && r.neden === "SILINDI"), JSON.stringify(u1.removed));
    const uu = urows.find((r) => r.id === ids.item);
    check("§1d ürün kartı `urun`da bugünkü gibi (tur FABRIC)", uu?.tur === "FABRIC" && uu?.ad === `TST BHK KUMAS ${D}`, JSON.stringify(uu));
    check("§1e `urun` kaynakları `service_items` İÇERMEZ; `hizmet` kökü `service_items`",
      !urun.sources.some((x) => x.table === "service_items") && hizmet.root.table === "service_items" && hizmet.permission === "bulut:oturum" && hizmet.deletion === "YOK");

    console.log("\n── §2 fiyat / fatura kalemi ──");
    const f = await buildRecords(proj("fiyat"), [ids.svcPrice, ids.itemPrice], Date.now());
    const fr = f.rows.get("fiyat") ?? [];
    const fs1 = fr.find((r) => r.id === ids.svcPrice);
    const fu1 = fr.find((r) => r.id === ids.itemPrice);
    check("§2a ⭐ hizmet fiyatı hizmetId = serviceItemId, urunId null", fs1?.hizmetId === ids.svc && fs1?.urunId === null, JSON.stringify(fs1));
    check("§2a' ürün fiyatı urunId = itemId, hizmetId null (bugünkü gibi)", fu1?.urunId === ids.item && fu1?.hizmetId === null, JSON.stringify(fu1));
    const k = await buildRecords(proj("fatura-kalemi"), [ids.svcLine, ids.itemLine, ids.textLine], Date.now());
    const kr = k.rows.get("fatura-kalemi") ?? [];
    const ks = kr.find((r) => r.id === ids.svcLine);
    const ku = kr.find((r) => r.id === ids.itemLine);
    const kt = kr.find((r) => r.id === ids.textLine);
    check("§2b ⭐ hizmet satırı satirTipi SERVICE, hizmetId = serviceItemId, urunId null",
      ks?.satirTipi === "SERVICE" && ks?.hizmetId === ids.svc && ks?.urunId === null, JSON.stringify(ks ?? k.removed));
    check("§2c ⭐ eski ürün satırı (serviceItemId NULL) bugünkü gibi: urunId = itemId, hizmetId null, satirTipi PRODUCT",
      ku?.satirTipi === "PRODUCT" && ku?.urunId === ids.item && ku?.hizmetId === null, JSON.stringify(ku));
    check("§2d açıklama satırı satirTipi TEXT, urunId ve hizmetId boş", kt?.satirTipi === "TEXT" && kt?.urunId === null && kt?.hizmetId === null, JSON.stringify(kt));

    console.log("\n── §3 silme işareti ──");
    const t1 = await dbNow();
    const tmp = randomUUID();
    await prisma.serviceItem.create({ data: { id: tmp, code: `TST-BHK-T${D}`, name: `TST BHK GECICI ${D}` } });
    await prisma.serviceItem.delete({ where: { id: tmp } });
    const ch = await collectProjectionChanges(hizmet, await marksFrom("hizmet", t1), await ufukSonrasi());
    check("§3a service_items silmesi kendi tetiğiyle SILINDI yazar, `hizmet` bunu görür", ch.deleted.has(tmp), `deleted=${[...ch.deleted].length}`);
    const chu = await collectProjectionChanges(urun, await marksFrom("urun", t1), await ufukSonrasi());
    check("§3b `urun` service_items işaretini görmez", !chu.deleted.has(tmp) && !chu.dirty.has(tmp));
    await prisma.$executeRawUnsafe(`DELETE FROM "sync_marks" WHERE "rowId" = $1::uuid`, tmp);

    console.log("\n── §4 uzlaştırma kümeleri ──");
    const uyeU = await membershipIds(urun, { retentionFrom: null, createdBefore: null });
    const uyeH = await membershipIds(hizmet, { retentionFrom: null, createdBefore: null });
    check("§4a `urun` kümesi ürün kartını içerir, hizmet kartını içermez", uyeU.includes(ids.item) && !uyeU.includes(ids.svc));
    check("§4b `hizmet` kümesi hizmet kartını içerir, ürün kartını içermez", uyeH.includes(ids.svc) && !uyeH.includes(ids.item));

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
    const c6a = await collectProjectionChanges(hizmet, await marksFrom("hizmet", t6, t6), await ufukSonrasi());
    check("§6a ⭐ ad değişikliği `hizmet`te kirli, SILINDI değil", c6a.dirty.has(ids.svc) && !c6a.deleted.has(ids.svc), `dirty=${c6a.dirty.has(ids.svc)} deleted=${c6a.deleted.has(ids.svc)}`);
    const c6u = await collectProjectionChanges(urun, await marksFrom("urun", t6, t6), await ufukSonrasi());
    check("§6b hizmet kartı değişikliği `urun`u kirletmez", !c6u.dirty.has(ids.svc) && !c6u.deleted.has(ids.svc));
    const t6b = await dbNow();
    await new Promise((r) => setTimeout(r, 20));
    await serviceItemService.update(ids.svc, { isActive: false }, ids.actor);
    const c6b = await collectProjectionChanges(hizmet, await marksFrom("hizmet", t6b, t6b), await ufukSonrasi());
    check("§6c ⭐ pasife alma `hizmet`te kirli, SILINDI değil", c6b.dirty.has(ids.svc) && !c6b.deleted.has(ids.svc), `dirty=${c6b.dirty.has(ids.svc)} deleted=${c6b.deleted.has(ids.svc)}`);
    const mezar = await prisma.syncMark.count({ where: { rowId: ids.svc, createdAt: { gte: t6 } } });
    check("§6d düzenleme/pasife alma silme damgası (sync_marks) yazmaz", mezar === 0, String(mezar));
    const b6 = await buildRecords(hizmet, [ids.svc], Date.now());
    const s6 = (b6.rows.get("hizmet") ?? []).find((r) => r.id === ids.svc);
    check("§6e tel satırı yeni ad + aktif:false + ARCHIVED (kaldırılmadı)",
      !!s6 && s6.ad === `TST BHK HIZMET YENI ${D}` && s6.aktif === false && s6.yasamDurumu === "ARCHIVED" && !b6.removed.some((r) => r.id === ids.svc),
      JSON.stringify(s6 ?? b6.removed));

    console.log("\n── §7 katalog sürümleri (bulut TAM ister) ──");
    const v = { urun: urun.catalogVersion, kalem: proj("fatura-kalemi").catalogVersion, fiyat: proj("fiyat").catalogVersion, hizmet: hizmet.catalogVersion };
    check("§7a ⭐ urun 2 · fatura-kalemi 2 · fiyat 3 · hizmet 1", v.urun === 2 && v.kalem === 2 && v.fiyat === 3 && v.hizmet === 1, JSON.stringify(v));
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
