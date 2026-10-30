// =============================================================================
// D4-B1a — Tambur ölçüm kaynağı (DALGA4 §3; ister 2.9) bekçisi
// =============================================================================
// §1  weakestMeasureSource dört kaynak × dört kaynak tablosu + kaynaksız/boş → NULL
// §2  ortak gövde şeması: katı `measure`, kurşun okuma gövdesi bayt-aynı (eski tanımla parse eşitliği),
//     Tambur kesim gövdeleri `measure`yi SİLMEZ (gerçek parse)
// §3  DB CHECK roll_meter_readings_policy_by_phase: IN satırı basis NULL → RED; CUT satırı NULL → kabul
// §4  finalize 2 kesim (MACHINE + OPERATOR) aşımlı → sapma measureSource = OPERATOR; measure'sız → NULL ve
//     yanıt/defter (measureSource dışında) bayt-aynı
// §5  cutOpenFabric SIMULATED (ayar açık) → SIMULATED; cutWarehouseRoll MACHINE → MACHINE
// §6  SIMULATED + tambur.simulatedMeterEnabled KAPALI → 400 SIMULATED_METER_DISABLED, yazım 0
// §7  tambur.olcumKaynagiZorunlu AÇIK + measure yok → 400 MEASURE_SOURCE_REQUIRED; measure'lı geçer (2026-10-30)
// §8  cardSampleId → 400 CARD_SAMPLE_UNSUPPORTED
// §9  ayar varsayılanları (satır yok): simüle AÇIK, zorunlu KAPALI
// §10 AST: zayıf halka sıralaması yalnız meter-reading.helper'da (ikinci sıralama KIRMIZI)
// D4-B1b (CUT okuması deftere):
// §11 finalize N measure'lı kesim → N CUT okuması (kaynak, makine, sunucu token'ı, adım); replay → N kalır;
//     measure'sız → okuma 0 ve yanıt bayt-aynı
// §12 geri alma: SINGLE → 1 damga, FULL → 3 damga (TAMBUR_UNDO), satır silinmez
// §13 cutOpenFabric CUT okuması; finalizeOpenFabric kalan sapması zayıf halka / okumasızda NULL;
//     depo kesimi okuma yazmaz, finalizeWarehouseCut NULL
// §14 faz süzgeçsiz okuyucu envanteri (revokeStepMeterReadingsTx): kurşun adımı → CUT dokunulmaz;
//     Tambur adımı yeniden açılınca CUT damgalanır (BEKLENEN)
// §15 AST: roll_meter_readings'e yazım (yaratma/damga/ham SQL) yalnız meter-reading.helper'da
// §16 iptal → CUT damgası (ROLL_CANCEL); iptali geri al → aynı kaynak/metreyle YENİ aktif satır (damgalı satır kalır)
// Ayarları birebir geri yükler; fixture `TEST-OK-` damgalı, finally'de silinir.
// =============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";
import { z } from "zod";
import { Prisma, RollEntrySource, RollStatus, StationKind, StationType, StepStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { InventoryService } from "../src/services/inventory.service";
import { TamburManualService } from "../src/services/tambur-manual.service";
import { TamburUndoService, UNDO_FULL_PERMISSION } from "../src/services/tambur-undo.service";
import { revokeStepMeterReadingsTx } from "../src/services/helpers/kursun-meter.helper";
import { randomUUID } from "node:crypto";
import { insertMeterReadingTx, meterSourceSchema, weakestMeasureSource, MEASURE_SOURCES, type MeasureSource } from "../src/services/helpers/meter-reading.helper";
import { readTamburMeasureSourceRequired, readTamburSimulatedMeterEnabled } from "../src/services/system-setting.service";
import { completeQc2Schema, meterReadingSchema } from "../src/controllers/kursun-qc.controller";
import { cutOpenFabricSchema, cutWarehouseRollSchema, finalizeSchema } from "../src/controllers/tambur.controller";
import { manualRollSchema, produceSchema } from "../src/controllers/tambur-manual.controller";

const tambur = new TamburService();
const manual = new TamburManualService();
const undo = new TamburUndoService();
const KEYS = ["tambur.overQuantityEnabled", "tambur.simulatedMeterEnabled", "tambur.olcumKaynagiZorunlu"] as const;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
const rnd = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const createdRolls: string[] = [];
const createdSteps: string[] = [];
const createdWOs: string[] = [];
const createdReadings: string[] = [];
let createdStationId: string | null = null;
let createdItemId: string | null = null;
let createdGradeId: string | null = null;
let gradeCode = "";
let savedSettings: Array<{ key: string; value: Prisma.JsonValue; description: string | null }> = [];

async function setSetting(key: string, value: boolean | null) {
  if (value === null) {
    await prisma.systemSetting.deleteMany({ where: { key } });
    return;
  }
  await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value, description: "test geçici" } });
}

/** 400 + details.code bekler; başka sonuç KIRMIZI. */
async function expectCode(label: string, code: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, "hata atılmadı");
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: string } };
    check(label, err.statusCode === 400 && err.details?.code === code, `status=${err.statusCode} code=${err.details?.code}`);
  }
}

