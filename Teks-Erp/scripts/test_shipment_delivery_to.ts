// =============================================================================
// BEKÇİ — SEVKİYATTA TESLİM YERİ (K18, fabrika cevabı 24-C, 2026-11-03)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_shipment_delivery_to.ts   (DB'li; TEST- fikstürü)
//
// Kural: mal bazen sahibine değil boyahaneye gider. Sevkiyatın carisi malın SAHİBİ
// kalır; `Shipment.deliveryCustomerId` + `deliveryAddress` yalnız belgeye basılan
// teslim yeridir. Ölçer:
//   §0 statik — tek doğrulayıcı (`resolveDeliveryToTx`) çekirdekte + düzenleyicide;
//      sahiplik kapısı `shipmentHeader.customerId`i okur (teslim yerini DEĞİL);
//      Shipment BaseController modeli değil (jenerik PATCH sızıntısı yok); zod alanları
//      opsiyonel; merge haritası + arşiv kapısı yeni FK'yı tanır.
//   §1 alan gelmeyince null — createShipment + Hızlı Sevk alanı göndermeden; snapshot
//      header'da `deliveryTo` anahtarı YOK, irsaliyede "Teslim Yeri" basılmaz.
//   §2 yazma/okuma — kurulumda teslim yeri (boyahane) + adres → kolonlar, detay, snapshot
//      DOĞARKEN donar; adres boşsa kart adresi; sonradan kart adresi değişse donmuş belge değişmez.
//   §3 PLANNED düzenleme — yaz/değiştir/temizle; DISPATCHED → 409 SHIPMENT_NOT_PLANNED; yok → 404.
//   §4 red — pasif cari · sevkiyatın kendi carisi · bulunamayan cari · carisiz adres → 400 + details.code
//      (kurulumda da düzenlemede de; red sevkiyatı doğurmaz).
//   §5 sahiplik kapısı iki yön — emanet top (sahip M): cari M + teslim yeri B → sevk OK;
//      cari B (teslim yeri M bile olsa) → 409 OWNER_MISMATCH.
//   §6 arşiv — PLANNED sevkiyatın teslim yeri olan cari pasife alınamaz (canlı referans).
//
// NEGATİF SONDALAR (2026-11-03, kırmızı görülüp geri alındı):
//   ① `resolveDeliveryToTx`te `id === ownerCustomerId` kontrolü düşürülünce §4b/§4e/§4f/§4g ❌ (29/4)
//   ② setDeliveryTo claim'inden `status: PLANNED` düşürülünce §0b/§3d ❌ (31/2)
//   ③ snapshot'ta `...(deliveryTo ? { deliveryTo } : {})` yerine `deliveryTo` her zaman yazılınca §1b ❌ (32/1)
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrintedDocType, RollEntrySource, RollStatus, ShipmentStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";
import { printedDocumentService, type PrintedDocSnapshot } from "../src/services/printed-document.service";
import { renderShipmentDispatchHtml } from "../src/services/document-render/shipment-dispatch.html";
import { listArchiveBlockers } from "../src/services/helpers/master-data-archive.helper";
import { CUSTOMER_ARCHIVE } from "../src/services/helpers/archive-gate/customer-archive.helper";
import { createShipmentSchema, deliveryToSchema, quickShipmentSchema } from "../src/controllers/shipping.controller";
import { AppError } from "../src/utils/app-error";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";

const ship = new ShippingService();
const ROOT = path.join(__dirname, "..");
const P = `TEST-DLV-${Date.now().toString(36).toUpperCase()}`;
const LINE = "Teslim Yeri:";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
async function hata(fn: () => Promise<unknown>): Promise<AppError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
}
const kod = (e: AppError | null): string => (e ? `${e.statusCode}/${String(e.details?.code ?? "")}` : "hata yok");

const ids = { customers: [] as string[], item: "", rolls: [] as string[], sacks: [] as string[], shipments: [] as string[] };
let userId = "";
let whId = "";

