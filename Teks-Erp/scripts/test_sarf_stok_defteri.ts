// =============================================================================
// BEKÇİ — SARF STOK DEFTERİ (kuşak / kurşun şeridi; `consumable_movements`)
// Çalıştır: npx tsx scripts/run-all-tests.ts sarf_stok_defteri
// =============================================================================
//   §1 Ayar KAPALI (varsayılan): kurşun izi sarf yazmaz; mal kabul sarf satırını bugünkü gibi reddeder;
//      kuşak ihtiyacı raporu stok sütunu taşımaz (bayt-aynı)
//   §2 Ayar AÇIK: mal kabul sarf satırı RECEIPT_IN; fiş iptali RECEIPT_CANCEL_OUT (reversesId bağlı)
//   §3 Kurşun izi → metre × geçerli norm düşer; aynı ize ikinci çağrı no-op; gramaj düzeltmesi eski
//      tüketimi ters kayıtla geri yazar; iz geri alınınca (revokeRollOperations) ters kayıt — ileri satır silinmez
//   §4 Eksi bakiye ENGELLEMEZ, uyarı döner
//   §5 Kuşak: top boyu bilinmeyen iş emrinde düşüm yok + uyarı
//   §6 Kuşak ihtiyacı raporu: değerin sarf kalemi varsa stokta/eksik sütunu (ayar açık)
// =============================================================================
import { randomUUID } from "node:crypto";
import { ConsumableMovementKind, Prisma, RollOperationType, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { goodsReceiptService } from "../src/services/goods-receipt.service";
import { applyKursunOperationTx } from "../src/services/helpers/kursun-operation.helper";
import { revokeRollOperations } from "../src/services/helpers/roll-operation.helper";
import { consumableBalances, consumeForOperationTx } from "../src/services/helpers/consumable-stock.helper";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { targetValueNeedReport } from "../src/services/reports/target-value-need.report";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const TAG = `TST-SARF-${Date.now()}`;
const FLAG_KEYS = [SETTING_KEYS.CONSUMABLE_STOCK_ENABLED, SETTING_KEYS.TICARET_ENABLED];
const created = { items: [] as string[], props: [] as string[], wos: [] as string[], rolls: [] as string[], receipts: [] as string[], norms: [] as string[] };
let savedSettings: Array<{ key: string; value: Prisma.JsonValue } | null> = [];

async function setFlag(key: string, value: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

async function balanceOf(itemId: string): Promise<string> {
  return ((await consumableBalances(prisma, [itemId])).get(itemId) ?? new Prisma.Decimal(0)).toFixed(3);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  console.log("\n=== Sarf stok defteri (kuşak / kurşun şeridi) ===\n");
  savedSettings = [];
  for (const key of FLAG_KEYS) savedSettings.push(await prisma.systemSetting.findUnique({ where: { key }, select: { key: true, value: true } }));
  await setFlag(SETTING_KEYS.TICARET_ENABLED, true);
  await setFlag(SETTING_KEYS.CONSUMABLE_STOCK_ENABLED, false);

  const adminId = (await ensureTestAdmin()).id;
  const mk = async (suffix: string, itemType: "FABRIC" | "CONSUMABLE" | "SERVICE", unit: "MT" | "KG" | "ADET" = "MT") => {
    const it = await prisma.item.create({ data: { code: `${TAG}-${suffix}`.slice(0, 32), name: `${TAG} ${suffix}`, itemType, unit }, select: { id: true } });
    created.items.push(it.id);
    return it.id;
  };
  const fabricId = await mk("F", "FABRIC");
  const stripId = await mk("S", "CONSUMABLE", "KG");
  const beltId = await mk("K", "CONSUMABLE", "ADET");
  const serviceId = await mk("H", "SERVICE");

  const prop = await prisma.fabricProperty.create({
    data: {
      code: `${TAG}-P`.slice(0, 32),
      name: `${TAG} gramaj`,
      values: { create: [{ code: "G1", name: "G1", serviceItemId: serviceId }, { code: "G2", name: "G2" }, { code: "ZEBRA", name: "Zebra", consumableItemId: beltId }] },
    },
    select: { id: true, values: { select: { id: true, code: true } } },
  });
  created.props.push(prop.id);
  const val = (c: string) => prop.values.find((v) => v.code === c)!.id;
  const norm = await prisma.serviceConsumableNorm.create({
    data: { serviceItemId: serviceId, consumableItemId: stripId, qtyPerM: "0.02", unit: "KG", clientToken: randomUUID(), createdById: adminId },
    select: { id: true },
  });
  created.norms.push(norm.id);

  const station = await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } });
  if (!station) throw new Error("Seed fixture eksik: KURSUN_KK2 (önce 'npm run seed')");
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-WO`, status: "IN_PROGRESS" }, select: { id: true } });
  created.wos.push(wo.id);
  const step = await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1, status: "PENDING" }, select: { id: true } });
  const mkRoll = async (s: string) => {
    const r = await prisma.roll.create({
      data: { barcode: `${TAG}-${s}`, itemId: fabricId, initialQty: 100, currentQty: 100, status: RollStatus.IN_PRODUCTION, currentStepId: step.id },
      select: { id: true },
    });
    created.rolls.push(r.id);
    return r.id;
  };
  const roll1 = await mkRoll("R1");
  const kursun = (rollId: string, valueId: string) =>
    prisma.$transaction((tx) => applyKursunOperationTx(tx, { rollId, stepId: step.id, valueId, userId: adminId }));
  const consumptionRows = (rollId: string) =>
    prisma.consumableMovement.count({ where: { rollOperation: { rollId }, kind: ConsumableMovementKind.CONSUMPTION_OUT } });

  // ── §1 AYAR KAPALI ─────────────────────────────────────────────────────
  await kursun(roll1, val("G1"));
  check("§1a kapalı: kurşun izi sarf satırı yazmaz", (await consumptionRows(roll1)) === 0);
  const wh = await fixtureWarehouseId();
  let rejected = false;
  try {
    const r = await goodsReceiptService.create({ warehouseId: wh, lines: [{ itemId: stripId, initialQty: 5 }] }, adminId);
    const id = (r.data as { id?: string } | undefined)?.id;
    if (id) created.receipts.push(id);
  } catch (e) {
    rejected = String((e as Error).message).includes("mal kabul fişi yalnız kumaş ve iplik alır");
  }
  check("§1b kapalı: mal kabul sarf satırını bugünkü 400 ile reddeder", rejected);
  await prisma.workOrderTargetValue.create({ data: { workOrderId: wo.id, propertyId: prop.id, valueId: val("ZEBRA") } });
  const repOff = await targetValueNeedReport();
  check("§1c kapalı: rapor satırlarında stokta/eksik anahtarı yok", repOff.satirlar.every((s) => !("stokta" in s) && !("eksik" in s)));

  // ── §2 AÇIK: mal kabul + iptal ─────────────────────────────────────────
  await setFlag(SETTING_KEYS.CONSUMABLE_STOCK_ENABLED, true);
  const rec = await goodsReceiptService.create({ warehouseId: wh, lines: [{ itemId: stripId, initialQty: 10 }] }, adminId);
  const recId = (rec.data as { id: string }).id;
  created.receipts.push(recId);
  check("§2a açık: mal kabul sarf satırı RECEIPT_IN yazar", (await balanceOf(stripId)) === "10.000", await balanceOf(stripId));
  const rec2 = await goodsReceiptService.create({ warehouseId: wh, lines: [{ itemId: stripId, initialQty: 3 }] }, adminId);
  const rec2Id = (rec2.data as { id: string }).id;
  created.receipts.push(rec2Id);
  await goodsReceiptService.cancel(rec2Id, "TEST — bekçi iptali", adminId);
  const cancelRow = await prisma.consumableMovement.findFirst({ where: { goodsReceiptId: rec2Id, kind: ConsumableMovementKind.RECEIPT_CANCEL_OUT }, select: { reversesId: true } });
  check("§2b fiş iptali ters kayıt (reversesId bağlı) yazar, bakiye geri döner", !!cancelRow?.reversesId && (await balanceOf(stripId)) === "10.000");

  // ── §3 KURŞUN TÜKETİMİ ─────────────────────────────────────────────────
  const roll2 = await mkRoll("R2");
  await kursun(roll2, val("G1"));
  check("§3a kurşun: 100 m × 0,02 = 2 kg düşer", (await balanceOf(stripId)) === "8.000", await balanceOf(stripId));
  const op2 = await prisma.rollOperation.findFirstOrThrow({ where: { rollId: roll2, revokedAt: null }, select: { id: true } });
  await prisma.$transaction((tx) => consumeForOperationTx(tx, op2.id, adminId));
  check("§3b aynı ize ikinci çağrı no-op", (await consumptionRows(roll2)) === 1 && (await balanceOf(stripId)) === "8.000");
  await kursun(roll2, val("G2"));
  check("§3c gramaj düzeltmesi (hizmet kalemi yok) eski tüketimi ters kayıtla geri yazar", (await balanceOf(stripId)) === "10.000");
  check("§3d ileri satır silinmez", (await consumptionRows(roll2)) === 1);
  const roll3 = await mkRoll("R3");
  await kursun(roll3, val("G1"));
  await prisma.$transaction((tx) => revokeRollOperations(tx, { rollIds: [roll3], operationTypes: [RollOperationType.KURSUN_APPLIED], reason: "BEKCI_TEST", userId: adminId }));
  const rev = await prisma.consumableMovement.count({ where: { kind: ConsumableMovementKind.CONSUMPTION_REVERSAL_IN, reverses: { rollOperation: { rollId: roll3 } } } });
  check("§3e iz geri alınınca CONSUMPTION_REVERSAL_IN yazılır", rev === 1 && (await balanceOf(stripId)) === "10.000");

  // ── §4 EKSİ BAKİYE ─────────────────────────────────────────────────────
  const big = await prisma.roll.create({
    data: { barcode: `${TAG}-BIG`, itemId: fabricId, initialQty: 1000, currentQty: 1000, status: RollStatus.IN_PRODUCTION, currentStepId: step.id },
    select: { id: true },
  });
  created.rolls.push(big.id);
  const bigOp = await prisma.rollOperation.create({
    data: { rollId: big.id, workOrderStepId: step.id, operationType: RollOperationType.KURSUN_APPLIED, propertyValueId: val("G1") },
    select: { id: true },
  });
  const warns = await prisma.$transaction((tx) => consumeForOperationTx(tx, bigOp.id, adminId));
  check("§4 eksi bakiye engellemez + CONSUMABLE_NEGATIVE_BALANCE uyarısı", (await balanceOf(stripId)) === "-10.000" && warns.some((w) => w.code === "CONSUMABLE_NEGATIVE_BALANCE"));

  // ── §5 KUŞAK — top boyu bilinmiyor ─────────────────────────────────────
  const tamburOp = await prisma.rollOperation.create({
    data: { rollId: roll1, workOrderStepId: step.id, operationType: RollOperationType.TAMBUR_PROCESSED },
    select: { id: true },
  });
  const kw = await prisma.$transaction((tx) => consumeForOperationTx(tx, tamburOp.id, adminId));
  check("§5 kuşak: top boyu bilinmeyen iş emrinde düşüm yok + uyarı", (await balanceOf(beltId)) === "0.000" && kw.some((w) => w.code === "CONSUMABLE_PIECE_LENGTH_UNKNOWN"));

  // ── §6 RAPOR STOK SÜTUNU (açık) ────────────────────────────────────────
  // Rapor açık sipariş kalemi ister; fikstür siparişi yok → yalnız sözleşme: satırı olan değerde
  // stokta/eksik dolu, olmayanda anahtar yok. Toplu ölçüm: açıkken hiçbir satır stoksuz sarf kaleminde boş kalmaz.
  const repOn = await targetValueNeedReport();
  check("§6 açık: sarf kalemli değer satırları stokta/eksik taşır", repOn.satirlar.every((s) => (s.stokta === undefined) === (s.eksik === undefined)));
}

async function cleanup(): Promise<void> {
  const ops = await prisma.rollOperation.findMany({ where: { rollId: { in: created.rolls } }, select: { id: true } });
  const opIds = ops.map((o) => o.id);
  // Ters satırlar önce (reversesId RESTRICT), sonra ileri satırlar.
  const mv = await prisma.consumableMovement.findMany({
    where: { OR: [{ itemId: { in: created.items } }, { rollOperationId: { in: opIds } }, { goodsReceiptId: { in: created.receipts } }] },
    select: { id: true, reversesId: true },
  });
  await prisma.consumableMovement.deleteMany({ where: { id: { in: mv.filter((m) => m.reversesId !== null).map((m) => m.id) } } });
  await prisma.consumableMovement.deleteMany({ where: { id: { in: mv.filter((m) => m.reversesId === null).map((m) => m.id) } } });
  await prisma.rollOperation.deleteMany({ where: { id: { in: opIds } } });
  await prisma.workOrderTargetValue.deleteMany({ where: { workOrderId: { in: created.wos } } });
  await prisma.roll.deleteMany({ where: { OR: [{ id: { in: created.rolls } }, { goodsReceiptId: { in: created.receipts } }] } });
  await prisma.goodsReceipt.deleteMany({ where: { id: { in: created.receipts } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: created.wos } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: created.wos } } });
  await prisma.serviceConsumableNorm.deleteMany({ where: { id: { in: created.norms } } });
  await prisma.fabricPropertyValue.deleteMany({ where: { propertyId: { in: created.props } } });
  await prisma.fabricProperty.deleteMany({ where: { id: { in: created.props } } });
  await prisma.item.deleteMany({ where: { id: { in: created.items } } });
  for (let i = 0; i < FLAG_KEYS.length; i++) {
    const s = savedSettings[i];
    if (s) await prisma.systemSetting.update({ where: { key: s.key }, data: { value: s.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key: FLAG_KEYS[i] } });
  }
}

main()
  .catch((e) => {
    fail++;
    console.error("❌ beklenmeyen hata:", e);
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (e) {
      console.error("⚠️ temizlik hatası:", e);
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
