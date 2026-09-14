// =============================================================================
// BEKÇİ — ÇUVAL TAHSİSİ (SackAllocation) SİL-YAZ'DAN DAMGAYA (K2, 2026-09-14)
// =============================================================================
// `SackAllocation` sipariş karşılamasını belirleyen TİCARİ pivottur (defter.md ③a):
// yeniden hesap (sipariş kümesi değişimi · tahsis yenileme · sevkiyat iptali) eski
// satırı SİLMEZ, `clearedAt` + `clearedShipmentId` + `clearedById` ile damgalar
// (`SackTagAssignment.clearedAt` deseni). Tablo hem etkin hem damgalı satır taşır ⇒
// Σ okuyan HER yol `ACTIVE_SACK_ALLOCATION` süzer; süzmeyen bir yüzey karşılamayı şişirir.
//
//   §1 sipariş kümesi değişince eski tahsis SİLİNMEZ, damgalanır (clearedShipmentId = sevkiyat);
//      yeni satır etkin; Σ okuyucular (sipariş defteri shippedQty · sevkiyat tahsis Σ) yalnız etkin
//   §2 aynı (çuval, satır) damgalı satır DURURKEN yeniden tahsis edilebilir (PARTIAL unique)
//   §3 sevkiyat iptali tahsisleri damgalar (silmez); sipariş defteri geri düşer
//   §4 ⭐ AST + tip: `sackAllocation` delegate/ilişki okumalarının HEPSİ `ACTIVE_SACK_ALLOCATION` taşır,
//      `delete/deleteMany` YOK, ham SQL `"clearedAt" IS NULL` — `revoke-ast-tarama` (damga: clearedAt)
//   §5 SQL ikizi (`consistency-check.sql` + `test_consistency.ts`) her `sack_allocations` başvurusunda
//      süzgeç taşır (qty ≤ 0 satırı beyanlı istisna)
//   §6 damgalı satırın ileri kaydı DEĞİŞMEZ: qty/sackId/orderLineId aynı, sadece damga
//
// NEGATİF SONDALAR (2026-09-14, cp + sha256): `order-status.helper`ten `...ACTIVE_SACK_ALLOCATION`
// düşürüldü → §4 ihlal ❌ VE §1 shippedQty şişti (300 → 600) ❌ · `clearShipmentAllocationsTx`
// deleteMany'e çevrildi → §1/§3 "satır silinmedi" ❌ + §4 silme ❌.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RollStatus, ShipmentStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";
import { ACTIVE_SACK_ALLOCATION } from "../src/services/helpers/sack-allocation.helper";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { aktifYuklemTara, sqlEksikSuzgec } from "./revoke-ast-tarama";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const ts = Date.now();
const TAG = `TST-SAC-${ts}`;
const svc = new ShippingService();
const sackIds: string[] = [];
const rollIds: string[] = [];
const shipmentIds: string[] = [];
let customerId = "";
let itemId = "";
let onayEskiDeger: string | null = null;

async function makeSack(tag: string, qty: number): Promise<string> {
  const sack = await prisma.sack.create({ data: { sackNo: `${TAG}-${tag}`, customerId }, select: { id: true } });
  sackIds.push(sack.id);
  const roll = await prisma.roll.create({
    data: {
      warehouseId: await fixtureWarehouseId(),
      barcode: `${TAG}-${tag}`,
      itemId,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.WAREHOUSE,
      sackId: sack.id,
    },
    select: { id: true },
  });
  rollIds.push(roll.id);
  return sack.id;
}

async function kur(sackId: string, orderIds: string[]): Promise<string> {
  const r = await svc.createShipment({ sackIds: [sackId], customerId, orderIds }, undefined);
  const id = (r.data as { id: string }).id;
  shipmentIds.push(id);
  return id;
}

