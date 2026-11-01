// =============================================================================
// BEKÇİ — BRODE FİYAT BİRİMİ: METRE | ADET | VURUŞ (fabrika ayarı; EKS-E2)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_brode_fiyat_birimi.ts
//
// NEDEN: brode bugün metreyle fiyatlanır (DALGA4 S7); fabrika adet ya da vuruşla fiyatlamak isteyebilir.
// Miktar formülü ikinci yerde yazılırsa fatura satırı, bağ tutarlılığı ve kârlılık gelir payı ayrışır;
// tarife satırının birimi işin birimine bakılmadan uygulanırsa metre fiyatı adede kesilir (para hatası).
//
// ÖLÇÜLENLER:
//   §1 METRE (varsayılan) bayt-aynı: ayar yokken ve METER'de taslak JSON birebir; miktar = metre, birim "m", bağda billedQty NULL
//   §2 ADET: miktar = okumadaki adet, birim "adet", tutar = birim fiyat × adet; bağ billedQty = adet, billedMeters = metre
//   §3 VURUŞ: miktar = adet × desen vuruşu, birim "vuruş", tutar = birim fiyat × vuruş
//   §4 Birim uyuşmazlığı: ADET kipinde metre fiyat satırı uygulanmaz (fiyatsız + uyarı)
//   §5 Eksik adet / eksik desen vuruşu: iş faturaya alınmaz + uyarı (uydurma miktar yok)
//   §6 Fatura ↔ kârlılık: `reconcileServiceLinksWithLines` satır miktarını bağ miktarıyla tutturur (metreyle 409);
//      `allocateRevenue` iş başına payı birim fiyat × miktar verir (toplam = satır tutarı)
//   §7 Ayar dört kapı: Zod + servis bilinmeyen değeri reddeder, PIECE/STITCH yazılır (sed kalktı, GK-H1b); panel üç seçenek; okuma varsayılanı METER; tablet okuma gövdesi adet alır
//   §8 Tarife satırı birimi: upsert birimi saklar (METER = NULL); aynı fiyat farklı birim yeni sürüm
//   §10 Tablet adım özeti `pieceInput`: sayaç açık brode istasyonunda ADET/VURUŞ'ta dolu; METER/sayaç OFF'ta anahtar yok
//   §9 AST: miktar okuyucuları `linkBilledQty`/`serviceWorkQuantity` dışında `billedMeters` ile miktar toplamaz
// Negatif sondalar: `serviceWorkQuantity` PIECE dalı metre döndürünce §2 kırmızı · `priceUnitMatches` hep true
// dönünce §4 kırmızı · `allocateRevenue` `billedMeters` payına dönünce §6/§9 kırmızı.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Currency, ItemType, MachineDataSource, MeterApprovalMode, MeterPhase, MeterVarianceBasis, PriceKind, Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { SETTING_KEYS, loadServiceBillingSettings, readFinanceServiceBillingBrodeUnit, systemSettingService } from "../src/services/system-setting.service";
import { collectServiceBillingDraft, reconcileServiceLinksWithLines } from "../src/services/helpers/service-billing.helper";
import { allocateRevenue, type RevenueLinkRow } from "../src/services/helpers/profitability.helper";
import { BRODE_PROPERTY_CODE, brodePieceInputOf } from "../src/services/helpers/service-quantity.helper";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { itemPriceService } from "../src/services/item-price.service";
import { updateSchema } from "../src/routes/feature-flag.routes";
import { completeQc2Schema } from "../src/controllers/kursun-qc.controller";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t} ──`); }
const eq = (a: Prisma.Decimal.Value | null | undefined, b: Prisma.Decimal.Value) => a != null && new Prisma.Decimal(a).equals(new Prisma.Decimal(b));

const STAMP = randomUUID().slice(0, 8);
const P = `TEST-BFB-${STAMP}`;
const fx = {
  itemIds: [] as string[], propIds: [] as string[], valueIds: [] as string[], rollIds: [] as string[], stationIds: [] as string[],
  woIds: [] as string[], customerId: null as string | null, createdBrodeFlag: false,
};
let priorUnit: { existed: boolean; value: unknown } = { existed: false, value: null };
let priorMeter: { existed: boolean; value: unknown } = { existed: false, value: null };

async function main(): Promise<void> {
  console.log("=== Brode fiyat birimi: metre | adet | vuruş (EKS-E2) ===");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU — ${engel}`);
  const unitRow = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.FINANCE_SERVICE_BILLING_BRODE_UNIT }, select: { value: true } });
  priorUnit = { existed: unitRow !== null, value: unitRow?.value ?? null };
  const wh = await ensureDefaultWarehouse();
  if (!wh) throw new Error("Varsayılan depo yok");

  const fabric = (await prisma.item.create({ data: { code: `${P}-K`.slice(0, 32), name: `TEST BFB kumaş ${STAMP}`, itemType: ItemType.FABRIC, unit: "MT" }, select: { id: true } })).id;
  const svc = (await prisma.item.create({ data: { code: `${P}-S`.slice(0, 32), name: `TEST BFB brode ${STAMP}`, itemType: ItemType.SERVICE, unit: "MT" }, select: { id: true } })).id;
  fx.itemIds.push(fabric, svc);
  // BRODE bayrağı kodla tanınır (tek kaynak `BRODE_PROPERTY_CODE`): yoksa bekçi açar ve sonda siler; varsa çeşidi kullanılır.
  let flag = await prisma.fabricProperty.findUnique({ where: { code: BRODE_PROPERTY_CODE }, select: { id: true, variant: { select: { id: true } } } });
  if (!flag) {
    flag = await prisma.fabricProperty.create({ data: { code: BRODE_PROPERTY_CODE, name: `TEST BFB Brode ${STAMP}`, valueType: "FLAG" }, select: { id: true, variant: { select: { id: true } } } });
    fx.propIds.push(flag.id);
    fx.createdBrodeFlag = true;
  }
  let patternId = flag.variant?.id ?? null;
  if (!patternId) {
    patternId = (await prisma.fabricProperty.create({ data: { code: `${P}-D`.slice(0, 32), name: `TEST BFB desen`, valueType: "CHOICE", variantOfPropertyId: flag.id }, select: { id: true } })).id;
    fx.propIds.push(patternId);
  }
  const mkValue = async (code: string, stitchCount: number | null) => {
    const id = (await prisma.fabricPropertyValue.create({ data: { propertyId: patternId!, code: `${code}${STAMP}`.slice(0, 32), name: `TEST BFB ${code}`, serviceItemId: svc, stitchCount }, select: { id: true } })).id;
    fx.valueIds.push(id);
    return id;
  };
  const vStitch = await mkValue("V25", 2500);
  const vNoStitch = await mkValue("V0", null);
  // Kontrol bayrağı (BRODE değil): ayar ona uygulanmaz.
  const other = (await prisma.fabricProperty.create({ data: { code: `${P}-T`.slice(0, 32), name: `TEST BFB tambur`, valueType: "FLAG", serviceItemId: svc }, select: { id: true } })).id;
  fx.propIds.push(other);
  const cust = await prisma.customer.create({ data: { code: `${P}-C`.slice(0, 32), name: `TEST BFB müşteri ${STAMP}` }, select: { id: true } });
  fx.customerId = cust.id;
  const st = await prisma.station.create({ data: { code: `${P}-ST`.slice(0, 32), name: `TEST BFB brode ${STAMP}`, type: "INTERNAL", kind: "PROCESS_QC", appliesProperty: true }, select: { id: true } });
  fx.stationIds.push(st.id);
  await prisma.stationProperty.createMany({ data: [{ stationId: st.id, propertyId: flag.id }, { stationId: st.id, propertyId: other }] });
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${P}-WO`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: fabric, steps: { create: [{ stationId: st.id, stepSequence: 1, status: "ACTIVE" }] } },
    select: { id: true, steps: { select: { id: true } } },
  });
  fx.woIds.push(wo.id);
  const stepId = wo.steps[0]!.id;

  const inventory = new InventoryService();
  const mkRoll = async (meters: number, pieceCount: number | null, props: Array<{ propertyId: string; valueId?: string }>) => {
    const res = await inventory.createInitialEntry({ itemId: fabric, initialQty: meters }, undefined, undefined, false, { forcedStatus: RollStatus.WAREHOUSE, warehouseId: wh.id });
    const id = (res.data as { id: string }).id;
    fx.rollIds.push(id);
    await prisma.roll.update({ where: { id }, data: { ownerCustomerId: cust.id } });
    await prisma.rollProperty.createMany({ data: props.map((p) => ({ rollId: id, propertyId: p.propertyId, valueId: p.valueId ?? null })) });
    await prisma.rollMeterReading.create({
      data: { rollId: id, workOrderStepId: stepId, phase: MeterPhase.OUT, meters: String(meters), pieceCount, source: MachineDataSource.OPERATOR, basis: MeterVarianceBasis.DECLARED_IN, approvalMode: MeterApprovalMode.NONE, clientToken: randomUUID() },
    });
    return id;
  };
  const setPrice = async (price: number, priceUnit: "METER" | "PIECE" | "STITCH") =>
    itemPriceService.upsert({ itemId: svc, customerId: null, kind: PriceKind.SALE, currency: Currency.TRY, price, priceUnit });
  const base = { ...(await loadServiceBillingSettings()), priceDate: "DISPATCH_DAY" as const };
  const draft = (rollIds: string[], brodeUnit?: "METER" | "PIECE" | "STITCH") =>
    collectServiceBillingDraft({ rollIds, customerId: cust.id, currency: Currency.TRY, settings: brodeUnit ? { ...base, brodeUnit } : { ...base, brodeUnit: "METER" }, dispatchedAt: new Date() });
  const amount = (l: { qty: Prisma.Decimal; unitPrice: Prisma.Decimal }) => l.qty.mul(l.unitPrice).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  const rA = await mkRoll(80, 12, [{ propertyId: flag.id }, { propertyId: patternId, valueId: vStitch }]);
  const rB = await mkRoll(20, 30, [{ propertyId: flag.id }, { propertyId: patternId, valueId: vStitch }]);

  // ── §1 ───────────────────────────────────────────────────────────────────
  section("§1 METRE (varsayılan) bayt-aynı");
  await setPrice(5, "METER");
  const m0 = await collectServiceBillingDraft({ rollIds: [rA], customerId: cust.id, currency: Currency.TRY, settings: { ...base, brodeUnit: "METER" }, dispatchedAt: new Date() });
  const m1 = await draft([rA], "METER");
  check("ayar METER ↔ varsayılan taslak JSON birebir", JSON.stringify(m0) === JSON.stringify(m1));
  const ml = m1.lines[0];
  check("METER: tek satır, miktar 80 m, birim 'm', tutar 5 × 80 = 400", m1.lines.length === 1 && eq(ml?.qty, 80) && ml?.unit === "m" && eq(ml ? amount(ml) : null, 400), JSON.stringify(m1.lines));
  check("METER: bağda billedQty/billedUnit NULL, billedMeters 80", m1.links.length === 1 && m1.links[0]!.billedQty === null && m1.links[0]!.billedUnit === null && eq(m1.links[0]!.billedMeters, 80), JSON.stringify(m1.links));

  // ── §2 ───────────────────────────────────────────────────────────────────
  section("§2 ADET: tutar = birim fiyat × adet");
  await setPrice(3, "PIECE");
  const p1 = await draft([rA], "PIECE");
  const pl = p1.lines[0];
  check("ADET: miktar 12, birim 'adet', birim fiyat 3, tutar 36", p1.lines.length === 1 && eq(pl?.qty, 12) && pl?.unit === "adet" && eq(pl?.unitPrice, 3) && eq(pl ? amount(pl) : null, 36), JSON.stringify(p1.lines));
  check("ADET: bağ billedQty 12 PIECE, billedMeters 80 (maliyet metresi korunur)", eq(p1.links[0]?.billedQty, 12) && p1.links[0]?.billedUnit === "PIECE" && eq(p1.links[0]?.billedMeters, 80), JSON.stringify(p1.links));
  const rOther = await mkRoll(40, 7, [{ propertyId: other }]);
  const po = await draft([rOther], "PIECE");
  check("BRODE dışı bayrak ADET kipinde de metre (miktar 40 m, birim 'm')", po.lines.length === 1 && eq(po.lines[0]?.qty, 40) && po.lines[0]?.unit === "m", JSON.stringify(po.lines));

  // ── §3 ───────────────────────────────────────────────────────────────────
  section("§3 VURUŞ: miktar = adet × desen vuruşu");
  await setPrice(0.002, "STITCH");
  const s1 = await draft([rA], "STITCH");
  const sl = s1.lines[0];
  check("VURUŞ: miktar 12 × 2500 = 30000, birim 'vuruş', tutar 0,002 × 30000 = 60", s1.lines.length === 1 && eq(sl?.qty, 30000) && sl?.unit === "vuruş" && eq(sl ? amount(sl) : null, 60), JSON.stringify(s1.lines));
  check("VURUŞ: bağ billedQty 30000 STITCH", eq(s1.links[0]?.billedQty, 30000) && s1.links[0]?.billedUnit === "STITCH", JSON.stringify(s1.links));

  // ── §4 ───────────────────────────────────────────────────────────────────
  section("§4 tarife birimi işin birimiyle aynı olmalı");
  const mis = await draft([rA], "PIECE"); // aktif fiyat STITCH birimli
  check("ADET kipinde VURUŞ fiyatı uygulanmaz: satır fiyatsız (0) + birim uyarısı", eq(mis.lines[0]?.unitPrice, 0) && mis.warnings.some((w) => w.includes("birimi seçilen brode fiyat birimiyle aynı değil")), JSON.stringify({ l: mis.lines, w: mis.warnings }));

  // ── §5 ───────────────────────────────────────────────────────────────────
  section("§5 eksik adet / eksik vuruş ⇒ iş faturaya alınmaz");
  const rNoPiece = await mkRoll(50, null, [{ propertyId: flag.id }, { propertyId: patternId, valueId: vStitch }]);
  const n1 = await draft([rNoPiece], "PIECE");
  check("adetsiz okuma (ADET): satır/bağ yok + 'adedi girilmemiş' uyarısı", n1.lines.length === 0 && n1.links.length === 0 && n1.warnings.some((w) => w.includes("adedi girilmemiş")), JSON.stringify(n1));
  const rNoStitch = await mkRoll(50, 10, [{ propertyId: flag.id }, { propertyId: patternId, valueId: vNoStitch }]);
  const n2 = await draft([rNoStitch], "STITCH");
  check("vuruşsuz desen (VURUŞ): satır/bağ yok + 'vuruş sayısı girilmemiş' uyarısı", n2.lines.length === 0 && n2.links.length === 0 && n2.warnings.some((w) => w.includes("vuruş sayısı girilmemiş")), JSON.stringify(n2));
  const n3 = await draft([rNoPiece], "METER");
  check("aynı top METER kipinde metreyle faturalanır (50 m)", n3.lines.length === 1 && eq(n3.lines[0]?.qty, 50), JSON.stringify(n3.lines));

  // ── §6 ───────────────────────────────────────────────────────────────────
  section("§6 fatura ↔ kârlılık aynı tutar");
  await setPrice(3, "PIECE");
  const two = await draft([rA, rB], "PIECE"); // 12 + 30 adet; metre 80 + 20 (oranlar FARKLI)
  const tl = two.lines[0]!;
  const total = amount(tl);
  check("iki iş tek satır: 42 adet × 3 = 126", two.lines.length === 1 && eq(tl.qty, 42) && eq(total, 126), JSON.stringify(two.lines));
  let rec409 = false;
  try { reconcileServiceLinksWithLines([{ itemId: svc, qty: "100", description: "x" }], two.links); } catch { rec409 = true; }
  let recOk = true;
  try { reconcileServiceLinksWithLines([{ itemId: svc, qty: tl.qty, description: "x" }], two.links); } catch { recOk = false; }
  check("bağ tutarlılığı adetle tutar; metre toplamıyla (100) 409", recOk && rec409, `ok=${recOk} 409=${rec409}`);
  const shares = allocateRevenue(total, two.links as unknown as RevenueLinkRow[]);
  const byRoll = new Map(two.links.map((l, i) => [l.rollId, shares[i]!]));
  check("kârlılık payı = birim fiyat × adet (rA 36, rB 90), toplam 126", eq(byRoll.get(rA), 36) && eq(byRoll.get(rB), 90) && eq(shares.reduce((a, s) => a.plus(s), new Prisma.Decimal(0)), 126), shares.map(String).join(","));

  // ── §7 ───────────────────────────────────────────────────────────────────
  section("§7 ayar dört kapı + tablet gövdesi");
  check("Zod: bilinmeyen birim reddedilir, STITCH kabul", !updateSchema.safeParse({ financeServiceBillingBrodeUnit: "KG" }).success && updateSchema.safeParse({ financeServiceBillingBrodeUnit: "STITCH" }).success);
  const bad = await systemSettingService.setFeatureFlags({ financeServiceBillingBrodeUnit: "KG" as unknown as "METER" }, await testActorId())
    .then(() => 200, (e: { statusCode?: number; message?: string }) => e.statusCode ?? `500 ${e.message}`);
  check("servis: bilinmeyen birim 400", bad === 400, String(bad));
  // GK-H1b: tablette brode adet girişi indi → sed kalktı; PIECE/STITCH sayaç açıkken yazılır ve geri okunur.
  const meterKey = SETTING_KEYS.KURSUN_METER_CAPTURE;
  const meterRow = await prisma.systemSetting.findUnique({ where: { key: meterKey }, select: { value: true } });
  priorMeter = { existed: meterRow !== null, value: meterRow?.value ?? null };
  const setMeter = (v: string) => prisma.systemSetting.upsert({ where: { key: meterKey }, create: { key: meterKey, value: v }, update: { value: v } });
  const flagRes = (input: Parameters<typeof systemSettingService.setFeatureFlags>[0]) => async () => systemSettingService.setFeatureFlags(input, await testActorId())
    .then(() => "200", (e: { statusCode?: number; details?: { code?: string } }) => `${e.statusCode}:${e.details?.code}`);
  await setMeter("OFF");
  const offRes = await flagRes({ financeServiceBillingBrodeUnit: "PIECE" })();
  check("çıkışsız kapı: sayaç OFF iken PIECE 400 BRODE_UNIT_NEEDS_METER_CAPTURE", offRes === "400:BRODE_UNIT_NEEDS_METER_CAPTURE", offRes);
  const bothRes = await flagRes({ financeServiceBillingBrodeUnit: "STITCH", kursunMeterCapture: "OUT" })();
  check("aynı istekte sayaç OUT + STITCH kabul", bothRes === "200", bothRes);
  const backOff = await flagRes({ kursunMeterCapture: "OFF" })();
  check("ters yön: STITCH varken sayaç OFF'a çekilemez (400)", backOff === "400:BRODE_UNIT_NEEDS_METER_CAPTURE", backOff);
  for (const unit of ["PIECE", "STITCH"] as const) {
    const res = await systemSettingService.setFeatureFlags({ financeServiceBillingBrodeUnit: unit }, await testActorId())
      .then(() => "200", (e: { statusCode?: number; details?: { code?: string } }) => `${e.statusCode}:${e.details?.code}`);
    check(`servis: ${unit} kabul edilir (sed yok) ve okuyucu ${unit} döner`, res === "200" && (await readFinanceServiceBillingBrodeUnit()) === unit, res);
  }
  const panelCfg = readFileSync(join(__dirname, "..", "..", "Electron", "src", "pages", "GeneralSettings", "settings-config.ts"), "utf8");
  const brodeRow = panelCfg.slice(panelCfg.indexOf('enumKey: "financeServiceBillingBrodeUnit"'), panelCfg.indexOf("enumKey:", panelCfg.indexOf('enumKey: "financeServiceBillingBrodeUnit"') + 10));
  check("panel üç seçeneği sunar (Metre · Adet · Vuruş)", ['value: "METER"', 'value: "PIECE"', 'value: "STITCH"'].every((v) => brodeRow.includes(v)));
  await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.FINANCE_SERVICE_BILLING_BRODE_UNIT } });
  check("okuma varsayılanı METER (bugünkü davranış)", (await readFinanceServiceBillingBrodeUnit()) === "METER" && (await loadServiceBillingSettings()).brodeUnit === "METER");
  const body = { rollId: randomUUID(), stepId: randomUUID(), meterOut: { meters: 10, source: "OPERATOR", clientToken: randomUUID(), pieceCount: 12 } };
  const parsed = completeQc2Schema.safeParse(body);
  check("tablet çıkış okuması adet taşır (Zod korur) ve 0 adet reddedilir",
    parsed.success && parsed.data.meterOut?.pieceCount === 12 && !completeQc2Schema.safeParse({ ...body, meterOut: { ...body.meterOut, pieceCount: 0 } }).success);

  // ── §10 ──────────────────────────────────────────────────────────────────
  section("§10 tablet adım özeti `pieceInput` (adet girişi yalnız sayaç açık brode istasyonunda, ADET/VURUŞ'ta)");
  const pieceOf = async () => ((await new KursunQcService().getStep(stepId)).data as { pieceInput?: string }).pieceInput ?? "YOK";
  const setUnit = (v: string) => prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.FINANCE_SERVICE_BILLING_BRODE_UNIT }, create: { key: SETTING_KEYS.FINANCE_SERVICE_BILLING_BRODE_UNIT, value: v }, update: { value: v } });
  await setMeter("OUT");
  await setUnit("PIECE");
  check("sayaç OUT + PIECE + brode istasyonu → pieceInput PIECE", (await pieceOf()) === "PIECE", await pieceOf());
  await setMeter("IN_OUT");
  check("sayaç IN_OUT + PIECE → pieceInput PIECE", (await pieceOf()) === "PIECE", await pieceOf());
  await setMeter("OUT");
  await setUnit("STITCH");
  check("STITCH → pieceInput STITCH", (await pieceOf()) === "STITCH", await pieceOf());
  await setUnit("METER");
  check("METER → anahtar YOK (bugünküyle bayt-aynı)", (await pieceOf()) === "YOK", await pieceOf());
  await setUnit("PIECE");
  await setMeter("OFF");
  check("sayaç OFF → anahtar YOK (okuma yok, adet taşınamaz)", (await pieceOf()) === "YOK", await pieceOf());
  check("brode olmayan istasyon → null", brodePieceInputOf({ meterOn: true, stationPropertyCodes: ["KURSUN"], brodeUnit: "PIECE" }) === null);
  // ── §10b ─────────────────────────────────────────────────────────────────
  section("§10b servis halkası: completeQc2 meterOut.pieceCount → okuma satırı → taslak miktarı");
  await setMeter("OUT");
  await setUnit("PIECE");
  const actor = await testActorId();
  // Desen seçimi istasyonda tanımlı olmalı (Gülkesim düzeni: BRODE + BRODE-DESEN).
  await prisma.stationProperty.create({ data: { stationId: st.id, propertyId: patternId } });
  const live = await prisma.roll.create({
    data: { barcode: `${P}-LIVE`.slice(0, 40), itemId: fabric, initialQty: 50, currentQty: 50, status: RollStatus.IN_PRODUCTION, entrySource: "SUPPLIER_RECEIPT", createdById: actor, currentStepId: stepId, ownerCustomerId: cust.id },
    select: { id: true },
  });
  fx.rollIds.push(live.id);
  await prisma.rollMovement.create({ data: { rollId: live.id, workOrderStepId: stepId, qtyIn: 50, operatorId: actor } });
  const vCode = (await prisma.fabricPropertyValue.findUniqueOrThrow({ where: { id: vStitch }, select: { code: true } })).code;
  const qcRes = await new KursunQcService().completeQc2({
    rollId: live.id, stepId, properties: [{ propertyId: flag.id }, { propertyId: patternId, valueCode: vCode }],
    meterOut: { meters: 50, source: MachineDataSource.OPERATOR, clientToken: randomUUID(), pieceCount: 12, rawCounter: null, peripheralId: null, cardSampleId: null },
  }, actor, null).then(() => "200", (e: { statusCode?: number; message?: string }) => `${e.statusCode}:${e.message}`);
  const liveRead = await prisma.rollMeterReading.findFirst({ where: { rollId: live.id, phase: MeterPhase.OUT }, select: { pieceCount: true } });
  check("completeQc2 başarılı ve okuma satırına pieceCount 12 yazıldı", qcRes === "200" && liveRead?.pieceCount === 12, `${qcRes} ${JSON.stringify(liveRead)}`);
  await setPrice(3, "PIECE");
  const liveDraft = await draft([live.id], "PIECE");
  check("taslak miktarı 12 adet (tablet adedi faturaya ulaşır)", liveDraft.lines.length === 1 && eq(liveDraft.lines[0]?.qty, 12) && liveDraft.lines[0]?.unit === "adet", JSON.stringify(liveDraft.lines));
  await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.FINANCE_SERVICE_BILLING_BRODE_UNIT } });

  // ── §8 ───────────────────────────────────────────────────────────────────
  section("§8 tarife satırı birimi");
  const v1 = await setPrice(3, "STITCH");
  const row1 = await prisma.itemPrice.findUnique({ where: { id: v1.data!.id }, select: { priceUnit: true } });
  check("aynı fiyat (3) farklı birim ⇒ yeni sürüm, birim STITCH saklandı", v1.message !== "Fiyat zaten bu değerde — değişiklik yapılmadı." && row1?.priceUnit === "STITCH", v1.message);
  const v2 = await setPrice(3, "METER");
  const row2 = await prisma.itemPrice.findUnique({ where: { id: v2.data!.id }, select: { priceUnit: true } });
  check("METER birimi NULL olarak saklanır (bugünkü satır biçimi)", row2 !== null && row2.priceUnit === null);
  await setPrice(3, "PIECE");
  const v3 = await itemPriceService.upsert({ itemId: svc, customerId: null, kind: PriceKind.SALE, currency: Currency.TRY, price: 4 });
  const row3 = await prisma.itemPrice.findUnique({ where: { id: v3.data!.id }, select: { priceUnit: true } });
  check("eski istemci (priceUnit göndermez) fiyat değiştirince birim korunur (PIECE → PIECE)", row3?.priceUnit === "PIECE", String(row3?.priceUnit));

  // ── §9 ───────────────────────────────────────────────────────────────────
  section("§9 AST: miktar tek yardımcıdan");
  const src = (p: string) => readFileSync(join(__dirname, "..", "src", "services", "helpers", p), "utf8");
  const fnBody = (text: string, name: string) => { const i = text.indexOf(`function ${name}`); return i < 0 ? "" : text.slice(i, text.indexOf("\n}\n", i)); };
  const alloc = fnBody(src("profitability.helper.ts"), "allocateRevenue");
  const rec = fnBody(src("service-billing.helper.ts"), "reconcileServiceLinksWithLines");
  check("allocateRevenue payı `linkBilledQty`den, `billedMeters` okumaz", alloc.includes("linkBilledQty(") && !alloc.includes(".billedMeters"), alloc.slice(0, 120));
  check("reconcileServiceLinksWithLines `linkBilledQty` kullanır", rec.includes("linkBilledQty(") && !rec.includes("plus(l.billedMeters)"));
  check("kârlılık okuyucusu fatura bağında `billedQty` seçer (yoksa pay sessizce metreye döner)",
    /serviceBillingLinks:\s*\{\s*select:\s*\{[^}]*billedQty:\s*true/.test(src("profitability-finance.helper.ts")));
  check("önizleme kapısı toplamı `linkBilledQty`den", src("service-preview-gate.helper.ts").includes("a.plus(linkBilledQty(l))") && !src("service-preview-gate.helper.ts").includes("a.plus(l.billedMeters)"));
  const pricing = src("service-pricing.helper.ts");
  check("hizmet çözücüsü miktarı `serviceWorkQuantity`den alır, adet × vuruş başka yerde yazılmaz",
    pricing.includes("serviceWorkQuantity(") && !/pieceCount\)?\s*\.mul\(/.test(pricing) && !/pieceCount\s*\*/.test(pricing + src("service-billing.helper.ts") + src("profitability.helper.ts")));
}

async function cleanup(): Promise<void> {
  const ids = fx.rollIds;
  await prisma.rollMeterReading.deleteMany({ where: { rollId: { in: ids } } });
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids } } });
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } });
  await prisma.rollProperty.deleteMany({ where: { rollId: { in: ids } } });
  await prisma.roll.deleteMany({ where: { id: { in: ids } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } });
  await prisma.stationProperty.deleteMany({ where: { stationId: { in: fx.stationIds } } });
  await prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } });
  await prisma.fabricPropertyValue.deleteMany({ where: { id: { in: fx.valueIds } } });
  await prisma.fabricProperty.updateMany({ where: { id: { in: fx.propIds } }, data: { variantOfPropertyId: null } });
  await prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } });
  await prisma.itemPrice.deleteMany({ where: { itemId: { in: fx.itemIds } } });
  await prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } });
  if (fx.customerId) await prisma.customer.deleteMany({ where: { id: fx.customerId } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids, ...fx.itemIds] } } });
  const key = SETTING_KEYS.FINANCE_SERVICE_BILLING_BRODE_UNIT;
  if (priorUnit.existed) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: priorUnit.value as never }, update: { value: priorUnit.value as never } });
  else await prisma.systemSetting.deleteMany({ where: { key } });
  const mk = SETTING_KEYS.KURSUN_METER_CAPTURE;
  if (priorMeter.existed) await prisma.systemSetting.upsert({ where: { key: mk }, create: { key: mk, value: priorMeter.value as never }, update: { value: priorMeter.value as never } });
  else await prisma.systemSetting.deleteMany({ where: { key: mk } });
  check("temizlik: TEST-BFB top kalıntısı yok", (await prisma.roll.count({ where: { id: { in: ids } } })) === 0);
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    await cleanup().catch((e) => { fail++; console.error(e); });
    if (pass + fail === 0) { fail++; console.log("❌ hiçbir kontrol koşmadı"); }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end().catch(() => {});
  });
