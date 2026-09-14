// TEST (2026-07-14): Parti ayırma — NEW_COLOR + UNDYED_MOVE (WO klonu) + karma-adım
//   per-roll uygunluk + depo-tebdili (WAREHOUSE) + B1 (boşalan kaynak WO iptali).
//   Güncel şema: refakat kartı İŞ EMRİ başına (workOrderId @unique).
// Çalıştır: npx tsx scripts/test_batch_split_new_wo_modes.ts
import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { WorkOrderService } from "../src/services/workorder.service";
import { RollStatus, WorkOrderStatus } from "@prisma/client";

const WIDTH = 250;
const wos = new WorkOrderService();
let pass = 0,
  fail = 0;
function check(l: string, ok: boolean, x = ""): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${l}${x ? ` — ${x}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${l}${x ? ` — ${x}` : ""}`);
  }
}
async function expectReject(l: string, fn: () => Promise<unknown>, needle: string): Promise<void> {
  let m: string | null = null;
  try {
    await fn();
  } catch (e) {
    m = e instanceof Error ? e.message : String(e);
  }
  check(l, m !== null && m.includes(needle), m ?? "hata atılmadı");
}
let bcN = 0;
function bc(): string {
  bcN++;
  return `TST-SPL-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bcN}`;
}
const createdWoIds = new Set<string>();

type Ctx = {
  ITEM: string;
  GRADE: string;
  /** Kalite KODU — rolden çözülür (karar ①), fabrikanın kodu gömülü değil. */
  GRADE_CODE: string;
  ADMIN: string;
  ST_BOYA: string;
  ST_TAMBUR: string;
  ST_INT: string;
  CAT_BOYA: string;
  COLOR: string;
  COLOR2: string;
  SUB: string;
};

async function seedRefs(): Promise<Ctx> {
  const need = (v: { id: string } | null, l: string): string => {
    if (!v) throw new Error(`Seed eksik: ${l}`);
    return v.id;
  };
  return {
    ITEM: need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS"),
    ...(await (async () => { const g = await roleGrade("FIRST"); return { GRADE: g.id, GRADE_CODE: g.code }; })()),
    ADMIN: need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin"),
    ST_BOYA: need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON"),
    ST_TAMBUR: need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1"),
    ST_INT: need(
      await prisma.station.findFirst({ where: { type: "INTERNAL", code: { notIn: ["TAMBUR_1"] } }, select: { id: true } }),
      "INTERNAL station",
    ),
    CAT_BOYA: need(await prisma.subcontractorCategory.findFirst({ where: { code: "BOYA" }, select: { id: true } }), "BOYA"),
    COLOR: need(await prisma.color.findFirst({ where: { code: "MAVI" }, select: { id: true } }), "MAVI"),
    COLOR2: need(await prisma.color.findFirst({ where: { code: { not: "MAVI" }, isActive: true }, select: { id: true } }), "COLOR2"),
    SUB: need(await prisma.subcontractor.findFirst({ where: { isActive: true }, select: { id: true } }), "subcontractor"),
  };
}

/** WO oluştur (verilen adım tanımlarıyla) + kaynak refakat kartı (workOrderId). */
async function mkWo(
  c: Ctx,
  steps: { stationId: string; colorStep?: boolean }[],
): Promise<{ id: string; stepIds: string[]; number: string }> {
  const stamp = `${Date.now()}`.slice(-7) + Math.floor(Math.random() * 90 + 10);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-SPL-${stamp}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      width: WIDTH,
      targetQuantity: 1000,
      targetItemId: c.ITEM,
      targetColorId: c.COLOR,
      steps: {
        create: steps.map((s, i) => ({
          stationId: s.stationId,
          stepSequence: i + 1,
          status: "PENDING" as const,
          requiredCategoryId: s.colorStep ? c.CAT_BOYA : null,
        })),
      },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  createdWoIds.add(wo.id);
  // Kaynak WO refakat kartı (WO başına) — B1'de VOID doğrulanacak.
  await prisma.travelerCard.create({
    data: { cardNumber: wo.workOrderNumber, barcode: wo.workOrderNumber, workOrderId: wo.id, version: 1, status: "ACTIVE" },
  });
  return { id: wo.id, stepIds: wo.steps.map((s) => s.id), number: wo.workOrderNumber };
}

