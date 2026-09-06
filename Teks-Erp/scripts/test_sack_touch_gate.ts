// =============================================================================
// BEKÇİ — ÇUVAL / SEVKİYAT DOKUNMA KAPILARI
//   `touchWarehouseSackTx`  ·  `touchShipmentPlannedTx`
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts sack_touch_gate
//
// ⭐ NEDEN YAZILDI: bu iki kapı kök `CLAUDE.md` "Yeni endpoint kontrol listesi"
//    maddesidir ("Depo çuvalı içeriğine dokunuyorsa `touchWarehouseSackTx`;
//    PLANNED sevkiyat kümesi `touchShipmentPlannedTx`") — ama 2026-09-06'da
//    ÖLÇÜLDÜ Kİ HİÇBİR BEKÇİSİ YOKTU: `touchWarehouseSackTx`in gövdesi koşulsuz
//    `return`e çevrildi ve SEKİZ çuval bekçisinin (pool_lifecycle ·
//    status_invariant · notes · weigh_source · content_dump · split_and_relabel ·
//    reassign_customer · bulk_distribute) HİÇBİRİ kırmızı VERMEDİ.
//
//    Sınıf: "kural yazılı ama kapısı yok". Kapı sessizce düşerse sevkiyata
//    atanmış çuvalın içeriği değiştirilebilir hâle gelir; donmuş irsaliye ile
//    fiziksel çuval AYRIŞIR ve bu ancak müşteri sayarken ortaya çıkar.
//
// NE ÖLÇER: kapının GERÇEKTEN reddettiğini — var olduğunu değil.
//   §2 depodaki çuval (shipmentId NULL)      → GEÇER  (kapı çıkışsız değil)
//   §3 sevkiyata atanmış çuval               → 409
//   §4 olmayan çuval                         → 409   (fail-closed)
//   §5 PLANNED sevkiyat geçer / sevk edilmiş → 409
//   §6 çağrı yeri TABANI — kapı bir uçtan sessizce sökülemez
//
// ⭐ NEGATİF SONDA (2026-09-06, ölçüldü): `touchWarehouseSackTx` gövdesine
//    koşulsuz `return` konunca §3 ve §4 KIRMIZI; `touchShipmentPlannedTx`e aynısı
//    yapılınca §5'in ikinci kontrolü KIRMIZI; `shipping.service.ts`ten tek bir
//    `await touchWarehouseSackTx(...)` satırı silinince §6 KIRMIZI. Geri
//    alındığında hepsi yeşil.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, RollStatus, RollEntrySource, ShipmentStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import {
  touchWarehouseSackTx,
  touchShipmentPlannedTx,
} from "../src/services/helpers/shipment-locks.helper";

const TS = Date.now();
const P = `TEST-STG-${TS}`;
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

let itemId = "";
let customerId = "";
const createdRolls: string[] = [];
const createdSacks: string[] = [];
const createdShipments: string[] = [];

/**
 * Kapı çağrısını GERİ ALINAN bir tx içinde dener. `true` = kapı reddetti (409).
 * Rollback şart: kapı geçtiğinde `updatedAt` yazar; bekçi ortamda iz bırakmaz.
 */
async function reddedildi(
  fn: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      await fn(tx);
      throw new Error("__GERI_AL__");
    });
    return false;
  } catch (e) {
    return !(e instanceof Error && e.message === "__GERI_AL__");
  }
}

async function makeRoll(sackId: string): Promise<void> {
  const roll = await prisma.roll.create({
    data: {
      barcode: `${P}-R${createdRolls.length + 1}`,
      itemId, width: 150, initialQty: 100, currentQty: 100,
      status: RollStatus.WAREHOUSE, qualityGrade: "1.KALITE",
      entrySource: RollEntrySource.SUPPLIER_RECEIPT,
      sackId,
    },
    select: { id: true },
  });
  createdRolls.push(roll.id);
}

async function makeSack(no: string, shipmentId: string | null): Promise<string> {
  const sack = await prisma.sack.create({
    data: { sackNo: `${P}-${no}`, customerId, shipmentId },
    select: { id: true },
  });
  createdSacks.push(sack.id);
  return sack.id;
}

async function makeShipment(no: string, status: ShipmentStatus): Promise<string> {
  const sh = await prisma.shipment.create({
    data: { shipmentNo: `${P}-${no}`, customerId, status },
    select: { id: true },
  });
  createdShipments.push(sh.id);
  return sh.id;
}

