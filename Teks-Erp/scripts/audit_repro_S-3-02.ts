// =============================================================================
// AUDIT REPRO — S-3-02: İş emri kapanış PHANTOM'u.
// `tambur.finalize` (son top) iş emri satırını `touchWorkOrderTx` ile kilitler;
// `tambur-undo` (applyFull / applySingleRestore) AYNI iş emrinin adımına canlı
// top GERİ KOYAR ama o satırı HİÇ kilitlemez. İkisi çakışırsa kapanış sayımı
// (`completeWorkOrderIfStepsDone`) geri konan topu GÖREMEZ → iş emri COMPLETED
// olur, refakat kartı COMPLETED'a döner, ama adımda canlı top + AÇIK hareket kalır.
//
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER (aşağıdaki guard).
//
// Beklenen (sağlıklı sistem): iki eşzamanlı işlemden sonra AŞAĞIDAKİLERDEN
//   HİÇBİRİ doğru olamaz:
//     • WO.status = COMPLETED iken adımda IN_PRODUCTION top var
//     • WO.status = COMPLETED iken adımda exitedAt=null hareket var
//     • WO.status = COMPLETED iken adım COMPLETED/SKIPPED değil
//   (Sıralı koşumda hiçbiri oluşmaz: undo önce koşarsa kapanış sayımı topu görür,
//    finalize önce koşarsa undo `updateMany WHERE status=COMPLETED` ile WO'yu
//    yeniden açar. Bozulan tek şey ARADAKİ sıradır.)
//
// Gözlenen: <çalıştırınca doldur — log audit/repro/S-3-02.log>
//
// KANIT NOKTALARI (kod):
//   • tambur.service.ts:931          → finalize tx'in İLK ifadesi touchWorkOrderTx
//   • roll-step.helper.ts:188-191    → helper docstring: "Çağıran tx başında
//                                       touchWorkOrderTx ile WO'yu write-kilitlemeli"
//   • tambur-undo.service.ts:1221    → applySingleRestore tx: kilit YOK
//   • tambur-undo.service.ts:1434    → applyFull tx: kilit YOK
//   • tambur-undo.service.ts:1668-72 → recompute + "WHERE status=COMPLETED" ile
//                                       geç dirilme denemesi (kaybeden sıra)
//
// Çalıştır:
//   cd Teks-Erp && npx tsx scripts/audit_repro_S-3-02.ts 2>&1 \
//     | tee ../audit/repro/S-3-02.log
// =============================================================================
import "dotenv/config";

function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production")
    throw new Error("REPRO: production ortamında koşturulamaz");
  let host = "", db = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    db = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db")
    throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();

