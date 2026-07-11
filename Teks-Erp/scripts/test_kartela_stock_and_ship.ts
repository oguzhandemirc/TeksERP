// =============================================================================
// TEST: Kartela ADET-bazlı stok + ÇUVALA seçerek ekleme (kartela.getStock +
//       shipping.addKartelaToSack — Çuval Havuzu / B modeli)
// Çalıştır: npx tsx scripts/test_kartela_stock_and_ship.ts
// =============================================================================
// Akış: TEST customer + item + 2 renk → WAREHOUSE toplar → kartelaService.dispatch →
// receive({count}) ile N swatch doğur → getStock gruplama (sackId:null filtreli) →
// addKartelaToSack happy/insufficient → sealed-çuval + PLANNED-sevkiyat guard (409) →
// removeSwatchFromSack ile stoğa dönüş → colorId=null claim →
// reduceStock (FIFO soft-cancel) happy/yetersiz/çuvaldakini-çalmaz/gerekçe-guard.
// Ölçümsüz (adet) akış; izole TEST item sayesinde grup sayıları kesin.
// =============================================================================

import prisma from "../src/lib/prisma";
import { kartelaService } from "../src/services/kartela.service";
import { shippingService } from "../src/services/shipping.service";
import { AppError } from "../src/utils/app-error";
import { RollStatus } from "@prisma/client";

