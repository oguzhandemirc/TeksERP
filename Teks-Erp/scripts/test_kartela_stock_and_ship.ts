// =============================================================================
// TEST: Kartela ADET-bazlı stok + ÇUVALA seçerek ekleme (kartela.getStock +
//       shipping.addKartelaToSack — Çuval Depo modeli)
// Çalıştır: npx tsx scripts/test_kartela_stock_and_ship.ts
// =============================================================================
// Akış: TEST customer + item + 2 renk → WAREHOUSE toplar → kartelaService.dispatch →
// receive({count}) ile N swatch doğur → getStock gruplama (sackId:null filtreli) →
// addKartelaToSack happy/insufficient → PLANNED-sevkiyat guard (409) →
// removeSwatchFromSack ile stoğa dönüş → colorId=null claim →
// reduceStock (FIFO soft-cancel) happy/yetersiz/çuvaldakini-çalmaz/gerekçe-guard.
// Ölçümsüz (adet) akış; izole TEST item sayesinde grup sayıları kesin.
// =============================================================================

import prisma from "../src/lib/prisma";
import { ensureTestKartela } from "./fixture-subcontractor";
import { kartelaService } from "../src/services/kartela.service";
import { shippingService } from "../src/services/shipping.service";
import { AppError } from "../src/utils/app-error";
import { RollStatus, WarehouseEventType } from "@prisma/client";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";

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

// Sevk onayı varsayılan KAPALI → createShipment doğrudan DISPATCHED eder. Bu test
// "PLANNED sevkiyattaki çuvala kartela eklenemez" guard'ını kanıtladığından onayı
// geçici AÇIP sevkiyatı PLANNED tutuyoruz (cleanup'ta eski değere döner).
const CONF_KEY = "shipping.confirmationEnabled";
let prevConf: { value: unknown } | null | undefined;

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
      // Stok kumesinden cikabilmek icin deposu DOLU olmali (K6 kapisi):
      // uretimde deposuz top dogamaz, fikstur de uretmemeli.
      warehouseId: await fixtureWarehouseId(),
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
  FIRM = (await ensureTestKartela()).id;

  // İzole TEST müşterisi — sevkiyat sadece kendi çuvallarımıza dokunsun.
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