import { RollEntrySource, RollStatus, StationKind, StationType, StepStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { TamburUndoService, UNDO_FULL_PERMISSION } from "../src/services/tambur-undo.service";

const STAMP = `AUDITREPRO-S-3-02-${Math.random().toString(36).slice(2, 8)}`;
const ADMIN = [UNDO_FULL_PERMISSION];
const FULL_REASON = "denetim reprosu — kapanış phantom sondası";

let fail = 0;
const ok = (m: string, x = "") => console.log(`✅ ${m}${x ? " — " + x : ""}`);
const bad = (m: string, x = "") => { fail++; console.log(`❌ ${m}${x ? " — " + x : ""}`); };
const info = (m: string) => console.log(`   ${m}`);

const tambur = new TamburService();
const undo = new TamburUndoService();

interface RoundResult {
  woStatus: string;
  stepStatus: string;
  liveRollsAtStep: number;
  openMovements: number;
  cardStatus: string | null;
  errors: string[];
}

/**
 * Tek tur: tek Tambur adımlı WO + 2 canlı top.
 *  1) A finalize edilir (adımda B kaldığı için adım ACTIVE, WO IN_PROGRESS)
 *  2) `parallel` ise: finalize(B) ‖ undo-FULL(A)   — asıl sonda
 *     değilse : undo-FULL(A) → finalize(B)          — referans (sıralı)
 */
async function runRound(
  round: number,
  parallel: boolean,
  itemId: string,
  stationId: string,
): Promise<RoundResult> {
  const tag = `${STAMP}-R${round}${parallel ? "P" : "S"}`;
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: tag.slice(0, 40), status: "IN_PROGRESS" },
    select: { id: true },
  });
  const step = await prisma.workOrderStep.create({
    data: { workOrderId: wo.id, stationId, stepSequence: 1, status: StepStatus.ACTIVE },
    select: { id: true },
  });
  const card = await prisma.travelerCard.create({
    data: {
      workOrderId: wo.id,
      cardNumber: `${tag}-C`.slice(0, 60),
      barcode: `${tag}-C`.slice(0, 60),
      status: "ACTIVE",
    },
    select: { id: true },
  });

  const mkRoll = async (label: string) => {
    const r = await prisma.roll.create({
      data: {
        barcode: null, // açık kumaş — Tambur'da finalize edilebilir
        itemId,
        width: 150,
        initialQty: 100,
        currentQty: 100,
        status: RollStatus.IN_PRODUCTION,
        qualityGrade: "1.KALITE",
        entrySource: RollEntrySource.SUBCONTRACTOR_RETURN,
        currentStepId: step.id,
      },
      select: { id: true },
    });
    // recomputeStepStatus hareketten türetir → AÇIK hareket şart.
    await prisma.rollMovement.create({
      data: { rollId: r.id, workOrderStepId: step.id, qtyIn: 100, notes: `${tag}-${label}` },
    });
    return r.id;
  };
  const rollA = await mkRoll("A");
  const rollB = await mkRoll("B");

  const errors: string[] = [];
  const cap = (e: unknown) => errors.push((e as { message?: string })?.message ?? String(e));

  // 1) A finalize (kesimsiz — tüm metraj tek "kalan kuyruk" çocuğa iner).
  await tambur.finalize({ rollId: rollA, decisions: [], cuts: [] }, undefined, null);

  // 2) Yarış
  if (parallel) {
    const res = await Promise.allSettled([
      tambur.finalize({ rollId: rollB, decisions: [], cuts: [] }, undefined, null),
      undo.applyUndo(rollA, undefined, { mode: "FULL", permissions: ADMIN, reason: FULL_REASON }),
    ]);
    for (const r of res) if (r.status === "rejected") cap(r.reason);
  } else {
    try {
      await undo.applyUndo(rollA, undefined, { mode: "FULL", permissions: ADMIN, reason: FULL_REASON });
    } catch (e) { cap(e); }
    try {
      await tambur.finalize({ rollId: rollB, decisions: [], cuts: [] }, undefined, null);
    } catch (e) { cap(e); }
  }

  // ── ÖLÇÜM: commit SONRASI, DB'DEN ────────────────────────────────────────
  const woAfter = await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { status: true } });
  const stepAfter = await prisma.workOrderStep.findUnique({ where: { id: step.id }, select: { status: true } });
  const liveRollsAtStep = await prisma.roll.count({
    where: { currentStepId: step.id, status: RollStatus.IN_PRODUCTION },
  });
  const openMovements = await prisma.rollMovement.count({
    where: { workOrderStepId: step.id, exitedAt: null, roll: { status: { not: RollStatus.CANCELLED } } },
  });
  const cardAfter = await prisma.travelerCard.findUnique({ where: { id: card.id }, select: { status: true } });

  return {
    woStatus: woAfter?.status ?? "?",
    stepStatus: stepAfter?.status ?? "?",
    liveRollsAtStep,
    openMovements,
    cardStatus: cardAfter?.status ?? null,
    errors,
  };
}

function violations(r: RoundResult): string[] {
  const v: string[] = [];
  if (r.woStatus === "COMPLETED" && r.liveRollsAtStep > 0)
    v.push(`WO COMPLETED ama adımda ${r.liveRollsAtStep} canlı top`);
  if (r.woStatus === "COMPLETED" && r.openMovements > 0)
    v.push(`WO COMPLETED ama adımda ${r.openMovements} AÇIK hareket`);
  if (r.woStatus === "COMPLETED" && r.stepStatus !== "COMPLETED" && r.stepStatus !== "SKIPPED")
    v.push(`WO COMPLETED ama adım ${r.stepStatus}`);
  if (r.woStatus === "COMPLETED" && r.cardStatus === "COMPLETED" && r.liveRollsAtStep > 0)
    v.push("refakat kartı COMPLETED — operatör topu okutamaz (çıkmaz)");
  if (r.stepStatus === "COMPLETED" && r.openMovements > 0)
    v.push(`adım COMPLETED ama ${r.openMovements} açık hareket (test_consistency §20 ihlali)`);
  return v;
}