interface Satir { id: string; sackId: string; orderLineId: string; qty: number; clearedAt: Date | null; clearedShipmentId: string | null }
async function satirlar(sackId: string): Promise<Satir[]> {
  const rows = await prisma.sackAllocation.findMany({
    // `clearedAt` SÜZÜLMEZ: bekçi damgalı satırın DURDUĞUNU ölçüyor
    where: { sackId },
    orderBy: { createdAt: "asc" },
    select: { id: true, sackId: true, orderLineId: true, qty: true, clearedAt: true, clearedShipmentId: true },
  });
  return rows.map((r) => ({ ...r, qty: Number(r.qty) }));
}
async function etkinToplam(lineId: string): Promise<number> {
  const a = await prisma.sackAllocation.aggregate({ where: { orderLineId: lineId, ...ACTIVE_SACK_ALLOCATION }, _sum: { qty: true } });
  return Number(a._sum.qty ?? 0);
}
async function shippedOf(lineId: string): Promise<number> {
  const l = await prisma.orderLine.findUnique({ where: { id: lineId }, select: { shippedQty: true } });
  return Number(l?.shippedQty ?? 0);
}

async function main(): Promise<void> {
  console.log("\n=== SackAllocation DAMGA — sil-yaz yok, etkin yüklem tek kaynak ===\n");
  const customer = await prisma.customer.create({ data: { code: `${TAG}-CUS`, name: `Tahsis damgası ${ts}` }, select: { id: true } });
  customerId = customer.id;
  const item = await prisma.item.create({ data: { code: `${TAG}-ITM`, name: `Tahsis kumaş ${ts}`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  itemId = item.id;
  const eski = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED }, select: { value: true } });
  onayEskiDeger = eski ? JSON.stringify(eski.value) : null;
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED },
    create: { key: SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED, value: true },
    update: { value: true },
  });

  const orderA = await prisma.order.create({
    data: { orderNumber: `TEST-SAC-A-${ts}`, customerId, lines: { create: [{ itemId, quantity: 500 }] } },
    select: { id: true, lines: { select: { id: true } } },
  });
  const orderB = await prisma.order.create({
    data: { orderNumber: `TEST-SAC-B-${ts}`, customerId, lines: { create: [{ itemId, quantity: 500 }] } },
    select: { id: true, lines: { select: { id: true } } },
  });
  const lineA = orderA.lines[0]!.id;
  const lineB = orderB.lines[0]!.id;

  // ── §1 sipariş kümesi değişimi: eski satır damgalanır, yeni satır etkin ──────
  const sackA = await makeSack("A", 300);
  const sh = await kur(sackA, [orderA.id]);
  const s1 = await satirlar(sackA);
  check("§1a fikstür: A siparişine 300 m etkin tahsis", s1.length === 1 && s1[0]!.orderLineId === lineA && s1[0]!.qty === 300 && s1[0]!.clearedAt === null, JSON.stringify(s1));

  await svc.setShipmentOrders(sh, [orderB.id], undefined);
  const s2 = await satirlar(sackA);
  const eskiA = s2.find((r) => r.orderLineId === lineA);
  const yeniB = s2.find((r) => r.orderLineId === lineB);
  check("§1b ⭐ eski tahsis SİLİNMEDİ — damgalı, clearedShipmentId = sevkiyat", eskiA !== undefined && eskiA.clearedAt !== null && eskiA.clearedShipmentId === sh, JSON.stringify(eskiA));
  check("§1c yeni tahsis etkin (B, 300)", yeniB !== undefined && yeniB.clearedAt === null && yeniB.qty === 300, JSON.stringify(yeniB));
  check("§1d ⭐ Σ okuyucu yalnız ETKİN satırı toplar — A 0 / B 300", (await etkinToplam(lineA)) === 0 && (await etkinToplam(lineB)) === 300);
  check("§1e sipariş defteri (shippedQty) PLANNED'da 0 (damgalı satır sayılmadı, sevk yok)", (await shippedOf(lineA)) === 0 && (await shippedOf(lineB)) === 0);

  // ── §2 partial unique: aynı (çuval, satır) damgalı satır dururken yeniden tahsis ──
  await svc.setShipmentOrders(sh, [orderA.id], undefined);
  const s3 = await satirlar(sackA);
  const aSatirlari = s3.filter((r) => r.orderLineId === lineA);
  check("§2a ⭐ aynı (çuval, A satırı) damgalı dururken YENİDEN tahsis edildi (partial unique)", aSatirlari.length === 2 && aSatirlari.filter((r) => r.clearedAt === null).length === 1, `A satırı ${aSatirlari.length}, etkin ${aSatirlari.filter((r) => r.clearedAt === null).length}`);
  check("§2b B satırı damgalandı", s3.find((r) => r.orderLineId === lineB)?.clearedAt !== null);
  check("§2c toplam satır 3 (hiçbiri silinmedi), etkin 1", s3.length === 3 && s3.filter((r) => r.clearedAt === null).length === 1);
  const cift = await prisma.sackAllocation.count({ where: { sackId: sackA, orderLineId: lineA, ...ACTIVE_SACK_ALLOCATION } });
  check("§2d etkin (çuval, satır) çifti TEK (sed: sack_allocations_active_uq)", cift === 1, `${cift}`);

  // ── §6 damgalı satırın ileri kaydı değişmedi ─────────────────────────────
  const damgali = aSatirlari.find((r) => r.clearedAt !== null);
  check("§6 damgalı satırın ileri kaydı DEĞİŞMEDİ (qty 300, aynı çuval/satır)", damgali?.qty === 300 && damgali.sackId === sackA && damgali.orderLineId === lineA);

  // ── §3 sevkiyat iptali: damga, silme değil ────────────────────────────────
  await svc.dispatchShipment(sh, {}, undefined);
  check("§3a sevk sonrası sipariş defteri A 300 (etkin tahsis)", (await shippedOf(lineA)) === 300, `${await shippedOf(lineA)}`);
  // Sevk tahsisi YENİDEN hesaplar (`writeShipmentAllocationsTx`): eski etkin satır damgalanır,
  // yenisi doğar — satır sayısı DÜŞMEZ, etkin hep 1.
  const sevkSonrasi = await satirlar(sackA);
  check("§3a2 sevk satır SİLMEDİ (≥3 satır), etkin 1", sevkSonrasi.length >= 3 && sevkSonrasi.filter((r) => r.clearedAt === null).length === 1, `${sevkSonrasi.length} satır, etkin ${sevkSonrasi.filter((r) => r.clearedAt === null).length}`);
  await svc.undoDispatch(sh, "bekçi §3 storno", undefined);
  check("§3a3 storno sonrası sipariş defteri 0, tahsis satırları yine 3/1 (storno tahsise dokunmaz)", (await shippedOf(lineA)) === 0 && (await satirlar(sackA)).filter((r) => r.clearedAt === null).length === 1, `${await shippedOf(lineA)}`);
  const durum = await prisma.shipment.findUnique({ where: { id: sh }, select: { status: true } });
  check("§3a4 storno sonrası sevkiyat PLANNED", durum?.status === ShipmentStatus.PLANNED, durum?.status ?? "");
  const iptalOncesi = (await satirlar(sackA)).length;
  await svc.cancelShipment(sh, undefined);
  const s4 = await satirlar(sackA);
  check("§3b ⭐ iptal tahsisleri SİLMEDİ — satır sayısı aynı, hepsi damgalı", s4.length === iptalOncesi && s4.every((r) => r.clearedAt !== null), `${s4.length}/${iptalOncesi}, etkin ${s4.filter((r) => r.clearedAt === null).length}`);
  check("§3c iptal sonrası Σ etkin 0 ve sipariş defteri 0", (await etkinToplam(lineA)) === 0 && (await shippedOf(lineA)) === 0);

  // ── §4 AST + tip taraması ─────────────────────────────────────────────────
  const kok = join(__dirname, "..");
  const r = aktifYuklemTara(kok, [
    {
      delegate: "sackAllocation",
      model: "SackAllocation",
      sabit: "ACTIVE_SACK_ALLOCATION",
      tablo: "sack_allocations",
      helper: join("src", "services", "helpers", "sack-allocation.helper.ts"),
      damga: "clearedAt",
    },
  ]).get("sackAllocation")!;
  check("§4a ⭐ her delegate okuma/güncelleme ACTIVE_SACK_ALLOCATION taşır", r.cagriSayisi >= 6 && r.cagriIhlal.length === 0, `çağrı=${r.cagriSayisi}${r.cagriIhlal.length ? " İHLAL: " + r.cagriIhlal.join(", ") : ""}`);
  check("§4b ⭐ her ilişki okuması (allocations: {…}) ACTIVE_SACK_ALLOCATION taşır", r.iliskiSayisi >= 5 && r.iliskiIhlal.length === 0, `ilişki=${r.iliskiSayisi}${r.iliskiIhlal.length ? " İHLAL: " + r.iliskiIhlal.join(", ") : ""}`);
  check("§4c ⭐ delete/deleteMany YOK (sil-yaz bitti)", r.silme.length === 0, r.silme.join(", ") || "0");
  check("§4d ham SQL başvuruları \"clearedAt\" IS NULL taşır", r.sqlIhlal.length === 0, `sql=${r.sqlSayisi}${r.sqlIhlal.length ? " İHLAL: " + r.sqlIhlal.join(", ") : ""}`);
  console.log(`   istisnalar: ${r.istisnalar.length ? r.istisnalar.join(", ") : "yok"}`);

  // ── §5 SQL ikizi ──────────────────────────────────────────────────────────
  for (const dosya of ["scripts/consistency-check.sql", "scripts/test_consistency.ts"]) {
    const metin = readFileSync(join(kok, dosya), "utf8");
    const eksik = sqlEksikSuzgec(metin, "sack_allocations", "clearedAt") ?? [];
    // TEK beyanlı istisna: alias'sız `qty <= 0` sondası (damgalı satırda da qty > 0) — "(alias yok) 0/1".
    // Alias'lı her başvuru (sal · sa) süzgeç taşımak zorunda; ikinci bir alias'sız başvuru da kırmızı.
    const gercek = eksik.filter((e) => e !== "(alias yok) 0/1");
    check(`§5 ${dosya}: sack_allocations başvuruları süzgeçli (tek beyanlı istisna: alias'sız qty≤0)`, gercek.length === 0 && eksik.length <= 1, gercek.join(", ") || `eksik: ${eksik.join(", ") || "yok"}`);
  }
}

async function cleanup(): Promise<void> {
  if (onayEskiDeger !== null) {
    await prisma.systemSetting.update({ where: { key: SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED }, data: { value: JSON.parse(onayEskiDeger) as boolean } }).catch(() => {});
  } else {
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED } }).catch(() => {});
  }
  const sids = [...new Set(shipmentIds)];
  await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackIds } } }).catch(() => {}); // fikstür temizliği — üretim yolu değil
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: sids } } }).catch(() => {});
  await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: sids } } }).catch(() => {});
  await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: sids } } }).catch(() => {});
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
  await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
  await prisma.sack.deleteMany({ where: { id: { in: sackIds } } }).catch(() => {});
  await prisma.shipment.deleteMany({ where: { id: { in: sids } } }).catch(() => {});
  await prisma.orderLine.deleteMany({ where: { order: { orderNumber: { startsWith: "TEST-SAC-" } } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { orderNumber: { startsWith: "TEST-SAC-" } } }).catch(() => {});
  if (itemId) await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => {});
  if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => {});
}

main()
  .catch((err) => {
    console.error("Beklenmeyen hata:", err);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
