// =============================================================================
// Test: RollError KARAR KAPSAMI — gerçek DB (K4P-KAPSAM, 2026-10-25)
// Çalıştır: npx tsx scripts/test_roll_error_kapsam_db.ts
// =============================================================================
// NEDEN: AST bekçisi (`test_roll_error_kapsam`) helper'a BAŞVURULDUĞUNU ölçer;
// bu bekçi başvurunun DAVRANIŞI değiştirdiğini ölçer. Muayene yazarı henüz yok
// (MOTOR dilimi), INSPECTION satırı + aktif `RollInspection` doğrudan yazılır.
//
//   §1 Dashboard bekleyen/bugün sayısı INSPECTION satırıyla değişmez
//   §2 Tambur karar ekranı + envanter top detayı yalnız PROCESS döner
//   §3 `deleteError` INSPECTION satırına 400 `INSPECTION_ERROR_IMMUTABLE`, satır yerinde
//   §4 Bypass uygunluğu: yalnız INSPECTION olan adım "hata açılmış" sayılmaz
//   §5 Kurşun adım özeti varsayılan PROCESS; `includeInspection` iki kökeni + `origin` döner
//   §6 Tambur depo kesimi kapanışı (`closeOrphanRollErrors`) INSPECTION satırına
//      dokunmaz, CHECK patlamaz; PROCESS satırı NO_CUT kapanır
//
// Negatif sonda (2026-10-25): `closeOrphanRollErrors` findMany'sinden helper
// kaldırıldı → §6 kırmızı (CHECK `roll_errors_inspection_ck` 23514); geri alındı.
// Kendi fikstürünü kurar (TEST-K4PK- damgası) ve `finally`de söker.
// =============================================================================
import { Prisma, RollErrorOrigin, RollStatus, RollEntrySource } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { DashboardService } from "../src/services/dashboard.service";
import { TamburService } from "../src/services/tambur.service";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { InventoryService } from "../src/services/inventory.service";
import { loadBypassEligibilitySignals } from "../src/services/helpers/kursun-bypass-eligibility.helper";
import { AppError } from "../src/utils/app-error";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

/** Servis dönüş tipi `Roll` include'u taşımaz; `errors` çalışma zamanında daraltılır (tip zorlaması yok). */
function errorIdsOf(v: unknown): string[] {
  if (typeof v !== "object" || v === null || !("errors" in v) || !Array.isArray(v.errors)) return [];
  return v.errors.flatMap((e: unknown) =>
    typeof e === "object" && e !== null && "id" in e && typeof e.id === "string" ? [e.id] : []);
}

interface Fikstur {
  itemId: string; stationId: string; woId: string; stepId: string;
  rollA: string; rollB: string; inspA: string; inspB: string;
  errAProcess: string; errAInspection: string; errBProcess: string; errBInspection: string;
}

