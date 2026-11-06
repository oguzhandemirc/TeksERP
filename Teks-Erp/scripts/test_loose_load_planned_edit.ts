// =============================================================================
// BEKÇİ — PLANLI SEVKİYATTA ÇUVALSIZ YÜK DÜZENLEME (9.2 ekleme · 9.3 tek top çıkarma · 9.4 birim sayıları)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_loose_load_planned_edit.ts
//
// NEDEN: tablet planlı sevkiyata okutarak dökme/araba/çuval ekler ve dökme/arabadan tek top çıkarır. Yük
// birimi yalnız sevkiyatın içinde yaşar: boşalan birim ÇÖZÜLÜR (havuza dönemez) ve her sevkiyat okuyucusu
// (detay, board, döküm, belge) çözülmüşü saymaz. Tahsis (`SackAllocation`) yeniden yazılır; eski satır
// SİLİNMEZ, damgalanır (ters kayıt bugüne).
//
// ÖLÇÜLENLER:
//   §0 PLANLI doğuşta plaka/şoför saklanır; sevk anı yalnız geleni yazar
//   §1 Ekleme: dökmeye top (aynı birim) · aynı topun tekrarı durum-idempotent · bayrak kapalı 400
//   §2 Araba: yeni araba no → yeni birim (token) · token replay aynı birim · token başka arabaya 409 · mevcut arabaya ekleme
//   §3 Okutma sınıflaması: çuval kodu → çuval yolu · tür seçilmeden top 400 · karışık tür 409 (iki yön)
//   §4 9.4 sayılar: detay / döküm / board sackCount·cartCount·bulkCount
//   §5 Çıkarma: top rafa · tahsis ters kaydı (eski satır damgalı, yeni satır küçük) · çuvaldaki top 409
//   §6 ⭐ Son top → birim çözülür; detay/döküm/board saymaz; çözülmüş birimin token'ı 409; aynı no yeniden açılır
//   §7 ⭐ Sevk sonrası ekleme/çıkarma 409 SHIPMENT_NOT_PLANNED
//   §8 ⭐ Yarış (elle açık tx): çıkarma ↔ eşzamanlı taşıma · ekleme ↔ eşzamanlı başka sevkiyata alınma
// =============================================================================
import { LoadUnitKind, Prisma, RollStatus, ShipmentStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { shippingService } from "../src/services/shipping.service";
import { InventoryService } from "../src/services/inventory.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

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

const TAG = `TEST-LLE-${Date.now()}`;
const rollIds: string[] = [];
const shipmentIds: string[] = [];
let customerId: string | null = null;
let itemId: string | null = null;
const savedSettings = new Map<string, Prisma.JsonValue | null>();

async function setSetting(key: string, value: boolean): Promise<void> {
  if (!savedSettings.has(key)) {
    const old = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
    savedSettings.set(key, old ? (old.value as Prisma.JsonValue) : null);
  }
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

type Caught = { message: string; code: string | null; status: number | null };
async function caught(fn: () => Promise<unknown>): Promise<Caught> {
  try {
    await fn();
    return { message: "", code: null, status: null };
  } catch (e) {
    const err = e as { message?: string; statusCode?: number; details?: { code?: string } };
    return { message: err.message ?? String(e), code: err.details?.code ?? null, status: err.statusCode ?? null };
  }
}

async function makeRoll(qty: number): Promise<string> {
  const res = await inventory.createInitialEntry({ itemId: itemId!, initialQty: qty }, undefined, undefined, false, {
    forcedStatus: RollStatus.WAREHOUSE,
  });
  const id = (res.data as { id: string }).id;
  rollIds.push(id);
  return id;
}

async function quick(ids: string[], loadUnits: unknown, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await shippingService.createShipmentFromRolls({
    rollIds: ids, customerId: customerId!, clientToken: crypto.randomUUID(), loadUnits: loadUnits as never, ...extra,
  });
  const d = res.data as { id: string };
  shipmentIds.push(d.id);
  return d.id;
}

const add = (shipmentId: string, kind: "BULK" | "CART", ids: string[], label: string | null = null, clientToken: string | null = null) =>
  shippingService.addLooseRollsToShipment(shipmentId, { kind, label, rollIds: ids, clientToken });
const unitData = (r: { data?: unknown }) => r.data as { unitId: string; added: number; unitKind: string; unitLabel: string | null };

async function liveUnits(shipmentId: string) {
  return prisma.sack.findMany({ where: { shipmentId, dissolvedAt: null }, select: { id: true, unitKind: true, unitLabel: true, rolls: { select: { id: true } } }, orderBy: { createdAt: "asc" } });
}
async function counts(shipmentId: string) {
  const det = (await shippingService.getShipmentById(shipmentId)).data as { summary: { sackCount: number; cartCount?: number; bulkCount?: number; rollCount: number } };
  const cont = (await shippingService.getShipmentSackContents(shipmentId)).data as { sackCount: number; cartCount?: number; bulkCount?: number; sacks: unknown[] };
  const board = (await shippingService.listSackStoreBoard({ search: (await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId }, select: { shipmentNo: true } })).shipmentNo, limit: 100 })).data as {
    id: string; sackCount: number; cartCount: number; bulkCount: number; rollCount: number; cartLabels?: string[];
  }[];
  const b = board.find((x) => x.id === shipmentId);
  return { det: det.summary, cont, board: b ?? null };
}
const roll = (id: string) => prisma.roll.findUniqueOrThrow({ where: { id }, select: { sackId: true, shipmentId: true } });