function statik(): void {
  console.log("── §0 Statik ──");
  const svc = readFileSync(path.join(ROOT, "src/services/shipping.service.ts"), "utf8");
  const core = svc.slice(svc.indexOf("private async createShipmentCoreTx("), svc.indexOf("private async createShipmentCoreTx(") + 6000);
  const setter = svc.slice(svc.indexOf("async setDeliveryTo("), svc.indexOf("async setDeliveryTo(") + 1500);
  check("§0a tek doğrulayıcı: kurulum çekirdeği ve PLANNED düzenleyici `resolveDeliveryToTx` çağırır",
    /await resolveDeliveryToTx\(tx, p\.customerId,/.test(core) && /await resolveDeliveryToTx\(tx, sh\.customerId, input\)/.test(setter));
  check("§0b düzenleme atomik claim `{id, status: PLANNED}` + count 0 → 409 SHIPMENT_NOT_PLANNED",
    /updateMany\(\{\s*where: \{ id: shipmentId, status: ShipmentStatus\.PLANNED \}/.test(setter) && /claimed\.count === 0/.test(setter) && /SHIPMENT_NOT_PLANNED/.test(setter));
  const dispatch = svc.slice(svc.indexOf("private async performDispatchTx("), svc.indexOf("private async performDispatchTx(") + 6000);
  check("§0c sahiplik kapısı DEĞİŞMEDİ — `assertOwnerMatchesTx` sevkiyatın carisini okur, teslim yerini değil",
    /assertOwnerMatchesTx\(tx, \{ rollIds: shipmentRollIds, customerId: shipmentHeader\.customerId/.test(dispatch) && !/deliveryCustomerId/.test(dispatch));
  const searchEnt = readFileSync(path.join(ROOT, "src/constants/search-entities.ts"), "utf8");
  const ctlDir = readFileSync(path.join(ROOT, "src/controllers/shipping.controller.ts"), "utf8");
  check("§0d BaseController sızıntısı yok — Shipment jenerik CRUD modeli değil (yazım yalnız açık uçlardan)",
    !/extends BaseController/.test(ctlDir) && !/BaseService<"shipment"|modelName: "shipment"[\s\S]{0,200}BaseController/.test(searchEnt));
  const merge = readFileSync(path.join(ROOT, "src/constants/merge-map.customer.ts"), "utf8");
  check("§0e birleştirme haritası `shipments.deliveryCustomerId`i taşır", /table: "shipments", column: "deliveryCustomerId"/.test(merge));
  const z1 = createShipmentSchema.safeParse({ sackIds: ["00000000-0000-4000-8000-000000000001"], customerId: "00000000-0000-4000-8000-000000000002" });
  const z2 = quickShipmentSchema.safeParse({ rollIds: ["00000000-0000-4000-8000-000000000001"], customerId: "00000000-0000-4000-8000-000000000002" });
  const z3 = deliveryToSchema.safeParse({ deliveryCustomerId: "x" });
  const z4 = deliveryToSchema.safeParse({ deliveryCustomerId: null, deliveryAddress: "a".repeat(501) });
  check("§0f zod: iki kurulum şeması alansız gövdeyi kabul eder (eski istemci); geçersiz uuid ve 500+ adres red",
    z1.success && z2.success && z1.data.deliveryCustomerId === undefined && !z3.success && !z4.success);
}

async function cari(ad: string, extra: Record<string, unknown> = {}): Promise<string> {
  const c = await prisma.customer.create({ data: { code: `${P}-${ad}`, name: `${P} ${ad}`, ...extra }, select: { id: true } });
  ids.customers.push(c.id);
  return c.id;
}
async function top(n: string, owner: string | null): Promise<{ id: string; barcode: string }> {
  const r = await prisma.roll.create({
    data: {
      warehouseId: whId, barcode: `${P}-${n}`, itemId: ids.item, width: 150, initialQty: 100, currentQty: 100,
      status: RollStatus.WAREHOUSE, qualityGrade: "1.KALITE", entrySource: RollEntrySource.SUPPLIER_RECEIPT,
      ownerCustomerId: owner,
    },
    select: { id: true, barcode: true },
  });
  ids.rolls.push(r.id);
  return { id: r.id, barcode: r.barcode as string };
}
async function cuval(customerId: string, roll: { barcode: string }): Promise<string> {
  const s = (await ship.openSack({ customerId }, userId)).data as { id: string };
  ids.sacks.push(s.id);
  await ship.scanIntoSack({ sackId: s.id, barcode: roll.barcode }, userId);
  return s.id;
}
async function belge(shipmentId: string): Promise<{ header: Record<string, unknown>; snap: PrintedDocSnapshot } | null> {
  const row = await prisma.printedDocument.findFirst({ where: { docType: PrintedDocType.SHIPMENT_DISPATCH, sourceId: shipmentId }, orderBy: { version: "desc" }, select: { snapshot: true } });
  if (!row) return null;
  const snap = row.snapshot as unknown as PrintedDocSnapshot;
  return { header: (snap.doc as { header: Record<string, unknown> }).header, snap };
}
const planli = async (customerId: string, n: string): Promise<string> => {
  const s = await prisma.shipment.create({ data: { shipmentNo: `${P}-PL-${n}`, customerId, status: ShipmentStatus.PLANNED }, select: { id: true } });
  ids.shipments.push(s.id);
  return s.id;
};

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exitCode = 2; return; }
  statik();
  userId = (await ensureTestAdmin()).id;
  whId = await fixtureWarehouseId();
  ids.item = (await prisma.item.create({ data: { code: `${P}-I`, name: `${P} KUMAS`, itemType: "FABRIC" }, select: { id: true } })).id;
  const M = await cari("SAHIP");
  const B = await cari("BOYAHANE", { address: "OSB 3. Cadde No:12", district: "Nilüfer", city: "Bursa" });
  const X = await cari("PASIF", { isActive: false });

  // ── §1 alan gelmeyince null ──
  console.log("\n── §1 Alan gelmeyince null (bugünkü davranış) ──");
  const s1 = (await ship.createShipment({ sackIds: [await cuval(M, await top("R1", null))], customerId: M, orderless: true }, userId)).data as { id: string; status: string };
  ids.shipments.push(s1.id);
  check("§1 körlük zemini: sevk onayı kapalı → anında DISPATCHED (snapshot aynı tx'te doğdu)", s1.status === ShipmentStatus.DISPATCHED, s1.status);
  const c1 = await prisma.shipment.findUnique({ where: { id: s1.id }, select: { deliveryCustomerId: true, deliveryAddress: true } });
  check("§1a çuvaldan kurulum alansız → iki kolon NULL", c1?.deliveryCustomerId === null && c1?.deliveryAddress === null);
  const b1 = await belge(s1.id);
  check("§1b ⭐ snapshot header'da `deliveryTo` anahtarı YOK (bayt bayt bugünkü)", !!b1 && !("deliveryTo" in b1.header), JSON.stringify(Object.keys(b1?.header ?? {})));
  check("§1c irsaliyede 'Teslim Yeri' basılmaz", !!b1 && !renderShipmentDispatchHtml(b1.snap, {}).includes(LINE));
  const q1 = (await ship.createShipmentFromRolls({ rollIds: [(await top("R1Q", null)).id], customerId: M, orderless: true }, userId)).data as { id: string };
  ids.shipments.push(q1.id);
  const cq = await prisma.shipment.findUnique({ where: { id: q1.id }, select: { deliveryCustomerId: true, deliveryAddress: true, sacks: { select: { id: true } } } });
  ids.sacks.push(...(cq?.sacks.map((s) => s.id) ?? []));
  check("§1d Hızlı Sevk alansız → iki kolon NULL", cq?.deliveryCustomerId === null && cq?.deliveryAddress === null);

  // ── §2 yazma/okuma + donma ──
  console.log("\n── §2 Kurulumda teslim yeri → detay + snapshot DOĞARKEN donar ──");
  const s2 = (await ship.createShipment({ sackIds: [await cuval(M, await top("R2", null))], customerId: M, orderless: true, deliveryCustomerId: B, deliveryAddress: "  Depo kapısı 2, Gürsu  " }, userId)).data as { id: string };
  ids.shipments.push(s2.id);
  const c2 = await prisma.shipment.findUnique({ where: { id: s2.id }, select: { customerId: true, deliveryCustomerId: true, deliveryAddress: true } });
  check("§2a kolonlar yazıldı (adres kırpılmış), carisi SAHİP kaldı", c2?.customerId === M && c2?.deliveryCustomerId === B && c2?.deliveryAddress === "Depo kapısı 2, Gürsu");
  const d2 = (await ship.getShipmentById(s2.id)).data as { deliveryCustomer: { id: string; name: string; address: string | null } | null; deliveryAddress: string | null };
  check("§2b detay `deliveryCustomer {id,name,address}` + `deliveryAddress` döner", d2.deliveryCustomer?.id === B && d2.deliveryAddress === "Depo kapısı 2, Gürsu" && d2.deliveryCustomer?.address === "OSB 3. Cadde No:12, Nilüfer, Bursa", JSON.stringify(d2.deliveryCustomer));
  const b2 = await belge(s2.id);
  const dt2 = b2?.header.deliveryTo as { name: string; address: string | null } | undefined;
  check("§2c ⭐ snapshot `header.deliveryTo` = {boyahane adı, kayıtlı adres}", dt2?.name === `${P} BOYAHANE` && dt2?.address === "Depo kapısı 2, Gürsu", JSON.stringify(dt2));
  const html2 = b2 ? renderShipmentDispatchHtml(b2.snap, {}) : "";
  check("§2d irsaliyede 'Teslim Yeri: <b>ad</b> — adres' basılır; SAYIN hâlâ sahip", html2.includes(`${LINE} <b>${P} BOYAHANE</b> — Depo kapısı 2, Gürsu`) && html2.includes(`<b>${P} SAHIP</b>`));
  const s2b = (await ship.createShipment({ sackIds: [await cuval(M, await top("R2B", null))], customerId: M, orderless: true, deliveryCustomerId: B }, userId)).data as { id: string };
  ids.shipments.push(s2b.id);
  const b2b = await belge(s2b.id);
  check("§2e adres boş → belge doğarken teslim carisinin KART adresi", (b2b?.header.deliveryTo as { address?: string } | undefined)?.address === "OSB 3. Cadde No:12, Nilüfer, Bursa");
  await prisma.customer.update({ where: { id: B }, data: { address: "YENİ ADRES", name: `${P} BOYAHANE YENI` } });
  const b2c = (await printedDocumentService.getCurrent(PrintedDocType.SHIPMENT_DISPATCH, s2b.id)).data as { snapshot: { doc: { header: { deliveryTo?: { name: string; address: string } } } } } | null;
  check("§2f ⭐ sevk sonrası kart değişse de donmuş belge ESKİ ad + adresi taşır", b2c?.snapshot.doc.header.deliveryTo?.name === `${P} BOYAHANE` && b2c?.snapshot.doc.header.deliveryTo?.address === "OSB 3. Cadde No:12, Nilüfer, Bursa", JSON.stringify(b2c?.snapshot.doc.header.deliveryTo));
  await prisma.customer.update({ where: { id: B }, data: { address: "OSB 3. Cadde No:12", name: `${P} BOYAHANE` } });

  // ── §3 PLANNED düzenleme ──
  console.log("\n── §3 Yalnız PLANNED'de düzenlenir ──");
  const pl = await planli(M, "1");
  const r3a = await ship.setDeliveryTo(pl, { deliveryCustomerId: B, deliveryAddress: "Kapı 5" }, userId);
  const c3a = await prisma.shipment.findUnique({ where: { id: pl }, select: { deliveryCustomerId: true, deliveryAddress: true } });
  check("§3a PLANNED'e yazıldı", r3a.success && c3a?.deliveryCustomerId === B && c3a?.deliveryAddress === "Kapı 5");
  const prev = (await ship.getDispatchReport(pl)).data as { header: Record<string, unknown> };
  check("§3b PLANNED taslak önizleme de teslim yerini gösterir", (prev.header.deliveryTo as { name?: string } | undefined)?.name === `${P} BOYAHANE`);
  await ship.setDeliveryTo(pl, { deliveryCustomerId: null }, userId);
  const c3c = await prisma.shipment.findUnique({ where: { id: pl }, select: { deliveryCustomerId: true, deliveryAddress: true } });
  check("§3c `deliveryCustomerId: null` teslim yerini kaldırır (iki kolon NULL)", c3c?.deliveryCustomerId === null && c3c?.deliveryAddress === null);
  const e3d = await hata(() => ship.setDeliveryTo(s1.id, { deliveryCustomerId: B }, userId));
  const c3d = await prisma.shipment.findUnique({ where: { id: s1.id }, select: { deliveryCustomerId: true } });
  check("§3d ⭐ sevk EDİLMİŞ sevkiyat → 409 SHIPMENT_NOT_PLANNED, kolon değişmez", kod(e3d) === "409/SHIPMENT_NOT_PLANNED" && c3d?.deliveryCustomerId === null, kod(e3d));
  const e3e = await hata(() => ship.setDeliveryTo("00000000-0000-4000-8000-00000000dead", { deliveryCustomerId: B }, userId));
  check("§3e olmayan sevkiyat → 404", e3e?.statusCode === 404, kod(e3e));

  // ── §4 red ──
  console.log("\n── §4 Red: pasif / aynı cari / bulunamayan / carisiz adres ──");
  check("§4a pasif cari → 400 DELIVERY_CUSTOMER_INACTIVE", kod(await hata(() => ship.setDeliveryTo(pl, { deliveryCustomerId: X }, userId))) === "400/DELIVERY_CUSTOMER_INACTIVE");
  check("§4b ⭐ sevkiyatın kendi carisi → 400 DELIVERY_SAME_AS_OWNER", kod(await hata(() => ship.setDeliveryTo(pl, { deliveryCustomerId: M }, userId))) === "400/DELIVERY_SAME_AS_OWNER");
  check("§4c bulunamayan cari → 400 DELIVERY_CUSTOMER_NOT_FOUND", kod(await hata(() => ship.setDeliveryTo(pl, { deliveryCustomerId: "00000000-0000-4000-8000-00000000beef" }, userId))) === "400/DELIVERY_CUSTOMER_NOT_FOUND");
  check("§4d carisiz adres → 400 DELIVERY_ADDRESS_WITHOUT_CUSTOMER", kod(await hata(() => ship.setDeliveryTo(pl, { deliveryCustomerId: null, deliveryAddress: "Bir yer" }, userId))) === "400/DELIVERY_ADDRESS_WITHOUT_CUSTOMER");
  const once = await prisma.shipment.count({ where: { customerId: M } });
  const sk4 = await cuval(M, await top("R4", null));
  const e4e = await hata(() => ship.createShipment({ sackIds: [sk4], customerId: M, orderless: true, deliveryCustomerId: X }, userId));
  const e4f = await hata(() => ship.createShipment({ sackIds: [sk4], customerId: M, orderless: true, deliveryCustomerId: M }, userId));
  check("§4e kurulumda pasif cari → 400, sevkiyat DOĞMAZ", kod(e4e) === "400/DELIVERY_CUSTOMER_INACTIVE" && (await prisma.shipment.count({ where: { customerId: M } })) === once);
  check("§4f kurulumda kendi carisi → 400, çuval depoda kalır", kod(e4f) === "400/DELIVERY_SAME_AS_OWNER" && (await prisma.sack.findUnique({ where: { id: sk4 }, select: { shipmentId: true } }))?.shipmentId === null);
  check("§4g Türkçe mesaj", /Teslim yeri sevkiyatın kendi carisi olamaz/.test(e4f?.message ?? ""));

  // ── §5 sahiplik kapısı iki yön ──
  console.log("\n── §5 Sahiplik kapısı DEĞİŞMEZ (iki yön) ──");
  const emanet1 = await top("E1", M);
  const s5 = (await ship.createShipment({ sackIds: [await cuval(M, emanet1)], customerId: M, orderless: true, deliveryCustomerId: B }, userId)).data as { id: string; status: string };
  ids.shipments.push(s5.id);
  check("§5a ⭐ emanet top (sahip M) + cari M + teslim yeri boyahane → sevk OK", s5.status === ShipmentStatus.DISPATCHED, s5.status);
  const emanet2 = await top("E2", M);
  const sk5 = await cuval(B, emanet2);
  const e5b = await hata(() => ship.createShipment({ sackIds: [sk5], customerId: B, orderless: true }, userId));
  check("§5b ⭐ aynı emanet top carisi BOYAHANE → 409 OWNER_MISMATCH", kod(e5b) === "409/OWNER_MISMATCH", kod(e5b));
  const e5c = await hata(() => ship.createShipment({ sackIds: [sk5], customerId: B, orderless: true, deliveryCustomerId: M }, userId));
  check("§5c carisi boyahane, teslim yeri SAHİP olsa bile → yine 409 OWNER_MISMATCH (teslim yeri kapıyı açmaz)", kod(e5c) === "409/OWNER_MISMATCH", kod(e5c));

  // ── §6 arşiv kapısı ──
  console.log("\n── §6 Canlı referans: PLANNED teslim yeri ──");
  await ship.setDeliveryTo(pl, { deliveryCustomerId: B }, userId);
  const bl = await listArchiveBlockers(prisma, CUSTOMER_ARCHIVE, B);
  const ref = bl.find((k) => k.kind === "SHIPMENT_DELIVERY");
  check("§6a boyahane pasife alınamaz: SHIPMENT_DELIVERY engeli kayıtla listelenir", ref?.count === 1 && ref.records[0]?.id === pl, JSON.stringify(ref));
}

async function teardown(): Promise<void> {
  const sh = ids.shipments;
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: sh } } }).catch(() => {});
  await prisma.sackAllocation.deleteMany({ where: { sackId: { in: ids.sacks } } }).catch(() => {});
  await prisma.warehouseMovement.deleteMany({ where: { OR: [{ rollId: { in: ids.rolls } }, { shipmentId: { in: sh } }] } }).catch(() => {});
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids.rolls } } }).catch(() => {});
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids.rolls } } }).catch(() => {});
  await prisma.roll.updateMany({ where: { id: { in: ids.rolls } }, data: { sackId: null, shipmentId: null } }).catch(() => {});
  await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } }).catch(() => {});
  await prisma.sackWeighing.deleteMany({ where: { sackId: { in: ids.sacks } } }).catch(() => {});
  await prisma.sack.deleteMany({ where: { id: { in: ids.sacks } } }).catch(() => {});
  await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: sh } } }).catch(() => {});
  await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: sh } } }).catch(() => {});
  await prisma.shipment.deleteMany({ where: { id: { in: sh } } }).catch((e) => console.error("teardown shipment:", (e as Error).message));
  if (ids.item) await prisma.item.deleteMany({ where: { id: ids.item } }).catch(() => {});
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } }).catch((e) => console.error("teardown customer:", (e as Error).message));
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => {
    await teardown().catch((e) => console.error("teardown hatası:", e));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
