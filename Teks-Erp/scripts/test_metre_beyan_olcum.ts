// =============================================================================
// BEKÇİ — BEYAN ↔ ÖLÇÜLEN METRE (GK metre, 2026-11-10)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_metre_beyan_olcum.ts
//
// NEDEN: müşteri belgede 1000 m beyan eder, kurşun/tambur 1010 ölçer. Fatura metresi PARTİ bazında
// max(beyan, ölçülen) (|fark| < %0,5 ise beyan); kurşun + tambur birlikteyse iki hizmet de partinin en
// büyük ölçümüyle. Kural tek çözücüde (`meter-compare.helper`), SIMULATED ölçüm sayılmaz, varsayılan
// ayar (`meterBasis=OUT`) bayt-aynı kalır (Adnan etkilenmez).
//
// ÖLÇÜLENLER:
//   §1 saf kural 1: beyan büyük · ölçülen büyük · tolerans içi · beyan yok · ikisi yok
//   §2 S1 İE karşılaştırması (belge özet satırı 1000 · kurşun OUT 1010 · kesim 300+300+410) + top izi kaynağı
//   §3 SIMULATED kurşun/kesim okuması ölçüme girmez
//   §4 kural 2 faturası (MAX_DECLARED): kurşun 1010 + kesim 1020 ⇒ iki hizmet de 1020; Σ bağ = Σ satır; meterCompare
//   §5 tolerans içi (1004/1000) ⇒ faturalanan beyan, yuvarlama farkı son işte (Σ = 1000 birebir) · beyan büyük ⇒ beyan
//   §6 varsayılan OUT: meterCompare anahtarı yok, metreler okumadan; seçenek yok = OUT (bayt-aynı)
//   §7 hata izi: topun beyanını aşan hata defectsBeyondDeclared'da + uyarı cümlesi
//   §8 top izi: önceki ölçüm KURSUN_OUT, kesilen, kalan; aşımda overReference
//   §9 uç kapıları: verifyToken ilk halka + izin (izinsiz 403) · ayar MAX_DECLARED kabul, tanınmayan 400
// Negatif sondalar (2026-11-10): ölçüm sorgusundaki `source: { not: SIMULATED }` kaldırılınca §3a/§3b kırmızı (37/2) ·
// tolerans dalı kapatılınca (`within && false`) §1c + §5a kırmızı (37/2) · resolver'da MAX_DECLARED ölçekleme çağrısı kapatılınca
// §4a/§4d/§4e/§5a/§5b kırmızı (34/5); üçü de geri alındı.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Currency, ItemType, MachineDataSource, MeterApprovalMode, MeterPhase, MeterVarianceBasis, PriceKind, Prisma, RollEntrySource, RollStatus, StationKind, StationType, StepStatus } from "@prisma/client";
import type { Request, Response } from "express";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";
import { applyKursunOperationTx } from "../src/services/helpers/kursun-operation.helper";
import { KURSUN_PROPERTY_CODE } from "../src/services/helpers/quality-station.helper";
import { partyLineId } from "../src/services/gelen-belge-kontrol.service";
import { METER_COMPARE_TOLERANCE_PCT, beyondDeclaredDefectWarning, decideBilledMeters } from "../src/services/helpers/meter-compare.helper";
import { getRollMeterTrail, getWorkOrderMeterComparison, rollMeterTrail, workOrderMeterComparison } from "../src/services/meter-comparison.service";
import { collectServiceBillingDraft, reconcileServiceLinksWithLines } from "../src/services/helpers/service-billing.helper";
import { resolveServiceItemsForRolls } from "../src/services/helpers/service-pricing.helper";
import { SETTING_KEYS, loadServiceBillingSettings, systemSettingService } from "../src/services/system-setting.service";
import workOrderRouter from "../src/routes/workorder.routes";
import inventoryRouter from "../src/routes/inventory.routes";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}
function section(t: string): void { console.log(`\n── ${t} ──`); }
async function errOf(fn: () => Promise<unknown>): Promise<{ status: number; code: string | null }> {
  try { await fn(); return { status: 200, code: null }; } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string } };
    return { status: x.statusCode ?? 500, code: x.details?.code ?? null };
  }
}