async function ensureFixtures() {
  const g = await prisma.qualityGrade.findFirst({ where: { role: "FIRST", isActive: true }, select: { code: true } });
  if (g) gradeCode = g.code;
  else {
    const c = await prisma.qualityGrade.create({
      data: { code: `TEST-OK-K1-${rnd()}`, name: `TEST-OK 1. Kalite ${rnd()}`, role: "FIRST", targetStatus: RollStatus.WAREHOUSE },
      select: { id: true, code: true },
    });
    createdGradeId = c.id;
    gradeCode = c.code;
  }
  const item = await prisma.item.create({
    data: { code: `TEST-OK-${rnd()}`, name: `TEST-OK Kumaş ${rnd()}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  createdItemId = item.id;
  let station = await prisma.station.findFirst({ where: { kind: StationKind.TAMBUR, isActive: true }, select: { id: true } });
  if (!station) {
    station = await prisma.station.create({
      data: { code: `TEST-OK-TMB-${rnd()}`, name: "TEST-OK Tambur", type: StationType.INTERNAL, kind: StationKind.TAMBUR },
      select: { id: true },
    });
    createdStationId = station.id;
  }
  return { itemId: item.id, stationId: station.id };
}

async function tamburRoll(fx: { itemId: string; stationId: string }, qty: number) {
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `TEST-OK-WO-${rnd()}`, status: "IN_PROGRESS" }, select: { id: true } });
  createdWOs.push(wo.id);
  const step = await prisma.workOrderStep.create({
    data: { workOrderId: wo.id, stationId: fx.stationId, stepSequence: 1, status: StepStatus.ACTIVE },
    select: { id: true },
  });
  createdSteps.push(step.id);
  const roll = await prisma.roll.create({
    data: {
      barcode: null, itemId: fx.itemId, colorId: null, width: 150, initialQty: qty, currentQty: qty,
      status: RollStatus.IN_PRODUCTION, qualityGrade: gradeCode, entrySource: RollEntrySource.SUBCONTRACTOR_RETURN, currentStepId: step.id,
    },
    select: { id: true },
  });
  createdRolls.push(roll.id);
  return { rollId: roll.id, stepId: step.id };
}

async function warehouseRoll(fx: { itemId: string }, qty: number) {
  const roll = await prisma.roll.create({
    data: {
      barcode: `TEST-OK-WH-${rnd()}`, itemId: fx.itemId, colorId: null, width: 150, initialQty: qty, currentQty: qty,
      status: RollStatus.WAREHOUSE, qualityGrade: gradeCode, entrySource: RollEntrySource.TAMBUR_SPLIT,
    },
    select: { id: true },
  });
  createdRolls.push(roll.id);
  return roll.id;
}

async function trackChildren(parentId: string) {
  const kids = await prisma.roll.findMany({ where: { parentRollId: parentId }, select: { id: true } });
  for (const k of kids) if (!createdRolls.includes(k.id)) createdRolls.push(k.id);
}

/** Bir topun defter izi — kimlik/zaman dışı alanlar (bayt-aynı karşılaştırma için). */
async function ledgerShape(rollId: string) {
  const variances = await prisma.rollVariance.findMany({
    where: { rollId }, select: { kind: true, qty: true, source: true, reasonCode: true, workOrderStepId: true, measureSource: true },
  });
  const ops = await prisma.rollOperation.findMany({ where: { rollId }, select: { operationType: true, metadata: true }, orderBy: { createdAt: "asc" } });
  const kids = await prisma.roll.findMany({ where: { parentRollId: rollId }, select: { initialQty: true, status: true, qualityGrade: true }, orderBy: { initialQty: "asc" } });
  const opShape = ops.map((o) => ({ t: o.operationType, keys: Object.keys((o.metadata ?? {}) as object).sort() }));
  return { variances, opShape, kids: kids.map((k) => ({ q: Number(k.initialQty), s: k.status, g: k.qualityGrade })) };
}

// ── §1 ────────────────────────────────────────────────────────────────────────
function section1() {
  console.log("\n§1 weakestMeasureSource 4×4");
  const expected: Record<MeasureSource, Record<MeasureSource, MeasureSource>> = {
    MACHINE: { MACHINE: "MACHINE", OPERATOR: "OPERATOR", SUPERVISOR: "SUPERVISOR", SIMULATED: "SIMULATED" },
    OPERATOR: { MACHINE: "OPERATOR", OPERATOR: "OPERATOR", SUPERVISOR: "OPERATOR", SIMULATED: "SIMULATED" },
    SUPERVISOR: { MACHINE: "SUPERVISOR", OPERATOR: "OPERATOR", SUPERVISOR: "SUPERVISOR", SIMULATED: "SIMULATED" },
    SIMULATED: { MACHINE: "SIMULATED", OPERATOR: "SIMULATED", SUPERVISOR: "SIMULATED", SIMULATED: "SIMULATED" },
  };
  for (const a of MEASURE_SOURCES) {
    for (const b of MEASURE_SOURCES) {
      const got = weakestMeasureSource([a, b]);
      check(`§1 ${a} × ${b} → ${expected[a][b]}`, got === expected[a][b], `got=${got}`);
    }
  }
  check("§1 boş liste → NULL", weakestMeasureSource([]) === null);
  check("§1 biri kaynaksız → NULL", weakestMeasureSource(["MACHINE", null]) === null && weakestMeasureSource([undefined, "SIMULATED"]) === null);
  check("§1 tek kaynak kendisi", weakestMeasureSource(["MACHINE"]) === "MACHINE");
}

// ── §2 ────────────────────────────────────────────────────────────────────────
function section2() {
  console.log("\n§2 gövde şemaları");
  check("§2 measure katı: tanınmayan anahtar 400", !meterSourceSchema.safeParse({ source: "MACHINE", meters: 3 }).success);
  check("§2 measure INFERRED kabul etmez", !meterSourceSchema.safeParse({ source: "INFERRED" }).success);
  // Kurşun gövdesinin D4-B1 öncesi tanımı (`b91c71af6`) — ortak şemaya geçiş bayt-aynı olmalı.
  const legacy = z.object({
    meters: z.number().min(0, "Metre 0 veya daha büyük olmalı").lt(1e9, "Metre çok büyük"),
    source: z.enum(["MACHINE", "OPERATOR", "SUPERVISOR", "SIMULATED"]),
    peripheralId: z.string().uuid("Geçersiz cihaz ID").nullish(),
    rawCounter: z.number().min(0).lt(1e11, "Sayaç değeri çok büyük").nullish(),
    cardSampleId: z.string().uuid("Geçersiz örnek ID").nullish(),
    clientToken: z.string().uuid("Geçersiz okuma kimliği"),
    ack: z.strictObject({ reasonCode: z.string().trim().max(64, "Sebep kodu en fazla 64 karakter").nullish(), reasonText: z.string().trim().max(300, "Sebep en fazla 300 karakter").nullish() }).nullish(),
  });
  const uuid = "3f1c9a4e-2b7d-4c1e-9a55-0d6e8f2b1c3a";
  const bodies: unknown[] = [
    { meters: 12.5, source: "MACHINE", clientToken: uuid },
    { meters: 12.5, source: "SIMULATED", peripheralId: uuid, rawCounter: 1234, cardSampleId: uuid, clientToken: uuid, extra: 1 },
    { meters: -1, source: "INFERRED", peripheralId: "x", rawCounter: 1e12, cardSampleId: "y", clientToken: "z" },
    { meters: 5, source: "OPERATOR", peripheralId: null, rawCounter: null, cardSampleId: null, clientToken: uuid, ack: { reasonCode: "A" } },
  ];
  const current = completeQc2Schema.shape.meterOut.unwrap().unwrap();
  bodies.forEach((b, i) => {
    const x = legacy.safeParse(b);
    const y = current.safeParse(b);
    const same = JSON.stringify(x.success ? x.data : x.error.issues) === JSON.stringify(y.success ? y.data : y.error.issues);
    check(`§2 kurşun meterOut gövdesi #${i + 1} eski tanımla bayt-aynı`, same);
  });
  const r = meterReadingSchema.safeParse({ meters: 1, source: "MACHINE", clientToken: uuid, rollId: uuid, stepId: uuid, phase: "OUT" });
  check("§2 kurşun meter-readings gövdesi kaynak alanlarını taşır", r.success && r.data.source === "MACHINE");
  const m = { source: "MACHINE", peripheralId: uuid };
  // Yalnız şema ayrıştırması: not değeri anlamsızdır, katalog kodu değildir.
  const parseOnlyLabel = "X";
  const f = finalizeSchema.parse({ rollId: uuid, cuts: [{ length: 10, qualityGrade: parseOnlyLabel, measure: m }] });
  check("§2 finalize cuts[].measure silinmez", f.cuts[0]?.measure?.source === "MACHINE");
  check("§2 cutOpenFabric measure silinmez", cutOpenFabricSchema.parse({ lengthMeters: 5, status: "WAREHOUSE", measure: m }).measure?.source === "MACHINE");
  check("§2 cutWarehouseRoll measure silinmez", cutWarehouseRollSchema.parse({ cutLength: 5, measure: m }).measure?.source === "MACHINE");
  check("§2 manual measure silinmez", manualRollSchema.parse({ targetStepId: uuid, initialQty: 5, reason: "abc", clientToken: uuid, measure: m }).measure?.source === "MACHINE");
  check("§2 produce measure silinmez", produceSchema.parse({ itemId: uuid, initialQty: 5, reason: "abc", clientToken: uuid, measure: m }).measure?.source === "MACHINE");
  check("§2 finalize measure katı (bilinmeyen anahtar RED)", !finalizeSchema.safeParse({ rollId: uuid, cuts: [{ length: 1, qualityGrade: parseOnlyLabel, measure: { source: "MACHINE", x: 1 } }] }).success);
}

// ── §3 ────────────────────────────────────────────────────────────────────────
async function section3(fx: { itemId: string; stationId: string }) {
  console.log("\n§3 DB CHECK (faz ↔ politika)");
  const { rollId, stepId } = await tamburRoll(fx, 10);
  const insRaw = (phase: string, basis: string | null, approvalMode: string | null) =>
    prisma.$executeRawUnsafe(
      `INSERT INTO roll_meter_readings (id, "rollId", "workOrderStepId", phase, meters, source, basis, "approvalMode", "clientToken")
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::"MeterPhase", 10, 'MACHINE', $4::"MeterVarianceBasis", $5::"MeterApprovalMode", gen_random_uuid())`,
      rollId, stepId, phase, basis, approvalMode,
    );
  const ins = (phase: string, basis: string | null) => insRaw(phase, basis, basis === null ? null : "NONE");
  // Çapraz durumlar: CHECK iki kolonu da ayrı ayrı korumalı (yalnız basis'e indirgenirse kırmızı).
  for (const [label, basis, mode] of [
    ["basis dolu + approvalMode NULL", "DECLARED_IN", null],
    ["basis NULL + approvalMode dolu", null, "NONE"],
  ] as const) {
    let crossRejected = false;
    try {
      await insRaw("IN", basis, mode);
    } catch (e) {
      crossRejected = String(e).includes("roll_meter_readings_policy_by_phase");
    }
    check(`§3 IN satırı ${label} insert REDDEDİLİR`, crossRejected);
  }
  let rejected = false;
  try {
    await ins("IN", null);
  } catch (e) {
    rejected = String(e).includes("roll_meter_readings_policy_by_phase");
  }
  check("§3 IN satırı basis NULL insert REDDEDİLİR", rejected);
  let rejectedOut = false;
  try {
    await ins("OUT", null);
  } catch (e) {
    rejectedOut = String(e).includes("roll_meter_readings_policy_by_phase");
  }
  check("§3 OUT satırı basis NULL insert REDDEDİLİR", rejectedOut);
  let cutOk = false;
  try {
    await ins("CUT", null);
    cutOk = true;
  } catch (e) {
    console.log(`   CUT insert: ${String(e).slice(0, 160)}`);
  }
  check("§3 CUT satırı politika NULL kabul", cutOk);
  const rows = await prisma.rollMeterReading.findMany({ where: { rollId }, select: { id: true } });
  createdReadings.push(...rows.map((r) => r.id));
}

// ── §4–§8 ────────────────────────────────────────────────────────────────────
async function sections4to8(fx: { itemId: string; stationId: string }) {
  await setSetting("tambur.overQuantityEnabled", true);
  await setSetting("tambur.simulatedMeterEnabled", null);
  await setSetting("tambur.olcumKaynagiZorunlu", null);

  console.log("\n§4 finalize zayıf halka + eski istemci bayt-aynı");
  const a = await tamburRoll(fx, 100);
  const resA = await tambur.finalize({
    rollId: a.rollId, decisions: [],
    cuts: [
      { length: 80, qualityGrade: gradeCode, relatedErrorIds: [], measure: { source: "MACHINE" } },
      { length: 40, qualityGrade: gradeCode, relatedErrorIds: [], measure: { source: "OPERATOR" } },
    ],
  });
  await trackChildren(a.rollId);
  const vA = await prisma.rollVariance.findMany({ where: { rollId: a.rollId }, select: { kind: true, qty: true, measureSource: true } });
  check("§4 aşım sapması doğdu (20 m)", vA.length === 1 && Number(vA[0]?.qty) === 20, JSON.stringify(vA));
  check("§4 sapma measureSource = OPERATOR (MACHINE+OPERATOR zayıf halka)", vA[0]?.measureSource === "OPERATOR");

  const b = await tamburRoll(fx, 100);
  const resB = await tambur.finalize({
    rollId: b.rollId, decisions: [],
    cuts: [
      { length: 80, qualityGrade: gradeCode, relatedErrorIds: [] },
      { length: 40, qualityGrade: gradeCode, relatedErrorIds: [] },
    ],
  });
  await trackChildren(b.rollId);
  const shA = await ledgerShape(a.rollId);
  const shB = await ledgerShape(b.rollId);
  check("§4 measure'sız finalize → measureSource NULL", shB.variances.length === 1 && shB.variances[0]?.measureSource === null);
  const strip = (s: Awaited<ReturnType<typeof ledgerShape>>) => JSON.stringify({ ...s, variances: s.variances.map((v) => ({ ...v, workOrderStepId: "-", measureSource: "-" })) });
  check("§4 defter izi (sapma kaynağı dışında) iki gövdede bayt-aynı", strip(shA) === strip(shB));
  const respShape = (r: typeof resA) => JSON.stringify({ ok: r.success, keys: Object.keys(r.data).sort(), n: r.data.splitRolls.length, p: r.data.processedErrors, msg: r.message });
  check("§4 yanıt şekli iki gövdede aynı", respShape(resA) === respShape(resB));

  console.log("\n§5 tekil kesim yolları");
  const of = await tamburRoll(fx, 50);
  const ofRes = await tambur.cutOpenFabric(of.rollId, { lengthMeters: 60, status: "WAREHOUSE", measure: { source: "SIMULATED" } });
  createdRolls.push(ofRes.data.childRoll.id);
  const vOf = await prisma.rollVariance.findFirst({ where: { rollId: of.rollId }, select: { measureSource: true } });
  check("§5 cutOpenFabric SIMULATED (ayar varsayılan açık) → sapma SIMULATED", vOf?.measureSource === "SIMULATED");
  const wh = await warehouseRoll(fx, 50);
  const whRes = await tambur.cutWarehouseRoll(wh, { cutLength: 70, measure: { source: "MACHINE", rawCounter: 70 } });
  createdRolls.push(whRes.data.childRoll.id);
  const vWh = await prisma.rollVariance.findFirst({ where: { rollId: wh }, select: { measureSource: true } });
  check("§5 cutWarehouseRoll MACHINE → sapma MACHINE (depo kesimi dahil)", vWh?.measureSource === "MACHINE");

  console.log("\n§6 SIMULATED + ayar kapalı");
  await setSetting("tambur.simulatedMeterEnabled", false);
  const c = await tamburRoll(fx, 100);
  const before = { kids: await prisma.roll.count({ where: { parentRollId: c.rollId } }), ops: await prisma.rollOperation.count({ where: { rollId: c.rollId } }) };
  await expectCode("§6 finalize SIMULATED → 400 SIMULATED_METER_DISABLED", "SIMULATED_METER_DISABLED", () =>
    tambur.finalize({ rollId: c.rollId, decisions: [], cuts: [
      { length: 50, qualityGrade: gradeCode, relatedErrorIds: [], measure: { source: "MACHINE" } },
      { length: 50, qualityGrade: gradeCode, relatedErrorIds: [], measure: { source: "SIMULATED" } },
    ] }),
  );
  const after = { kids: await prisma.roll.count({ where: { parentRollId: c.rollId } }), ops: await prisma.rollOperation.count({ where: { rollId: c.rollId } }) };
  const cRoll = await prisma.roll.findUnique({ where: { id: c.rollId }, select: { status: true, currentQty: true } });
  check("§6 yazım 0 (çocuk/operasyon yok, top değişmedi)", JSON.stringify(before) === JSON.stringify(after) && cRoll?.status === RollStatus.IN_PRODUCTION && Number(cRoll.currentQty) === 100);
  await expectCode("§6 cutOpenFabric SIMULATED → 400", "SIMULATED_METER_DISABLED", () =>
    tambur.cutOpenFabric(c.rollId, { lengthMeters: 10, status: "WAREHOUSE", measure: { source: "SIMULATED" } }),
  );
  const wh2 = await warehouseRoll(fx, 30);
  await expectCode("§6 cutWarehouseRoll SIMULATED → 400", "SIMULATED_METER_DISABLED", () =>
    tambur.cutWarehouseRoll(wh2, { cutLength: 10, measure: { source: "SIMULATED" } }),
  );
  check("§6 depo topu kesilmedi", (await prisma.roll.count({ where: { parentRollId: wh2 } })) === 0);
  await expectCode("§6 manuel üretim SIMULATED → 400", "SIMULATED_METER_DISABLED", () =>
    manual.produceFinishedRoll({ itemId: fx.itemId, initialQty: 10, reason: "test ölçüm", clientToken: crypto.randomUUID(), measure: { source: "SIMULATED" } }),
  );
  await expectCode("§6 manuel top SIMULATED → 400", "SIMULATED_METER_DISABLED", () =>
    manual.createManualRoll({ targetStepId: c.stepId, initialQty: 10, reason: "test ölçüm", clientToken: crypto.randomUUID(), measure: { source: "SIMULATED" } }),
  );
  await setSetting("tambur.simulatedMeterEnabled", null);

  console.log("\n§7 ölçüm kaynağı zorunlu");
  await setSetting("tambur.olcumKaynagiZorunlu", true);
  await expectCode("§7 finalize measure yok → 400 MEASURE_SOURCE_REQUIRED", "MEASURE_SOURCE_REQUIRED", () =>
    tambur.finalize({ rollId: c.rollId, decisions: [], cuts: [
      { length: 50, qualityGrade: gradeCode, relatedErrorIds: [], measure: { source: "MACHINE" } },
      { length: 50, qualityGrade: gradeCode, relatedErrorIds: [] },
    ] }),
  );
  await expectCode("§7 cutOpenFabric measure yok → 400", "MEASURE_SOURCE_REQUIRED", () =>
    tambur.cutOpenFabric(c.rollId, { lengthMeters: 10, status: "WAREHOUSE" }),
  );
  await expectCode("§7 manuel üretim measure yok → 400", "MEASURE_SOURCE_REQUIRED", () =>
    manual.produceFinishedRoll({ itemId: fx.itemId, initialQty: 10, reason: "test ölçüm", clientToken: crypto.randomUUID() }),
  );
  const okRes = await tambur.cutOpenFabric(c.rollId, { lengthMeters: 10, status: "WAREHOUSE", measure: { source: "OPERATOR" } });
  createdRolls.push(okRes.data.childRoll.id);
  check("§7 measure'lı kesim zorunlu açıkken geçer", okRes.success && Number(okRes.data.childRoll.initialQty) === 10);
  await setSetting("tambur.olcumKaynagiZorunlu", null);

  console.log("\n§8 kart örneği");
  await expectCode("§8 cardSampleId → 400 CARD_SAMPLE_UNSUPPORTED", "CARD_SAMPLE_UNSUPPORTED", () =>
    tambur.cutOpenFabric(c.rollId, { lengthMeters: 10, status: "WAREHOUSE", measure: { source: "MACHINE", cardSampleId: crypto.randomUUID() } }),
  );
  await expectCode("§8 bilinmeyen sayaç cihazı → 400 METER_PERIPHERAL_NOT_FOUND", "METER_PERIPHERAL_NOT_FOUND", () =>
    tambur.cutOpenFabric(c.rollId, { lengthMeters: 10, status: "WAREHOUSE", measure: { source: "MACHINE", peripheralId: crypto.randomUUID() } }),
  );
}

// ── §9 ────────────────────────────────────────────────────────────────────────
async function section9() {
  console.log("\n§9 ayar varsayılanları");
  await setSetting("tambur.simulatedMeterEnabled", null);
  await setSetting("tambur.olcumKaynagiZorunlu", null);
  check("§9 satır yok → simüle metre AÇIK (bugünkü davranış)", (await readTamburSimulatedMeterEnabled()) === true);
  check("§9 satır yok → ölçüm kaynağı zorunlu KAPALI", (await readTamburMeasureSourceRequired()) === false);
}

// ── §10 ───────────────────────────────────────────────────────────────────────
const SOURCE_NAMES = new Set(["MACHINE", "OPERATOR", "SUPERVISOR", "SIMULATED", "INFERRED"]);
const HELPER = "src/services/helpers/meter-reading.helper.ts";

function walk(dir: string, out: string[]) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n === "generated" || n === "node_modules") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
}
function sourceNameOf(e: ts.Node): string | null {
  if (ts.isStringLiteral(e) && SOURCE_NAMES.has(e.text)) return e.text;
  if (ts.isPropertyAccessExpression(e) && SOURCE_NAMES.has(e.name.text)) return e.name.text;
  return null;
}
/** İkinci sıralama ihlalleri: sayısal kademe haritası · konumla sıralayan dizi · zayıf/güçlü-kaynak fonksiyonu. */
export function findSecondRankings(root: string): string[] {
  const files: string[] = [];
  walk(join(root, "src"), files);
  const hits: string[] = [];
  for (const file of files) {
    const rel = relative(root, file);
    if (rel === HELPER) continue;
    const text = readFileSync(file, "utf8");
    if (!/SIMULATED|MACHINE/.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node) => {
      if (ts.isObjectLiteralExpression(n)) {
        const numeric = n.properties.filter(
          (p) => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && SOURCE_NAMES.has(p.name.text) && ts.isNumericLiteral(p.initializer),
        );
        if (numeric.length >= 2) hits.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} sayısal kaynak kademesi`);
      }
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ["indexOf", "findIndex"].includes(n.expression.name.text)) {
        const recv = n.expression.expression;
        if (ts.isArrayLiteralExpression(recv) && recv.elements.filter((e) => sourceNameOf(e) !== null).length >= 2) {
          hits.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} konumla kaynak sıralaması`);
        }
      }
      const name =
        (ts.isFunctionDeclaration(n) && n.name?.text) || (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text) || null;
      if (name && /(weak|strong)\w*(measure|source)/i.test(name)) hits.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${name}`);
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return hits;
}

function section10() {
  console.log("\n§10 AST: zayıf halka sıralaması tek yerde");
  const root = join(__dirname, "..");
  const helperText = readFileSync(join(root, HELPER), "utf8");
  check("§10 körlük zemini: helper sayısal kademe taşıyor", /MACHINE: 0, OPERATOR: 1, SUPERVISOR: 1, SIMULATED: 2/.test(helperText));
  const hits = findSecondRankings(root);
  check("§10 src'de ikinci kaynak sıralaması YOK", hits.length === 0, hits.join(" · "));
}

// ── D4-B1b ────────────────────────────────────────────────────────────────────
let createdMachineId: string | null = null;
async function ensureMachine(stationId: string): Promise<string> {
  const m = await prisma.machine.create({ data: { stationId, code: `TOK-${Date.now().toString(36)}`, name: `TEST-OK Makine ${rnd()}` }, select: { id: true } });
  createdMachineId = m.id;
  return m.id;
}
const kidsOf = (parentId: string) => prisma.roll.findMany({ where: { parentRollId: parentId }, select: { id: true, initialQty: true }, orderBy: { initialQty: "asc" } });
const cutRows = (rollIds: string[]) =>
  prisma.rollMeterReading.findMany({
    where: { rollId: { in: rollIds }, phase: "CUT" },
    select: { id: true, rollId: true, workOrderStepId: true, machineId: true, source: true, meters: true, rawCounter: true, clientToken: true, basis: true, approvalMode: true, revokedAt: true, revokeReason: true },
  });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** §11 finalize 3 ölçümlü kesim → 3 CUT okuması; replay → 3 kalır; measure'sız → 0, yanıt bayt-aynı. */
async function section11(fx: { itemId: string; stationId: string }, machineId: string) {
  console.log("\n§11 finalize CUT okumaları (kaynak · makine · sunucu token'ı · replay · eski APK)");
  const cuts = (withMeasure: boolean) => [
    { length: 20, qualityGrade: gradeCode, relatedErrorIds: [], ...(withMeasure ? { measure: { source: "MACHINE" as const, rawCounter: 20.4 } } : {}) },
    { length: 30, qualityGrade: gradeCode, relatedErrorIds: [], ...(withMeasure ? { measure: { source: "OPERATOR" as const } } : {}) },
    { length: 40, qualityGrade: gradeCode, relatedErrorIds: [], ...(withMeasure ? { measure: { source: "SIMULATED" as const } } : {}) },
  ];
  const a = await tamburRoll(fx, 90);
  const resA = await tambur.finalize({ rollId: a.rollId, decisions: [], cuts: cuts(true) }, undefined, machineId);
  await trackChildren(a.rollId);
  const kids = await kidsOf(a.rollId);
  const rows = await cutRows(kids.map((k) => k.id));
  const byRoll = new Map(rows.map((r) => [r.rollId, r]));
  check("§11 3 çocuk → 3 CUT okuması", kids.length === 3 && rows.length === 3, `çocuk ${kids.length}, okuma ${rows.length}`);
  const want = ["MACHINE", "OPERATOR", "SIMULATED"];
  check("§11 her okuma kendi çocuğunda, kaynağı gövdedeki measure, metre = çocuğun metresi",
    kids.every((k, i) => byRoll.get(k.id)?.source === want[i] && Number(byRoll.get(k.id)?.meters) === Number(k.initialQty)), JSON.stringify(rows.map((r) => [r.source, r.meters.toString()])));
  check("§11 adım = Tambur adımı, makine = oturum makinesi", rows.every((r) => r.workOrderStepId === a.stepId && r.machineId === machineId));
  check("§11 token SUNUCU üretir (UUID, üçü ayrı), politika alanları NULL",
    rows.every((r) => UUID_RE.test(r.clientToken) && r.basis === null && r.approvalMode === null) && new Set(rows.map((r) => r.clientToken)).size === 3);
  check("§11 rawCounter gövdeden (yalnız verilen kesimde)", Number(byRoll.get(kids[0]!.id)?.rawCounter) === 20.4 && byRoll.get(kids[1]!.id)?.rawCounter === null);
  const replay = await tambur.finalize({ rollId: a.rollId, decisions: [], cuts: cuts(true) }, undefined, machineId);
  check("§11 aynı finalize replay → başarılı, okuma sayısı 3 kalır",
    replay.success && (await prisma.rollMeterReading.count({ where: { rollId: { in: kids.map((k) => k.id) } } })) === 3);
  const b = await tamburRoll(fx, 90);
  const resB = await tambur.finalize({ rollId: b.rollId, decisions: [], cuts: cuts(false) }, undefined, machineId);
  await trackChildren(b.rollId);
  const kidsB = await kidsOf(b.rollId);
  check("§11 measure'sız finalize (eski APK) → okuma 0", kidsB.length === 3 && (await prisma.rollMeterReading.count({ where: { rollId: { in: kidsB.map((k) => k.id) } } })) === 0);
  const shape = (r: typeof resA) => JSON.stringify({ ok: r.success, keys: Object.keys(r.data).sort(), n: r.data.splitRolls.length, p: r.data.processedErrors, msg: r.message, kid: Object.keys(r.data.splitRolls[0] ?? {}).sort() });
  check("§11 yanıt measure'lı/measure'sız bayt-aynı (şekil + mesaj)", shape(resA) === shape(resB), shape(resA) === shape(resB) ? "" : `${shape(resA)} ≠ ${shape(resB)}`);
  return { parentId: a.rollId, stepId: a.stepId, kidIds: kids.map((k) => k.id) };
}

/** §12 geri alma: SINGLE → 1 damga; FULL → kalan damgalar; satır silinmez. */
async function section12(fx: { itemId: string; stationId: string }, machineId: string, cut: { parentId: string; kidIds: string[] }) {
  console.log("\n§12 geri alma CUT okumasını DAMGALAR (ters yol)");
  const [k0, k1, k2] = cut.kidIds as [string, string, string];
  await undo.applyUndo(k0);
  const afterSingle = await cutRows(cut.kidIds);
  const s0 = afterSingle.find((r) => r.rollId === k0);
  check("§12 SINGLE → iptal parçanın okuması damgalı (sebep TAMBUR_UNDO), diğer ikisi aktif",
    !!s0?.revokedAt && s0.revokeReason === "TAMBUR_UNDO" && afterSingle.filter((r) => r.revokedAt === null).length === 2, JSON.stringify(afterSingle.map((r) => r.revokeReason)));
  const t = await tamburRoll(fx, 90);
  await tambur.finalize({
    rollId: t.rollId, decisions: [],
    cuts: [20, 30, 40].map((length) => ({ length, qualityGrade: gradeCode, relatedErrorIds: [], measure: { source: "MACHINE" as const } })),
  }, undefined, machineId);
  await trackChildren(t.rollId);
  const kidsT = (await kidsOf(t.rollId)).map((k) => k.id);
  await undo.applyUndo(t.rollId, undefined, { mode: "FULL", reason: "bekçi D4-B1b §12", permissions: [UNDO_FULL_PERMISSION] });
  const afterFull = await cutRows(kidsT);
  check("§12 FULL → 3 okumanın 3'ü damgalı, satırlar silinmedi",
    afterFull.length === 3 && afterFull.every((r) => r.revokedAt !== null && r.revokeReason === "TAMBUR_UNDO"), JSON.stringify(afterFull.map((r) => r.revokeReason)));
  void k1; void k2;
}

/** §13 cutOpenFabric CUT okuması + açık kumaş / depo kesimi kapanışında kalan sapmasının kaynağı. */
async function section13(fx: { itemId: string; stationId: string }, machineId: string) {
  console.log("\n§13 açık kumaş kesimi + kalan sapması kaynağı (zayıf halka); depo kesimi okumasız");
  await setSetting("tambur.overQuantityEnabled", null);
  const o = await tamburRoll(fx, 100);
  const c1 = await tambur.cutOpenFabric(o.rollId, { lengthMeters: 30, status: "WAREHOUSE", measure: { source: "MACHINE" } }, undefined, machineId);
  const c2 = await tambur.cutOpenFabric(o.rollId, { lengthMeters: 20, status: "WAREHOUSE", measure: { source: "OPERATOR" } }, undefined, machineId);
  createdRolls.push(c1.data.childRoll.id, c2.data.childRoll.id);
  const oRows = await cutRows([c1.data.childRoll.id, c2.data.childRoll.id]);
  check("§13 cutOpenFabric ölçümlü → çocuk başına 1 CUT okuması (Tambur adımı, makine)",
    oRows.length === 2 && oRows.every((r) => r.workOrderStepId === o.stepId && r.machineId === machineId));
  await tambur.finalizeOpenFabric(o.rollId, { remainingAction: "scrap" }, undefined, machineId);
  await trackChildren(o.rollId);
  const vO = await prisma.rollVariance.findFirst({ where: { rollId: o.rollId, source: "TAMBUR_FINALIZE" }, select: { measureSource: true, qty: true } });
  check("§13 finalizeOpenFabric kalan (50 m fire) sapması = MACHINE+OPERATOR zayıf halkası → OPERATOR", vO?.measureSource === "OPERATOR" && Number(vO.qty) === 50, JSON.stringify(vO));
  const p = await tamburRoll(fx, 100);
  const d1 = await tambur.cutOpenFabric(p.rollId, { lengthMeters: 30, status: "WAREHOUSE", measure: { source: "MACHINE" } }, undefined, machineId);
  const d2 = await tambur.cutOpenFabric(p.rollId, { lengthMeters: 20, status: "WAREHOUSE" }, undefined, machineId);
  createdRolls.push(d1.data.childRoll.id, d2.data.childRoll.id);
  await tambur.finalizeOpenFabric(p.rollId, { remainingAction: "scrap" }, undefined, machineId);
  await trackChildren(p.rollId);
  const vP = await prisma.rollVariance.findFirst({ where: { rollId: p.rollId, source: "TAMBUR_FINALIZE" }, select: { measureSource: true } });
  check("§13 kesimlerden biri okumasız (eski APK) → kalan sapması NULL (uydurulmaz)", vP !== null && vP.measureSource === null, JSON.stringify(vP));
  const wh = await warehouseRoll(fx, 100);
  const w1 = await tambur.cutWarehouseRoll(wh, { cutLength: 30, measure: { source: "MACHINE" } }, undefined, null, machineId);
  createdRolls.push(w1.data.childRoll.id);
  check("§13 depo kesimi (adımsız) okuma YAZMAZ", (await prisma.rollMeterReading.count({ where: { rollId: w1.data.childRoll.id } })) === 0);
  await tambur.finalizeWarehouseCut(wh, { remainingAction: "scrap" }, undefined, null, machineId);
  await trackChildren(wh);
  const vW = await prisma.rollVariance.findFirst({ where: { rollId: wh, source: "TAMBUR_WAREHOUSE_FINALIZE" }, select: { measureSource: true } });
  check("§13 finalizeWarehouseCut kalan sapması → NULL (okuma yok)", vW !== null && vW.measureSource === null, JSON.stringify(vW));
}

/**
 * §14 FAZ SÜZGEÇSİZ OKUYUCU ENVANTERİ — `revokeStepMeterReadingsTx` (adım yeniden açılınca faza bakmadan damgalar):
 * kurşun adımı yeniden açılınca CUT varken sonuç bayt-aynı (CUT dokunulmaz); Tambur adımı yeniden açılınca CUT damgalanır (BEKLENEN).
 * (service-pricing `loadReadings` + service-flag-work: `test_senaryo_hizmet_veren` adım 5 — CUT'lı/CUT'suz çözüm bayt-aynı.)
 */
async function section14(fx: { itemId: string; stationId: string }, machineId: string) {
  console.log("\n§14 faz süzgeçsiz okuyucu envanteri — revokeStepMeterReadingsTx");
  const t = await tamburRoll(fx, 50);
  await tambur.finalize({ rollId: t.rollId, decisions: [], cuts: [{ length: 50, qualityGrade: gradeCode, relatedErrorIds: [], measure: { source: "MACHINE" } }] }, undefined, machineId);
  await trackChildren(t.rollId);
  const kid = (await kidsOf(t.rollId))[0]!.id;
  // Aynı topa başka (kurşun benzeri) adımda OUT okuması — ortak boğazdan, politika kopyalı.
  const k = await tamburRoll(fx, 1);
  const out = await prisma.$transaction((tx) => insertMeterReadingTx(tx, { data: {
    rollId: kid, workOrderStepId: k.stepId, phase: "OUT", meters: 49.5, source: "MACHINE", basis: "DECLARED_IN", approvalMode: "NONE", clientToken: randomUUID(),
  } }));
  createdReadings.push(out.id);
  const reopenOther = await prisma.$transaction((tx) => revokeStepMeterReadingsTx(tx, { rollIds: [kid], stepId: k.stepId, userId: null, reason: "KURSUN_REOPEN" }));
  const cutAfter = await cutRows([kid]);
  check("§14 kurşun adımı yeniden açılınca: damgalanan = yalnız o adımın OUT'u (1) — CUT varken sonuç bayt-aynı",
    reopenOther === 1 && cutAfter.length === 1 && cutAfter[0]!.revokedAt === null, `damga ${reopenOther}, CUT aktif ${cutAfter[0]?.revokedAt === null}`);
  const reopenTambur = await prisma.$transaction((tx) => revokeStepMeterReadingsTx(tx, { rollIds: [kid], stepId: t.stepId, userId: null, reason: "MANUAL_MOVE" }));
  const cutReopened = await cutRows([kid]);
  check("§14 BEKLENEN: Tambur adımı yeniden açılınca (geri taşıma) CUT okuması damgalanır",
    reopenTambur === 1 && cutReopened[0]?.revokedAt !== null && cutReopened[0]?.revokeReason === "MANUAL_MOVE", `damga ${reopenTambur}`);
}

const WRITE_METHODS = new Set(["create", "createMany", "createManyAndReturn", "upsert", "update", "updateMany", "delete", "deleteMany"]);
/** §15 İkinci yazar: `*.rollMeterReading.<yazım>` çağrısı ya da ham INSERT/UPDATE/DELETE roll_meter_readings — meter-reading.helper DIŞINDA. */
export function findSecondMeterWriters(root: string): string[] {
  const files: string[] = [];
  walk(join(root, "src"), files);
  const hits: string[] = [];
  for (const file of files) {
    const rel = relative(root, file);
    if (rel === HELPER) continue;
    const text = readFileSync(file, "utf8");
    if (!/rollMeterReading|roll_meter_readings/.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && WRITE_METHODS.has(n.expression.name.text)) {
        const recv = n.expression.expression;
        const recvName = ts.isPropertyAccessExpression(recv) ? recv.name.text : ts.isElementAccessExpression(recv) && ts.isStringLiteral(recv.argumentExpression) ? recv.argumentExpression.text : null;
        if (recvName === "rollMeterReading") hits.push(`${rel}:${line(n)} rollMeterReading.${n.expression.name.text}`);
      }
      if (ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n) || ts.isStringLiteral(n)) {
        if (/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?roll_meter_readings\b/i.test(n.getText(sf))) hits.push(`${rel}:${line(n)} ham SQL yazımı`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return hits;
}
function section15() {
  console.log("\n§15 AST: roll_meter_readings'e yazım yalnız meter-reading.helper'dan");
  const root = join(__dirname, "..");
  const helperText = readFileSync(join(root, HELPER), "utf8");
  check("§15 körlük zemini: boğaz yaratma + damga çağrısını taşıyor", /tx\.rollMeterReading\.create\(/.test(helperText) && /tx\.rollMeterReading\.updateMany\(/.test(helperText));
  const hits = findSecondMeterWriters(root);
  check("§15 src'de ikinci okuma yazarı YOK", hits.length === 0, hits.join(" · "));
}

/** §16 iptal ↔ iptali geri al: CUT damgasının tersi yeni satırdır; SIMULATED kaynak dirilen topta kaybolmaz (K4). */
async function section16(fx: { itemId: string; stationId: string }, machineId: string) {
  console.log("\n§16 iptal → CUT damgası; iptali geri al → okuma yeniden kurulur");
  const inv = new InventoryService();
  const o = await tamburRoll(fx, 100);
  const c = await tambur.cutOpenFabric(o.rollId, { lengthMeters: 25, status: "WAREHOUSE", measure: { source: "SIMULATED", rawCounter: 25.2 } }, undefined, machineId);
  const kid = c.data.childRoll.id;
  createdRolls.push(kid);
  await inv.softDelete(kid, undefined, { confirmActive: true, confirmLabelPrinted: true });
  const afterCancel = await cutRows([kid]);
  check("§16 iptal → CUT okuması damgalı (ROLL_CANCEL), satır silinmedi",
    afterCancel.length === 1 && afterCancel[0]!.revokedAt !== null && afterCancel[0]!.revokeReason === "ROLL_CANCEL", JSON.stringify(afterCancel.map((r) => r.revokeReason)));
  await inv.restoreCancelledRoll(kid, undefined, { reason: "bekçi D4-B1b §16" });
  const afterRestore = await cutRows([kid]);
  const act = afterRestore.filter((r) => r.revokedAt === null);
  const orig = afterCancel[0]!;
  check("§16 iptali geri al → 1 YENİ aktif CUT okuması (kaynak/metre/adım/makine/rawCounter aynı, yeni token), damgalı satır yerinde",
    afterRestore.length === 2 && act.length === 1 && act[0]!.id !== orig.id && act[0]!.source === "SIMULATED" && Number(act[0]!.meters) === 25 &&
      act[0]!.workOrderStepId === orig.workOrderStepId && act[0]!.machineId === machineId && Number(act[0]!.rawCounter) === 25.2 && act[0]!.clientToken !== orig.clientToken &&
      afterRestore.some((r) => r.id === orig.id && r.revokeReason === "ROLL_CANCEL"),
    JSON.stringify(afterRestore.map((r) => [r.source, r.meters.toString(), r.revokeReason])));
  await inv.softDelete(kid, undefined, { confirmActive: true, confirmLabelPrinted: true });
  await inv.restoreCancelledRoll(kid, undefined, {});
  const second = await cutRows([kid]);
  check("§16 ikinci iptal/geri al turu → yine TEK aktif okuma (yalnız SON iptalin damgası kurulur)",
    second.length === 3 && second.filter((r) => r.revokedAt === null).length === 1, `toplam ${second.length}, aktif ${second.filter((r) => r.revokedAt === null).length}`);
  const c2 = await tambur.cutOpenFabric(o.rollId, { lengthMeters: 20, status: "WAREHOUSE" }, undefined, machineId);
  const w = c2.data.childRoll.id;
  createdRolls.push(w);
  await inv.softDelete(w, undefined, { confirmActive: true, confirmLabelPrinted: true });
  await inv.restoreCancelledRoll(w, undefined, {});
  check("§16 okumasız top iptal/geri al → okuma uydurulmaz (0)", (await prisma.rollMeterReading.count({ where: { rollId: w } })) === 0);
}

async function main() {
  console.log("=== D4-B1a Tambur ölçüm kaynağı ===");
  savedSettings = await prisma.systemSetting.findMany({ where: { key: { in: [...KEYS] } }, select: { key: true, value: true, description: true } });
  section1();
  section2();
  section10();
  const fx = await ensureFixtures();
  await section3(fx);
  await sections4to8(fx);
  await section9();
  section15();
  const machineId = await ensureMachine(fx.stationId);
  await setSetting("tambur.simulatedMeterEnabled", null);
  await setSetting("tambur.olcumKaynagiZorunlu", null);
  await setSetting("tambur.overQuantityEnabled", null);
  const cut = await section11(fx, machineId);
  await section12(fx, machineId, cut);
  await section13(fx, machineId);
  await section14(fx, machineId);
  await section16(fx, machineId);
}

function cleanupError(e: unknown) {
  console.error(`   ⚠️ temizlik adımı düştü: ${(e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 200)}`);
}

async function cleanup() {
  for (const k of KEYS) await prisma.systemSetting.deleteMany({ where: { key: k } }).catch(cleanupError);
  for (const s of savedSettings) {
    await prisma.systemSetting.create({ data: { key: s.key, value: s.value as Prisma.InputJsonValue, description: s.description } }).catch(cleanupError);
  }
  if (createdReadings.length) await prisma.rollMeterReading.deleteMany({ where: { id: { in: createdReadings } } }).catch(cleanupError);
  if (createdRolls.length) {
    const cutIds = (await prisma.rollMeterReading.findMany({ where: { rollId: { in: createdRolls } }, select: { id: true } })).map((r) => r.id);
    await prisma.systemLog.deleteMany({ where: { recordId: { in: cutIds } } }).catch(cleanupError);
    await prisma.rollMeterReading.deleteMany({ where: { id: { in: cutIds } } }).catch(cleanupError);
  }
  if (createdRolls.length) {
    await prisma.systemLog.deleteMany({ where: { recordId: { in: createdRolls } } }).catch(cleanupError);
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(cleanupError);
    await prisma.warehouseMovement.deleteMany({ where: { OR: [{ rollId: { in: createdRolls } }, { rollVariance: { rollId: { in: createdRolls } } }] } }).catch(cleanupError);
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(cleanupError);
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(cleanupError);
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(cleanupError);
    await prisma.roll.deleteMany({ where: { id: { in: createdRolls }, parentRollId: { not: null } } }).catch(cleanupError);
    await prisma.roll.deleteMany({ where: { id: { in: createdRolls } } }).catch(cleanupError);
  }
  if (createdSteps.length) {
    await prisma.rollOperation.deleteMany({ where: { workOrderStepId: { in: createdSteps } } }).catch(cleanupError);
    await prisma.workOrderStep.deleteMany({ where: { id: { in: createdSteps } } }).catch(cleanupError);
  }
  if (createdWOs.length) await prisma.workOrder.deleteMany({ where: { id: { in: createdWOs } } }).catch(cleanupError);
  if (createdItemId) await prisma.item.deleteMany({ where: { id: createdItemId } }).catch(cleanupError);
  if (createdMachineId) await prisma.machine.deleteMany({ where: { id: createdMachineId } }).catch(cleanupError);
  if (createdStationId) await prisma.station.deleteMany({ where: { id: createdStationId } }).catch(cleanupError);
  if (createdGradeId) await prisma.qualityGrade.deleteMany({ where: { id: createdGradeId } }).catch(cleanupError);
}

main()
  .catch((e) => {
    console.error("Test hatası:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup().catch(cleanupError);
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  });