async function fiksturKur(damga: string, f: Partial<Fikstur>): Promise<void> {
  const inspectorId = await testActorId();
  const item = await prisma.item.create({
    data: { code: `TEST-K4PK-${damga}`, name: `TEST K4P kapsam ${damga}`, itemType: "FABRIC" },
    select: { id: true },
  });
  f.itemId = item.id;
  const station = await prisma.station.create({
    data: { code: `TEST-K4PK-${damga}`, name: `TEST KK ${damga}`, type: "INTERNAL", kind: "PROCESS_QC" },
    select: { id: true },
  });
  f.stationId = station.id;
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `TEST-K4PK-${damga}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: item.id },
    select: { id: true },
  });
  f.woId = wo.id;
  const step = await prisma.workOrderStep.create({
    data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1 },
    select: { id: true },
  });
  f.stepId = step.id;
  // A: ham depo topu (barkodlu, renksiz) — Tambur depo kesimi + karar ekranı + detay.
  const rollA = await prisma.roll.create({
    data: {
      itemId: item.id, barcode: `TEST-K4PK-A-${damga}`, width: 150, initialQty: 100, currentQty: 100,
      status: RollStatus.STOCK, entrySource: RollEntrySource.SUPPLIER_RECEIPT,
    },
    select: { id: true },
  });
  f.rollA = rollA.id;
  // B: KK adımında açık hareketli top — kurşun adım özeti + bypass uygunluğu.
  const rollB = await prisma.roll.create({
    data: { itemId: item.id, barcode: `TEST-K4PK-B-${damga}`, initialQty: 50, currentQty: 50, status: "IN_PRODUCTION", currentStepId: step.id },
    select: { id: true },
  });
  f.rollB = rollB.id;
  await prisma.rollMovement.create({ data: { rollId: rollB.id, workOrderStepId: step.id, qtyIn: 50 } });

  const inspection = (rollId: string) => prisma.rollInspection.create({
    data: {
      rollId, phase: "RAW", inspectedLengthM: 100, widthCm: 150, widthSource: "ITEM_CARD",
      totalPoints: 2, defectCount: 1, unplacedDefectCount: 1, ruleSnapshot: {}, inspectedById: inspectorId,
    },
    select: { id: true },
  });
  f.inspA = (await inspection(rollA.id)).id;
  f.inspB = (await inspection(rollB.id)).id;
  // PROCESS satırları INSPECTION'dan ÖNCE: §1 farkı yalnız muayene satırlarını ölçsün.
  f.errAProcess = (await prisma.rollError.create({
    data: { rollId: rollA.id, startMeter: 10, errorType: "TEST" }, select: { id: true },
  })).id;
  f.errBProcess = (await prisma.rollError.create({
    data: { rollId: rollB.id, startMeter: 5, errorType: "TEST", detectedAtStepId: step.id }, select: { id: true },
  })).id;
}

async function muayeneSatirlari(f: Partial<Fikstur>): Promise<void> {
  const row = (rollId: string, inspectionId: string, stepId: string | null) => prisma.rollError.create({
    data: {
      rollId, origin: RollErrorOrigin.INSPECTION, startMeter: null, points: 2, sizeClass: "UP_TO_3IN",
      inspectionId, errorType: "TEST-MUAYENE", detectedAtStepId: stepId,
    },
    select: { id: true },
  });
  f.errAInspection = (await row(f.rollA!, f.inspA!, null)).id;
  f.errBInspection = (await row(f.rollB!, f.inspB!, f.stepId!)).id;
}

async function temizle(f: Partial<Fikstur>): Promise<void> {
  const rollIds = [f.rollA, f.rollB].filter((x): x is string => !!x);
  const children = rollIds.length
    ? (await prisma.roll.findMany({ where: { parentRollId: { in: rollIds } }, select: { id: true } })).map((r) => r.id)
    : [];
  const all = [...children, ...rollIds];
  const adimlar: Array<[string, () => Promise<unknown>]> = [
    ["rollError", () => prisma.rollError.deleteMany({ where: { rollId: { in: all } } })],
    ["rollInspection", () => prisma.rollInspection.deleteMany({ where: { rollId: { in: all } } })],
    ["systemLog", () => prisma.systemLog.deleteMany({ where: { recordId: { in: all } } })],
    ["rollVariance", () => prisma.rollVariance.deleteMany({ where: { rollId: { in: all } } })],
    ["rollOperation", () => prisma.rollOperation.deleteMany({ where: { rollId: { in: all } } })],
    ["rollMovement", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: all } } })],
    ["child", () => prisma.roll.deleteMany({ where: { id: { in: children } } })],
    ["roll", () => prisma.roll.deleteMany({ where: { id: { in: rollIds } } })],
    ["workOrderStep", () => (f.stepId ? prisma.workOrderStep.deleteMany({ where: { id: f.stepId } }) : Promise.resolve())],
    ["workOrder", () => (f.woId ? prisma.workOrder.deleteMany({ where: { id: f.woId } }) : Promise.resolve())],
    ["station", () => (f.stationId ? prisma.station.deleteMany({ where: { id: f.stationId } }) : Promise.resolve())],
    ["item", () => (f.itemId ? prisma.item.deleteMany({ where: { id: f.itemId } }) : Promise.resolve())],
  ];
  for (const [ad, sil] of adimlar) {
    try { await sil(); } catch (e) { console.log(`   ⚠️ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  }
}