let pass = 0,
  fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fixture bulunamadı: ${what}`);
  return v;
}
const is409 = (e: unknown) => e instanceof AppError && e.statusCode === 409;
const TS = Date.now().toString().slice(-6);

let ADMIN = "";
let FIRM = "";
let CUSTOMER = "";
let ITEM = "";
let COLOR_A = "";
let COLOR_B = "";
const rollIds: string[] = [];
const sackIds: string[] = [];
const shipmentIds: string[] = [];
const receiptIds: string[] = [];
const dispatchIds: string[] = [];

async function stockCount(itemId: string, colorId: string | null): Promise<number> {
  const res = await kartelaService.getStock();
  const g = (res.data ?? []).find((x) => x.itemId === itemId && x.colorId === colorId);
  return g?.count ?? 0;
}

async function makeWarehouseRoll(colorId: string | null): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: `TEST-KRTROLL-${TS}-${rollIds.length}`,
      itemId: ITEM,
      colorId,
      initialQty: 100,
      currentQty: 100,
      qualityGrade: "A1",
      width: 150,
      status: RollStatus.WAREHOUSE,
    },
    select: { id: true },
  });
  rollIds.push(r.id);
  return r.id;
}

async function setup(): Promise<void> {
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin").id;
  FIRM = need(
    await prisma.subcontractor.findFirst({ where: { code: "KARTELAAS" }, select: { id: true } }),
    "KARTELAAS firması",
  ).id;

  // İzole TEST müşterisi — sevkiyat/rebalance sadece kendi havuzumuza dokunsun.
  CUSTOMER = (
    await prisma.customer.create({
      data: { code: `TEST-KRT-CUST-${TS}`, name: `Kartela Test Müşteri ${TS}` },
      select: { id: true },
    })
  ).id;

  ITEM = (
    await prisma.item.create({
      data: { code: `TEST-KRT-ITEM-${TS}`, name: `Kartela Test Ürün ${TS}`, itemType: "FABRIC" },
      select: { id: true },
    })
  ).id;
  COLOR_A = (
    await prisma.color.create({ data: { code: `TEST-KRTA-${TS}`, name: `Kartela Test A ${TS}`, hex: "#112233" }, select: { id: true } })
  ).id;
  COLOR_B = (
    await prisma.color.create({ data: { code: `TEST-KRTB-${TS}`, name: `Kartela Test B ${TS}`, hex: "#445566" }, select: { id: true } })
  ).id;
}

/** N kartela doğur: WAREHOUSE top → dispatch → receive(count=N). */
async function birthSwatches(colorId: string | null, count: number): Promise<void> {
  const rollId = await makeWarehouseRoll(colorId);
  const disp = await kartelaService.dispatch({ subcontractorId: FIRM, rollIds: [rollId] }, ADMIN);
  const dispatchId = (disp.data as { id?: string })?.id;
  if (dispatchId) dispatchIds.push(dispatchId);
  const rec = await kartelaService.receive(
    { subcontractorId: FIRM, returns: [{ rollId, count }] },
    ADMIN,
  );
  const receiptId = (rec.data as { id?: string })?.id;
  if (receiptId) receiptIds.push(receiptId);
}

/** Açık çuvala WAREHOUSE top okut → mühürle → mühürlü havuz çuvalı döndür. */
async function sealedSackWithRoll(manualCode: string): Promise<string> {
  const roll = await prisma.roll.create({
    data: {
      barcode: `TEST-KRT-GROLL-${TS}-${rollIds.length}`,
      itemId: ITEM,
      initialQty: 10,
      currentQty: 10,
      qualityGrade: "A1",
      width: 150,
      status: RollStatus.WAREHOUSE,
    },
    select: { id: true, barcode: true },
  });
  rollIds.push(roll.id);
  const sackId = (await shippingService.openSack({ customerId: CUSTOMER, manualCode }, ADMIN)).data as { id: string };
  sackIds.push(sackId.id);
  await shippingService.scanIntoSack({ sackId: sackId.id, barcode: roll.barcode! }, ADMIN);
  await shippingService.sealSack({ sackId: sackId.id }, ADMIN);
  return sackId.id;
}

async function run(): Promise<void> {
  await setup();

  console.log("\n=== getStock: ürün+renk gruplama (sackId:null filtreli) ===");
  const NA = 5,
    NB = 3,
    NN = 4;
  await birthSwatches(COLOR_A, NA);
  await birthSwatches(COLOR_B, NB);
  await birthSwatches(null, NN);

  check("grup (item, colorA) === NA", (await stockCount(ITEM, COLOR_A)) === NA, `${await stockCount(ITEM, COLOR_A)} vs ${NA}`);
  check("grup (item, colorB) === NB", (await stockCount(ITEM, COLOR_B)) === NB);
  check("grup (item, renksiz=null) === NN", (await stockCount(ITEM, null)) === NN);

  console.log("\n=== addKartelaToSack: happy + stok düşümü (çuvala giren stok değil) ===");
  const happySack = (await shippingService.openSack({ customerId: CUSTOMER }, ADMIN)).data as { id: string };
  sackIds.push(happySack.id);
  const K = 2;
  const addRes = await shippingService.addKartelaToSack(
    { sackId: happySack.id, itemId: ITEM, colorId: COLOR_A, count: K },
    ADMIN,
  );
  check("addKartela: added === K", addRes.data.added === K, `${addRes.data.added}`);
  check("addKartela: swatchIds uzunluğu === K", addRes.data.swatchIds.length === K);
  check("stok düştü: colorA === NA-K (çuvala girdi)", (await stockCount(ITEM, COLOR_A)) === NA - K, `${await stockCount(ITEM, COLOR_A)}`);
  const assigned = await prisma.swatch.findMany({
    where: { id: { in: addRes.data.swatchIds } },
    select: { sackId: true },
  });
  check("eklenen swatch'lerde sackId set", assigned.every((s) => s.sackId === happySack.id));

  console.log("\n=== insufficient stock → 409 + rollback ===");
  const remaining = await stockCount(ITEM, COLOR_A); // NA-K
  let conflicted = false;
  try {
    await shippingService.addKartelaToSack(
      { sackId: happySack.id, itemId: ITEM, colorId: COLOR_A, count: remaining + 1 },
      ADMIN,
    );
  } catch (e) {
    conflicted = is409(e);
  }
  check("yetersiz stok → 409", conflicted);
  check("rollback: stok değişmedi", (await stockCount(ITEM, COLOR_A)) === remaining, `${await stockCount(ITEM, COLOR_A)} vs ${remaining}`);

  console.log("\n=== guard: mühürlü çuvala + PLANNED sevkiyattaki çuvala kartela eklenemez (409) ===");
  const sealedSack = await sealedSackWithRoll(`TEST-KRT-G1-${TS}`);
  let sealedGuard = false;
  try {
    await shippingService.addKartelaToSack({ sackId: sealedSack, itemId: ITEM, colorId: COLOR_A, count: 1 }, ADMIN);
  } catch (e) {
    sealedGuard = is409(e);
  }
  check("mühürlü çuvala kartela eklenemez → 409", sealedGuard);

  const plannedSack = await sealedSackWithRoll(`TEST-KRT-G2-${TS}`);
  const planned = (await shippingService.createShipment({ sackIds: [plannedSack] })).data as { id: string; status: string };
  shipmentIds.push(planned.id);
  check("sevkiyat PLANNED kuruldu", planned.status === "PLANNED", planned.status);
  let plannedGuard = false;
  try {
    await shippingService.addKartelaToSack({ sackId: plannedSack, itemId: ITEM, colorId: COLOR_A, count: 1 }, ADMIN);
  } catch (e) {
    plannedGuard = is409(e);
  }
  check("PLANNED sevkiyattaki çuvala kartela eklenemez → 409", plannedGuard);
  // Guard'lar colorA'ya dokunmadı (rollback + sealed çuvallarda rol var, kartela yok).
  check("guard sonrası colorA stok değişmedi", (await stockCount(ITEM, COLOR_A)) === remaining, `${await stockCount(ITEM, COLOR_A)} vs ${remaining}`);

  console.log("\n=== removeSwatchFromSack → stoğa dönüş ===");
  const before = await stockCount(ITEM, COLOR_A); // NA-K
  await shippingService.removeSwatchFromSack({ swatchId: addRes.data.swatchIds[0]! }, ADMIN);
  check("removeSwatch: stok +1 (stoğa döndü)", (await stockCount(ITEM, COLOR_A)) === before + 1, `${await stockCount(ITEM, COLOR_A)} vs ${before + 1}`);

  console.log("\n=== colorId null grubu claim (renksiz) ===");
  const nullBefore = await stockCount(ITEM, null);
  const addNull = await shippingService.addKartelaToSack(
    { sackId: happySack.id, itemId: ITEM, colorId: null, count: 1 },
    ADMIN,
  );
  check("renksiz grup claim: added === 1", addNull.data.added === 1);
  check("renksiz stok düştü", (await stockCount(ITEM, null)) === nullBefore - 1);

  console.log("\n=== reduceStock: elle stok düşürme (FIFO soft-cancel) ===");
  // colorB grubu (NB) henüz dokunulmadı → kesin sayım.
  const bBefore = await stockCount(ITEM, COLOR_B); // NB
  // FIFO: en eski (createdAt asc) müsait (sackId/shipmentId null) kartela iptal edilmeli.
  const bAsc = await prisma.swatch.findMany({
    where: { itemId: ITEM, colorId: COLOR_B, shipmentId: null, sackId: null, cancelledAt: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const oldestId = need(bAsc[0], "colorB en eski swatch").id;
  const RED = 2;
  const redRes = await kartelaService.reduceStock(
    { itemId: ITEM, colorId: COLOR_B, count: RED, reason: "test zayiat" },
    ADMIN,
  );
  check("reduceStock: reduced === RED", redRes.data.reduced === RED, `${redRes.data.reduced}`);
  check("reduceStock: stok NB-RED", (await stockCount(ITEM, COLOR_B)) === bBefore - RED, `${await stockCount(ITEM, COLOR_B)} vs ${bBefore - RED}`);
  const oldest = await prisma.swatch.findUnique({
    where: { id: oldestId },
    select: { cancelledAt: true, cancelReason: true },
  });
  check("FIFO: en eski kartela iptal (cancelledAt set)", oldest?.cancelledAt != null);
  check("iptal edilen kartelada cancelReason set", oldest?.cancelReason === "test zayiat");

  console.log("\n=== reduceStock: yetersiz stok → 409 + rollback ===");
  const bRem = await stockCount(ITEM, COLOR_B); // NB-RED
  let redConflict = false;
  try {
    await kartelaService.reduceStock(
      { itemId: ITEM, colorId: COLOR_B, count: bRem + 1, reason: "fazla" },
      ADMIN,
    );
  } catch (e) {
    redConflict = is409(e);
  }
  check("reduceStock yetersiz → 409", redConflict);
  check("reduceStock rollback: stok değişmedi", (await stockCount(ITEM, COLOR_B)) === bRem, `${await stockCount(ITEM, COLOR_B)} vs ${bRem}`);

  console.log("\n=== reduceStock: çuvaldaki kartelaya dokunmaz ===");
  // colorA'da 1 kartela hâlâ happySack'te (removeSwatch sonrası). Müsait stoktan fazlası
  // istenince 409 → çuvaldakini ASLA çalmaz.
  const aAvail = await stockCount(ITEM, COLOR_A);
  let noSteal = false;
  try {
    await kartelaService.reduceStock(
      { itemId: ITEM, colorId: COLOR_A, count: aAvail + 1, reason: "çalma testi" },
      ADMIN,
    );
  } catch (e) {
    noSteal = is409(e);
  }
  check("müsaitten fazlası → 409 (çuvaldaki çalınmaz)", noSteal);
  const stillInSack = await prisma.swatch.count({
    where: { itemId: ITEM, colorId: COLOR_A, sackId: { not: null }, cancelledAt: null },
  });
  check("çuvaldaki kartelalar hâlâ aktif", stillInSack >= 1, `${stillInSack}`);

  console.log("\n=== reduceStock: gerekçe guard (kısa reason → 400) ===");
  let reasonGuard = false;
  try {
    await kartelaService.reduceStock(
      { itemId: ITEM, colorId: COLOR_B, count: 1, reason: "x" },
      ADMIN,
    );
  } catch (e) {
    reasonGuard = e instanceof AppError && e.statusCode === 400;
  }
  check("kısa gerekçe → 400", reasonGuard);
}

async function cleanup(): Promise<void> {
  try {
    // Roll-tabanlı (dönen id şekline güvenme): allocation → swatch → receipt → dispatch →
    // roll-unset → sack → shipment → roll → master-data sırası.
    await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackIds } } });
    await prisma.swatch.deleteMany({ where: { parentRollId: { in: rollIds } } });
    await prisma.kartelaReceipt.deleteMany({
      where: { items: { some: { consumedRollId: { in: rollIds } } } }, // receiptItems cascade
    });
    await prisma.kartelaDispatch.deleteMany({
      where: { items: { some: { rollId: { in: rollIds } } } }, // dispatchItems cascade
    });
    await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { shipmentId: null, sackId: null } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: shipmentIds } } });
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
    await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.color.deleteMany({ where: { id: { in: [COLOR_A, COLOR_B].filter(Boolean) } } });
    if (ITEM) await prisma.item.deleteMany({ where: { id: ITEM } });
    if (CUSTOMER) await prisma.customer.deleteMany({ where: { id: CUSTOMER } });
  } catch (e) {
    console.warn("cleanup uyarı:", (e as Error).message);
  }
}

run()
  .catch((e) => {
    fail++;
    console.error("HATA:", e);
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