async function main(): Promise<void> {
  console.log("=== Planlı sevkiyatta çuvalsız yük düzenleme bekçisi ===\n");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  await ensureDefaultWarehouse();
  customerId = (await prisma.customer.create({ data: { code: TAG, name: `${TAG} Müşteri` }, select: { id: true } })).id;
  itemId = (await prisma.item.create({ data: { code: `${TAG}-ITM`, name: `${TAG} kumaş`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  await setSetting(SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED, true); // sevkiyat PLANNED kalsın
  await setSetting(SETTING_KEYS.SHIPMENT_LOOSE_LOAD_ENABLED, true);
  const order = await prisma.order.create({
    data: { orderNumber: `${TAG}-ORD`, customerId, lines: { create: [{ itemId, quantity: 5000 }] } },
    select: { id: true },
  });

  // ── §1 DÖKMEYE EKLEME ────────────────────────────────────────────────────
  const b1 = await makeRoll(100);
  const bulkShip = await quick([b1], [{ kind: "BULK", rollIds: [b1] }], { orderIds: [order.id], plateNumber: " 34 TST 99 ", driverName: "Ali Test" });
  const plannedCar = await prisma.shipment.findUniqueOrThrow({ where: { id: bulkShip }, select: { status: true, plateNumber: true, driverName: true } });
  check("§0 ⭐ PLANLI sevkiyatta plaka/şoför saklanır (sessiz düşme yok)", plannedCar.status === ShipmentStatus.PLANNED && plannedCar.plateNumber === "34 TST 99" && plannedCar.driverName === "Ali Test", JSON.stringify(plannedCar));
  const bulkUnitId = (await liveUnits(bulkShip))[0]!.id;
  const b2 = await makeRoll(50);
  const a1 = unitData(await add(bulkShip, "BULK", [b2]));
  check("§1a Dökmeye eklenen top AYNI birime girer", a1.unitId === bulkUnitId && a1.added === 1, `${a1.added}`);
  const r2 = await roll(b2);
  check("§1b Top birime + sevkiyata bağlı", r2.sackId === bulkUnitId && r2.shipmentId === bulkShip);
  const a1b = unitData(await add(bulkShip, "BULK", [b2]));
  check("§1c Aynı topun tekrarı durum-idempotent (added 0, hata yok)", a1b.added === 0 && a1b.unitId === bulkUnitId);
  check("§1d Dökme sevkiyatında hâlâ tek canlı birim", (await liveUnits(bulkShip)).length === 1);
  await setSetting(SETTING_KEYS.SHIPMENT_LOOSE_LOAD_ENABLED, false);
  const off = await makeRoll(10);
  const offErr = await caught(() => add(bulkShip, "BULK", [off]));
  check("§1e Bayrak kapalı → 400 LOOSE_LOAD_DISABLED", offErr.status === 400 && offErr.code === "LOOSE_LOAD_DISABLED", `${offErr.status} ${offErr.code}`);
  check("§1f Reddedilen top serbest", (await roll(off)).sackId === null);
  await setSetting(SETTING_KEYS.SHIPMENT_LOOSE_LOAD_ENABLED, true);

  // ── §2 ARABA ─────────────────────────────────────────────────────────────
  const c1 = await makeRoll(30);
  const cartShip = await quick([c1], [{ kind: "CART", label: "A-1", rollIds: [c1] }]);
  const c2 = await makeRoll(40);
  const tok = crypto.randomUUID();
  const n1 = unitData(await add(cartShip, "CART", [c2], "  A-2 ", tok));
  const unitsAfter = await liveUnits(cartShip);
  check("§2a Yeni araba no → yeni CART birimi (etiket boşluk-normalize)", unitsAfter.length === 2 && n1.unitLabel === "A-2" && n1.added === 1, `${unitsAfter.length} ${n1.unitLabel}`);
  const stored = await prisma.sack.findUniqueOrThrow({ where: { id: n1.unitId }, select: { clientToken: true, seq: true } });
  check("§2b Token yeni doğan birimde saklı + sıra verildi", stored.clientToken === tok && stored.seq != null);
  const rep = unitData(await add(cartShip, "CART", [c2], "A-2", tok));
  check("§2c Aynı token → aynı birim (replay), ikinci birim yok", rep.unitId === n1.unitId && (await liveUnits(cartShip)).length === 2);
  const col = await caught(() => add(cartShip, "CART", [c2], "A-9", tok));
  check("§2d ⭐ Token başka araba no ile → 409 (kimlik çakışması)", col.status === 409, `${col.status} ${col.code}`);
  const c3 = await makeRoll(25);
  const ex = unitData(await add(cartShip, "CART", [c3], "A-1"));
  check("§2e Mevcut araba no → mevcut birime eklenir", ex.unitId === unitsAfter[0]!.id && ex.added === 1);

  // ── §3 OKUTMA SINIFLAMASI + KARIŞIK TÜR ─────────────────────────────────
  const s1 = await makeRoll(20);
  const sack = (await shippingService.openSack({ customerId })).data as { id: string; sackNo: string };
  await shippingService.scanIntoSack({ sackId: sack.id, barcode: (await prisma.roll.findUniqueOrThrow({ where: { id: s1 }, select: { barcode: true } })).barcode! });
  const mixA = await caught(() => shippingService.addLoadByScan(bulkShip, { barcode: sack.sackNo }));
  check("§3a ⭐ Çuval kodu dökme sevkiyatına → 409 LOAD_UNIT_KIND_MIXED", mixA.status === 409 && mixA.code === "LOAD_UNIT_KIND_MIXED", `${mixA.status} ${mixA.code}`);
  check("§3b Reddedilen çuval havuzda kaldı", (await prisma.sack.findUniqueOrThrow({ where: { id: sack.id }, select: { shipmentId: true } })).shipmentId === null);
  const sackShipRes = await shippingService.createShipment({ customerId: customerId!, sackIds: [sack.id], clientToken: crypto.randomUUID() });
  const sackShipId = (sackShipRes.data as { id: string }).id;
  shipmentIds.push(sackShipId);
  const loose = await makeRoll(12);
  const looseBarcode = (await prisma.roll.findUniqueOrThrow({ where: { id: loose }, select: { barcode: true } })).barcode!;
  const noKind = await caught(() => shippingService.addLoadByScan(sackShipId, { barcode: looseBarcode }));
  check("§3c Tür seçilmeden top okutma → 400 LOAD_UNIT_KIND_REQUIRED", noKind.status === 400 && noKind.code === "LOAD_UNIT_KIND_REQUIRED", `${noKind.status} ${noKind.code}`);
  const mixB = await caught(() => shippingService.addLoadByScan(sackShipId, { barcode: looseBarcode, unitKind: "BULK" }));
  check("§3d ⭐ Çuvallı sevkiyata dökme → 409 LOAD_UNIT_KIND_MIXED", mixB.status === 409 && mixB.code === "LOAD_UNIT_KIND_MIXED", `${mixB.status} ${mixB.code}`);
  const viaScan = await shippingService.addLoadByScan(bulkShip, { barcode: looseBarcode, unitKind: "BULK" });
  const vs = viaScan.data as { kind: string; unitId: string; added: number };
  check("§3e Top barkodu + Dökme → dökme birimine", vs.kind === "ROLL" && vs.unitId === bulkUnitId && vs.added === 1);

  // ── §4 SAYILAR (9.4) ─────────────────────────────────────────────────────
  const cc = await counts(cartShip);
  check("§4a Detay: 2 araba, 0 dökme, sackCount 2", cc.det.cartCount === 2 && cc.det.bulkCount === 0 && cc.det.sackCount === 2, JSON.stringify(cc.det));
  check("§4b Döküm: cartCount 2 · bulkCount 0", cc.cont.cartCount === 2 && cc.cont.bulkCount === 0);
  check("§4c Board: cartCount 2 · rollCount 3", cc.board?.cartCount === 2 && cc.board?.rollCount === 3, JSON.stringify(cc.board));
  check("§4c2 Board araba no'ları sırayla (kart 'Araba A-1' yazabilsin)", JSON.stringify(cc.board?.cartLabels) === JSON.stringify(["A-1", "A-2"]), JSON.stringify(cc.board?.cartLabels));
  const bc = await counts(bulkShip);
  check("§4d Dökme sevkiyatı: bulkCount 1 · cartCount 0", bc.det.bulkCount === 1 && bc.det.cartCount === 0 && bc.board?.bulkCount === 1);
  const sc = await counts(sackShipId);
  check("§4e Çuvallı sevkiyat: sackCount 1 · araba/dökme 0", sc.det.sackCount === 1 && sc.det.cartCount === 0 && sc.det.bulkCount === 0);

  // ── §5 ÇIKARMA + TERS KAYIT ──────────────────────────────────────────────
  const allocBefore = await prisma.sackAllocation.findMany({ where: { sackId: bulkUnitId }, select: { id: true, qty: true, clearedAt: true } });
  const activeBefore = allocBefore.filter((a) => a.clearedAt === null);
  const rm = await shippingService.removeRollFromLoadUnit(bulkShip, b2);
  const rmd = rm.data as { unitDissolved: boolean };
  check("§5a Tek top çıkar → birim yaşıyor", rmd.unitDissolved === false);
  const fr = await roll(b2);
  check("§5b Çıkan top rafa döndü (sackId/shipmentId null)", fr.sackId === null && fr.shipmentId === null);
  const allocAfter = await prisma.sackAllocation.findMany({ where: { sackId: bulkUnitId }, select: { id: true, qty: true, clearedAt: true } });
  const oldStill = activeBefore.every((a) => allocAfter.some((x) => x.id === a.id && x.clearedAt !== null));
  const activeAfter = allocAfter.filter((a) => a.clearedAt === null);
  const sum = (xs: { qty: Prisma.Decimal }[]) => xs.reduce((s, a) => s + Number(a.qty), 0);
  check("§5c ⭐ Ters kayıt: eski tahsis SİLİNMEDİ, damgalandı (clearedAt)", activeBefore.length > 0 && oldStill, `${activeBefore.length} eski`);
  check("§5d Yeni tahsis çıkarılan top kadar küçük (brüt)", Math.abs(sum(activeBefore) - sum(activeAfter) - 50) < 0.001, `${sum(activeBefore)} → ${sum(activeAfter)}`);
  const inSack = await caught(() => shippingService.removeRollFromLoadUnit(sackShipId, s1));
  check("§5e Çuvaldaki top buradan çıkarılamaz → 409 ROLL_IN_SACK", inSack.status === 409 && inSack.code === "ROLL_IN_SACK", `${inSack.status} ${inSack.code}`);
  const notIn = await caught(() => shippingService.removeRollFromLoadUnit(cartShip, b2));
  check("§5f Sevkiyatta olmayan top → 409 ROLL_NOT_IN_SHIPMENT", notIn.status === 409 && notIn.code === "ROLL_NOT_IN_SHIPMENT");

  // ── §6 SON TOP → ÇÖZÜLME ─────────────────────────────────────────────────
  const last = await shippingService.removeRollFromLoadUnit(cartShip, c2);
  check("§6a ⭐ Son top çıkınca birim ÇÖZÜLÜR", (last.data as { unitDissolved: boolean }).unitDissolved === true);
  const du = await prisma.sack.findUniqueOrThrow({ where: { id: n1.unitId }, select: { dissolvedAt: true, shipmentId: true, seq: true } });
  check("§6b Çözülen birim sevkiyatında damgalı, havuzda değil, sırası boş", du.dissolvedAt !== null && du.shipmentId === cartShip && du.seq === null);
  const c6 = await counts(cartShip);
  check("§6c ⭐ Detay/döküm/board çözülmüşü SAYMAZ (1 araba)", c6.det.cartCount === 1 && c6.det.sackCount === 1 && c6.cont.sacks.length === 1 && c6.board?.cartCount === 1, `${c6.det.cartCount}/${c6.cont.sacks.length}/${c6.board?.cartCount}`);
  check("§6c2 Board araba no listesinde çözülen araba yok", JSON.stringify(c6.board?.cartLabels) === JSON.stringify(["A-1"]), JSON.stringify(c6.board?.cartLabels));
  const dissolvedReplay = await caught(() => add(cartShip, "CART", [c2], "A-2", tok));
  check("§6d ⭐ Çözülmüş birimin token'ı → 409 LOAD_UNIT_DISSOLVED", dissolvedReplay.code === "LOAD_UNIT_DISSOLVED" && dissolvedReplay.status === 409, `${dissolvedReplay.status} ${dissolvedReplay.code}`);
  const reopen = unitData(await add(cartShip, "CART", [c2], "A-2", crypto.randomUUID()));
  check("§6e Aynı araba no yeniden açılır (yeni birim)", reopen.unitId !== n1.unitId && reopen.added === 1);

  // ── §8 YARIŞ (elle açık tx) ─ sevk §7'den önce: çıkarma ↔ eşzamanlı taşıma ─
  const raceRoll = c3;
  let releaseHeld: () => void = () => {};
  const held = new Promise<void>((r) => { releaseHeld = r; });
  let lockedSignal: () => void = () => {};
  const locked = new Promise<void>((r) => { lockedSignal = r; });
  const holder = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM shipments WHERE id = ${cartShip}::uuid FOR UPDATE`;
    lockedSignal();
    await held;
    await tx.roll.update({ where: { id: raceRoll }, data: { sackId: null, shipmentId: null } });
  }, { timeout: 20_000 });
  await locked;
  const racer = caught(() => shippingService.removeRollFromLoadUnit(cartShip, raceRoll));
  await new Promise((r) => setTimeout(r, 400));
  releaseHeld();
  await holder;
  const rr = await racer;
  check("§8a ⭐ Yarış: çıkarma kilitte bekledi, top bu arada taşındı → 409 ROLL_NOT_IN_SHIPMENT", rr.status === 409 && rr.code === "ROLL_NOT_IN_SHIPMENT", `${rr.status} ${rr.code}`);

  // Ekleme ↔ top eşzamanlı başka sevkiyata alınır.
  const raceAdd = await makeRoll(11);
  let rel2: () => void = () => {};
  const held2 = new Promise<void>((r) => { rel2 = r; });
  let sig2: () => void = () => {};
  const locked2 = new Promise<void>((r) => { sig2 = r; });
  const holder2 = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM shipments WHERE id = ${bulkShip}::uuid FOR UPDATE`;
    sig2();
    await held2;
    await tx.roll.update({ where: { id: raceAdd }, data: { sackId: reopen.unitId, shipmentId: cartShip } });
  }, { timeout: 20_000 });
  await locked2;
  const racer2 = caught(() => add(bulkShip, "BULK", [raceAdd]));
  await new Promise((r) => setTimeout(r, 400));
  rel2();
  await holder2;
  const ra = await racer2;
  const raRoll = await roll(raceAdd);
  check("§8b ⭐ Yarış: ekleme bekledi, top başka sevkiyata girdi → 409 ROLL_TAKEN, top orada kaldı", ra.status === 409 && ra.code === "ROLL_TAKEN" && raRoll.shipmentId === cartShip, `${ra.status} ${ra.code}`);

  // ── §7 SEVK SONRASI ──────────────────────────────────────────────────────
  await shippingService.dispatchShipment(bulkShip, { plateNumber: "34 TST 01" });
  const st = await prisma.shipment.findUniqueOrThrow({ where: { id: bulkShip }, select: { status: true } });
  check("§7a (ön koşul) dökme sevkiyatı sevk edildi", st.status !== ShipmentStatus.PLANNED, st.status);
  const car = await prisma.shipment.findUniqueOrThrow({ where: { id: bulkShip }, select: { plateNumber: true, driverName: true } });
  check("§7a2 Sevk anında gelen plaka yazılır, gelmeyen şoför korunur", car.plateNumber === "34 TST 01" && car.driverName === "Ali Test", JSON.stringify(car));
  const late = await makeRoll(5);
  const afterAdd = await caught(() => add(bulkShip, "BULK", [late]));
  check("§7b ⭐ Sevk sonrası ekleme → 409 SHIPMENT_NOT_PLANNED", afterAdd.status === 409 && afterAdd.code === "SHIPMENT_NOT_PLANNED", `${afterAdd.status} ${afterAdd.code}`);
  const afterRm = await caught(() => shippingService.removeRollFromLoadUnit(bulkShip, b1));
  check("§7c ⭐ Sevk sonrası çıkarma → 409 SHIPMENT_NOT_PLANNED, top sevkiyatta", afterRm.status === 409 && afterRm.code === "SHIPMENT_NOT_PLANNED" && (await roll(b1)).shipmentId === bulkShip, `${afterRm.status} ${afterRm.code}`);
  check("§7d Dökme birimi türü değişmedi", (await liveUnits(bulkShip))[0]?.unitKind === LoadUnitKind.BULK);
}

main()
  .catch((e) => {
    fail++;
    console.error("❌ Beklenmeyen hata:", e);
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    for (const [key, value] of savedSettings) {
      if (value === null) await prisma.systemSetting.deleteMany({ where: { key } }).catch(() => {});
      else await prisma.systemSetting.update({ where: { key }, data: { value: value as Prisma.InputJsonValue } }).catch(() => {});
    }
    const sids = [...new Set(shipmentIds)];
    const sackIds = customerId ? (await prisma.sack.findMany({ where: { OR: [{ customerId }, { shipmentId: { in: sids } }] }, select: { id: true } })).map((s) => s.id) : [];
    await prisma.sackWeighing.deleteMany({ where: { sackId: { in: sackIds } } }).catch(() => {});
    await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackIds } } }).catch(() => {}); // fikstür temizliği
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: sids } } }).catch(() => {});
    await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: sids } } }).catch(() => {});
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: sids } } }).catch(() => {});
    if (rollIds.length > 0) {
      await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null, shipmentId: null } }).catch(() => {});
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch((e) => console.error("temizlik roll:", (e as Error).message));
    }
    await prisma.sack.deleteMany({ where: { id: { in: sackIds } } }).catch((e) => console.error("temizlik sack:", (e as Error).message));
    await prisma.shipment.deleteMany({ where: { id: { in: sids } } }).catch((e) => console.error("temizlik shipment:", (e as Error).message));
    if (customerId) {
      await prisma.orderLine.deleteMany({ where: { order: { customerId } } }).catch(() => {});
      await prisma.order.deleteMany({ where: { customerId } }).catch(() => {});
      await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => {});
    }
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => {});
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