async function main(): Promise<void> {
  console.log(`\n=== ${STAMP} — iş emri kapanış phantom'u (finalize ‖ tambur-undo) ===\n`);

  const item = await prisma.item.create({
    data: { code: `${STAMP}-ITM`.slice(0, 40), name: `${STAMP} kumaş`, itemType: "FABRIC" },
    select: { id: true },
  });
  let ownStationId = "";
  let station = await prisma.station.findFirst({
    where: { kind: StationKind.TAMBUR, isActive: true },
    select: { id: true },
  });
  if (!station) {
    station = await prisma.station.create({
      data: {
        code: `${STAMP}-T`.slice(0, 40),
        name: `${STAMP} Tambur`,
        type: StationType.INTERNAL,
        kind: StationKind.TAMBUR,
      },
      select: { id: true },
    });
    ownStationId = station.id;
  }

  try {
    // ── REFERANS: sıralı koşum tutarlı mı ────────────────────────────────────
    const seq = await runRound(0, false, item.id, station.id);
    info(
      `SIRALI: wo=${seq.woStatus} step=${seq.stepStatus} canlıTop=${seq.liveRollsAtStep} ` +
        `açıkHareket=${seq.openMovements} kart=${seq.cardStatus} hata=${seq.errors.length}`,
    );
    const seqV = violations(seq);
    if (seqV.length === 0) ok("SIRALI koşum tutarlı (referans)");
    else bad("SIRALI koşumda da ihlal — fixture/ortam şüpheli", seqV.join(" · "));

    // ── ASIL SONDA ───────────────────────────────────────────────────────────
    let broken = 0;
    for (let i = 1; i <= 10; i++) {
      const r = await runRound(i, true, item.id, station.id);
      const v = violations(r);
      if (v.length > 0) broken++;
      console.log(
        `   tur ${i}: wo=${r.woStatus} step=${r.stepStatus} canlıTop=${r.liveRollsAtStep} ` +
          `açıkHareket=${r.openMovements} kart=${r.cardStatus} hata=${r.errors.length}` +
          (v.length ? `  ⇐ İHLAL: ${v.join(" · ")}` : ""),
      );
    }

    if (broken > 0) {
      bad(`PARALEL koşumda ${broken}/10 turda iş emri kapanış phantom'u oluştu`);
    } else {
      ok("PARALEL koşumun 10 turunda phantom oluşmadı — bu ortamda TETİKLENEMEDİ (negatif sonuç)");
      info("Not: negatif sonuç kilidin var olduğunu KANITLAMAZ. tambur-undo'nun iki yazma");
      info("      yolunda `touchWorkOrderTx` çağrısı KODDA YOKTUR (grep: 0 vuruş) —");
      info("      pencere dar olduğu için tek makinede her turda yakalanmayabilir.");
    }
  } finally {
    const wos = await prisma.workOrder.findMany({
      where: { workOrderNumber: { startsWith: STAMP } },
      select: { id: true },
    });
    const woIds = wos.map((w) => w.id);
    const steps = await prisma.workOrderStep.findMany({
      where: { workOrderId: { in: woIds } },
      select: { id: true },
    });
    const stepIds = steps.map((s) => s.id);
    const rolls = await prisma.roll.findMany({ where: { itemId: item.id }, select: { id: true } });
    const rollIds = rolls.map((r) => r.id);
    if (rollIds.length) {
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollPlanDeviation.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { parentRollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (stepIds.length) await prisma.workOrderStep.deleteMany({ where: { id: { in: stepIds } } });
    if (woIds.length) {
      await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    }
    if (ownStationId) await prisma.station.deleteMany({ where: { id: ownStationId } });
    await prisma.item.deleteMany({ where: { id: item.id } });

    console.log(`\n=== SONUÇ: ${fail} kırmızı ===`);
    await prisma.$disconnect();
    await pool.end();
  }
}

main().then(
  () => { process.exitCode = fail > 0 ? 1 : 0; },
  (e) => { console.error(e); process.exitCode = 1; },
);
