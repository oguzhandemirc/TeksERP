// =============================================================================
// BEKÇİ — SARF TÜKETİM TABANI (top başına poşet · gramaja özel kurşun ipi · tüketim maliyeti; 2026-11-10 GK sarf)
// Çalıştır: npx tsx scripts/run-all-tests.ts sarf_tuketim_taban
// =============================================================================
//   §1 Ayar KAPALI: tambur çıktı topu sarf yazmaz
//   §2 PER_ROLL: çıktı topu başına TEK satır (ikinci çağrı no-op; bayrak + çeşit satırı çift sayılmaz;
//      çeşide özel PER_ROLL norm çeşitsizi ezer); PER_METER norm doğumda okunmaz
//   §3 Tambur geri alma: ters kayıt (CONSUMPTION_REVERSAL_IN, reversesId), ileri satır durur; ikinci çağrı no-op
//   §4 Kurşun: gramaja özel norm önceliği; çeşide normu olmayan gramaj çeşitsiz norma düşer (eski davranış)
//   §5 Maliyet: ağırlıklı ortalama tüketim anında; alış yoksa null (0 değil)
//   §6 İE sarfiyat yüzeyi: maliyet alanları yalnız canCost iken; terslenen hariç
//   §7 DB CHECK: tüketim satırı tek bağ (iz XOR doğan top); doğan top bağı yalnız tüketimde — negatif sonda
//   §8 Kaynak: tek boğaz yalnız OUTPUT doğumda düşer; üç tambur geri alma yolu ters kaydı çağırır
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ConsumableMovementKind, ConsumableNormBasis, Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { kartAc, kartlariSil } from "./lib/kart-fikstur";
import { goodsReceiptService } from "../src/services/goods-receipt.service";
import { applyKursunOperationTx } from "../src/services/helpers/kursun-operation.helper";
import { consumeForTamburBirthTx } from "../src/services/helpers/consumable-birth.helper";
import { reverseBirthConsumptionTx } from "../src/services/helpers/consumable-stock.helper";
import { consumptionCostsTry } from "../src/services/helpers/consumable-cost.helper";
import { workOrderConsumableUsage } from "../src/services/consumable-usage.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) pass++;
  else fail++;
  (cond ? console.log : console.error)(`${cond ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const TAG = `TST-STT-${Date.now()}`;
const FLAG_KEYS = [SETTING_KEYS.CONSUMABLE_STOCK_ENABLED, SETTING_KEYS.TICARET_ENABLED];
const created = { items: [] as string[], props: [] as string[], wos: [] as string[], rolls: [] as string[], receipts: [] as string[], norms: [] as string[] };
let savedSettings: Array<{ key: string; value: Prisma.JsonValue } | null> = [];
const setFlag = (key: string, value: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
const rejects = async (fn: () => Promise<unknown>) => fn().then(() => false, () => true);

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  console.log("\n=== Sarf tüketim tabanı (poşet / kurşun ipi / maliyet) ===\n");
  for (const key of FLAG_KEYS) savedSettings.push(await prisma.systemSetting.findUnique({ where: { key }, select: { key: true, value: true } }));
  await setFlag(SETTING_KEYS.TICARET_ENABLED, true);
  await setFlag(SETTING_KEYS.CONSUMABLE_STOCK_ENABLED, false);
  const adminId = (await ensureTestAdmin()).id;
  const mk = async (s: string, itemType: "FABRIC" | "CONSUMABLE" | "SERVICE", unit: "MT" | "KG" | "ADET" = "MT") => {
    const it = await kartAc({ code: `${TAG}-${s}`.slice(0, 32), name: `${TAG} ${s}`, itemType, unit });
    created.items.push(it.id);
    return it.id;
  };
  const fabricId = await mk("F", "FABRIC");
  const posetId = await mk("PST", "CONSUMABLE", "ADET");
  const ipId = await mk("IP", "CONSUMABLE");
  const tamburSvc = await mk("HT", "SERVICE");
  const kursunSvc = await mk("HK", "SERVICE");

  // Tambur bayrağı (hizmet kalemi özellikte) + çeşidi (tambur katı); kurşun gramajı özelliği (hizmet özellikte).
  const flag = await prisma.fabricProperty.create({ data: { code: `${TAG}-T`.slice(0, 32), name: `${TAG} tambur`, serviceItemId: tamburSvc }, select: { id: true } });
  created.props.push(flag.id);
  const kat = await prisma.fabricProperty.create({
    data: { code: `${TAG}-TK`.slice(0, 32), name: `${TAG} kat`, variantOfPropertyId: flag.id, values: { create: [{ code: "K1", name: "K1" }, { code: "K2", name: "K2" }] } },
    select: { id: true, values: { select: { id: true, code: true } } },
  });
  const gram = await prisma.fabricProperty.create({
    data: { code: `${TAG}-G`.slice(0, 32), name: `${TAG} gramaj`, serviceItemId: kursunSvc, values: { create: [{ code: "G50", name: "50", amount: 50 }, { code: "G75", name: "75", amount: 75 }] } },
    select: { id: true, values: { select: { id: true, code: true } } },
  });
  created.props.push(kat.id, gram.id);
  const v = (p: typeof kat, c: string) => p.values.find((x) => x.code === c)!.id;
  const norm = async (serviceItemId: string, consumableItemId: string, qtyPerM: string, basis: ConsumableNormBasis, propertyValueId: string | null = null) => {
    const unit = consumableItemId === posetId ? "ADET" : "MT";
    const n = await prisma.serviceConsumableNorm.create({ data: { serviceItemId, consumableItemId, qtyPerM, unit, basis, propertyValueId, clientToken: randomUUID(), createdById: adminId }, select: { id: true } });
    created.norms.push(n.id);
  };
  await norm(tamburSvc, posetId, "1", ConsumableNormBasis.PER_ROLL);
  await norm(tamburSvc, posetId, "2", ConsumableNormBasis.PER_ROLL, v(kat, "K2"));
  await norm(tamburSvc, ipId, "5", ConsumableNormBasis.PER_METER); // doğumda okunmamalı
  await norm(kursunSvc, ipId, "1", ConsumableNormBasis.PER_METER); // çeşitsiz (eski davranış)
  await norm(kursunSvc, ipId, "2", ConsumableNormBasis.PER_METER, v(gram, "G75"));

  const station = await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } });
  if (!station) throw new Error("Seed fixture eksik: KURSUN_KK2 (önce 'npm run seed')");
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-WO`, status: "IN_PROGRESS" }, select: { id: true } });
  created.wos.push(wo.id);
  const step = await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1, status: "PENDING" }, select: { id: true } });
  const mkRoll = async (s: string, props: Array<{ propertyId: string; valueId?: string }> = []) => {
    const r = await prisma.roll.create({
      data: { barcode: `${TAG}-${s}`, itemId: fabricId, initialQty: 100, currentQty: 100, status: RollStatus.IN_PRODUCTION, currentStepId: step.id, producedInStepId: step.id },
      select: { id: true },
    });
    created.rolls.push(r.id);
    if (props.length > 0) await prisma.rollProperty.createMany({ data: props.map((p) => ({ rollId: r.id, propertyId: p.propertyId, valueId: p.valueId ?? null })) });
    return r.id;
  };
  const birth = (rollId: string) => prisma.$transaction((tx) => consumeForTamburBirthTx(tx, { rollId, propertyIds: [flag.id, kat.id], userId: adminId }));
  const birthRows = (rollId: string) => prisma.consumableMovement.findMany({ where: { birthRollId: rollId, kind: ConsumableMovementKind.CONSUMPTION_OUT }, select: { id: true, itemId: true, qty: true } });

  // ── §1 KAPALI ──────────────────────────────────────────────────────────
  const r1 = await mkRoll("R1", [{ propertyId: flag.id }]);
  await birth(r1);
  check("§1 kapalı: tambur çıktı topu sarf yazmaz", (await birthRows(r1)).length === 0);

  // ── §2 PER_ROLL ────────────────────────────────────────────────────────
  await setFlag(SETTING_KEYS.CONSUMABLE_STOCK_ENABLED, true);
  const wh = await fixtureWarehouseId();
  const rec = await goodsReceiptService.create({ warehouseId: wh, clientToken: randomUUID(), lines: [{ itemId: posetId, initialQty: 100, unitPrice: 1.5 }] }, adminId);
  created.receipts.push((rec.data as { id: string }).id);
  await birth(r1);
  await birth(r1);
  const r1Rows = await birthRows(r1);
  check("§2a çıktı topu başına tek poşet satırı (ikinci çağrı no-op)", r1Rows.length === 1 && r1Rows[0]!.itemId === posetId && r1Rows[0]!.qty.eq(1), JSON.stringify(r1Rows));
  check("§2b PER_METER norm doğumda okunmaz (ip satırı yok)", !r1Rows.some((r) => r.itemId === ipId));
  const r2 = await mkRoll("R2", [{ propertyId: flag.id }, { propertyId: kat.id, valueId: v(kat, "K1") }]);
  await birth(r2);
  const r2Rows = await birthRows(r2);
  check("§2c bayrak + normsuz çeşit: çeşitsiz norma düşer, çift sayılmaz (1 satır, 1 adet)", r2Rows.length === 1 && r2Rows[0]!.qty.eq(1), JSON.stringify(r2Rows));
  const r3 = await mkRoll("R3", [{ propertyId: flag.id }, { propertyId: kat.id, valueId: v(kat, "K2") }]);
  await birth(r3);
  const r3Rows = await birthRows(r3);
  check("§2d çeşide özel PER_ROLL norm çeşitsizi ezer (K2 → 2 adet)", r3Rows.length === 1 && r3Rows[0]!.qty.eq(2), JSON.stringify(r3Rows));

  // ── §3 Tambur geri alma ────────────────────────────────────────────────
  const n1 = await prisma.$transaction((tx) => reverseBirthConsumptionTx(tx, [r3], adminId, "TEST geri alma"));
  const n2 = await prisma.$transaction((tx) => reverseBirthConsumptionTx(tx, [r3], adminId, "TEST geri alma"));
  const rev = await prisma.consumableMovement.findFirst({ where: { reversesId: r3Rows[0]!.id }, select: { kind: true, qty: true } });
  check("§3a geri alma ters kaydı yazar (REVERSAL_IN, aynı miktar), ileri satır durur", n1 === 1 && rev?.kind === ConsumableMovementKind.CONSUMPTION_REVERSAL_IN && rev.qty.eq(2) && (await birthRows(r3)).length === 1);
  check("§3b ikinci geri alma no-op", n2 === 0);

  // ── §4 Kurşun: gramaja özel öncelik + çeşitsiz yedek ───────────────────
  const kursun = async (s: string, valueId: string) => {
    const rid = await mkRoll(s);
    await prisma.$transaction((tx) => applyKursunOperationTx(tx, { rollId: rid, stepId: step.id, valueId, userId: adminId }));
    return prisma.consumableMovement.findMany({ where: { rollOperation: { rollId: rid }, kind: ConsumableMovementKind.CONSUMPTION_OUT }, select: { itemId: true, qty: true } });
  };
  const k75 = await kursun("K75", v(gram, "G75"));
  check("§4a gramaja özel norm önceliği (75 gr → 2 mt/mt × 100 = 200)", k75.length === 1 && k75[0]!.qty.eq(200), JSON.stringify(k75));
  const k50 = await kursun("K50", v(gram, "G50"));
  check("§4b özel normu olmayan gramaj çeşitsiz norma düşer (eski PER_METER: 100)", k50.length === 1 && k50[0]!.qty.eq(100), JSON.stringify(k50));

  // ── §5 Maliyet ─────────────────────────────────────────────────────────
  const t0 = new Date();
  const rec2 = await goodsReceiptService.create({ warehouseId: wh, clientToken: randomUUID(), lines: [{ itemId: posetId, initialQty: 100, unitPrice: 2.5 }] }, adminId);
  created.receipts.push((rec2.data as { id: string }).id);
  const t1 = new Date(Date.now() + 1000);
  const [before, after, unpriced] = await consumptionCostsTry([
    { itemId: posetId, qty: new Prisma.Decimal(4), createdAt: t0 },
    { itemId: posetId, qty: new Prisma.Decimal(4), createdAt: t1 },
    { itemId: ipId, qty: new Prisma.Decimal(10), createdAt: t1 },
  ]);
  check("§5a ikinci alıştan önce birim 1,5 (4 adet → 6 TL)", before!.unitTry?.eq(1.5) === true && before!.costTry?.eq(6) === true, before!.costTry?.toString());
  check("§5b sonra ağırlıklı ortalama 2,0 (4 adet → 8 TL)", after!.unitTry?.eq(2) === true && after!.costTry?.eq(8) === true, after!.costTry?.toString());
  check("§5c alış yok → null (0 değil)", unpriced!.unitTry === null && unpriced!.costTry === null);

  // ── §6 İE sarfiyat yüzeyi ──────────────────────────────────────────────
  const plain = await workOrderConsumableUsage(wo.id, { canCost: false });
  const withCost = await workOrderConsumableUsage(wo.id, { canCost: true });
  const pRow = plain.rows.find((r) => r.itemId === posetId);
  check("§6a izinsiz: maliyet anahtarı yok, poşet = 2 (terslenen K2 hariç)", !!pRow && pRow.qty === "2.000" && !("costTry" in pRow) && !("totalCostTry" in plain), JSON.stringify(pRow));
  const ipRow = withCost.rows.find((r) => r.itemId === ipId);
  check("§6b kurşun ipi ≈ kg = Σ metre × gramaj (100×75 + 100×50 g = 12,50 kg)", ipRow?.kursunKg === "12.50", JSON.stringify(ipRow));
  check("§6c izinli: ip maliyeti bilinmiyor (null) → toplam null, poşet maliyeti dolu", ipRow?.costTry === null && "totalCostTry" in withCost && withCost.totalCostTry === null && !!withCost.rows.find((r) => r.itemId === posetId)?.costTry);

  // ── §7 DB CHECK negatif sonda ──────────────────────────────────────────
  const opId = (await prisma.rollOperation.findFirst({ where: { rollId: { in: created.rolls } }, select: { id: true } }))!.id;
  check("§7a tüketim satırı iki bağ birden taşıyamaz", await rejects(() => prisma.consumableMovement.create({ data: { itemId: posetId, kind: "CONSUMPTION_OUT", qty: 1, rollOperationId: opId, birthRollId: r2 } })));
  check("§7b tüketim satırı bağsız olamaz", await rejects(() => prisma.consumableMovement.create({ data: { itemId: posetId, kind: "CONSUMPTION_OUT", qty: 1 } })));
  // Ters satır + doğan top bağı: yalnız bu CHECK reddeder; kabul edilirse (sonda) tx geri sarılır, defter kirlenmez.
  const revProbe = (birthRollId: string | null) =>
    prisma
      .$transaction(async (tx) => {
        await tx.consumableMovement.create({ data: { itemId: posetId, kind: "CONSUMPTION_REVERSAL_IN", qty: 1, reversesId: r1Rows[0]!.id, birthRollId } });
        throw new Error("ROLLBACK_OK");
      })
      .then(() => "accepted", (e: Error) => (e.message === "ROLLBACK_OK" ? "accepted" : "rejected"));
  check("§7c doğan top bağı tüketim dışı satırda olamaz (bağsız ters satır kabul — sonda geçerli)", (await revProbe(r2)) === "rejected" && (await revProbe(null)) === "accepted");

  // ── §8 Kaynak ──────────────────────────────────────────────────────────
  const src = (p: string) => readFileSync(path.join(__dirname, "..", "src", p), "utf8");
  const shared = src("services/tambur/shared.ts");
  check("§8a tek boğaz yalnız OUTPUT doğumda düşer", /if \(args\.birth === "OUTPUT"\) await consumeForTamburBirthTx\(/.test(shared));
  const undo = src("services/tambur-undo.service.ts");
  check("§8b üç tambur geri alma yolu ters kaydı çağırır", (undo.match(/await reverseBirthConsumptionTx\(/g) ?? []).length === 3);
  const manual = src("services/tambur-manual.service.ts");
  check("§8c elle eklenen (tambura giren) top INPUT doğar — çift sayım yok", /birth: "INPUT"/.test(manual));
}

async function cleanup(): Promise<void> {
  const mv = await prisma.consumableMovement.findMany({
    where: { OR: [{ itemId: { in: created.items } }, { birthRollId: { in: created.rolls } }, { goodsReceiptId: { in: created.receipts } }] },
    select: { id: true, reversesId: true },
  });
  await prisma.consumableMovement.deleteMany({ where: { id: { in: mv.filter((m) => m.reversesId !== null).map((m) => m.id) } } });
  await prisma.consumableMovement.deleteMany({ where: { id: { in: mv.filter((m) => m.reversesId === null).map((m) => m.id) } } });
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: created.rolls } } });
  await prisma.rollProperty.deleteMany({ where: { rollId: { in: created.rolls } } });
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: created.receipts } } });
  await prisma.roll.deleteMany({ where: { id: { in: created.rolls } } });
  await prisma.goodsReceipt.deleteMany({ where: { id: { in: created.receipts } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: created.wos } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: created.wos } } });
  await prisma.serviceConsumableNorm.deleteMany({ where: { id: { in: created.norms } } });
  // Çeşit bayraktan önce silinir (variantOf RESTRICT): yaratılış sırasının tersi.
  await prisma.fabricPropertyValue.deleteMany({ where: { propertyId: { in: created.props } } });
  for (const id of [...created.props].reverse()) await prisma.fabricProperty.deleteMany({ where: { id } });
  await kartlariSil(created.items);
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