async function mkAttachedParty(c: Ctx, woId: string, n: number): Promise<{ batchId: string; rollIds: string[] }> {
  const bcs = Array.from({ length: n }, () => bc());
  for (const b of bcs)
    await prisma.roll.create({
      data: { barcode: b, itemId: c.ITEM, initialQty: 100, currentQty: 100, status: RollStatus.STOCK, qualityGrade: c.GRADE_CODE, qualityGradeId: c.GRADE, width: WIDTH, createdById: c.ADMIN },
    });
  const attach = await wos.attachRolls(woId, bcs, c.ADMIN);
  const batchId = attach.data!.batch!.id;
  const rollIds = (await prisma.roll.findMany({ where: { batchId }, select: { id: true } })).map((r) => r.id);
  return { batchId, rollIds };
}

async function main(): Promise<void> {
  const c = await seedRefs();

  // ═══════════════ NEW_COLOR (kısmi + tam → B1) ═══════════════
  console.log("\n── NEW_COLOR (kısmi + tam-parti B1) ──");
  {
    const wo = await mkWo(c, [{ stationId: c.ST_BOYA, colorStep: true }, { stationId: c.ST_TAMBUR }]);
    const boyaStep = wo.stepIds[0];
    const tamburStep = wo.stepIds[1];
    const { batchId: p1, rollIds } = await mkAttachedParty(c, wo.id, 4);
    // Boyandı + döndü: Tambur'da, renkli, IN_PRODUCTION.
    await prisma.roll.updateMany({ where: { batchId: p1 }, data: { currentStepId: tamburStep, colorId: c.COLOR, status: RollStatus.IN_PRODUCTION } });

    // Guard: newColorId olmadan NEW_COLOR → 400.
    await expectReject("NEW_COLOR: renksiz → 400", () => wos.splitBranch(wo.id, { batchId: p1, mode: "NEW_COLOR" }, c.ADMIN), "yeni renk seçilmeli");

    // Önizleme: 4 top uygun, NEW_COLOR izinli, sourceTargetColorId dolu.
    const pv = (await wos.getSplitPreview(wo.id, p1)).data as { allowedModes: string[]; eligibleCount: number; sourceTargetColorId: string | null };
    check("NEW_COLOR önizleme: mod izinli", pv.allowedModes.includes("NEW_COLOR"));
    check("NEW_COLOR önizleme: 4 uygun top", pv.eligibleCount === 4, `n=${pv.eligibleCount}`);
    check("NEW_COLOR önizleme: sourceTargetColorId dolu", pv.sourceTargetColorId === c.COLOR);

    // KISMİ: 2 topu farklı renge yeni İE'ye.
    const half = rollIds.slice(0, 2);
    const r1 = (await wos.splitBranch(wo.id, { batchId: p1, mode: "NEW_COLOR", newColorId: c.COLOR2, rollIds: half, reason: "renk tutmadı" }, c.ADMIN)).data as {
      newWorkOrderId: string; newWorkOrderNumber: string; newBatchId: string; movedRollCount: number;
    };
    createdWoIds.add(r1.newWorkOrderId);
    check("NEW_COLOR: yeni İE oluştu", !!r1.newWorkOrderId && r1.newWorkOrderNumber.startsWith("IE"), r1.newWorkOrderNumber);
    check("NEW_COLOR: 2 top taşındı", r1.movedRollCount === 2);
    const newWo = await prisma.workOrder.findUnique({ where: { id: r1.newWorkOrderId }, select: { status: true, splitFromId: true, targetColorId: true, steps: { orderBy: { stepSequence: "asc" }, select: { status: true, requiredCategory: { select: { appliesColor: true } } } } } });
    check("NEW_COLOR: yeni WO splitFrom = kaynak", newWo?.splitFromId === wo.id);
    check("NEW_COLOR: yeni WO hedef renk = yeni renk", newWo?.targetColorId === c.COLOR2);
    check("NEW_COLOR: yeni WO IN_PROGRESS", newWo?.status === "IN_PROGRESS");
    const newBoyaStepStatus = newWo?.steps.find((s) => s.requiredCategory?.appliesColor)?.status;
    check("NEW_COLOR: yeni WO boyahane adımı ACTIVE", newBoyaStepStatus === "ACTIVE", newBoyaStepStatus);
    const movedRolls = await prisma.roll.findMany({ where: { batchId: r1.newBatchId }, select: { colorId: true, status: true, currentStepId: true } });
    check("NEW_COLOR: taşınan 2 top yeni partide", movedRolls.length === 2);
    check("NEW_COLOR: renk sıfırlandı", movedRolls.every((r) => r.colorId === null));
    check("NEW_COLOR: yeni WO kendi kartını aldı", (await prisma.travelerCard.count({ where: { workOrderId: r1.newWorkOrderId, status: "ACTIVE" } })) === 1);
    // Kaynak: 2 top kaldı, WO hâlâ IN_PROGRESS (B1 tetiklenmez).
    check("NEW_COLOR: kaynakta 2 top kaldı", (await prisma.roll.count({ where: { batchId: p1 } })) === 2);
    check("NEW_COLOR: kaynak WO hâlâ IN_PROGRESS (kısmi)", (await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { status: true } }))?.status === "IN_PROGRESS");

    // TAM: kalan 2 topu da → kaynak boşalır → B1 (SUPERSEDED/Devredildi + kart VOID).
    const rest = rollIds.slice(2);
    const r2 = (await wos.splitBranch(wo.id, { batchId: p1, mode: "NEW_COLOR", newColorId: c.COLOR2, rollIds: rest }, c.ADMIN)).data as { newWorkOrderId: string };
    createdWoIds.add(r2.newWorkOrderId);
    check("B1: kaynak WO SUPERSEDED/Devredildi (tam-parti ayrıldı, iptal DEĞİL)", (await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { status: true } }))?.status === "SUPERSEDED");
    check("B1: kaynak WO kartı VOIDED", (await prisma.travelerCard.count({ where: { workOrderId: wo.id, status: "VOIDED" } })) === 1);
  }

  // ═══════════════ UNDYED_MOVE ═══════════════
  console.log("\n── UNDYED_MOVE (fasondaki parti → yeni İE) ──");
  {
    const wo = await mkWo(c, [{ stationId: c.ST_BOYA, colorStep: true }, { stationId: c.ST_TAMBUR }]);
    const boyaStep = wo.stepIds[0];
    const { batchId: p1, rollIds } = await mkAttachedParty(c, wo.id, 3);
    // Fasona gönderilmiş simülasyonu: AT_SUBCONTRACTOR @ boyaStep + açık movement + dispatch.
    await prisma.roll.updateMany({ where: { batchId: p1 }, data: { status: RollStatus.AT_SUBCONTRACTOR, currentStepId: boyaStep } });
    // @silme-baglami: FIKSTUR_KURULUMU — fasona gönderilmiş simülasyonu kuruluyor: açık hareket silinip yerine boya adımında yenisi yazılıyor
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds }, exitedAt: null } });
    for (const rid of rollIds) await prisma.rollMovement.create({ data: { rollId: rid, workOrderStepId: boyaStep, qtyIn: 100 } });
    const disp = await prisma.subcontractorDispatch.create({
      // Kalemli fixture ŞART: gerçek dispatch() her top için kalem yazar; açık sevkin
      // OUTSTANDING tanımı (K14/K15) kalem-bazlıdır (dönmemiş kalemi olan sevk) —
      // kalemsiz fixture undyedMove'un outstanding-scope'lu sevk seçimine takılırdı.
      data: {
        dispatchNo: `TST-SPL-D${Date.now()}`, workOrderId: wo.id, batchId: p1, stepId: boyaStep, subcontractorId: c.SUB, totalQty: 300,
        items: { create: rollIds.map((rid) => ({ rollId: rid, dispatchedQty: 100 })) },
      },
    });

    // Guard'lar.
    await expectReject("UNDYED: renk verilirse → 400", () => wos.splitBranch(wo.id, { batchId: p1, mode: "UNDYED_MOVE", newColorId: c.COLOR2 }, c.ADMIN), "renk verilemez");
    await expectReject("UNDYED: kısmi rollIds → 400", () => wos.splitBranch(wo.id, { batchId: p1, mode: "UNDYED_MOVE", rollIds: [rollIds[0]] }, c.ADMIN), "TÜM topları");

    const pv = (await wos.getSplitPreview(wo.id, p1)).data as { allowedModes: string[] };
    check("UNDYED önizleme: yalnız UNDYED_MOVE", pv.allowedModes.length === 1 && pv.allowedModes[0] === "UNDYED_MOVE", pv.allowedModes.join(","));

    const r = (await wos.splitBranch(wo.id, { batchId: p1, mode: "UNDYED_MOVE" }, c.ADMIN)).data as { newWorkOrderId: string; movedBatchId: string; movedRollCount: number; dispatchNo: string };
    createdWoIds.add(r.newWorkOrderId);
    check("UNDYED: yeni İE oluştu", !!r.newWorkOrderId);
    check("UNDYED: 3 top taşındı", r.movedRollCount === 3);
    check("UNDYED: parti yeni WO'ya taşındı", (await prisma.batch.findUnique({ where: { id: p1 }, select: { workOrderId: true } }))?.workOrderId === r.newWorkOrderId);
    const movedDisp = await prisma.subcontractorDispatch.findUnique({ where: { id: disp.id }, select: { workOrderId: true, stepId: true, batchId: true } });
    check("UNDYED: dispatch workOrderId yeni WO", movedDisp?.workOrderId === r.newWorkOrderId);
    check("UNDYED: dispatch batchId DEĞİŞMEDİ (F74 tutarlı)", movedDisp?.batchId === p1);
    const newBoyaStep = (await prisma.workOrderStep.findFirst({ where: { workOrderId: r.newWorkOrderId, requiredCategory: { appliesColor: true } }, select: { id: true } }))?.id;
    check("UNDYED: dispatch stepId yeni WO'nun boyahane adımı", movedDisp?.stepId === newBoyaStep);
    const undyedRolls = await prisma.roll.findMany({ where: { batchId: p1 }, select: { status: true, currentStepId: true } });
    check("UNDYED: toplar AT_SUBCONTRACTOR kaldı", undyedRolls.every((r) => r.status === RollStatus.AT_SUBCONTRACTOR));
    check("UNDYED: toplar yeni WO boyahane adımında", undyedRolls.every((r) => r.currentStepId === newBoyaStep));
    check("UNDYED: açık fason movement hâlâ AÇIK", (await prisma.rollMovement.count({ where: { rollId: { in: rollIds }, workOrderStepId: newBoyaStep, exitedAt: null } })) === 3);
    check("B1: UNDYED kaynak WO SUPERSEDED/Devredildi (iptal DEĞİL)", (await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { status: true } }))?.status === "SUPERSEDED");
  }

  // ═══════════════ Karma-adım (per-roll uygunluk) ═══════════════
  console.log("\n── Karma-adım (per-roll uygunluk) ──");
  {
    // 3 adım: step1=INTERNAL (boyahane ÖNCESİ), step2=BOYA (color), step3=TAMBUR.
    const wo = await mkWo(c, [{ stationId: c.ST_INT }, { stationId: c.ST_BOYA, colorStep: true }, { stationId: c.ST_TAMBUR }]);
    const [preStep, , tamburStep] = wo.stepIds;
    const { batchId: p1, rollIds } = await mkAttachedParty(c, wo.id, 2);
    // 1 top boyahane ÖNCESİ (step1) — uygun DEĞİL; 1 top Tambur'da (boyahane sonrası, renkli) — uygun.
    await prisma.roll.update({ where: { id: rollIds[0] }, data: { currentStepId: preStep, status: RollStatus.IN_PRODUCTION } });
    await prisma.roll.update({ where: { id: rollIds[1] }, data: { currentStepId: tamburStep, colorId: c.COLOR, status: RollStatus.IN_PRODUCTION } });

    const pv = (await wos.getSplitPreview(wo.id, p1)).data as { eligibleCount: number; rolls: { id: string; eligible: boolean }[] };
    check("karma: yalnız 1 top uygun", pv.eligibleCount === 1, `n=${pv.eligibleCount}`);
    check("karma: boyahane-öncesi top uygun DEĞİL", pv.rolls.find((r) => r.id === rollIds[0])?.eligible === false);
    check("karma: Tambur topu uygun", pv.rolls.find((r) => r.id === rollIds[1])?.eligible === true);

    // Karışık seçim (1 uygun + 1 uygun-değil) → 400 (per-roll guard).
    await expectReject("karma: karışık seçimde uygun-olmayan → 400", () => wos.splitBranch(wo.id, { batchId: p1, mode: "REDYE_SAME_COLOR", rollIds: [rollIds[0], rollIds[1]] }, c.ADMIN), "uygun değil");
    // Yalnız uygun-olmayan seçim → 400 (net ret).
    await expectReject("karma: yalnız uygun-olmayan seçim → 400", () => wos.splitBranch(wo.id, { batchId: p1, mode: "REDYE_SAME_COLOR", rollIds: [rollIds[0]] }, c.ADMIN), "uygun top yok");
    // Uygun topu redye → çalışır (kalan top kaynakta kalır → WO IN_PROGRESS, B1 yok).
    const r = (await wos.splitBranch(wo.id, { batchId: p1, mode: "REDYE_SAME_COLOR", rollIds: [rollIds[1]] }, c.ADMIN)).data as { newBatchId: string };
    check("karma: uygun top redye edildi", !!r.newBatchId);
    check("karma: kaynak WO IN_PROGRESS kaldı (1 top duruyor)", (await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { status: true } }))?.status === "IN_PROGRESS");
  }

  // ═══════════════ Depo-tebdili (WAREHOUSE) ═══════════════
  console.log("\n── Depo-tebdili (WAREHOUSE + çuval guard) ──");
  {
    // Boyahane SON adım → dönen toplar WAREHOUSE'a düşer.
    const wo = await mkWo(c, [{ stationId: c.ST_BOYA, colorStep: true }]);
    const boyaStep = wo.stepIds[0];
    const { batchId: p1, rollIds } = await mkAttachedParty(c, wo.id, 2);
    // Depoya çekilmiş, barkodlu, renkli, WO COMPLETED simülasyonu.
    await prisma.roll.updateMany({ where: { batchId: p1 }, data: { status: RollStatus.WAREHOUSE, currentStepId: null, producedInStepId: boyaStep, colorId: c.COLOR } });
    await prisma.workOrderStep.updateMany({ where: { id: boyaStep }, data: { status: "COMPLETED" } });
    await prisma.workOrder.update({ where: { id: wo.id }, data: { status: WorkOrderStatus.COMPLETED } });
    await prisma.travelerCard.updateMany({ where: { workOrderId: wo.id }, data: { status: "COMPLETED" } });
    // 1 topu çuvala koy → uygun DEĞİL.
    const sack = await prisma.sack.create({ data: { sackNo: `TST-SPL-CV${Date.now()}` } });
    await prisma.roll.update({ where: { id: rollIds[0] }, data: { sackId: sack.id } });

    const pv = (await wos.getSplitPreview(wo.id, p1)).data as { eligibleCount: number; rolls: { id: string; eligible: boolean }[] };
    check("depo: çuvaldaki top uygun DEĞİL", pv.rolls.find((r) => r.id === rollIds[0])?.eligible === false);
    check("depo: serbest depo topu uygun", pv.rolls.find((r) => r.id === rollIds[1])?.eligible === true);
    check("depo: 1 uygun top", pv.eligibleCount === 1, `n=${pv.eligibleCount}`);

    // Serbest depo topunu tebdil → WO geri açılır.
    const r = (await wos.splitBranch(wo.id, { batchId: p1, mode: "REDYE_SAME_COLOR", rollIds: [rollIds[1]] }, c.ADMIN)).data as { newBatchId: string };
    check("depo: tebdil çalıştı", !!r.newBatchId);
    const rewound = await prisma.roll.findUnique({ where: { id: rollIds[1] }, select: { status: true, currentStepId: true, colorId: true } });
    check("depo: top boyahaneye geri sarıldı + IN_PRODUCTION", rewound?.status === RollStatus.IN_PRODUCTION && rewound?.currentStepId === boyaStep);
    check("depo: renk sıfırlandı", rewound?.colorId === null);
    check("depo: WO COMPLETED→IN_PROGRESS geri açıldı", (await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { status: true } }))?.status === "IN_PROGRESS");
    check("depo: kart COMPLETED→ACTIVE geri açıldı", (await prisma.travelerCard.count({ where: { workOrderId: wo.id, status: "ACTIVE" } })) === 1);
    await prisma.roll.update({ where: { id: rollIds[0] }, data: { sackId: null } });
    await prisma.sack.delete({ where: { id: sack.id } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    const woIds = [...createdWoIds];
    if (woIds.length === 0) return;
    const batches = await prisma.batch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const batchIds = batches.map((b) => b.id);
    const rolls = await prisma.roll.findMany({ where: { OR: [{ batchId: { in: batchIds } }, { barcode: { startsWith: "TST-SPL-" } }] }, select: { id: true } });
    const rollIds = rolls.map((r) => r.id);
    await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatch: { workOrderId: { in: woIds } } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: { in: woIds } } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.batch.deleteMany({ where: { id: { in: batchIds }, splitFromId: { not: null } } });
    await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...woIds, ...batchIds] } } });
    // Klon WO'lar splitFromId ile kaynağa bağlı — çocukları önce sil.
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds }, splitFromId: { not: null } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    console.log("(temizlendi)");
  } catch (e) {
    console.error("cleanup hata:", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