const STAMP = randomUUID().slice(0, 8);
const P = `TEST-MBO-${STAMP}`;
const fx = {
  itemIds: [] as string[], propIds: [] as string[], valueIds: [] as string[], woIds: [] as string[], rollIds: [] as string[],
  stationIds: [] as string[], machineIds: [] as string[], noteIds: [] as string[], customerId: null as string | null, kursunCreated: null as string | null, defectTypeId: null as string | null,
};
const METER_KEY = SETTING_KEYS.FINANCE_SERVICE_BILLING_METER_BASIS;
let priorMeter: { existed: boolean; value: unknown } = { existed: false, value: null };

type Cut = { m: number; source?: MachineDataSource };
interface Ctx { actor: string; grade: string; fabric: string; customer: string; kStation: string; kMachine: string; tStation: string; valueId: string; flagId: string; K: string; T: string }
interface Party { wo: string; root: string; kids: string[]; kStep: string; tStep: string }

/** Parti: (belge özet satırı) → kurşun adımı (OUT okuması) → tambur adımı (giriş hareketi + kesim çocukları). */
async function mkParty(c: Ctx, o: { declaredDoc: number | null; initial: number; kursunOut: number | null; kursunSource?: MachineDataSource; cuts: Cut[] }): Promise<Party> {
  const n = fx.woIds.length;
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${P}-WO${n}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: c.fabric,
      steps: { create: [{ stationId: c.kStation, stepSequence: 1, status: StepStatus.COMPLETED }, { stationId: c.tStation, stepSequence: 2, status: StepStatus.ACTIVE }] } },
    select: { id: true, steps: { select: { id: true, stepSequence: true } } },
  });
  fx.woIds.push(wo.id);
  const kStep = wo.steps.find((s) => s.stepSequence === 1)!.id;
  const tStep = wo.steps.find((s) => s.stepSequence === 2)!.id;
  const root = await prisma.roll.create({
    data: { itemId: c.fabric, width: 150, initialQty: o.initial, currentQty: o.initial, status: RollStatus.IN_PRODUCTION,
      qualityGrade: c.grade, entrySource: RollEntrySource.SUBCONTRACTOR_RETURN, currentStepId: tStep, ownerCustomerId: c.customer },
    select: { id: true },
  });
  fx.rollIds.push(root.id);
  const reading = (rollId: string, stepId: string, phase: MeterPhase, meters: number, source: MachineDataSource) => prisma.rollMeterReading.create({
    data: { rollId, workOrderStepId: stepId, phase, meters, source, basis: MeterVarianceBasis.DECLARED_IN, approvalMode: MeterApprovalMode.NONE, clientToken: randomUUID(), createdById: c.actor },
  });
  await prisma.rollMovement.create({ data: { rollId: root.id, workOrderStepId: kStep, qtyIn: o.initial, qtyOut: o.kursunOut ?? o.initial, exitedAt: new Date() } });
  await prisma.$transaction((tx) => applyKursunOperationTx(tx, { rollId: root.id, stepId: kStep, valueId: c.valueId, userId: c.actor, machineId: c.kMachine }));
  if (o.kursunOut !== null) await reading(root.id, kStep, MeterPhase.OUT, o.kursunOut, o.kursunSource ?? MachineDataSource.OPERATOR);
  await prisma.rollMovement.create({ data: { rollId: root.id, workOrderStepId: tStep, qtyIn: o.kursunOut ?? o.initial } });
  if (o.declaredDoc !== null) {
    const note = await prisma.customerDeliveryNote.create({ data: { noteNo: `${P}-N${n}`.slice(0, 32), sourceKind: "MANUAL", status: "APPROVED", ownerCustomerId: c.customer }, select: { id: true } });
    fx.noteIds.push(note.id);
    await prisma.customerDeliveryNoteLine.create({ data: { id: partyLineId(note.id, 1), noteId: note.id, lineNo: 1, blockNo: 1, lineKind: "ARABA", meters: o.declaredDoc, rollId: root.id } });
  }
  const kids: string[] = [];
  for (const cut of o.cuts) {
    const k = await prisma.roll.create({
      data: { itemId: c.fabric, width: 150, initialQty: cut.m, currentQty: cut.m, status: RollStatus.WAREHOUSE, qualityGrade: c.grade,
        entrySource: RollEntrySource.TAMBUR_SPLIT, parentRollId: root.id, producedInStepId: tStep, ownerCustomerId: c.customer },
      select: { id: true },
    });
    fx.rollIds.push(k.id);
    kids.push(k.id);
    await prisma.rollProperty.create({ data: { rollId: k.id, propertyId: c.flagId } });
    await reading(k.id, tStep, MeterPhase.CUT, cut.m, cut.source ?? MachineDataSource.MACHINE);
  }
  return { wo: wo.id, root: root.id, kids, kStep, tStep };
}