/** Açık çuvala WAREHOUSE top okut → depoda dolu çuval döndür (mühür YOK). */
async function depotSackWithRoll(): Promise<string> {
  const roll = await prisma.roll.create({
    data: {
      // Stok kumesinden cikabilmek icin deposu DOLU olmali (K6 kapisi):
      // uretimde deposuz top dogamaz, fikstur de uretmemeli.
      warehouseId: await fixtureWarehouseId(),
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
  const sackId = (await shippingService.openSack({ customerId: CUSTOMER }, ADMIN)).data as { id: string };
  sackIds.push(sackId.id);
  await shippingService.scanIntoSack({ sackId: sackId.id, barcode: roll.barcode! }, ADMIN);
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

  // Kartela olay defteri: kabulde doğan her kartela IN_STOCK doğar ve BORN satırı kabule bağlıdır.
  const dogan = await prisma.swatch.findMany({ where: { parentReceiptId: { in: receiptIds } }, select: { id: true, status: true, parentReceiptId: true } });
  const born = await prisma.swatchEvent.findMany({ where: { swatchId: { in: dogan.map((s) => s.id) } }, select: { swatchId: true, type: true, trigger: true, receiptId: true } });
  check("kabul: doğan her kartela IN_STOCK + tek BORN satırı (KARTELA_RECEIVE, kabul kimliğiyle)",
    dogan.length === NA + NB + NN && dogan.every((s) => s.status === "IN_STOCK")
      && born.length === dogan.length
      && born.every((e) => e.type === "BORN" && e.trigger === "KARTELA_RECEIVE" && e.receiptId === dogan.find((s) => s.id === e.swatchId)?.parentReceiptId),
    `${dogan.length} kartela · ${born.length} BORN`);

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

  console.log("\n=== guard: PLANNED sevkiyattaki çuvala kartela eklenemez (409); depo çuvalı düzenlenebilir ===");
  // Depo çuvalı (sevkiyatsız) düzenlenebilir → kartela eklenir (happy path yukarıda happySack ile).
  const plannedSack = await depotSackWithRoll();
  // Sevk onayını geçici aç → sevkiyat DISPATCHED yerine PLANNED kalsın (cleanup geri alır).
  prevConf = await prisma.systemSetting.findUnique({ where: { key: CONF_KEY }, select: { value: true } });
  await prisma.systemSetting.upsert({ where: { key: CONF_KEY }, create: { key: CONF_KEY, value: true }, update: { value: true } });
  const planned = (await shippingService.createShipment({ sackIds: [plannedSack], customerId: CUSTOMER })).data as { id: string; status: string };
  shipmentIds.push(planned.id);
  check("sevkiyat PLANNED kuruldu", planned.status === "PLANNED", planned.status);
  let plannedGuard = false;
  try {
    await shippingService.addKartelaToSack({ sackId: plannedSack, itemId: ITEM, colorId: COLOR_A, count: 1 }, ADMIN);
  } catch (e) {
    plannedGuard = is409(e);
  }
  check("PLANNED sevkiyattaki çuvala kartela eklenemez → 409", plannedGuard);
  // Guard colorA'ya dokunmadı (rollback + sevkiyattaki çuvalda rol var, kartela yok).
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

  // ══ STOK DEFTERİ — kartela sevki ve iptali (K'nin SON iki kapısı) ══════════
  // ⚠️ Bu yol 2026-09-13'e kadar deftere NE İLERİ NE TERS satır yazıyordu; yani
  // "taşıma" değil SIFIRDAN BAĞLAMA. Karşılaştıracak bir "önce" hâli olmadığı için
  // kalemler şekli DOĞRUDAN ölçüyor (önce/sonra yüklemi kurulamaz).
  const dRoll = await makeWarehouseRoll(null);
  const dDepo = (await prisma.roll.findUniqueOrThrow({ where: { id: dRoll }, select: { warehouseId: true } })).warehouseId;
  const dres = await kartelaService.dispatch({ subcontractorId: FIRM, rollIds: [dRoll] }, ADMIN);
  const dId = (dres.data as { id?: string })?.id as string;
  if (dId) dispatchIds.push(dId);
  const ileri = await prisma.warehouseMovement.findFirst({
    where: { rollId: dRoll, eventType: WarehouseEventType.EXTERNAL },
    select: { id: true, fromWarehouseId: true, fromStatus: true, toWarehouseId: true, toStatus: true, reasonCode: true, qty: true, notes: true },
  });
  const dTop = await prisma.roll.findUniqueOrThrow({ where: { id: dRoll }, select: { status: true, warehouseId: true } });
  check(
    "DEFTER-1 ⭐ Kartela sevki: ÇIKIŞ satırı STATÜLÜ — from {depo, WAREHOUSE} → to {∅, AT_KARTELA} · KARTELA_DISPATCH",
    ileri !== null &&
      ileri.fromWarehouseId === dDepo &&
      ileri.fromStatus === RollStatus.WAREHOUSE &&
      ileri.toWarehouseId === null &&
      ileri.toStatus === RollStatus.AT_KARTELA &&
      ileri.reasonCode === STOCK_MOVE_REASON.KARTELA_DISPATCH,
    JSON.stringify(ileri),
  );
  check(
    "DEFTER-2 Topun deposu KORUNDU (dönüş adresi) ama defterin giriş ucu NULL — ikisi bilerek farklı",
    dTop.status === RollStatus.AT_KARTELA && dTop.warehouseId === dDepo && ileri?.toWarehouseId === null,
    `${dTop.status} / depo=${String(dTop.warehouseId)}`,
  );
  check(
    "DEFTER-3 Belge bağı `notes`ta (şemada kartelaDispatchId kolonu YOK)",
    (ileri?.notes ?? "").includes("Kartela sevki"),
    ileri?.notes ?? "—",
  );

  await kartelaService.cancelDispatch(dId, "bekçi: defter ölçümü için iptal", ADMIN);
  const tersler = await prisma.warehouseMovement.findMany({
    where: { rollId: dRoll, eventType: WarehouseEventType.EXTERNAL, reversesMovementId: { not: null } },
    select: { reversesMovementId: true, fromWarehouseId: true, fromStatus: true, toWarehouseId: true, toStatus: true, reasonCode: true },
  });
  check(
    "DEFTER-4 ⭐ İptal: ters satır BAĞLI (reversesMovementId → ileri) ve uçlar AYNALI · KARTELA_CANCEL",
    tersler.length === 1 &&
      tersler[0]!.reversesMovementId === ileri?.id &&
      tersler[0]!.fromWarehouseId === null &&
      tersler[0]!.fromStatus === RollStatus.AT_KARTELA &&
      tersler[0]!.toWarehouseId === dDepo &&
      tersler[0]!.toStatus === RollStatus.WAREHOUSE &&
      tersler[0]!.reasonCode === STOCK_MOVE_REASON.KARTELA_CANCEL,
    JSON.stringify(tersler),
  );
  const dSatirlar = await prisma.warehouseMovement.findMany({
    where: { rollId: dRoll },
    select: { qty: true, fromWarehouseId: true, toWarehouseId: true },
  });
  const dNet = dSatirlar.reduce((t, x) => t + (x.toWarehouseId ? Number(x.qty) : 0) - (x.fromWarehouseId ? Number(x.qty) : 0), 0);
  check("DEFTER-5 ⭐ Σ kapanıyor: çıkış + iptal girişi = 0 (mal rafa döndü)", Math.abs(dNet) < 0.001, `net=${dNet}`);

  // ⚠️ BU DİLİMDEN ÖNCE yapılmış sevkin iptali: ileri satır YOK ⇒ ters satır da
  // YAZILMAZ. Bağsız bir giriş satırı, çıkışı hiç kaydedilmemiş malı stoğa EKLER
  // ve Σ'yı ŞİŞİRİRDİ. Fikstür o hâli ileri satırı silerek kurar.
  const mRoll = await makeWarehouseRoll(null);
  const mres = await kartelaService.dispatch({ subcontractorId: FIRM, rollIds: [mRoll] }, ADMIN);
  const mId = (mres.data as { id?: string })?.id as string;
  if (mId) dispatchIds.push(mId);
  // @silme-baglami: SINANAN_SILME — MİRAS sevk koşulu kuruluyor: defter satırı olmayan eski sevkin iptali sınanıyor
  await prisma.warehouseMovement.deleteMany({ where: { rollId: mRoll } });
  await kartelaService.cancelDispatch(mId, "bekçi: miras sevkin iptali", ADMIN);
  const mSatir = await prisma.warehouseMovement.count({ where: { rollId: mRoll } });
  const mTop = await prisma.roll.findUniqueOrThrow({ where: { id: mRoll }, select: { status: true } });
  check(
    "DEFTER-6 ⭐ İleri satırı OLMAYAN sevkin iptali satır YAZMADI (Σ şişmedi) ama top rafına DÖNDÜ",
    mSatir === 0 && mTop.status === RollStatus.WAREHOUSE,
    `satır=${mSatir} · ${mTop.status}`,
  );
}

async function cleanup(): Promise<void> {
  try {
    // Sevk onayı ayarını eski değerine döndür (PLANNED guard'ı için geçici açılmıştı).
    if (prevConf !== undefined) {
      if (prevConf === null) await prisma.systemSetting.delete({ where: { key: CONF_KEY } }).catch(() => {});
      else await prisma.systemSetting.update({ where: { key: CONF_KEY }, data: { value: prevConf.value as never } }).catch(() => {});
    }
    // Roll-tabanlı (dönen id şekline güvenme): allocation → swatch → receipt → dispatch →
    // roll-unset → sack → shipment → roll → master-data sırası.
    await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackIds } } });
    // Düşüm kalemleri kartelaya RESTRICT FK ile bağlı → kartelalardan önce.
    if (ITEM) await prisma.swatchStockReductionItem.deleteMany({ where: { reduction: { itemId: ITEM } } });
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
    // reduceStock, itemId/colorId referanslı SwatchStockReduction olayları yaratır → önce sil.
    if (ITEM) await prisma.swatchStockReduction.deleteMany({ where: { itemId: ITEM } });
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
