// =============================================================================
// TEST: Kartela ADET-bazlı stok + seçerek-sevk (kartela.getStock +
//       shipping.addKartelaToShipment)
// Çalıştır: npx tsx scripts/test_kartela_stock_and_ship.ts
// =============================================================================
// Akış: TEST item + 2 renk → WAREHOUSE toplar → kartelaService.dispatch →
// receive({count}) ile N swatch doğur → getStock gruplama → addKartelaToShipment
// happy/insufficient/PREPARING-guard → removeSwatch ile stoğa dönüş.
// Ölçümsüz (adet) akış; izole TEST item sayesinde grup sayıları kesin.
// =============================================================================

import prisma from "../src/lib/prisma";
import { kartelaService } from "../src/services/kartela.service";
import { shippingService } from "../src/services/shipping.service";
import { AppError } from "../src/utils/app-error";
import { RollStatus, ShipmentStatus } from "@prisma/client";

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
  CUSTOMER = need(await prisma.customer.findFirst({ select: { id: true } }), "herhangi müşteri").id;

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

async function makeShipment(status: ShipmentStatus): Promise<string> {
  const s = await prisma.shipment.create({
    data: { shipmentNo: `TEST-SVK-${TS}-${shipmentIds.length}`, customerId: CUSTOMER, status },
    select: { id: true },
  });
  shipmentIds.push(s.id);
  return s.id;
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

async function run(): Promise<void> {
  await setup();

  console.log("\n=== getStock: ürün+renk gruplama ===");
  const NA = 5,
    NB = 3,
    NN = 4;
  await birthSwatches(COLOR_A, NA);
  await birthSwatches(COLOR_B, NB);
  await birthSwatches(null, NN);

  check("grup (item, colorA) === NA", (await stockCount(ITEM, COLOR_A)) === NA, `${await stockCount(ITEM, COLOR_A)} vs ${NA}`);
  check("grup (item, colorB) === NB", (await stockCount(ITEM, COLOR_B)) === NB);
  check("grup (item, renksiz=null) === NN", (await stockCount(ITEM, null)) === NN);

  console.log("\n=== addKartelaToShipment: happy + stok düşümü ===");
  const ship = await makeShipment(ShipmentStatus.PREPARING);
  const K = 2;
  const addRes = await shippingService.addKartelaToShipment(
    { shipmentId: ship, itemId: ITEM, colorId: COLOR_A, count: K },
    ADMIN,
  );
  check("addKartela: added === K", addRes.data.added === K, `${addRes.data.added}`);
  check("addKartela: swatchIds uzunluğu === K", addRes.data.swatchIds.length === K);
  check("stok düştü: colorA === NA-K", (await stockCount(ITEM, COLOR_A)) === NA - K, `${await stockCount(ITEM, COLOR_A)}`);
  const assigned = await prisma.swatch.findMany({
    where: { id: { in: addRes.data.swatchIds } },
    select: { shipmentId: true },
  });
  check("eklenen swatch'lerde shipmentId set", assigned.every((s) => s.shipmentId === ship));

  console.log("\n=== insufficient stock → 409 + rollback ===");
  const remaining = await stockCount(ITEM, COLOR_A); // NA-K
  let conflicted = false;
  try {
    await shippingService.addKartelaToShipment(
      { shipmentId: ship, itemId: ITEM, colorId: COLOR_A, count: remaining + 1 },
      ADMIN,
    );
  } catch (e) {
    conflicted = is409(e);
  }
  check("yetersiz stok → 409", conflicted);
  check("rollback: stok değişmedi", (await stockCount(ITEM, COLOR_A)) === remaining, `${await stockCount(ITEM, COLOR_A)} vs ${remaining}`);

  console.log("\n=== PREPARING-only guard ===");
  const readyShip = await makeShipment(ShipmentStatus.READY);
  let guard409 = false;
  try {
    await shippingService.addKartelaToShipment(
      { shipmentId: readyShip, itemId: ITEM, colorId: COLOR_A, count: 1 },
      ADMIN,
    );
  } catch (e) {
    guard409 = is409(e);
  }
  check("READY sevkiyata kartela eklenemez → 409", guard409);

  console.log("\n=== removeSwatch → stoğa dönüş ===");
  const before = await stockCount(ITEM, COLOR_A); // NA-K
  await shippingService.removeSwatchFromShipment({ shipmentId: ship, swatchId: addRes.data.swatchIds[0]! }, ADMIN);
  check("removeSwatch: stok +1 (stoğa döndü)", (await stockCount(ITEM, COLOR_A)) === before + 1, `${await stockCount(ITEM, COLOR_A)} vs ${before + 1}`);

  console.log("\n=== colorId null grubu claim (renksiz) ===");
  const nullBefore = await stockCount(ITEM, null);
  const addNull = await shippingService.addKartelaToShipment(
    { shipmentId: ship, itemId: ITEM, colorId: null, count: 1 },
    ADMIN,
  );
  check("renksiz grup claim: added === 1", addNull.data.added === 1);
  check("renksiz stok düştü", (await stockCount(ITEM, null)) === nullBefore - 1);
}

async function cleanup(): Promise<void> {
  try {
    // Roll-tabanlı (dönen id şekline güvenme): swatch → receipt → dispatch sırası
    // (swatch.parentReceiptId + receiptItem.sourceDispatchItemId FK zinciri).
    await prisma.swatch.deleteMany({ where: { parentRollId: { in: rollIds } } });
    await prisma.kartelaReceipt.deleteMany({
      where: { items: { some: { consumedRollId: { in: rollIds } } } }, // receiptItems cascade
    });
    await prisma.kartelaDispatch.deleteMany({
      where: { items: { some: { rollId: { in: rollIds } } } }, // dispatchItems cascade
    });
    await prisma.sack.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.color.deleteMany({ where: { id: { in: [COLOR_A, COLOR_B].filter(Boolean) } } });
    if (ITEM) await prisma.item.deleteMany({ where: { id: ITEM } });
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