async function draftOf(c: Ctx, p: Party, meterBasis: "OUT" | "MAX_DECLARED") {
  const settings = { ...(await loadServiceBillingSettings()), meterBasis };
  return collectServiceBillingDraft({ rollIds: p.kids, customerId: c.customer, currency: Currency.TRY, settings, dispatchedAt: new Date() });
}
const sumBy = (rows: Array<{ serviceItemId: string; billedMeters: Prisma.Decimal }>, id: string) =>
  rows.filter((r) => r.serviceItemId === id).reduce((a, r) => a.plus(r.billedMeters), new Prisma.Decimal(0));
const lineQty = (lines: Array<{ serviceItemId: string; qty: Prisma.Decimal }>, id: string) =>
  lines.filter((l) => l.serviceItemId === id).reduce((a, l) => a.plus(l.qty), new Prisma.Decimal(0));

async function main(): Promise<void> {
  console.log("=== Beyan ↔ ölçülen metre (kural 1 · kural 2 · SIMULATED · varsayılan bayt-aynı) ===");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  const row = await prisma.systemSetting.findUnique({ where: { key: METER_KEY }, select: { value: true } });
  priorMeter = { existed: row !== null, value: row?.value ?? null };
  await prisma.systemSetting.deleteMany({ where: { key: METER_KEY } });

  // ── §1 saf kural 1 ────────────────────────────────────────────────────────
  section("§1 decideBilledMeters (kural 1, tolerans %0,5)");
  check("§1 tolerans sabiti %0,5", METER_COMPARE_TOLERANCE_PCT === 0.5);
  const a = decideBilledMeters(1000, 980);
  check("§1a beyan büyük (1000/980) ⇒ 1000 DECLARED", a.billedM === 1000 && a.billedBasis === "DECLARED" && !a.withinTolerance && !a.longerThanDeclared && a.diffM === -20 && a.diffPct === -2, JSON.stringify(a));
  const b = decideBilledMeters(1000, 1010);
  check("§1b ölçülen büyük (1000/1010) ⇒ 1010 MEASURED", b.billedM === 1010 && b.billedBasis === "MEASURED" && b.longerThanDeclared && b.diffPct === 1, JSON.stringify(b));
  const c1 = decideBilledMeters(1000, 1004);
  check("§1c tolerans içi (1000/1004, %0,4) ⇒ 1000 DECLARED", c1.billedM === 1000 && c1.billedBasis === "DECLARED" && c1.withinTolerance && !c1.longerThanDeclared, JSON.stringify(c1));
  const c2 = decideBilledMeters(1000, 1005);
  check("§1d sınır (%0,5 tam) tolerans DIŞI ⇒ 1005 MEASURED", c2.billedM === 1005 && c2.billedBasis === "MEASURED" && !c2.withinTolerance, JSON.stringify(c2));
  const d = decideBilledMeters(null, 990);
  check("§1e beyan yok ⇒ ölçülen", d.billedM === 990 && d.billedBasis === "MEASURED", JSON.stringify(d));
  const e = decideBilledMeters(1000, null);
  check("§1f ölçüm yok ⇒ beyan", e.billedM === 1000 && e.billedBasis === "DECLARED", JSON.stringify(e));
  const f = decideBilledMeters(null, null);
  check("§1g ikisi de yok ⇒ null", f.billedM === null && f.billedBasis === null, JSON.stringify(f));

  // ── Fikstür ───────────────────────────────────────────────────────────────
  const actor = await testActorId();
  const g = await prisma.qualityGrade.findFirst({ where: { role: "FIRST", isActive: true }, select: { code: true } });
  if (!g) throw new Error("FIRST rollü kalite yok — seed'siz DB");
  let kursun = await prisma.fabricProperty.findUnique({ where: { code: KURSUN_PROPERTY_CODE }, select: { id: true } });
  if (!kursun) {
    kursun = await prisma.fabricProperty.create({ data: { code: KURSUN_PROPERTY_CODE, name: `TEST Kurşunlu ${STAMP}`, valueType: "FLAG" }, select: { id: true } });
    fx.kursunCreated = kursun.id;
  }
  const variant = await prisma.fabricProperty.create({ data: { code: `${P}-GR`.slice(0, 32), name: `TEST MBO gramaj ${STAMP}`, valueType: "CHOICE", variantOfPropertyId: kursun.id }, select: { id: true } });
  fx.propIds.push(variant.id);
  const fabric = await prisma.item.create({ data: { code: `${P}-KUM`.slice(0, 32), name: `TEST MBO kumaş ${STAMP}`, unit: "MT", itemType: ItemType.FABRIC }, select: { id: true } });
  const K = await prisma.serviceItem.create({ data: { code: `${P}-K`.slice(0, 32), name: `TEST MBO kurşun ${STAMP}`, unit: "MT" }, select: { id: true } });
  const T = await prisma.serviceItem.create({ data: { code: `${P}-T`.slice(0, 32), name: `TEST MBO tambur ${STAMP}`, unit: "MT" }, select: { id: true } });
  fx.itemIds.push(fabric.id, K.id, T.id);
  await prisma.itemPrice.create({ data: { serviceItemId: K.id, customerId: null, kind: PriceKind.SALE, currency: Currency.TRY, price: "8.0000" } });
  await prisma.itemPrice.create({ data: { serviceItemId: T.id, customerId: null, kind: PriceKind.SALE, currency: Currency.TRY, price: "2.0000" } });
  const val = await prisma.fabricPropertyValue.create({ data: { propertyId: variant.id, code: `MB45-${STAMP}`.toUpperCase(), name: "45 gr", sortOrder: 10, serviceItemId: K.id }, select: { id: true } });
  fx.valueIds.push(val.id);
  const flag = await prisma.fabricProperty.create({ data: { code: `${P}-TB`.slice(0, 32), name: `TEST MBO Tambur ${STAMP}`, valueType: "FLAG", serviceItemId: T.id }, select: { id: true } });
  fx.propIds.push(flag.id);
  const cust = await prisma.customer.create({ data: { code: `${P}-C`.slice(0, 32), name: `TEST MBO müşteri ${STAMP}` }, select: { id: true } });
  fx.customerId = cust.id;
  const kSt = await prisma.station.create({ data: { code: `${P}-KS`.slice(0, 32), name: `TEST MBO kurşun ${STAMP}`, type: StationType.INTERNAL, kind: "PROCESS_QC", appliesProperty: true }, select: { id: true } });
  const tSt = await prisma.station.create({ data: { code: `${P}-TS`.slice(0, 32), name: `TEST MBO tambur ${STAMP}`, type: StationType.INTERNAL, kind: StationKind.TAMBUR }, select: { id: true } });
  fx.stationIds.push(kSt.id, tSt.id);
  await prisma.stationProperty.create({ data: { stationId: kSt.id, propertyId: kursun.id } });
  const km = await prisma.machine.create({ data: { stationId: kSt.id, code: `${P}-KM`.slice(0, 32), name: `TEST MBO makine ${STAMP}` }, select: { id: true } });
  fx.machineIds.push(km.id);
  const ctx: Ctx = { actor, grade: g.code, fabric: fabric.id, customer: cust.id, kStation: kSt.id, kMachine: km.id, tStation: tSt.id, valueId: val.id, flagId: flag.id, K: K.id, T: T.id };

  // ── §2 S1 karşılaştırma ───────────────────────────────────────────────────
  section("§2 S1 İE karşılaştırması: beyan 1000 (belge) · kurşun 1010 · kesim 1010");
  const s1 = await mkParty(ctx, { declaredDoc: 1000, initial: 1000, kursunOut: 1010, cuts: [{ m: 300 }, { m: 300 }, { m: 410 }] });
  const cmp1 = await getWorkOrderMeterComparison(s1.wo);
  console.log(`   ℹ️ örnek çıktı: ${JSON.stringify(cmp1)}`);
  const p1 = cmp1.parties[0];
  check("§2a tek parti satırı, beyan 1000 DOCUMENT", cmp1.parties.length === 1 && p1?.declaredM === 1000 && p1.declaredSource === "DOCUMENT", JSON.stringify(p1));
  check("§2b kurşun çıkan 1010 · tambura giren 1010 · tamburdan çıkan 1010 · ölçülen max 1010",
    p1?.kursunOutM === 1010 && p1.tamburInM === 1010 && p1.tamburCutM === 1010 && p1.measuredMaxM === 1010, JSON.stringify(p1));
  check("§2c fark +10 m (%1) ⇒ faturalanan 1010 MEASURED", p1?.diffM === 10 && p1.diffPct === 1 && p1.billedM === 1010 && p1.billedBasis === "MEASURED" && p1.longerThanDeclared, JSON.stringify(p1));
  check("§2d toplamlar parti satırlarından", cmp1.totals.declaredM === 1000 && cmp1.totals.billedM === 1010 && cmp1.totals.diffM === 10 && cmp1.tolerancePct === 0.5, JSON.stringify(cmp1.totals));
  const s2 = await mkParty(ctx, { declaredDoc: null, initial: 800, kursunOut: 790, cuts: [] });
  const cmp2 = await workOrderMeterComparison(s2.wo);
  check("§2e belgesiz parti: beyan = İE'ye giriş (800, WORK_ORDER); beyan büyük ⇒ 800 DECLARED",
    cmp2.parties[0]?.declaredM === 800 && cmp2.parties[0].declaredSource === "WORK_ORDER" && cmp2.parties[0].billedM === 800 && cmp2.parties[0].billedBasis === "DECLARED", JSON.stringify(cmp2.parties[0]));
  const bad = await errOf(() => getWorkOrderMeterComparison("x"));
  const miss = await errOf(() => getWorkOrderMeterComparison(randomUUID()));
  check("§2f geçersiz id 400 · bilinmeyen İE 404 WORK_ORDER_NOT_FOUND", bad.status === 400 && miss.status === 404 && miss.code === "WORK_ORDER_NOT_FOUND", JSON.stringify({ bad, miss }));

  // ── §3 SIMULATED ──────────────────────────────────────────────────────────
  section("§3 SIMULATED ölçüm sayılmaz");
  const s3 = await mkParty(ctx, { declaredDoc: 1000, initial: 1000, kursunOut: 1100, kursunSource: MachineDataSource.SIMULATED, cuts: [{ m: 495 }, { m: 500 }, { m: 300, source: MachineDataSource.SIMULATED }] });
  const p3 = (await workOrderMeterComparison(s3.wo)).parties[0];
  check("§3a simüle kurşun OUT (1100) ⇒ kursunOutM null", p3?.kursunOutM === null, JSON.stringify(p3));
  check("§3b simüle kesim (300) hariç ⇒ tamburCutM 995, ölçülen max 995 ⇒ tolerans dışı beyan 1000", p3?.tamburCutM === 995 && p3.measuredMaxM === 995 && p3.billedM === 1000 && p3.billedBasis === "DECLARED", JSON.stringify(p3));

  // ── §4 kural 2 fatura ─────────────────────────────────────────────────────
  section("§4 MAX_DECLARED: kurşun 1010 + kesim 1020 ⇒ iki hizmet de 1020");
  const s4 = await mkParty(ctx, { declaredDoc: 1000, initial: 1000, kursunOut: 1010, cuts: [{ m: 300 }, { m: 300 }, { m: 420 }] });
  const d4 = await draftOf(ctx, s4, "MAX_DECLARED");
  const kSum = sumBy(d4.links, K.id);
  const tSum = sumBy(d4.links, T.id);
  check("§4a kurşun hizmeti bağ toplamı 1020 (parti max; okuma 1010 idi)", kSum.equals(1020), kSum.toFixed(3));
  check("§4b tambur hizmeti bağ toplamı 1020", tSum.equals(1020), tSum.toFixed(3));
  check("§4c Σ bağ = Σ satır (her hizmet) + reconcile 409 vermez",
    lineQty(d4.lines, K.id).equals(kSum) && lineQty(d4.lines, T.id).equals(tSum) && (await errOf(async () => reconcileServiceLinksWithLines(d4.lines, d4.links))).status === 200,
    JSON.stringify(d4.lines.map((l) => [l.serviceItemId === K.id ? "K" : "T", l.qty.toString()])));
  const kw = d4.works.find((w) => w.serviceItemId === K.id);
  check("§4d kurşun işi meterCompare: beyan 1000 · ölçülen 1020 · faturalanan 1020 · MEASURED",
    kw?.meterCompare?.declaredM === 1000 && kw.meterCompare.measuredM === 1020 && kw.meterCompare.billedM === 1020 && kw.meterCompare.basis === "MEASURED", JSON.stringify(kw?.meterCompare));
  const tw = d4.works.filter((w) => w.serviceItemId === T.id);
  check("§4e tambur işleri kendi kesim metreleriyle (300/300/420), payları Σ 1020",
    tw.length === 3 && tw.map((w) => Number(w.qty)).sort((x, y) => x - y).join("/") === "300/300/420"
    && tw.reduce((acc, w) => acc + (w.meterCompare?.billedM ?? 0), 0) === 1020, JSON.stringify(tw.map((w) => w.meterCompare)));
  const part4 = await errOf(async () => {
    const half = await collectServiceBillingDraft({ rollIds: [s4.kids[0]!], customerId: cust.id, currency: Currency.TRY, settings: { ...(await loadServiceBillingSettings()), meterBasis: "MAX_DECLARED" }, dispatchedAt: new Date() });
    const t = sumBy(half.links, T.id);
    if (!t.equals(300)) throw Object.assign(new Error(`kısmi sevk tambur ${t.toFixed(3)}`), { statusCode: 599 });
  });
  check("§4f kısmi sevk (tek çocuk): pay = 1020 × 300 / 1020 = 300 (payda bütün parti, toplam şişmez)", part4.status === 200, JSON.stringify(part4));

  // ── §5 tolerans içi + beyan büyük ─────────────────────────────────────────
  section("§5 tolerans içi ⇒ beyan; yuvarlama farkı son işte");
  const s5 = await mkParty(ctx, { declaredDoc: 1000, initial: 1000, kursunOut: 1004, cuts: [{ m: 500 }, { m: 504 }] });
  const d5 = await draftOf(ctx, s5, "MAX_DECLARED");
  check("§5a %0,4 fark ⇒ kurşun 1000, tambur Σ 1000 (birebir), basis DECLARED",
    sumBy(d5.links, K.id).equals(1000) && sumBy(d5.links, T.id).equals(1000) && d5.works.every((w) => w.meterCompare?.basis === "DECLARED"),
    JSON.stringify(d5.links.map((l) => l.billedMeters.toString())));
  const s5b = await mkParty(ctx, { declaredDoc: 1000, initial: 1000, kursunOut: 980, cuts: [{ m: 490 }, { m: 490 }] });
  const d5b = await draftOf(ctx, s5b, "MAX_DECLARED");
  check("§5b beyan büyük (980) ⇒ iki hizmet de 1000", sumBy(d5b.links, K.id).equals(1000) && sumBy(d5b.links, T.id).equals(1000), JSON.stringify(d5b.links.map((l) => l.billedMeters.toString())));

  // ── §6 varsayılan bayt-aynı ───────────────────────────────────────────────
  section("§6 varsayılan OUT bayt-aynı");
  check("§6a ayar yokken meterBasis varsayılanı OUT", (await loadServiceBillingSettings()).meterBasis === "OUT");
  const d6 = await draftOf(ctx, s4, "OUT");
  check("§6b OUT: hiçbir işte meterCompare anahtarı yok", d6.works.every((w) => !("meterCompare" in w)) && !JSON.stringify(d6).includes("meterCompare"));
  check("§6c OUT: kurşun okumadan 1010, tambur kesimlerden 1020 (parti ölçeklemesi yok)", sumBy(d6.links, K.id).equals(1010) && sumBy(d6.links, T.id).equals(1020), JSON.stringify(d6.links.map((l) => l.billedMeters.toString())));
  const lineage = [s4.root, ...s4.kids];
  const rDefault = await resolveServiceItemsForRolls({ rollIds: lineage, customerId: cust.id, currency: Currency.TRY });
  const rOut = await resolveServiceItemsForRolls({ rollIds: lineage, customerId: cust.id, currency: Currency.TRY, options: { meterBasis: "OUT" } });
  check("§6d seçenek yok ≡ OUT (çözücü çıktısı bayt-aynı)", JSON.stringify(rDefault) === JSON.stringify(rOut) && !JSON.stringify(rOut).includes("meterCompare"));

  // ── §7 hata izi ───────────────────────────────────────────────────────────
  section("§7 beyanı aşan hata: kayıt + iz");
  const defect = await prisma.defectType.create({ data: { code: `${P}-D`.slice(0, 32), name: `TEST MBO hata ${STAMP}` }, select: { id: true, name: true } });
  fx.defectTypeId = defect.id;
  await prisma.rollError.create({ data: { rollId: s1.root, startMeter: 1005, defectTypeId: defect.id, errorType: defect.name, detectedAtStepId: s1.kStep } });
  await prisma.rollError.create({ data: { rollId: s1.root, startMeter: 500, defectTypeId: defect.id, errorType: defect.name, detectedAtStepId: s1.kStep } });
  const p7 = (await workOrderMeterComparison(s1.wo)).parties[0];
  check("§7a defectsBeyondDeclared yalnız 1005 m hatası (beyan 1000)", p7?.defectsBeyondDeclared.length === 1 && p7.defectsBeyondDeclared[0]!.startMeter === 1005 && p7.defectsBeyondDeclared[0]!.rollDeclaredM === 1000, JSON.stringify(p7?.defectsBeyondDeclared));
  check("§7b uyarı cümlesi sözleşmesi", beyondDeclaredDefectWarning(1005, 1000) === "Hata konumu (1005 m) topun beyan metresini (1000 m) aşıyor — kayıt alındı, metre farkı iş emrinde görünür.");

  // ── §8 top izi ────────────────────────────────────────────────────────────
  section("§8 tambur şeridi: önceki ölçüm · kesilen · kalan");
  const tr1 = await getRollMeterTrail(s1.root);
  console.log(`   ℹ️ örnek çıktı: ${JSON.stringify(tr1)}`);
  check("§8a beyan 1000 · önceki ölçüm KURSUN_OUT 1010 · kesilen 1010 · kalan 0", tr1.declaredM === 1000 && tr1.prior?.kind === "KURSUN_OUT" && tr1.prior.meters === 1010
    && tr1.referenceM === 1010 && tr1.cutSoFarM === 1010 && tr1.remainingM === 0 && !tr1.overReference, JSON.stringify(tr1));
  const tr4 = await rollMeterTrail(s4.root);
  check("§8b kesim 1020 > ölçüm 1010 ⇒ kalan -10, overReference", tr4.remainingM === -10 && tr4.overReference, JSON.stringify(tr4));
  const tr3 = await rollMeterTrail(s3.root);
  check("§8c simüle kurşun OUT önceki ölçüm sayılmaz ⇒ referans beyan 1000, kesilen 495+500+300(initialQty)", tr3.prior === null && tr3.referenceM === 1000 && tr3.cutSoFarM === 1295 && tr3.overReference, JSON.stringify(tr3));
  const tm = await errOf(() => getRollMeterTrail(randomUUID()));
  check("§8d bilinmeyen top 404 ROLL_NOT_FOUND", tm.status === 404 && tm.code === "ROLL_NOT_FOUND", JSON.stringify(tm));

  // ── §9 uç kapıları + ayar ─────────────────────────────────────────────────
  section("§9 uç kapıları ve ayar");
  const fakeReq = (perms: string[]): Partial<Request> => ({ user: { userId: randomUUID(), username: "mbo", permissions: perms, tokenVersion: 0 } as Request["user"] });
  const gate = async (stack: typeof workOrderRouter.stack, path: string, ok: string[], denied: string[]) => {
    const layer = stack.find((l) => l.route?.path === path && (l.route as unknown as { methods?: Record<string, boolean> }).methods?.get);
    const names = layer?.route?.stack.map((s) => s.name) ?? [];
    const perm = layer?.route?.stack[1];
    const run = (p: string[]) => new Promise<unknown>((res) => { void perm?.handle(fakeReq(p) as Request, {} as Response, (er?: unknown) => res(er ?? "next")); });
    const dn = (await run(denied)) as { statusCode?: number } | string;
    const results = await Promise.all(ok.map((p) => run([p])));
    return { exists: !!layer, first: names[0], denied: typeof dn === "string" ? dn : dn?.statusCode, allowed: results.every((r) => r === "next") };
  };
  const gWo = await gate(workOrderRouter.stack, "/:id/meter-comparison", ["workorder:read", "mobile:hizli-is-emri"], ["roll:read"]);
  check("§9a GET /work-orders/:id/meter-comparison: verifyToken ilk halka; workorder:read | mobile:hizli-is-emri geçer, diğeri 403",
    gWo.exists && gWo.first === "verifyToken" && gWo.denied === 403 && gWo.allowed, JSON.stringify(gWo));
  const gRoll = await gate(inventoryRouter.stack, "/:id/meter-trail", ["roll:read", "mobile:tambur", "mobile:kk2-kursun"], ["workorder:read"]);
  check("§9b GET /rolls/:id/meter-trail: verifyToken ilk halka; roll:read | mobile:tambur | mobile:kk2-kursun geçer, diğeri 403",
    gRoll.exists && gRoll.first === "verifyToken" && gRoll.denied === 403 && gRoll.allowed, JSON.stringify(gRoll));
  const setOk = await errOf(() => systemSettingService.setFeatureFlags({ financeServiceBillingMeterBasis: "MAX_DECLARED" } as never, actor));
  check("§9c ayar MAX_DECLARED kabul edilir ve okunur", setOk.status === 200 && (await loadServiceBillingSettings()).meterBasis === "MAX_DECLARED", JSON.stringify(setOk));
  const setBad = await errOf(() => systemSettingService.setFeatureFlags({ financeServiceBillingMeterBasis: "MAX" } as never, actor));
  check("§9d tanınmayan taban 400", setBad.status === 400, JSON.stringify(setBad));
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  await del("ayar", () => priorMeter.existed
    ? prisma.systemSetting.upsert({ where: { key: METER_KEY }, create: { key: METER_KEY, value: priorMeter.value as never }, update: { value: priorMeter.value as never } })
    : prisma.systemSetting.deleteMany({ where: { key: METER_KEY } }));
  const ids = fx.rollIds;
  await del("rollError", () => prisma.rollError.deleteMany({ where: { rollId: { in: ids } } }));
  if (fx.defectTypeId) { const dt = fx.defectTypeId; await del("defectType", () => prisma.defectType.deleteMany({ where: { id: dt } })); }
  await del("noteLine", () => prisma.customerDeliveryNoteLine.deleteMany({ where: { noteId: { in: fx.noteIds } } }));
  await del("note", () => prisma.customerDeliveryNote.deleteMany({ where: { id: { in: fx.noteIds } } }));
  await del("meterAck", () => prisma.rollMeterAck.deleteMany({ where: { reading: { rollId: { in: ids } } } }));
  await del("meterReading", () => prisma.rollMeterReading.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollOperation", () => prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollMovement", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollVariance", () => prisma.rollVariance.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollProperty", () => prisma.rollProperty.deleteMany({ where: { rollId: { in: ids } } }));
  await del("roll (çocuk)", () => prisma.roll.deleteMany({ where: { id: { in: ids }, parentRollId: { not: null } } }));
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: ids } } }));
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("machine", () => prisma.machine.deleteMany({ where: { id: { in: fx.machineIds } } }));
  await del("stationProperty", () => prisma.stationProperty.deleteMany({ where: { stationId: { in: fx.stationIds } } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("value", () => prisma.fabricPropertyValue.deleteMany({ where: { id: { in: fx.valueIds } } }));
  await del("variant bağı", () => prisma.fabricProperty.updateMany({ where: { id: { in: fx.propIds } }, data: { variantOfPropertyId: null } }));
  await del("property", () => prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } }));
  if (fx.kursunCreated) { const k = fx.kursunCreated; await del("KURSUN", () => prisma.fabricProperty.deleteMany({ where: { id: k } })); }
  await del("itemPrice", () => prisma.itemPrice.deleteMany({ where: { OR: [{ itemId: { in: fx.itemIds } }, { serviceItemId: { in: fx.itemIds } }] } }));
  await del("item", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  await del("serviceItem", () => prisma.serviceItem.deleteMany({ where: { id: { in: fx.itemIds } } }));
  if (fx.customerId) { const cid = fx.customerId; await del("customer", () => prisma.customer.deleteMany({ where: { id: cid } })); }
  const left = await prisma.roll.count({ where: { id: { in: ids } } });
  check("temizlik: TEST-MBO top kalıntısı yok", left === 0, String(left));
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
