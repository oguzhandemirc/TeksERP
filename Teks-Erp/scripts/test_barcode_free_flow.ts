// =============================================================================
// BEKÇİ — BARKODSUZ ÇALIŞMA: uçtan uca zincir, tek okutma olmadan
// =============================================================================
// Çalıştırma: npx tsx scripts/test_barcode_free_flow.ts
//
// NEDEN: Ticaret personası (alım-satım firması) etiket BASMIYOR ve barkod
// OKUTMUYOR — stoğunu ekrandan yönetiyor. 2026-08-14 persona denetiminde
// ölçüldü ki sistem bunu üç yerde dayatıyordu: sevk (çuvala tek tek okutma),
// depo transferi (tek giriş okutma kutusu) ve iade (çuval/top kodu olmadan
// listeye ulaşılamıyor). Bu bekçi, o kullanıcının zincirin TAMAMINI kod
// yazmadan yürütebildiğini kilitler.
//
// ⚠️ İDDİA "barkod YOK" DEĞİL, "barkod GEREKMİYOR". Barkod bu sistemde topun
// KİMLİĞİdir ve doğduğu an verilir (kök CLAUDE.md 2026-08-05); mesele onu
// operatörün OKUMAK/YAZMAK zorunda olup olmadığı. Bu yüzden fixture bilinçli
// olarak barkodu NULL'lar: etiket hiç basılmamış topu temsil eder.
//
// ÖLÇÜLENLER:
//   §1 KEŞİF barkodsuz: FIFO önerisi barkodsuz topu döndürür
//   §2 SEVK barkodsuz: `createShipmentFromRolls` yalnız id ile sevk eder
//   §3 İADE barkodsuz: `createReturn({rollIds})` barkod istemez
//   §4 TRANSFER barkodsuz: depodaki çuvallar listelenir + id ile taşınır
//   §5 ⭐ Sevkiyata atanmış çuval öneri listesinde ÇIKMAZ (öneri↔create hizası)
// =============================================================================
import { RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { shippingService } from "../src/services/shipping.service";
import { warehouseTransferService } from "../src/services/warehouse-transfer.service";
import { returnService } from "../src/services/return.service";
import { InventoryService } from "../src/services/inventory.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";

const inventory = new InventoryService();

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

const TAG = `TEST-BF-${Date.now()}`;
const rollIds: string[] = [];
const sackIds: string[] = [];
const shipmentIds: string[] = [];
const warehouseIds: string[] = [];
const transferIds: string[] = [];
let customerId: string | null = null;
let itemId: string | null = null;

/** Etiket basılmamış top: barkod alanı NULL. */
async function makeBarcodelessRoll(item: string, qty: number, warehouseId?: string): Promise<string> {
  const res = await inventory.createInitialEntry({ itemId: item, initialQty: qty }, undefined, undefined, false, {
    forcedStatus: RollStatus.WAREHOUSE,
    ...(warehouseId ? { warehouseId } : {}),
  });
  const id = (res.data as { id: string }).id;
  rollIds.push(id);
  await prisma.roll.update({ where: { id }, data: { barcode: null } });
  return id;
}

async function main(): Promise<void> {
  console.log("=== Barkodsuz çalışma bekçisi ===\n");

  await ensureDefaultWarehouse();
  const item = await prisma.item.create({
    data: { code: `${TAG}-ITEM`, name: `${TAG} Kumaş`, unit: "MT", itemType: "FABRIC" },
    select: { id: true },
  });
  itemId = item.id;
  const customer = await prisma.customer.create({
    data: { code: TAG, name: `${TAG} Müşteri` },
    select: { id: true },
  });
  customerId = customer.id;

  // ── §1 KEŞİF ────────────────────────────────────────────────────────────
  // Kullanıcı "3 top X sattım" diyor; sistem topları KENDİSİ buluyor.
  const r1 = await makeBarcodelessRoll(item.id, 100);
  const r2 = await makeBarcodelessRoll(item.id, 120);
  const r3 = await makeBarcodelessRoll(item.id, 140);
  const sug = await shippingService.findShippableRolls({ itemId: item.id, limit: 10 });
  const sugIds = (sug.data as { id: string; barcode: string | null }[]).map((x) => x.id);
  check(
    "§1a Barkodsuz toplar FIFO önerisinde çıkıyor (keşif kod istemiyor)",
    [r1, r2, r3].every((id) => sugIds.includes(id)),
    `öneri=${sugIds.length}`,
  );
  check(
    "§1b Öneri satırı barkodun YOKLUĞUNU taşıyor (ekran '—' basabilsin)",
    (sug.data as { id: string; barcode: string | null }[]).every((x) => x.barcode === null),
  );

  // ── §2 SEVK ─────────────────────────────────────────────────────────────
  const ship = await shippingService.createShipmentFromRolls({
    rollIds: [r1, r2],
    customerId: customer.id,
  });
  const sd = ship.data as { id: string; shipmentNo: string };
  shipmentIds.push(sd.id);
  const shipped = await prisma.roll.findMany({
    where: { id: { in: [r1, r2] } },
    select: { shipmentId: true, sackId: true, status: true },
  });
  for (const s of shipped) if (s.sackId) sackIds.push(s.sackId);
  check(
    "§2 ⭐ SEVK barkodsuz tamamlandı (yalnız id)",
    shipped.every((s) => s.shipmentId === sd.id && s.status === RollStatus.SHIPPED),
    sd.shipmentNo,
  );

  // ── §3 İADE ─────────────────────────────────────────────────────────────
  // Müşteriden dönen malın üstünde etiket YOKTUR (hiç basılmadı) — iade uçları
  // barkod değil id kabul ettiği için akış kod olmadan kapanır.
  // İade kullanıcı ister (defter kaydı "kim aldı" sorusuna cevap verir).
  const actor = await prisma.user.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
  const ret = await returnService.createReturn(
    { rollIds: [r1], reasonText: `${TAG} hatalı sevk`, note: `${TAG} iade` },
    actor.id,
  );
  const retRoll = await prisma.roll.findUniqueOrThrow({
    where: { id: r1 },
    select: { status: true, shipmentId: true },
  });
  check(
    "§3 ⭐ İADE barkodsuz alındı (rollIds ile)",
    Boolean(ret.success) && retRoll.status !== RollStatus.SHIPPED,
    `statü=${retRoll.status}`,
  );

  // ── §4 TRANSFER ─────────────────────────────────────────────────────────
  const wA = await prisma.warehouse.create({
    data: { code: `${TAG}-A`, name: `${TAG} Depo A` },
    select: { id: true },
  });
  const wB = await prisma.warehouse.create({
    data: { code: `${TAG}-B`, name: `${TAG} Depo B` },
    select: { id: true },
  });
  warehouseIds.push(wA.id, wB.id);
  const tr1 = await makeBarcodelessRoll(item.id, 55, wA.id);
  const trRes = await warehouseTransferService.create({
    fromWarehouseId: wA.id,
    toWarehouseId: wB.id,
    rollIds: [tr1],
  });
  transferIds.push((trRes.data as { id: string }).id);
  const moved = await prisma.roll.findUniqueOrThrow({ where: { id: tr1 }, select: { warehouseId: true } });
  check("§4a ⭐ TRANSFER barkodsuz tamamlandı (yalnız id)", moved.warehouseId === wB.id);

  // Çuval seçimi de listeden: A deposunda serbest bir çuval kur.
  const freeSackRoll = await makeBarcodelessRoll(item.id, 65, wA.id);
  const openRes = await shippingService.openSack({ clientToken: crypto.randomUUID() });
  const freeSackId = (openRes.data as { id: string }).id;
  sackIds.push(freeSackId);
  await prisma.sack.update({ where: { id: freeSackId }, data: { warehouseId: wA.id } });
  await prisma.roll.update({ where: { id: freeSackRoll }, data: { sackId: freeSackId } });

  const listed = await warehouseTransferService.listWarehouseSacks({ warehouseId: wA.id, limit: 50 });
  const listedIds = (listed.data as { id: string; rollCount: number }[]).map((s) => s.id);
  check("§4b Depodaki serbest çuval LİSTELENİYOR (kod okutmadan)", listedIds.includes(freeSackId));
  check(
    "§4c Çuval satırı üye sayısı + metraj taşıyor (karar verdirecek bilgi)",
    (listed.data as { rollCount: number; totalQty: number }[]).some((s) => s.rollCount === 1 && s.totalQty === 65),
  );

  // ── §5 ÖNERİ ↔ CREATE HİZASI ────────────────────────────────────────────
  // ⭐ Sevkiyata atanmış çuval `create` tarafından REDDEDİLİYOR; listede
  // çıksaydı kullanıcı onu seçer ve tüm transferi 400'e düşürürdü.
  // ⚠️ ÖLÇÜM ARACI **PLANNED** SEVKİYATA ATANMIŞ ÇUVAL OLMAK ZORUNDA.
  // İlk yazımda sevk EDİLMİŞ çuval kullanılmıştı ve kontrol KÖRDÜ (ölçüldü):
  // sevkten sonra toplar `SHIPPED` oluyor, o statü zaten `TRANSFERABLE`ta
  // olmadığı için liste onu "üye topu yok" diye eliyordu → `shipmentId: null`
  // süzgeci silinse bile test yeşil kalıyordu. PLANNED'da toplar hâlâ
  // `WAREHOUSE`tur; çuvalı listeden eleyen TEK şey sevkiyat bağıdır.
  const assignedRoll = await makeBarcodelessRoll(item.id, 75, wA.id);
  const carrier = await shippingService.createShipmentFromRolls({
    rollIds: [await makeBarcodelessRoll(item.id, 5, wA.id)],
    customerId: customer.id,
  });
  const carrierId = (carrier.data as { id: string }).id;
  shipmentIds.push(carrierId);
  const plannedSack = await shippingService.openSack({ clientToken: crypto.randomUUID() });
  const plannedSackId = (plannedSack.data as { id: string }).id;
  sackIds.push(plannedSackId);
  await prisma.sack.update({
    where: { id: plannedSackId },
    data: { warehouseId: wA.id, customerId: customer.id, shipmentId: carrierId },
  });
  // ⚠️ Topun `shipmentId`'si de yazılır: `rolls_sackId_shipmentId_consistency`
  // composite FK'sı ikisinin uyumunu commit'te doğruluyor. Statü WAREHOUSE
  // KALIR — PLANNED sevkiyatın tanımı budur (mal daha çıkmadı).
  await prisma.roll.update({
    where: { id: assignedRoll },
    data: { sackId: plannedSackId, shipmentId: carrierId },
  });

  const listed2 = await warehouseTransferService.listWarehouseSacks({ warehouseId: wA.id, limit: 50 });
  const listed2Ids = (listed2.data as { id: string }[]).map((s) => s.id);
  check(
    "§5a ⭐ Sevkiyata atanmış (PLANNED) çuval listede ÇIKMIYOR (öneri↔create hizası)",
    !listed2Ids.includes(plannedSackId),
    `liste=${listed2Ids.length} çuval`,
  );
  // Ve transfer onu gerçekten reddediyor mu — hizanın ikinci ucu.
  let rejected = "";
  try {
    await warehouseTransferService.create({
      fromWarehouseId: wA.id,
      toWarehouseId: wB.id,
      rollIds: [],
      sackIds: [plannedSackId],
    });
  } catch (e) {
    rejected = (e as Error).message;
  }
  check("§5b ⭐ Ve transfer o çuvalı reddediyor (iki uç aynı cevap)", rejected.length > 0, rejected.slice(0, 60));

  // §5c — KÖRLÜK ZEMİNİ: liste gerçekten dolu mu? Boş dönen bir uç yukarıdaki
  // "çıkmıyor" kontrolünü VAKUMEN yeşil bırakırdı.
  check("§5c KÖRLÜK ZEMİNİ: liste boş değil (kontrol gerçekten ölçüyor)", listed2Ids.length >= 1, `n=${listed2Ids.length}`);

  // §5d ⭐ KARIŞIK ÇUVAL — bu kontrol yazılırken GERÇEK BİR HATA buldu.
  // İlk uygulama `rolls: { some: { status: { in: TRANSFERABLE } } }` diyordu:
  // "içinde bir tane uygun top VARSA listele". Oysa `create` çuvalı BÜTÜN
  // taşıyor ve TEK bir uygunsuz üye çuvalın TAMAMINI reddediyor → liste,
  // sevkin reddedeceği çuvalı öneriyordu. Doğru yüklem "hiçbir üyesi uygunsuz
  // DEĞİL"dir.
  const mixSack = await shippingService.openSack({ clientToken: crypto.randomUUID() });
  const mixSackId = (mixSack.data as { id: string }).id;
  sackIds.push(mixSackId);
  await prisma.sack.update({ where: { id: mixSackId }, data: { warehouseId: wA.id } });
  const okMember = await makeBarcodelessRoll(item.id, 30, wA.id);
  const badMember = await makeBarcodelessRoll(item.id, 40, wA.id);
  await prisma.roll.update({ where: { id: okMember }, data: { sackId: mixSackId } });
  await prisma.roll.update({
    where: { id: badMember },
    data: { sackId: mixSackId, status: RollStatus.CANCELLED },
  });

  const listed3 = await warehouseTransferService.listWarehouseSacks({ warehouseId: wA.id, limit: 50 });
  const listed3Ids = (listed3.data as { id: string }[]).map((s) => s.id);
  check(
    "§5d ⭐ Tek uygunsuz üyesi olan çuval listede ÇIKMIYOR (çuval BÜTÜN taşınır)",
    !listed3Ids.includes(mixSackId),
    `liste=${listed3Ids.length} çuval`,
  );
  let mixErr = "";
  try {
    await warehouseTransferService.create({
      fromWarehouseId: wA.id,
      toWarehouseId: wB.id,
      rollIds: [],
      sackIds: [mixSackId],
    });
  } catch (e) {
    mixErr = (e as Error).message;
  }
  check("§5e ⭐ Ve transfer onu da reddediyor (iki uç aynı cevap)", /uygun değil/i.test(mixErr), mixErr.slice(0, 60));

  // §5f — sayım FİLTRELENMEZ: listelenen çuvalın tüm üyeleri zaten uygun
  // olduğu için ekran taşınacak metrajın TAMAMINI gösterir.
  const freeRow = (listed3.data as { id: string; rollCount: number; totalQty: number }[]).find(
    (s) => s.id === freeSackId,
  );
  check("§5f Listelenen çuvalın metrajı taşınacak olanın TAMAMI", freeRow?.totalQty === 65, `qty=${freeRow?.totalQty}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    if (transferIds.length > 0) {
      await prisma.warehouseMovement.deleteMany({ where: { transferId: { in: transferIds } } });
      await prisma.warehouseTransfer.deleteMany({ where: { id: { in: transferIds } } });
    }
    if (shipmentIds.length > 0) {
      await prisma.sackAllocation.deleteMany({ where: { sack: { shipmentId: { in: shipmentIds } } } });
      await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.printedDocument.deleteMany({ where: { sourceId: { in: shipmentIds } } });
      await prisma.rollReturn.deleteMany({ where: { fromShipmentId: { in: shipmentIds } } });
    }
    if (rollIds.length > 0) {
      await prisma.rollReturn.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null, shipmentId: null } });
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (shipmentIds.length > 0) await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    // Süpürme: negatif sonda koşumunda geri sarılmayan çuval listeye girmez
    // (test_quick_shipment'taki aynı gerekçe) — müşteriye bağlı hepsi silinir.
    if (sackIds.length > 0) await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
    if (customerId) await prisma.sack.deleteMany({ where: { customerId } });
    if (warehouseIds.length > 0) await prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
