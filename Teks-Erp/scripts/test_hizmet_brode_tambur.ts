// =============================================================================
// BEKÇİ — BRODE · TAMBUR · ETEK KESİM HİZMET SATIRLARI (Gülkesim dalga 2 · H10, karar belgesi §5, §8 H10)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_hizmet_brode_tambur.ts
//
// NEDEN: kurşun dışındaki işler (Tambur, etek kesim, brode) müşterinin emanet kumaşına
// yapılır ve metreyle kesilir. İşin izi topun bayrak özelliğidir, kalem bayrak eşlemesinden
// gelir. Metre yanlış kaynaktan alınırsa (ata yerine çocuk, kesim yerine beyan) müşteriye
// eksik/fazla kesilir; aynı iş iki sevkte iki kez faturalanırsa çift kesilir.
//
// ÖLÇÜLENLER:
//   §1 Sahiplik: emanet toptan Tambur kesimiyle doğan çocuk aynı sahibi taşır
//   §2 Tambur + etek: çocuk sevki ⇒ TAMBUR + ETEK satırı, bağ ÇOCUKTA, metre CUT = kesilen; ata bağsız; ürün satırı yok
//   §3 İkinci çocuk ayrı sevkte kendi kesimiyle; ilk çocuğun işi yeniden toplanmaz (tek kez)
//   §4 İç brode okumasız ⇒ BRODE metre = Tambur kesilen metre (CUT)
//   §5 İç brode okumalı ⇒ BRODE atanın OUT okumasıyla, tamamı bir kez (ikinci çocuk sevkinde yok)
//   §6 Dış brode (GERÇEK fason sevk + iki kısmi kabul 300 + 180): makbuzdan DOĞAN toplar emanet sahibini
//      kalıtır, sevklerinde BRODE bağı doğan topta RECEIVED (300 / 180 = 480); ikinci sevkte iş tekrar
//      toplanmaz; karışık sahipli kabul 409 OWNER_MISMATCH
//   §6b H10b: 2 aynı sahipli kaynak ⇒ doğan top aynı sahip + RECEIVED = initialQty tek satır; doğan topun başka
//      müşteriye sevki 409; sahipli + sahipsiz kaynak 409 (makbuz/doğan top yok); emanet kapalıda sahipsiz doğar
//   §7 Gelir ItemPrice'tan, maliyet (FinishingRate) karışmaz; KURSUN kodu dışındaki çeşitli bayrak bu yoldan bir kez
//   §8 Ölçümsüz bayrak işi: BLOCK_LINE ⇒ taslağa girmez + uyarı; DECLARED_WITH_WARNING ⇒ mevcut metre
//   §9 Kurşun DIŞI çeşitli bayrak (brode deseni) kendi kalemiyle faturalanır (uyarısız düşmez)
//   §10 Kardeşi parça parça (CUT) faturalanmış atanın sonradan girilen okuması ikinci çocukta atayı
//       bütünüyle yeniden kesmez (CUT kalır) · faturalı bayrak geri alınamaz (409 SERVICE_ALREADY_BILLED)
// Negatif sondalar (2026-10-29): bayrak çözüm dalı (`listFlagServiceWorks` çağrısı) kaldırılınca §2/§4/§5/§6
// kırmızı · RECEIVED (makbuz) dalı kaldırılınca §6 kırmızı (geri alındı). Bitirici sondaları (2026-10-29):
// doğan topa sahip kalıtımı kaldırılınca §6 kırmızı · kardeş-faturalı ata süzgeci kaldırılınca §10 kırmızı.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Currency, FinishingBasis, ItemType, MachineDataSource, MeterApprovalMode, MeterPhase, MeterVarianceBasis, PriceKind, Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { shippingService } from "../src/services/shipping.service";
import { InventoryService } from "../src/services/inventory.service";
import { TamburService } from "../src/services/tambur.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { SETTING_KEYS, loadServiceBillingSettings } from "../src/services/system-setting.service";
import { collectServiceBillingDraft } from "../src/services/helpers/service-billing.helper";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { applyRollFlagSetTx } from "../src/services/helpers/property-revoke.helper";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t} ──`); }

const STAMP = randomUUID().slice(0, 8);
const P = `TEST-HZBT-${STAMP}`;
const inventory = new InventoryService();
const tambur = new TamburService();
const fx = {
  itemIds: [] as string[], propIds: [] as string[], woIds: [] as string[], rollIds: [] as string[], childIds: [] as string[],
  stationIds: [] as string[], shipmentIds: [] as string[], receiptIds: [] as string[], rateIds: [] as string[], customerId: null as string | null,
  customer2Id: null as string | null,
};
const KEYS = [
  SETTING_KEYS.FINANCE_ENABLED, SETTING_KEYS.FINANCE_AUTO_DRAFT_FROM_SHIPMENT_ENABLED, SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED,
  SETTING_KEYS.FINANCE_SERVICE_BILLING_ENABLED, SETTING_KEYS.FINANCE_SERVICE_BILLING_METER_BASIS, SETTING_KEYS.FINANCE_SERVICE_BILLING_MISSING_METER,
  SETTING_KEYS.FINANCE_SERVICE_BILLING_TRIGGER, SETTING_KEYS.FINANCE_SERVICE_BILLING_PRICE_DATE, SETTING_KEYS.EMANET_ENABLED,
];
const prior = new Map<string, { existed: boolean; value: unknown }>();
async function setSetting(key: string, value: unknown): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}
const eq = (a: Prisma.Decimal.Value | null | undefined, b: number) => a != null && new Prisma.Decimal(a).minus(b).abs().lte(0.001);

async function main(): Promise<void> {
  console.log("=== Hizmet satırları — Tambur · etek · iç/dış brode (H10) ===");
  for (const k of KEYS) {
    const row = await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } });
    prior.set(k, { existed: row !== null, value: row?.value ?? null });
  }
  for (const k of KEYS.slice(4)) await prisma.systemSetting.deleteMany({ where: { key: k } });
  await setSetting(SETTING_KEYS.FINANCE_ENABLED, true);
  await setSetting(SETTING_KEYS.FINANCE_AUTO_DRAFT_FROM_SHIPMENT_ENABLED, true);
  await setSetting(SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED, false);
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_ENABLED, true);
  const actor = await testActorId();
  const wh = await ensureDefaultWarehouse();
  if (!wh) throw new Error("Varsayılan depo yok");
  const grade = await prisma.qualityGrade.findFirst({ where: { role: "FIRST", isActive: true }, select: { code: true } });
  if (!grade) throw new Error("FIRST rollü kalite yok — seed'siz DB");

  // ── Fikstür ──────────────────────────────────────────────────────────────
  const mkItem = async (suffix: string, itemType: ItemType, price?: string) => {
    const it = await prisma.item.create({ data: { code: `${P}-${suffix}`.slice(0, 32), name: `TEST HZBT ${suffix} ${STAMP}`, itemType, unit: "MT" }, select: { id: true } });
    fx.itemIds.push(it.id);
    if (price) await prisma.itemPrice.create({ data: { itemId: it.id, customerId: null, kind: PriceKind.SALE, currency: Currency.TRY, price } });
    return it.id;
  };
  const fabric = await mkItem("KUM", ItemType.FABRIC);
  const TAMBUR = await mkItem("TAMBUR", ItemType.SERVICE, "2.0000");
  const ETEK = await mkItem("ETEK", ItemType.SERVICE, "3.0000");
  const BRODE = await mkItem("BRODE", ItemType.SERVICE, "5.0000");
  const KUR = await mkItem("KURT", ItemType.SERVICE, "9.0000");
  const mkFlag = async (suffix: string, serviceItemId: string | null) => {
    const p = await prisma.fabricProperty.create({ data: { code: `${P}-${suffix}`.slice(0, 32), name: `TEST HZBT ${suffix}`, valueType: "FLAG", serviceItemId }, select: { id: true } });
    fx.propIds.push(p.id);
    return p.id;
  };
  const TB = await mkFlag("TB", TAMBUR);
  const ET = await mkFlag("ET", ETEK);
  const BR = await mkFlag("BR", BRODE);
  const KT = await mkFlag("KT", KUR); // çeşitli bayrak, KURSUN kodu DEĞİL: bayrak yolunda okunur
  const kv = await prisma.fabricProperty.create({ data: { code: `${P}-KTV`.slice(0, 32), name: `TEST HZBT KT gramaj`, valueType: "CHOICE", variantOfPropertyId: KT }, select: { id: true } });
  fx.propIds.push(kv.id);
  const cust = await prisma.customer.create({ data: { code: `${P}-C`.slice(0, 32), name: `TEST HZBT müşteri ${STAMP}` }, select: { id: true } });
  fx.customerId = cust.id;
  const mkStation = async (suffix: string, type: "INTERNAL" | "EXTERNAL", kind: "TAMBUR" | "PROCESS_QC" | "SUBCONTRACTOR", props: string[]) => {
    const s = await prisma.station.create({ data: { code: `${P}-${suffix}`.slice(0, 32), name: `TEST HZBT ${suffix} ${STAMP}`, type, kind, appliesProperty: true }, select: { id: true } });
    fx.stationIds.push(s.id);
    await prisma.stationProperty.createMany({ data: props.map((propertyId) => ({ stationId: s.id, propertyId })) });
    return s.id;
  };
  const stBrode = await mkStation("BRD", "INTERNAL", "PROCESS_QC", [BR]);
  const stTambur = await mkStation("TMB", "INTERNAL", "TAMBUR", [TB, ET]);
  const stFason = await mkStation("FSN", "EXTERNAL", "SUBCONTRACTOR", [BR]);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${P}-WO`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: fabric,
      steps: { create: [{ stationId: stBrode, stepSequence: 1, status: "ACTIVE" as const }, { stationId: stFason, stepSequence: 2, status: "PENDING" as const }, { stationId: stTambur, stepSequence: 3, status: "PENDING" as const }] },
    },
    select: { id: true, steps: { select: { id: true, stepSequence: true } } },
  });
  fx.woIds.push(wo.id);
  const stepOf = (n: number) => wo.steps.find((s) => s.stepSequence === n)!.id;
  const S_BRODE = stepOf(1);
  // Bizim fasona ÖDEDİĞİMİZ brode maliyeti — gelir satırına sızmamalı.
  const rate = await prisma.finishingRate.create({ data: { code: `${P}-FR`.slice(0, 32), name: "TEST HZBT brode maliyeti", basis: FinishingBasis.RAW_M, currency: Currency.TRY, pricePerM: "1.5000" }, select: { id: true } });
  fx.rateIds.push(rate.id);

  /** Emanet ana top: depoda doğar + bayrak özellikleri. */
  const mkParent = async (qty: number, props: string[]): Promise<string> => {
    const res = await inventory.createInitialEntry({ itemId: fabric, initialQty: qty }, undefined, undefined, false, { forcedStatus: RollStatus.WAREHOUSE, warehouseId: wh.id });
    const id = (res.data as { id: string }).id;
    fx.rollIds.push(id);
    await prisma.roll.update({ where: { id }, data: { ownerCustomerId: cust.id } });
    if (props.length) await prisma.rollProperty.createMany({ data: props.map((propertyId) => ({ rollId: id, propertyId })) });
    return id;
  };
  const cut = async (parentId: string, len: number): Promise<string> => {
    const r = await tambur.cutWarehouseRoll(parentId, { cutLength: len, rawDestination: "WAREHOUSE", qualityGrade: grade.code });
    const id = (r.data as { childRoll?: { id: string } }).childRoll?.id;
    if (!id) throw new Error("kesim çocuk dönmedi");
    fx.childIds.push(id);
    return id;
  };
  const ship = async (rollIds: string[]) => {
    const res = (await shippingService.createShipmentFromRolls({ rollIds, customerId: cust.id, clientToken: randomUUID() })) as { data: { id: string; dispatched: boolean } };
    fx.shipmentIds.push(res.data.id);
    return res.data;
  };
  const invoiceOf = async (shipmentId: string) => prisma.invoice.findFirst({ where: { shipmentId }, select: { id: true, lines: { select: { itemId: true, qty: true, unitPrice: true } } } });
  const linksOf = (invoiceId: string) => prisma.serviceBillingLink.findMany({ where: { invoiceId, revokedAt: null }, select: { rollId: true, serviceItemId: true, billedMeters: true, meterBasis: true, readingId: true, workOrderStepId: true } });
  const settings = await loadServiceBillingSettings();
  const draft = (rollIds: string[], s = settings) => collectServiceBillingDraft({ rollIds, customerId: cust.id, currency: Currency.TRY, settings: s, dispatchedAt: null });

  // ── §1 ───────────────────────────────────────────────────────────────────
  section("§1 emanet toptan kesilen çocuk sahibi taşır");
  const P1 = await mkParent(100, [TB, ET]);
  const C1 = await cut(P1, 60);
  const C2 = await cut(P1, 30);
  const owners = await prisma.roll.findMany({ where: { id: { in: [C1, C2] } }, select: { ownerCustomerId: true } });
  check("iki çocuk da müşterinin (ownerCustomerId kalıttı)", owners.length === 2 && owners.every((o) => o.ownerCustomerId === cust.id), JSON.stringify(owners));
  const inherited = await prisma.rollProperty.count({ where: { rollId: C1, revokedAt: null, propertyId: { in: [TB, ET] } } });
  check("bayraklar çocuğa geçti (inheritRollPropertiesTx)", inherited === 2, String(inherited));

  // ── §2 ───────────────────────────────────────────────────────────────────
  section("§2 Tambur + etek: bağ çocukta, metre CUT = kesilen");
  const sh1 = await ship([C1]);
  const inv1 = await invoiceOf(sh1.id);
  const l1 = inv1 ? await linksOf(inv1.id) : [];
  const tb1 = l1.find((l) => l.serviceItemId === TAMBUR);
  const et1 = l1.find((l) => l.serviceItemId === ETEK);
  check("sevk + taslak", sh1.dispatched && inv1 !== null);
  check("TAMBUR bağı çocukta, CUT 60 m", tb1?.rollId === C1 && tb1.meterBasis === "CUT" && eq(tb1.billedMeters, 60), JSON.stringify(tb1));
  check("ETEK bağı çocukta, CUT 60 m", et1?.rollId === C1 && et1.meterBasis === "CUT" && eq(et1.billedMeters, 60), JSON.stringify(et1));
  check("atada (P1) bağ yok", l1.every((l) => l.rollId !== P1), JSON.stringify(l1.map((l) => l.rollId)));
  const tLine = inv1?.lines.find((l) => l.itemId === TAMBUR);
  check("TAMBUR satırı 60 × 2 (kalem bayrak eşlemesinden)", eq(tLine?.qty, 60) && eq(tLine?.unitPrice, 2), JSON.stringify(inv1?.lines));
  check("emanet ürün satırı yok (yalnız hizmet)", (inv1?.lines ?? []).every((l) => l.itemId !== fabric), JSON.stringify(inv1?.lines));

  // ── §3 ───────────────────────────────────────────────────────────────────
  section("§3 ikinci çocuk ayrı sevkte; ilk iş yeniden toplanmaz");
  const again = await draft([C1]);
  check("C1 yeniden toplanınca bağ 0 (zaten faturalı)", again.links.length === 0, JSON.stringify(again.links));
  const sh2 = await ship([C2]);
  const inv2 = await invoiceOf(sh2.id);
  const l2 = inv2 ? await linksOf(inv2.id) : [];
  check("C2: TAMBUR 30 + ETEK 30, ikisi C2'de", l2.length === 2 && l2.every((l) => l.rollId === C2 && l.meterBasis === "CUT" && eq(l.billedMeters, 30)), JSON.stringify(l2));
  const tbAll = await prisma.serviceBillingLink.count({ where: { serviceItemId: TAMBUR, revokedAt: null, rollId: { in: [P1, C1, C2] } } });
  check("P1 ailesinde TAMBUR bağı tam 2 (çocuk başına bir)", tbAll === 2, String(tbAll));

  // ── §4 ───────────────────────────────────────────────────────────────────
  section("§4 iç brode okumasız ⇒ Tambur kesilen metre");
  const P2 = await mkParent(80, [BR]);
  const C3 = await cut(P2, 50);
  const d4 = await draft([C3]);
  const br4 = d4.links.find((l) => l.serviceItemId === BRODE);
  check("BRODE C3'te, CUT 50 m", br4?.rollId === C3 && br4.meterBasis === "CUT" && eq(br4.billedMeters, 50), JSON.stringify(d4.links));

  // ── §5 ───────────────────────────────────────────────────────────────────
  section("§5 iç brode okumalı ⇒ adımın OUT okuması, bir kez");
  const P3 = await mkParent(90, [BR]);
  const rd = await prisma.rollMeterReading.create({
    data: { rollId: P3, workOrderStepId: S_BRODE, phase: MeterPhase.OUT, meters: "88.500", source: MachineDataSource.OPERATOR, basis: MeterVarianceBasis.DECLARED_IN, approvalMode: MeterApprovalMode.NONE, clientToken: randomUUID(), createdById: actor },
    select: { id: true },
  });
  const C4 = await cut(P3, 40);
  const C5 = await cut(P3, 40);
  const sh3 = await ship([C4]);
  const inv3 = await invoiceOf(sh3.id);
  const l3 = inv3 ? await linksOf(inv3.id) : [];
  const br5 = l3.find((l) => l.serviceItemId === BRODE);
  check("BRODE atada (P3), OUT 88,5 m, okumaya bağlı, brode adımı", br5?.rollId === P3 && br5.meterBasis === "OUT" && eq(br5.billedMeters, 88.5) && br5.readingId === rd.id && br5.workOrderStepId === S_BRODE, JSON.stringify(l3));
  const d5 = await draft([C5]);
  check("ikinci çocukta BRODE yeniden toplanmaz", d5.links.every((l) => l.serviceItemId !== BRODE), JSON.stringify(d5.links));

  // ── §6 ───────────────────────────────────────────────────────────────────
  section("§6 dış brode: gerçek fason sevk + kısmi kabuller ⇒ doğan toplarda RECEIVED 300 + 180");
  const sub = await ensureTestDyeHouse();
  const subSvc = new SubcontractorService();
  const mkFasonWo = async (tag: string) => {
    const w = await prisma.workOrder.create({
      data: { workOrderNumber: `${P}-${tag}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: fabric, steps: { create: [{ stationId: stFason, stepSequence: 1, status: "PENDING" as const }] } },
      select: { id: true, steps: { select: { id: true } } },
    });
    fx.woIds.push(w.id);
    await prisma.$transaction((tx) => new TravelerCardService().createForWorkOrder(tx, w.id, actor));
    return { woId: w.id, stepId: w.steps[0]!.id };
  };
  const bornOf = async (receiptId: string) => {
    const rows = await prisma.roll.findMany({ where: { parentReceiptId: receiptId }, select: { id: true, ownerCustomerId: true, initialQty: true } });
    fx.childIds.push(...rows.map((r) => r.id));
    return rows;
  };
  const F1 = await mkFasonWo("WOF1");
  // Ham emanet top serbest stokta (fason sevki STOCK topu adıma kendisi bağlar).
  const toStock = (ids: string[]) => prisma.roll.updateMany({ where: { id: { in: ids } }, data: { status: RollStatus.STOCK } });
  const P4 = await mkParent(500, []);
  await toStock([P4]);
  await subSvc.dispatch({ workOrderId: F1.woId, stepId: F1.stepId, subcontractorId: sub.id, rollIds: [P4] }, actor);
  const rcv = async (receivedQty: number, newQty: number) => {
    const r = await subSvc.receive({ workOrderId: F1.woId, stepId: F1.stepId, subcontractorId: sub.id, clientToken: randomUUID(), returns: [{ rollId: P4, receivedQty }], newRolls: [{ qty: newQty }], appliedPropertyIds: [BR] }, actor);
    const id = (r.data as { id: string }).id;
    fx.receiptIds.push(id);
    return bornOf(id);
  };
  const born1 = await rcv(300, 300);
  const born2 = await rcv(200, 180);
  const born = [...born1, ...born2];
  check("iki kabulde 2 top doğdu, ikisi de müşterinin (kaynak topun sahibi kalıttı)", born.length === 2 && born.every((r) => r.ownerCustomerId === cust.id), JSON.stringify(born));
  const brOnBorn = await prisma.rollProperty.count({ where: { rollId: { in: born.map((r) => r.id) }, revokedAt: null, propertyId: BR } });
  check("brode bayrağı doğan toplarda", brOnBorn === 2, String(brOnBorn));
  const sh6 = await ship([born1[0]!.id]);
  const inv6 = await invoiceOf(sh6.id);
  const l6 = inv6 ? await linksOf(inv6.id) : [];
  const br6 = l6.find((l) => l.serviceItemId === BRODE);
  check("1. sevk: BRODE doğan topta, RECEIVED 300 m, fason adımı", br6?.rollId === born1[0]!.id && br6.meterBasis === "RECEIVED" && eq(br6.billedMeters, 300) && br6.workOrderStepId === F1.stepId, JSON.stringify(l6));
  check("1. sevk: emanet ürün satırı yok", (inv6?.lines ?? []).every((l) => l.itemId !== fabric), JSON.stringify(inv6?.lines));
  const sh6b = await ship([born2[0]!.id]);
  const inv6b = await invoiceOf(sh6b.id);
  const l6b = inv6b ? await linksOf(inv6b.id) : [];
  check("2. sevk: BRODE RECEIVED 180 m, yalnız ikinci doğan top", l6b.length === 1 && l6b[0]!.rollId === born2[0]!.id && l6b[0]!.meterBasis === "RECEIVED" && eq(l6b[0]!.billedMeters, 180), JSON.stringify(l6b));
  const brAll = await prisma.serviceBillingLink.findMany({ where: { serviceItemId: BRODE, revokedAt: null, rollId: { in: [P4, ...born.map((r) => r.id)] } }, select: { billedMeters: true } });
  check("dış brode toplamı 480 m (fason dönüşü), kaynak topa bağ yok, çift sayım yok", brAll.length === 2 && eq(brAll.reduce((a, l) => a.plus(l.billedMeters), new Prisma.Decimal(0)), 480), JSON.stringify(brAll));
  const again6 = await draft(born.map((r) => r.id));
  check("yeniden toplama: BRODE yok (zaten faturalı)", again6.links.every((l) => l.serviceItemId !== BRODE), JSON.stringify(again6.links));
  // Karışık sahipli kabul: iki müşterinin emanet topu tek makbuzda ⇒ doğan topun sahibi belirsiz ⇒ 409.
  const cust2 = await prisma.customer.create({ data: { code: `${P}-C2`.slice(0, 32), name: `TEST HZBT müşteri2 ${STAMP}` }, select: { id: true } });
  fx.customer2Id = cust2.id;
  const F2 = await mkFasonWo("WOF2");
  const Pa = await mkParent(50, []);
  const Pb = await mkParent(50, []);
  await prisma.roll.update({ where: { id: Pb }, data: { ownerCustomerId: cust2.id } });
  await toStock([Pa, Pb]);
  await subSvc.dispatch({ workOrderId: F2.woId, stepId: F2.stepId, subcontractorId: sub.id, rollIds: [Pa, Pb] }, actor);
  const mixed = await subSvc.receive({ workOrderId: F2.woId, stepId: F2.stepId, subcontractorId: sub.id, clientToken: randomUUID(), returns: [{ rollId: Pa, receivedQty: 50 }, { rollId: Pb, receivedQty: 50 }], newRolls: [{ qty: 100 }] }, actor)
    .then(() => "geçti", (e: { details?: { code?: string } }) => e.details?.code ?? String(e));
  check("karışık sahipli kabul 409 OWNER_MISMATCH", mixed === "OWNER_MISMATCH", mixed);
  // Makbuz yolunun karşılaştırması için: bir kabul + doğan toplar + makbuz sayısı (iş emri kapsamında).
  const receiptState = async (woId: string) => {
    // Kapı açılırsa (sonda) doğan top temizliğe girsin — yoksa ürün/müşteri silinemez.
    const bornIds = (await prisma.roll.findMany({ where: { parentReceipt: { workOrderId: woId } }, select: { id: true } })).map((r) => r.id);
    fx.childIds.push(...bornIds);
    return { receipts: await prisma.subcontractorReceipt.count({ where: { workOrderId: woId } }), born: bornIds.length };
  };
  const s2 = await receiptState(F2.woId);
  check("karışık sahip: makbuz YOK, doğan top YOK (tx geri alındı)", s2.receipts === 0 && s2.born === 0, JSON.stringify(s2));

  // ── §6b ──────────────────────────────────────────────────────────────────
  section("§6b H10b: iki aynı sahipli kaynak ⇒ doğan top sahibi taşır; sahipli+sahipsiz 409; başka müşteriye sevk reddi");
  const F3 = await mkFasonWo("WOF3");
  const Pc = await mkParent(120, []);
  const Pd = await mkParent(80, []);
  await toStock([Pc, Pd]);
  await subSvc.dispatch({ workOrderId: F3.woId, stepId: F3.stepId, subcontractorId: sub.id, rollIds: [Pc, Pd] }, actor);
  const r3 = await subSvc.receive({ workOrderId: F3.woId, stepId: F3.stepId, subcontractorId: sub.id, clientToken: randomUUID(), returns: [{ rollId: Pc }, { rollId: Pd }], newRolls: [{ qty: 190 }], appliedPropertyIds: [BR] }, actor);
  const born3 = await bornOf((r3.data as { id: string }).id);
  check("2 aynı sahipli kaynaktan doğan top aynı ownerCustomerId'yi taşır", born3.length === 1 && born3[0]!.ownerCustomerId === cust.id, JSON.stringify(born3));
  const d3 = await draft(born3.map((r) => r.id));
  const br3 = d3.links.filter((l) => l.serviceItemId === BRODE);
  check("hizmet taslağı: dış brode tek satır, RECEIVED = doğan topun initialQty (190)", br3.length === 1 && br3[0]!.rollId === born3[0]!.id && br3[0]!.meterBasis === "RECEIVED" && eq(br3[0]!.billedMeters, 190) && br3[0]!.workOrderStepId === F3.stepId, JSON.stringify(br3));
  // Emanet sevk kapısı: doğan top yalnız sahibine gider.
  const wrong = await shippingService.createShipmentFromRolls({ rollIds: [born3[0]!.id], customerId: cust2.id, clientToken: randomUUID() })
    .then(() => "geçti", (e: { details?: { code?: string } }) => e.details?.code ?? String(e));
  check("doğan topun başka müşteriye sevki 409 OWNER_MISMATCH", wrong === "OWNER_MISMATCH", wrong);
  const shipped3 = await prisma.roll.findUnique({ where: { id: born3[0]!.id }, select: { shipmentId: true, sackId: true } });
  check("reddedilen sevk topa iz bırakmadı", shipped3?.shipmentId === null && shipped3?.sackId === null, JSON.stringify(shipped3));
  // Sahipli + sahipsiz (fabrikanın kendi malı) tek makbuzda ⇒ katı kalıtım 409; makbuz ve doğan top yok.
  const F4 = await mkFasonWo("WOF4");
  const Pe = await mkParent(40, []);
  const Pf = await mkParent(60, []);
  await prisma.roll.update({ where: { id: Pf }, data: { ownerCustomerId: null } });
  await toStock([Pe, Pf]);
  await subSvc.dispatch({ workOrderId: F4.woId, stepId: F4.stepId, subcontractorId: sub.id, rollIds: [Pe, Pf] }, actor);
  const half = await subSvc.receive({ workOrderId: F4.woId, stepId: F4.stepId, subcontractorId: sub.id, clientToken: randomUUID(), returns: [{ rollId: Pe }, { rollId: Pf }], newRolls: [{ qty: 100 }] }, actor)
    .then(() => "geçti", (e: { details?: { code?: string } }) => e.details?.code ?? String(e));
  const s4 = await receiptState(F4.woId);
  check("sahipli + sahipsiz kaynak: 409 OWNER_MISMATCH, makbuz YOK, doğan top YOK", half === "OWNER_MISMATCH" && s4.receipts === 0 && s4.born === 0, `${half} ${JSON.stringify(s4)}`);
  // Emanet kapalı kurulum: kaynakların hepsi sahipsiz ⇒ makbuz bugünkü gibi yazılır, doğan top sahipsiz doğar.
  await setSetting(SETTING_KEYS.EMANET_ENABLED, false);
  const F5 = await mkFasonWo("WOF5");
  const Pg = await mkParent(70, []);
  const Ph = await mkParent(30, []);
  await prisma.roll.updateMany({ where: { id: { in: [Pg, Ph] } }, data: { ownerCustomerId: null } });
  await toStock([Pg, Ph]);
  await subSvc.dispatch({ workOrderId: F5.woId, stepId: F5.stepId, subcontractorId: sub.id, rollIds: [Pg, Ph] }, actor);
  const r5 = await subSvc.receive({ workOrderId: F5.woId, stepId: F5.stepId, subcontractorId: sub.id, clientToken: randomUUID(), returns: [{ rollId: Pg }, { rollId: Ph }], newRolls: [{ qty: 60 }, { qty: 38 }] }, actor);
  const born5 = await bornOf((r5.data as { id: string }).id);
  check("emanet kapalı, sahipsiz kaynaklar: makbuz yazıldı, 2 doğan top sahipsiz, metreler aynen", born5.length === 2 && born5.every((r) => r.ownerCustomerId === null) && born5.map((r) => Number(r.initialQty)).sort((a, b) => a - b).join(",") === "38,60", JSON.stringify(born5));

  // ── §7 ───────────────────────────────────────────────────────────────────
  section("§7 gelir ItemPrice, maliyet karışmaz; kurşun dışı çeşitli bayrak bir kez");
  const bLine = d4.lines.find((l) => l.itemId === BRODE);
  check("BRODE birim fiyatı 5 (ItemPrice), 1,5 (FinishingRate) DEĞİL", eq(bLine?.unitPrice, 5), JSON.stringify(bLine));
  const P5 = await mkParent(70, [KT]);
  const C7 = await cut(P5, 70);
  const d7 = await draft([C7]);
  // Kurşun yolu yalnız KURSUN kodunu okur; kodu başka olan çeşitli bayrak bayrak yolundadır (sessiz düşmez).
  const kur7 = d7.links.filter((l) => l.serviceItemId === KUR);
  check("kurşun kodlu olmayan çeşitli bayrak kendi kalemiyle bir kez (CUT 70)", kur7.length === 1 && kur7[0]!.meterBasis === "CUT" && eq(kur7[0]!.billedMeters, 70), JSON.stringify(d7.links));

  // ── §8 ───────────────────────────────────────────────────────────────────
  section("§8 ölçümsüz bayrak işi: ayara göre");
  const P6 = await mkParent(45, [TB]);
  const blk = await draft([P6], { ...settings, missingMeter: "BLOCK_LINE" });
  check("BLOCK_LINE: bağ yok + uyarı", blk.links.length === 0 && blk.warnings.some((w) => w.includes("sayaç okuması yok")), JSON.stringify(blk));
  const dw = await draft([P6], { ...settings, missingMeter: "DECLARED_WITH_WARNING" });
  check("DECLARED_WITH_WARNING: mevcut metre 45, DECLARED + uyarı", dw.links.length === 1 && dw.links[0]!.meterBasis === "DECLARED" && eq(dw.links[0]!.billedMeters, 45) && dw.warnings.length > 0, JSON.stringify(dw));

  // ── §9 ───────────────────────────────────────────────────────────────────
  section("§9 kurşun dışı çeşitli bayrak kendi kalemiyle");
  const BRV = await mkFlag("BRV", BRODE);
  const bv = await prisma.fabricProperty.create({ data: { code: `${P}-BRVD`.slice(0, 32), name: `TEST HZBT brode deseni`, valueType: "CHOICE", variantOfPropertyId: BRV }, select: { id: true } });
  fx.propIds.push(bv.id);
  const P8 = await mkParent(35, [BRV]);
  const C10 = await cut(P8, 35);
  const d9 = await draft([C10]);
  const br9 = d9.links.find((l) => l.serviceItemId === BRODE);
  check("çeşitli brode bayrağı ⇒ BRODE bağı C10'da CUT 35", br9?.rollId === C10 && br9.meterBasis === "CUT" && eq(br9.billedMeters, 35), JSON.stringify(d9.links));

  // ── §10 ──────────────────────────────────────────────────────────────────
  section("§10 kardeşi parça faturalı ata: sonraki okuma çift kesmez; faturalı bayrak geri alınamaz");
  const P9 = await mkParent(100, [BR]);
  const C11 = await cut(P9, 60);
  const sh10 = await ship([C11]);
  const inv10 = await invoiceOf(sh10.id);
  const l10 = inv10 ? await linksOf(inv10.id) : [];
  check("C11: BRODE CUT 60 (okuma yok)", l10.some((l) => l.serviceItemId === BRODE && l.rollId === C11 && l.meterBasis === "CUT" && eq(l.billedMeters, 60)), JSON.stringify(l10));
  await prisma.rollMeterReading.create({
    data: { rollId: P9, workOrderStepId: S_BRODE, phase: MeterPhase.OUT, meters: "99.000", source: MachineDataSource.OPERATOR, basis: MeterVarianceBasis.DECLARED_IN, approvalMode: MeterApprovalMode.NONE, clientToken: randomUUID(), createdById: actor },
  });
  const C12 = await cut(P9, 30);
  const d10 = await draft([C12]);
  const br10 = d10.links.filter((l) => l.serviceItemId === BRODE);
  check("C12: BRODE kendi parçası CUT 30, atanın 99'u yeniden kesilmez", br10.length === 1 && br10[0]!.rollId === C12 && br10[0]!.meterBasis === "CUT" && eq(br10[0]!.billedMeters, 30), JSON.stringify(br10));
  const revoke = await prisma.$transaction((tx) => applyRollFlagSetTx(tx, { rollId: C11, desired: [], reason: "test", userId: actor }))
    .then(() => "geçti", (e: { details?: { code?: string } }) => e.details?.code ?? String(e));
  check("faturalı brode bayrağını geri alma 409 SERVICE_ALREADY_BILLED", revoke === "SERVICE_ALREADY_BILLED", revoke);
  const free = await prisma.$transaction((tx) => applyRollFlagSetTx(tx, { rollId: C12, desired: [], reason: "test", userId: actor }))
    .then((r) => `revoked=${r.revoked}`, (e: { details?: { code?: string } }) => e.details?.code ?? String(e));
  check("faturasız topta bayrak geri alma serbest", free === "revoked=1", free);
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  for (const [key, prev] of prior) {
    await del(`ayar ${key}`, () => prev.existed
      ? prisma.systemSetting.upsert({ where: { key }, create: { key, value: prev.value as never }, update: { value: prev.value as never } })
      : prisma.systemSetting.deleteMany({ where: { key } }));
  }
  const ids = [...fx.childIds, ...fx.rollIds];
  const invIds = (await prisma.invoice.findMany({ where: { shipmentId: { in: fx.shipmentIds } }, select: { id: true } })).map((i) => i.id);
  await del("link", () => prisma.serviceBillingLink.deleteMany({ where: { OR: [{ invoiceId: { in: invIds } }, { rollId: { in: ids } }] } }));
  await del("cariTx", () => prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: invIds } } }));
  await del("invoiceLine", () => prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invIds } } }));
  await del("printedDoc", () => prisma.printedDocument.deleteMany({ where: { sourceId: { in: [...invIds, ...fx.shipmentIds] } } }));
  await del("invoice", () => prisma.invoice.deleteMany({ where: { id: { in: invIds } } }));
  if (fx.customerId) {
    const cid = fx.customerId;
    const cari = (await prisma.cariAccount.findMany({ where: { customerId: cid }, select: { id: true } })).map((c) => c.id);
    await del("cariBalance", () => prisma.cariBalance.deleteMany({ where: { cariId: { in: cari } } }));
    await del("cariTx2", () => prisma.cariTransaction.deleteMany({ where: { cariId: { in: cari } } }));
    await del("cari", () => prisma.cariAccount.deleteMany({ where: { id: { in: cari } } }));
  }
  await del("sackAlloc", () => prisma.sackAllocation.deleteMany({ where: { sack: { shipmentId: { in: fx.shipmentIds } } } }));
  await del("meterReading", () => prisma.rollMeterReading.deleteMany({ where: { rollId: { in: ids } } }));
  await del("roll unlink", () => prisma.roll.updateMany({ where: { id: { in: ids } }, data: { sackId: null, shipmentId: null } }));
  await del("whMove", () => prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollOperation", () => prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollMovement", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollVariance", () => prisma.rollVariance.deleteMany({ where: { rollId: { in: ids } } }));
  const recIds = (await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: fx.woIds } }, select: { id: true } })).map((r) => r.id);
  const dispIds = (await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: fx.woIds } }, select: { id: true } })).map((d) => d.id);
  await del("receiptItem", () => prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: recIds } } }));
  await del("receiptProperty", () => prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: recIds } } }));
  await del("dispatchItem", () => prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispIds } } }));
  await del("child roll", () => prisma.roll.deleteMany({ where: { id: { in: fx.childIds } } }));
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: fx.rollIds } } }));
  await del("receipt", () => prisma.subcontractorReceipt.deleteMany({ where: { id: { in: recIds } } }));
  await del("dispatch", () => prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispIds } } }));
  await del("travelerCard", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("batch", () => prisma.batch.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("shipmentEvent", () => prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: fx.shipmentIds } } }));
  await del("shipment", () => prisma.shipment.deleteMany({ where: { id: { in: fx.shipmentIds } } }));
  if (fx.customerId) { const cid = fx.customerId; await del("sack", () => prisma.sack.deleteMany({ where: { customerId: cid } })); }
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("finishingRate", () => prisma.finishingRate.deleteMany({ where: { id: { in: fx.rateIds } } }));
  await del("variant bağı", () => prisma.fabricProperty.updateMany({ where: { id: { in: fx.propIds } }, data: { variantOfPropertyId: null } }));
  await del("property", () => prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } }));
  await del("itemPrice", () => prisma.itemPrice.deleteMany({ where: { itemId: { in: fx.itemIds } } }));
  await del("item", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  if (fx.customerId) { const cid = fx.customerId; await del("customer", () => prisma.customer.deleteMany({ where: { id: cid } })); }
  if (fx.customer2Id) { const cid = fx.customer2Id; await del("customer2", () => prisma.customer.deleteMany({ where: { id: cid } })); }
  await del("systemLog", () => prisma.systemLog.deleteMany({ where: { recordId: { in: [...fx.shipmentIds, ...invIds, ...ids, ...recIds, ...dispIds, ...fx.woIds] } } }));
  const left = await prisma.roll.count({ where: { id: { in: ids } } });
  check("temizlik: TEST-HZBT top kalıntısı yok", left === 0, String(left));
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
