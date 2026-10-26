// =============================================================================
// TEST: KQ-D7 — RollError TEK YAZMA BOĞAZI + önceki adım hataları
// Çalıştır: npx tsx scripts/test_roll_defect_single_gateway.ts
// =============================================================================
// NEDEN: hata satırını üç kopya yazar basıyordu (KK2/Kurşun, Tambur, kurşun
// bitirişi) ve kurallar kayıyordu; artık hepsi `roll-defect.helper.ts`ten geçer.
//   §1 AST: `src/` altında `rollError.create`/`createMany` yalnız helper'da
//   §2 DB: üç yol — mükerrer 409, pasif tip 400, tipsiz → varsayılan, muayene kapalı 400
//   §3 DB: Kurşun(muayene açık)→KK: Kurşun'da açılan hata KK özetinde `priorDefects`te,
//          KK'nin kendi listesinde değil; kart `openErrorCount` doğru
//   §4 DB: muayene kapalı TAMBUR'da yazma 400; karar (NO_CUT) ve yetim kapatma çalışır
// Çalışıyor mu (negatif sonda, bir kezlik, geri alındı — 27/0 taban):
//   (b) kursun-qc'ye ikinci `rollError.create` → §1 ❌ (26/1)
//   (c) priorDefects süzgecinde `detectedAtStepId` ters → §3 ❌ (24/3)
//   (a) helper kalite kapısı `kind === TAMBUR`a → test_station_quality_capability §4b+§11 ❌ (52/2)
// Gerekli mi: EVET, ölçüldü — doğduğu gün `kursunFinish` mükerrer hatada kodsuz ham P2002
//   fırlatıyordu ve kalite kapısı üç yerde ayrı kopyaydı (§2 kursunFinish satırları).
// =============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";
import { RollForm, RollStatus, StationKind, StepStatus, TravelerCardStatus, WorkOrderStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { TamburService } from "../src/services/tambur.service";
import { InventoryService } from "../src/services/inventory.service";
import { roleGrade } from "./fixture-quality-grade";
import { testActorId } from "./fixture-test-user";
import { findDefaultDefectType } from "../src/services/helpers/default-defect-type.helper";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
async function caught(fn: () => Promise<unknown>): Promise<AppError | Error | null> {
  try { await fn(); return null; } catch (e) { return e as Error; }
}
const status = (e: unknown): number | null => (e instanceof AppError ? e.statusCode : null);
const code = (e: unknown): unknown => (e instanceof AppError ? e.details?.code : undefined);

// ── §1 AST ─────────────────────────────────────────────────────────────────
const SRC = join(__dirname, "..", "src");
const GATEWAY = "services/helpers/roll-defect.helper.ts";
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}
function section1(): void {
  console.log("\n§1 AST — rollError.create/createMany yalnız tek boğazda");
  const hits: string[] = [];
  for (const f of walk(SRC)) {
    const text = readFileSync(f, "utf8");
    if (!text.includes("rollError")) continue;
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node): void => {
      if (ts.isPropertyAccessExpression(n) && ["create", "createMany", "createManyAndReturn", "upsert"].includes(n.name.text)) {
        const target = n.expression;
        const name = ts.isPropertyAccessExpression(target) ? target.name.text : ts.isIdentifier(target) ? target.text : "";
        if (name === "rollError") hits.push(`${relative(SRC, f)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  const outside = hits.filter((h) => !h.startsWith(`${GATEWAY}:`));
  check("§1 zemin: boğazda yazım bulundu (tarayıcı canlı)", hits.length - outside.length >= 3, `${hits.length - outside.length} çağrı`);
  check("§1 ⭐ boğaz DIŞINDA rollError yazımı YOK", outside.length === 0, outside.join(" · ") || "0 ihlal");
}

// ── Fikstür ────────────────────────────────────────────────────────────────
const STAMP = `${process.pid}${Date.now().toString().slice(-5)}`;
const created = { stations: [] as string[], wos: [] as string[], rolls: [] as string[], defectTypes: [] as string[] };
let ITEM = "", ADMIN = "", GRADE_CODE = "", DEFECT = "", DEFAULT_TYPE = "", PASSIVE = "";
let restoreDefault: string | null = null;
let stationSeq = 0;
let woSeq = 0;

async function makeStation(kind: StationKind, inspectionEnabled: boolean, name: string): Promise<string> {
  const st = await prisma.station.create({
    data: {
      code: `TEST-RDG-${++stationSeq}-${STAMP}`.slice(0, 32), name: `${name} ${STAMP}`, type: "INTERNAL", kind,
      department: "KALITE", appliesQuality: kind !== StationKind.TAMBUR, inspectionEnabled, // akış adımı: Tambur dışındaki fikstür istasyonları
    },
    select: { id: true },
  });
  created.stations.push(st.id);
  return st.id;
}

async function makeWo(stationIds: string[]): Promise<{ woId: string; steps: string[] }> {
  const number = `TEST-RDG-${STAMP}-${++woSeq}`;
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: number, type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS, targetItemId: ITEM,
      steps: { create: stationIds.map((stationId, i) => ({ stationId, stepSequence: i + 1, status: i === 0 ? StepStatus.ACTIVE : StepStatus.PENDING })) },
    },
    select: { id: true, steps: { select: { id: true, stepSequence: true }, orderBy: { stepSequence: "asc" } } },
  });
  created.wos.push(wo.id);
  await prisma.travelerCard.create({ data: { cardNumber: number, barcode: number, workOrderId: wo.id, status: TravelerCardStatus.ACTIVE } });
  return { woId: wo.id, steps: wo.steps.map((s) => s.id) };
}

async function makeRoll(stepId: string, openFabric = false): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      // kursunFinish yalnız açık kumaşta (barkodsuz) çalışır.
      barcode: openFabric ? null : `TEST-RDG-R-${STAMP}-${created.rolls.length}`, itemId: ITEM, initialQty: 100, currentQty: 100,
      status: RollStatus.IN_PRODUCTION, currentStepId: stepId, entrySource: "SUBCONTRACTOR_RETURN", form: RollForm.ACIK,
      qualityGrade: GRADE_CODE,
    },
    select: { id: true },
  });
  created.rolls.push(r.id);
  await prisma.rollMovement.create({ data: { rollId: r.id, workOrderStepId: stepId, qtyIn: 100 } });
  return r.id;
}

async function moveRoll(rollId: string, from: string, to: string): Promise<void> {
  await prisma.rollMovement.updateMany({ where: { rollId, workOrderStepId: from, exitedAt: null }, data: { exitedAt: new Date(), qtyOut: 100 } });
  await prisma.roll.update({ where: { id: rollId }, data: { currentStepId: to } });
  await prisma.rollMovement.create({ data: { rollId, workOrderStepId: to, qtyIn: 100 } });
}

async function setup(): Promise<void> {
  // Fikstür iş anahtarıyla (kalem kodu, test aktörü); hata tipleri bekçinin kendisinin.
  ITEM = (await prisma.item.findUniqueOrThrow({ where: { code: "PATOS" }, select: { id: true } })).id;
  ADMIN = await testActorId();
  GRADE_CODE = (await roleGrade("FIRST")).code;
  const mk = async (suffix: string, isActive: boolean): Promise<string> => {
    const t = await prisma.defectType.create({ data: { code: `TRDG${suffix}${STAMP}`.slice(0, 32), name: `TEST ${suffix} ${STAMP}`, isActive }, select: { id: true } });
    created.defectTypes.push(t.id);
    return t.id;
  };
  DEFECT = await mk("A", true);
  PASSIVE = await mk("P", false);
  // Varsayılan katalogdan (helper'ın kendi okuması); yoksa bekçinin tipi geçici varsayılan olur.
  const def = await findDefaultDefectType(prisma);
  if (def) DEFAULT_TYPE = def.id;
  else {
    DEFAULT_TYPE = await mk("D", true);
    await prisma.defectType.update({ where: { id: DEFAULT_TYPE }, data: { isDefault: true } });
    restoreDefault = DEFAULT_TYPE;
  }
}

const kq = new KursunQcService();
const tambur = new TamburService();
const inventory = new InventoryService();

// ── §2 ─────────────────────────────────────────────────────────────────────
async function section2(): Promise<void> {
  console.log("\n§2 DB — üç yol aynı kurallar");
  const qcOn = await makeStation(StationKind.PROCESS_QC, true, "TEST KK açık");
  const qcOff = await makeStation(StationKind.PROCESS_QC, false, "TEST kurşun kapalı");
  const tbOn = await makeStation(StationKind.TAMBUR, true, "TEST Tambur açık");
  const tbOff = await makeStation(StationKind.TAMBUR, false, "TEST Tambur kapalı");

  // KK2 (FLOW)
  const a = await makeWo([qcOn, tbOn]);
  const ra = await makeRoll(a.steps[0]);
  await kq.reportError({ rollId: ra, stepId: a.steps[0], startMeter: 10, defectTypeId: DEFECT }, ADMIN);
  const kDup = await caught(() => kq.reportError({ rollId: ra, stepId: a.steps[0], startMeter: 10, defectTypeId: DEFECT }, ADMIN));
  check("KK2 mükerrer → 409 DUPLICATE_ROLL_ERROR", status(kDup) === 409 && code(kDup) === "DUPLICATE_ROLL_ERROR", kDup?.message);
  const kPas = await caught(() => kq.reportError({ rollId: ra, stepId: a.steps[0], startMeter: 11, defectTypeId: PASSIVE }, ADMIN));
  check("KK2 pasif tip → 400", code(kPas) === "DEFECT_TYPE_INACTIVE", kPas?.message);
  const kDef = await kq.reportError({ rollId: ra, stepId: a.steps[0], startMeter: 12, defectTypeId: null as unknown as string }, ADMIN);
  check("KK2 tipsiz → varsayılan tip", kDef.data?.defectTypeId === DEFAULT_TYPE);
  const b = await makeWo([qcOff, tbOn]);
  const rb = await makeRoll(b.steps[0]);
  const kOff = await caught(() => kq.reportError({ rollId: rb, stepId: b.steps[0], startMeter: 10, defectTypeId: DEFECT }, ADMIN));
  check("KK2 muayene kapalı istasyon → 400", code(kOff) === "QUALITY_STEP_ERROR", kOff?.message);

  // TAMBUR
  const c = await makeWo([tbOn]);
  const rc = await makeRoll(c.steps[0]);
  await tambur.reportError({ rollId: rc, stepId: c.steps[0], startMeter: 10, defectTypeId: DEFECT }, ADMIN);
  const tDup = await caught(() => tambur.reportError({ rollId: rc, stepId: c.steps[0], startMeter: 10, defectTypeId: DEFECT }, ADMIN));
  check("Tambur mükerrer → 409 DUPLICATE_ROLL_ERROR", status(tDup) === 409 && code(tDup) === "DUPLICATE_ROLL_ERROR", tDup?.message);
  const tPas = await caught(() => tambur.reportError({ rollId: rc, stepId: c.steps[0], startMeter: 11, defectTypeId: PASSIVE }, ADMIN));
  check("Tambur pasif tip → 400", code(tPas) === "DEFECT_TYPE_INACTIVE", tPas?.message);
  const tDef = await tambur.reportError({ rollId: rc, stepId: c.steps[0], startMeter: 12, defectTypeId: null as unknown as string }, ADMIN);
  check("Tambur tipsiz → varsayılan tip", tDef.data?.defectTypeId === DEFAULT_TYPE);
  const d = await makeWo([tbOff]);
  const rd = await makeRoll(d.steps[0]);
  const tOff = await caught(() => tambur.reportError({ rollId: rd, stepId: d.steps[0], startMeter: 10, defectTypeId: DEFECT }, ADMIN));
  check("Tambur muayene kapalı istasyon → 400", code(tOff) === "QUALITY_STEP_ERROR", tOff?.message);

  // kursunFinish (toplu)
  const e = await makeWo([qcOn, tbOn]);
  const re1 = await makeRoll(e.steps[0], true);
  await kq.reportError({ rollId: re1, stepId: e.steps[0], startMeter: 30, defectTypeId: DEFECT }, ADMIN);
  const fDup = await caught(() => inventory.kursunFinish(re1, { errors: [{ startMeter: 30, defectTypeId: DEFECT }] }, ADMIN));
  check("kursunFinish mükerrer (DB) → 409 DUPLICATE_ROLL_ERROR", status(fDup) === 409 && code(fDup) === "DUPLICATE_ROLL_ERROR", fDup?.message);
  const fDup2 = await caught(() => inventory.kursunFinish(re1, { errors: [{ startMeter: 40, defectTypeId: DEFECT }, { startMeter: 40, defectTypeId: DEFECT }] }, ADMIN));
  check("kursunFinish mükerrer (aynı gövde) → 409", status(fDup2) === 409 && code(fDup2) === "DUPLICATE_ROLL_ERROR", fDup2?.message);
  const fPas = await caught(() => inventory.kursunFinish(re1, { errors: [{ startMeter: 41, defectTypeId: PASSIVE }] }, ADMIN));
  check("kursunFinish pasif tip → 400", code(fPas) === "DEFECT_TYPE_INACTIVE", fPas?.message);
  const fOk = await caught(() => inventory.kursunFinish(re1, { errors: [{ startMeter: 42, defectTypeId: null }] }, ADMIN));
  const defRow = await prisma.rollError.findFirst({ where: { rollId: re1, startMeter: 42 }, select: { defectTypeId: true, errorType: true } });
  check("kursunFinish tipsiz → varsayılan tip + ad snapshot", fOk === null && defRow?.defectTypeId === DEFAULT_TYPE && !!defRow?.errorType, fOk?.message);
  const f = await makeWo([qcOff, tbOn]);
  const rf = await makeRoll(f.steps[0], true);
  const fOff = await caught(() => inventory.kursunFinish(rf, { errors: [{ startMeter: 10, defectTypeId: DEFECT }] }, ADMIN));
  check("kursunFinish muayene kapalı istasyon (hata listesiyle) → 400", code(fOff) === "QUALITY_STEP_ERROR", fOff?.message);
  const fOffEmpty = await caught(() => inventory.kursunFinish(rf, {}, ADMIN));
  check("kursunFinish muayene kapalı + boş liste → bugünkü gibi geçer", fOffEmpty === null, fOffEmpty?.message);
}

// ── §3 ─────────────────────────────────────────────────────────────────────
async function section3(): Promise<void> {
  console.log("\n§3 DB — önceki adım hataları (Kurşun → KK)");
  const kursun = await makeStation(StationKind.PROCESS_QC, true, "TEST Kurşun");
  const kk = await makeStation(StationKind.PROCESS_QC, true, "TEST KK Masa");
  const w = await makeWo([kursun, kk]);
  const r1 = await makeRoll(w.steps[0]);
  const r2 = await makeRoll(w.steps[0]);
  await kq.reportError({ rollId: r1, stepId: w.steps[0], startMeter: 5, defectTypeId: DEFECT }, ADMIN);
  await kq.reportError({ rollId: r1, stepId: w.steps[0], startMeter: 15, defectTypeId: DEFECT }, ADMIN);
  await kq.reportError({ rollId: r2, stepId: w.steps[0], startMeter: 7, defectTypeId: DEFECT }, ADMIN);
  await moveRoll(r1, w.steps[0], w.steps[1]);
  await moveRoll(r2, w.steps[0], w.steps[1]);
  await kq.reportError({ rollId: r1, stepId: w.steps[1], startMeter: 50, defectTypeId: DEFECT }, ADMIN);

  const sum = (await kq.getStep(w.steps[1])).data!;
  const s1 = sum.rolls.find((r) => r.rollId === r1)!;
  const s2 = sum.rolls.find((r) => r.rollId === r2)!;
  check("§3 ⭐ Kurşun'da açılan hatalar KK özetinde priorDefects'te", s1.priorDefects.length === 2 && s1.priorDefects.every((p) => p.startMeter === 5 || p.startMeter === 15), JSON.stringify(s1.priorDefects.map((p) => p.startMeter)));
  check("§3 ⭐ KK'nin kendi listesinde (defects) yalnız KK hatası", s1.defects.length === 1 && s1.defects[0].startMeter === 50, JSON.stringify(s1.defects.map((p) => p.startMeter)));
  check("§3 priorOpenErrorCount = 2 / 1", s1.priorOpenErrorCount === 2 && s2.priorOpenErrorCount === 1);
  check("§3 künye: istasyon + kişi + saat", s1.priorDefects[0].detectedStationName?.startsWith("TEST Kurşun") === true && !!s1.priorDefects[0].detectedByName && s1.priorDefects[0].detectedAt instanceof Date);

  // Karara bağlanmış hata önceki listeden düşer (açık olan gösterilir).
  await prisma.rollError.updateMany({ where: { rollId: r2, startMeter: 7 }, data: { isProcessed: true, actionTaken: "NO_CUT", processedAt: new Date() } });
  const sum2 = (await kq.getStep(w.steps[1])).data!;
  check("§3 kapanmış hata priorDefects'te YOK", sum2.rolls.find((r) => r.rollId === r2)!.priorDefects.length === 0);

  const cards = (await kq.listOpenCards(kk)).data ?? [];
  const card = cards.find((c) => c.stepId === w.steps[1]);
  check("§3 ⭐ kart openErrorCount = açık topların açık hata toplamı (3)", card?.openErrorCount === 3, String(card?.openErrorCount));
}

// ── §4 ─────────────────────────────────────────────────────────────────────
async function section4(): Promise<void> {
  console.log("\n§4 DB — muayene kapalı TAMBUR: yazma yok, karar var");
  const tbOff = await makeStation(StationKind.TAMBUR, false, "TEST Tambur muayenesiz");
  const w = await makeWo([tbOff]);
  const r = await makeRoll(w.steps[0]);
  const wr = await caught(() => tambur.reportError({ rollId: r, stepId: w.steps[0], startMeter: 20, defectTypeId: DEFECT }, ADMIN));
  check("§4 muayene kapalı Tambur'da hata yazma → 400", code(wr) === "QUALITY_STEP_ERROR", wr?.message);
  // Önceki adımdan gelmiş açık hatalar (fikstür: doğrudan satır — tek boğaz yalnız src/ için).
  const e1 = await prisma.rollError.create({ data: { rollId: r, startMeter: 20, defectTypeId: DEFECT, errorType: "TEST" } });
  const e2 = await prisma.rollError.create({ data: { rollId: r, startMeter: 60, defectTypeId: DEFECT, errorType: "TEST" } });
  const step = (await tambur.getStep(w.steps[0])).data!;
  check("§4 özet inspectionEnabled=false", step.inspectionEnabled === false);
  check("§4 rehber açık hataları gösterir", step.rolls[0]?.errors.length === 2);
  const fin = await caught(() => tambur.finalize({
    rollId: r, decisions: [{ errorId: e1.id, decision: "NO_CUT" }], cuts: [{ length: 100, qualityGrade: GRADE_CODE, relatedErrorIds: [] }],
  } as Parameters<TamburService["finalize"]>[0], ADMIN));
  check("§4 karar (NO_CUT) muayene kapalıyken çalışır", fin === null, fin?.message);
  const after = await prisma.rollError.findMany({ where: { id: { in: [e1.id, e2.id] } }, select: { id: true, isProcessed: true } });
  check("§4 kararlı + yetim hata kapandı (closeOrphanRollErrors)", after.length === 2 && after.every((x) => x.isProcessed), JSON.stringify(after));
}

async function cleanup(): Promise<void> {
  const kids = await prisma.roll.findMany({ where: { parentRollId: { in: created.rolls } }, select: { id: true } });
  const all = [...created.rolls, ...kids.map((k) => k.id)];
  const steps = (await prisma.workOrderStep.findMany({ where: { workOrderId: { in: created.wos } }, select: { id: true } })).map((s) => s.id);
  const del = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    try { await fn(); } catch (e) { console.error(`cleanup ${label}:`, e instanceof Error ? e.message.split("\n").pop() : e); }
  };
  await del("rollError", () => prisma.rollError.deleteMany({ where: { rollId: { in: all } } }));
  await del("rollVariance", () => prisma.rollVariance.deleteMany({ where: { rollId: { in: all } } }));
  await del("rollOperation", () => prisma.rollOperation.deleteMany({ where: { rollId: { in: all } } }));
  await del("rollMovement", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: all } } }));
  await del("rollProperty", () => prisma.rollProperty.deleteMany({ where: { rollId: { in: all } } }));
  await del("warehouseMovement", () => prisma.warehouseMovement.deleteMany({ where: { rollId: { in: all } } }));
  await del("systemLog", () => prisma.systemLog.deleteMany({ where: { recordId: { in: [...all, ...created.wos] } } }));
  await del("roll(kids)", () => prisma.roll.deleteMany({ where: { id: { in: kids.map((k) => k.id) } } }));
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: created.rolls } } }));
  await del("travelerCard", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: created.wos } } }));
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { id: { in: steps } } }));
  await del("wo", () => prisma.workOrder.deleteMany({ where: { id: { in: created.wos } } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: created.stations } } }));
  if (restoreDefault) await del("default", () => prisma.defectType.update({ where: { id: restoreDefault! }, data: { isDefault: false } }));
  await del("defectType", () => prisma.defectType.deleteMany({ where: { id: { in: created.defectTypes } } }));
}

async function main(): Promise<void> {
  section1();
  await setup();
  try {
    await section2();
    await section3();
    await section4();
  } finally {
    await cleanup();
    console.log("(test verisi temizlendi)");
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