async function main(): Promise<void> {
  console.log("=== RollError karar kapsamı (DB) ===\n");
  const damga = `${Date.now()}`;
  const f: Partial<Fikstur> = {};
  try {
    await fiksturKur(damga, f);

    console.log("── §1 Dashboard ──");
    const before = await DashboardService.getDefectsSummary();
    await muayeneSatirlari(f);
    const after = await DashboardService.getDefectsSummary();
    check("§1 bekleyen sayısı muayene satırıyla değişmez", after.openCount === before.openCount, `${before.openCount} → ${after.openCount}`);
    check("§1 bugün açılan sayısı muayene satırıyla değişmez", after.todayCount === before.todayCount, `${before.todayCount} → ${after.todayCount}`);

    console.log("\n── §2 Tambur karar ekranı + top detayı ──");
    const tambur = new TamburService();
    const decision = await tambur.getRollForDecision(f.rollA!);
    const decIds = errorIdsOf(decision.data);
    check("§2 karar ekranı PROCESS hatasını gösterir", decIds.includes(f.errAProcess!));
    check("§2 karar ekranı muayene hatasını göstermez", !decIds.includes(f.errAInspection!), decIds.join(","));
    const detail = await new InventoryService().findRollById(f.rollA!);
    const detIds = errorIdsOf(detail.data);
    check("§2 envanter top detayı yalnız PROCESS", detIds.length === 1 && detIds[0] === f.errAProcess, detIds.join(","));

    console.log("\n── §3 deleteError ──");
    const kursun = new KursunQcService();
    let code: string | undefined;
    let status: number | undefined;
    try {
      await kursun.deleteError({ errorId: f.errAInspection! });
    } catch (e) {
      if (e instanceof AppError) { status = e.statusCode; code = (e.details as { code?: string } | undefined)?.code; }
      else throw e;
    }
    check("§3 muayene hatası silinmek istenince 400 INSPECTION_ERROR_IMMUTABLE", status === 400 && code === "INSPECTION_ERROR_IMMUTABLE", `${status} ${code}`);
    const still = await prisma.rollError.count({ where: { id: f.errAInspection! } });
    check("§3 muayene satırı yerinde", still === 1);

    console.log("\n── §4 Bypass uygunluğu ──");
    // B'nin PROCESS satırı geçici olarak adımdan ayrılır: adımda yalnız muayene satırı kalsın.
    await prisma.rollError.update({ where: { id: f.errBProcess! }, data: { detectedAtStepId: null } });
    const sig = await loadBypassEligibilitySignals(prisma, [f.stepId!]);
    check("§4 yalnız muayene satırı olan adım 'hata açılmış' sayılmaz", !sig.errorSteps.has(f.stepId!));
    await prisma.rollError.update({ where: { id: f.errBProcess! }, data: { detectedAtStepId: f.stepId! } });
    const sig2 = await loadBypassEligibilitySignals(prisma, [f.stepId!]);
    check("§4 (kontrol) PROCESS satırı adımı 'hata açılmış' yapar", sig2.errorSteps.has(f.stepId!));

    console.log("\n── §5 Kurşun adım özeti ──");
    type Defect = { id: string; startMeter: number | null; origin?: RollErrorOrigin };
    const defectsOf = (r: Awaited<ReturnType<KursunQcService["getStep"]>>): Defect[] =>
      (r.data.rolls.find((x) => x.rollId === f.rollB)?.defects ?? []) as Defect[];
    const plain = defectsOf(await kursun.getStep(f.stepId!));
    check("§5 varsayılan özet yalnız PROCESS", plain.length === 1 && plain[0].id === f.errBProcess, plain.map((d) => d.id).join(","));
    check("§5 varsayılan özet `origin` alanı taşımaz (eski yanıt bayt-eşit)", plain.every((d) => !("origin" in d)));
    const full = defectsOf(await kursun.getStep(f.stepId!, { includeInspection: true }));
    const insp = full.find((d) => d.id === f.errBInspection);
    check("§5 includeInspection iki kökeni döner", full.length === 2 && !!insp, full.map((d) => d.id).join(","));
    check("§5 muayene satırı metresiz ve origin=INSPECTION", insp?.startMeter === null && insp?.origin === RollErrorOrigin.INSPECTION);

    console.log("\n── §6 Tambur depo kesimi kapanışı ──");
    let finalizeErr: unknown = null;
    try {
      await tambur.finalizeWarehouseCut(f.rollA!, { remainingAction: "discard" });
    } catch (e) { finalizeErr = e; }
    const msg = finalizeErr instanceof Prisma.PrismaClientKnownRequestError || finalizeErr instanceof Error
      ? (finalizeErr as Error).message.split("\n").slice(-1)[0] : String(finalizeErr);
    check("§6 finalizeWarehouseCut muayene satırlı topta patlamaz", finalizeErr === null, finalizeErr ? msg : "");
    const [pRow, iRow] = await Promise.all([
      prisma.rollError.findUnique({ where: { id: f.errAProcess! }, select: { isProcessed: true, actionTaken: true } }),
      prisma.rollError.findUnique({ where: { id: f.errAInspection! }, select: { isProcessed: true, actionTaken: true } }),
    ]);
    check("§6 PROCESS satırı NO_CUT kapandı", pRow?.isProcessed === true && pRow.actionTaken === "NO_CUT", JSON.stringify(pRow));
    check("§6 muayene satırına dokunulmadı", iRow?.isProcessed === false && iRow.actionTaken === null, JSON.stringify(iRow));
  } finally {
    await temizle(f);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