async function run(): Promise<void> {
  customerId = (await prisma.customer.create({
    data: { code: `${P}-C`, name: `${P} MUSTERI` }, select: { id: true },
  })).id;
  itemId = (await prisma.item.create({
    data: { code: `${P}-I`, name: `${P} KUMAS`, itemType: "FABRIC" }, select: { id: true },
  })).id;

  // ── §1 KÖRLÜK ZEMİNİ ─────────────────────────────────────────────────────
  // 0 kontrol ≠ hiç bakılmadı: fixture gerçekten kurulmuş mu?
  console.log("\n§1 — körlük zemini");
  const depoSack = await makeSack("S-DEPO", null);
  await makeRoll(depoSack);
  check("fixture: depoda içeriği olan çuval var",
    (await prisma.roll.count({ where: { sackId: depoSack } })) === 1);

  // ── §2 DEPODAKİ ÇUVAL GEÇER ──────────────────────────────────────────────
  console.log("\n§2 — depodaki çuval (shipmentId NULL) GEÇER");
  check("⭐ kapı depodaki çuvalda geçiyor (çıkışsız kapı DEĞİL)",
    !(await reddedildi((tx) => touchWarehouseSackTx(tx, depoSack))));

  // ── §3 SEVKİYATA ATANMIŞ ÇUVAL REDDEDİLİR ────────────────────────────────
  console.log("\n§3 — sevkiyata atanmış çuval 409");
  const dispatched = await makeShipment("SH-D", ShipmentStatus.DISPATCHED);
  const sevkSack = await makeSack("S-SEVK", dispatched);
  await makeRoll(sevkSack);
  check("⭐ atanmış çuvalda kapı 409 (donmuş irsaliye ↔ fiziksel çuval ayrışmasın)",
    await reddedildi((tx) => touchWarehouseSackTx(tx, sevkSack)));
  check("atanmış çuvalda kapı reddettikten sonra çuval hâlâ o sevkiyatta",
    (await prisma.sack.findUnique({ where: { id: sevkSack }, select: { shipmentId: true } }))
      ?.shipmentId === dispatched);

  // ── §4 OLMAYAN ÇUVAL: FAIL-CLOSED ────────────────────────────────────────
  console.log("\n§4 — olmayan çuval SESSİZ GEÇMEZ");
  check("⭐ olmayan çuval id'siyle kapı 409 (`updateMany` 0 satırı sessizce geçmez)",
    await reddedildi((tx) => touchWarehouseSackTx(tx, "00000000-0000-0000-0000-000000000000")));

  // ── §5 PLANNED SEVKİYAT KAPISI ───────────────────────────────────────────
  console.log("\n§5 — `touchShipmentPlannedTx`");
  const planned = await makeShipment("SH-P", ShipmentStatus.PLANNED);
  check("PLANNED sevkiyatta kapı geçiyor",
    !(await reddedildi((tx) => touchShipmentPlannedTx(tx, planned))));
  check("⭐ sevk EDİLMİŞ sevkiyatta kapı 409 (çuval kümesi donar)",
    await reddedildi((tx) => touchShipmentPlannedTx(tx, dispatched)));
  const cancelled = await makeShipment("SH-C", ShipmentStatus.CANCELLED);
  check("⭐ İPTAL sevkiyatta kapı 409",
    await reddedildi((tx) => touchShipmentPlannedTx(tx, cancelled)));
  check("olmayan sevkiyat id'siyle kapı 409 (fail-closed)",
    await reddedildi((tx) => touchShipmentPlannedTx(tx, "00000000-0000-0000-0000-000000000000")));

  // ── §6 ÇAĞRI YERİ TABANI ─────────────────────────────────────────────────
  // Kapı bir uçtan sessizce sökülebilir: helper yerinde durur, ama onu çağıran
  // `removeFromSack`/`moveRollBetweenSacks`/… satırı silinir. §2–§5 bunu görmez.
  // Bu yüzden çağrı sayısı RATCHET'tir: yalnız YÜKSELİR. Yeni çağrı ekleyen taban
  // sayısını yükseltir; DÜŞÜRMEK bilinçli bir karar ve gerekçesi arşive yazılır.
  console.log("\n§6 — çağrı yeri tabanı (kapı bir uçtan sökülemez)");
  const TABAN_SHIPPING = 15;
  const TABAN_INVENTORY = 1;
  const TABAN_PLANNED = 4;
  const oku = (f: string): string =>
    readFileSync(join(__dirname, "..", "src", "services", f), "utf8");
  const say = (src: string, ad: string): number =>
    (src.match(new RegExp(`await\\s+${ad}\\s*\\(`, "g")) ?? []).length;
  const shippingSrc = oku("shipping.service.ts");
  const invSrc = oku("inventory.service.ts");
  const nWh = say(shippingSrc, "touchWarehouseSackTx");
  const nInv = say(invSrc, "touchWarehouseSackTx");
  const nPl = say(shippingSrc, "touchShipmentPlannedTx");
  check(`⭐ shipping.service.ts'te ≥${TABAN_SHIPPING} touchWarehouseSackTx çağrısı`,
    nWh >= TABAN_SHIPPING, `ölçülen ${nWh}`);
  check(`⭐ inventory.service.ts'te ≥${TABAN_INVENTORY} touchWarehouseSackTx çağrısı`,
    nInv >= TABAN_INVENTORY, `ölçülen ${nInv}`);
  check(`⭐ shipping.service.ts'te ≥${TABAN_PLANNED} touchShipmentPlannedTx çağrısı`,
    nPl >= TABAN_PLANNED, `ölçülen ${nPl}`);
}

async function teardown(): Promise<void> {
  await prisma.roll.updateMany({
    where: { id: { in: createdRolls } },
    data: { sackId: null, shipmentId: null },
  }).catch(() => {});
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(() => {});
  await prisma.roll.deleteMany({ where: { id: { in: createdRolls } } }).catch(() => {});
  await prisma.sack.deleteMany({ where: { id: { in: createdSacks } } }).catch(() => {});
  await prisma.shipment.deleteMany({ where: { id: { in: createdShipments } } }).catch(() => {});
  if (itemId) await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => {});
  if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => {});
}

run()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => {
    await teardown().catch((e) => console.error("teardown hatası:", e));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
