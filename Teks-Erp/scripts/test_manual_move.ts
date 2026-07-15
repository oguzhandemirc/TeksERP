// TEST (2026-07-15): Manuel Konum Düzeltme (süpervizör override).
//   Parti/top rotada ileri-geri taşıma + parti kararı (keep/new/join) + guard'lar
//   (fasonda/çuval/downstream-işlem engel) + WAREHOUSE reopen + önizleme.
// Çalıştır: npx tsx scripts/test_manual_move.ts
import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { RollStatus, WorkOrderStatus, RollOperationType } from "@prisma/client";

const WIDTH = 250;
const svc = new WorkOrderService();
let pass = 0, fail = 0;
function check(l: string, ok: boolean, x = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${l}${x ? ` — ${x}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${l}${x ? ` — ${x}` : ""}`); }
}
async function expectReject(l: string, fn: () => Promise<unknown>, needle: string): Promise<void> {
  let m: string | null = null;
  try { await fn(); } catch (e) { m = e instanceof Error ? e.message : String(e); }
  check(l, m !== null && m.includes(needle), m ?? "hata atılmadı");
}
let bcN = 0;
function bc(): string { bcN++; return `TST-MOV-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bcN}`; }
const woIds = new Set<string>();

type Ctx = { ITEM: string; GRADE: string; ADMIN: string; ST_INT: string; ST_BOYA: string; ST_TAMBUR: string; CAT_BOYA: string };

async function seed(): Promise<Ctx> {
  const need = (v: { id: string } | null, l: string): string => { if (!v) throw new Error(`Seed eksik: ${l}`); return v.id; };
  return {
    ITEM: need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS"),
    GRADE: need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "1.KALITE"),
    ADMIN: need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin"),
    ST_INT: need(await prisma.station.findFirst({ where: { type: "INTERNAL", code: { notIn: ["TAMBUR_1"] } }, select: { id: true } }), "INTERNAL"),
    ST_BOYA: need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON"),
    ST_TAMBUR: need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1"),
    CAT_BOYA: need(await prisma.subcontractorCategory.findFirst({ where: { code: "BOYA" }, select: { id: true } }), "BOYA"),
  };
}

async function mkWo(c: Ctx, steps: { stationId: string; colorStep?: boolean }[], status: WorkOrderStatus = "IN_PROGRESS"): Promise<{ id: string; stepIds: string[] }> {
  const stamp = `${Date.now()}`.slice(-7) + Math.floor(Math.random() * 90 + 10);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-MOV-${stamp}`, type: "STOCK_PRODUCTION", status, width: WIDTH, targetQuantity: 1000, targetItemId: c.ITEM,
      steps: { create: steps.map((s, i) => ({ stationId: s.stationId, stepSequence: i + 1, status: "PENDING" as const, requiredCategoryId: s.colorStep ? c.CAT_BOYA : null })) },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woIds.add(wo.id);
  return { id: wo.id, stepIds: wo.steps.map((s) => s.id) };
}

async function mkParty(c: Ctx, woId: string, stepId: string, n: number): Promise<{ batchId: string; rollIds: string[] }> {
  const bcs = Array.from({ length: n }, () => bc());
  for (const b of bcs) await prisma.roll.create({ data: { barcode: b, itemId: c.ITEM, initialQty: 100, currentQty: 100, status: RollStatus.STOCK, qualityGrade: "1.KALITE", qualityGradeId: c.GRADE, width: WIDTH, createdById: c.ADMIN } });
  const attach = await svc.attachRolls(woId, bcs, c.ADMIN);
  const batchId = (attach.data as { batch: { id: string } }).batch.id;
  const rollIds = (await prisma.roll.findMany({ where: { batchId }, select: { id: true } })).map((r) => r.id);
  // Toplu olarak istenen adıma yerleştir + açık movement.
  await prisma.roll.updateMany({ where: { batchId }, data: { currentStepId: stepId, status: RollStatus.IN_PRODUCTION } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds }, exitedAt: null } });
  for (const rid of rollIds) await prisma.rollMovement.create({ data: { rollId: rid, workOrderStepId: stepId, qtyIn: 100 } });
  return { batchId, rollIds };
}

async function main(): Promise<void> {
  const c = await seed();

  // ═══ İleri + geri (tüm parti, keep) ═══
  console.log("\n── İleri/geri taşıma (tüm parti · keep) ──");
  {
    const wo = await mkWo(c, [{ stationId: c.ST_INT }, { stationId: c.ST_BOYA, colorStep: true }, { stationId: c.ST_TAMBUR }]);
    const [s1, , s3] = wo.stepIds;
    const { batchId, rollIds } = await mkParty(c, wo.id, s1, 3);

    // Önizleme: tüm parti → karar gerekmez.
    const pv = (await svc.getManualMovePreview(wo.id, { batchId, targetStepId: s3 })).data as { isWholeParty: boolean; partyDecisionNeeded: boolean; movableCount: number };
    check("önizleme: tüm parti", pv.isWholeParty === true && pv.partyDecisionNeeded === false);
    check("önizleme: 3 taşınabilir", pv.movableCount === 3, `n=${pv.movableCount}`);

    await svc.manualMove(wo.id, { batchId, targetStepId: s3, reason: "manuel ileri" }, c.ADMIN);
    const at3 = await prisma.roll.findMany({ where: { batchId }, select: { currentStepId: true, status: true, batchId: true } });
    check("ileri: 3 top Tambur'da", at3.every((r) => r.currentStepId === s3));
    check("ileri: IN_PRODUCTION", at3.every((r) => r.status === RollStatus.IN_PRODUCTION));
    check("ileri: parti kimliği korundu (keep)", at3.every((r) => r.batchId === batchId));
    check("ileri: Tambur'da taze açık movement", (await prisma.rollMovement.count({ where: { rollId: { in: rollIds }, workOrderStepId: s3, exitedAt: null } })) === 3);
    const s3status = (await prisma.workOrderStep.findUnique({ where: { id: s3 }, select: { status: true } }))?.status;
    check("ileri: hedef adım ACTIVE", s3status === "ACTIVE", s3status);

    await svc.manualMove(wo.id, { batchId, targetStepId: s1, reason: "manuel geri" }, c.ADMIN);
    check("geri: 3 top tekrar 1. adımda", (await prisma.roll.findMany({ where: { batchId }, select: { currentStepId: true } })).every((r) => r.currentStepId === s1));
    // B4: geri taşımada kaynak (Tambur) adımı hayalet-COMPLETED değil, PENDING olmalı (movement izi silindi).
    const s3back = (await prisma.workOrderStep.findUnique({ where: { id: s3 }, select: { status: true } }))?.status;
    check("geri: kaynak Tambur PENDING (hayalet COMPLETED yok · B4)", s3back === "PENDING", s3back);
  }

  // ═══ Kısmi → yeni parti ═══
  console.log("\n── Kısmi taşıma → yeni parti ──");
  {
    const wo = await mkWo(c, [{ stationId: c.ST_INT }, { stationId: c.ST_TAMBUR }]);
    const [s1, s2] = wo.stepIds;
    const { batchId, rollIds } = await mkParty(c, wo.id, s1, 3);

    const pv = (await svc.getManualMovePreview(wo.id, { rollIds: [rollIds[0]], targetStepId: s2 })).data as { isWholeParty: boolean; partyDecisionNeeded: boolean };
    check("önizleme: kısmi → karar gerekir", pv.isWholeParty === false && pv.partyDecisionNeeded === true);

    const r = (await svc.manualMove(wo.id, { rollIds: [rollIds[0]], targetStepId: s2, partyMode: "new", reason: "kısmi ayır" }, c.ADMIN)).data as { newBatchNumber: string };
    check("kısmi/new: yeni parti oluştu", !!r.newBatchNumber, r.newBatchNumber);
    const moved = await prisma.roll.findUnique({ where: { id: rollIds[0] }, select: { batchId: true, currentStepId: true } });
    check("kısmi/new: taşınan top yeni partide + hedefte", moved?.batchId !== batchId && moved?.currentStepId === s2);
    check("kısmi/new: kalan 2 top kaynakta 1. adımda", (await prisma.roll.count({ where: { batchId, currentStepId: s1 } })) === 2);
    const newB = await prisma.batch.findFirst({ where: { id: moved!.batchId! }, select: { splitFromId: true } });
    check("kısmi/new: splitFrom = kaynak", newB?.splitFromId === batchId);
  }

  // ═══ Kısmi → hedef partiye kat (join) ═══
  console.log("\n── Kısmi taşıma → hedef partiye kat (join) ──");
  {
    const wo = await mkWo(c, [{ stationId: c.ST_INT }, { stationId: c.ST_TAMBUR }]);
    const [s1, s2] = wo.stepIds;
    const src = await mkParty(c, wo.id, s1, 2);
    const dst = await mkParty(c, wo.id, s2, 1);

    await svc.manualMove(wo.id, { rollIds: [src.rollIds[0]], targetStepId: s2, partyMode: "join", joinBatchId: dst.batchId, reason: "kat" }, c.ADMIN);
    const moved = await prisma.roll.findUnique({ where: { id: src.rollIds[0] }, select: { batchId: true, currentStepId: true } });
    check("join: taşınan top hedef partide", moved?.batchId === dst.batchId);
    check("join: hedefte (2. adım)", moved?.currentStepId === s2);
    check("join: hedef parti artık 2 top", (await prisma.roll.count({ where: { batchId: dst.batchId } })) === 2);
  }

  // ═══ Guard'lar ═══
  console.log("\n── Guard'lar ──");
  {
    const wo = await mkWo(c, [{ stationId: c.ST_INT }, { stationId: c.ST_TAMBUR }]);
    const [s1, s2] = wo.stepIds;
    const { batchId, rollIds } = await mkParty(c, wo.id, s1, 2);

    // Fasonda top → engel. (sebep geçerli ki asıl guard'a ulaşsın)
    await prisma.roll.update({ where: { id: rollIds[0] }, data: { status: RollStatus.AT_SUBCONTRACTOR } });
    await expectReject("guard: fasonda top → taşınamaz", () => svc.manualMove(wo.id, { batchId, targetStepId: s2, reason: "test" }, c.ADMIN), "taşınamaz");
    await prisma.roll.update({ where: { id: rollIds[0] }, data: { status: RollStatus.IN_PRODUCTION } });

    // Çuvaldaki top → engel.
    const sack = await prisma.sack.create({ data: { sackNo: `TST-MOV-CV${Date.now()}` } });
    await prisma.roll.update({ where: { id: rollIds[0] }, data: { sackId: sack.id } });
    await expectReject("guard: çuvaldaki top → taşınamaz", () => svc.manualMove(wo.id, { rollIds: [rollIds[0]], targetStepId: s2, reason: "test" }, c.ADMIN), "taşınamaz");
    await prisma.roll.update({ where: { id: rollIds[0] }, data: { sackId: null } });
    await prisma.sack.delete({ where: { id: sack.id } });

    // Hedef adım başka rotada → 400.
    await expectReject("guard: hedef adım rotada değil", () => svc.manualMove(wo.id, { batchId, targetStepId: "00000000-0000-0000-0000-000000000000", reason: "test" }, c.ADMIN), "rotasında değil");

    // Sebep zorunlu.
    await expectReject("guard: sebep zorunlu", () => svc.manualMove(wo.id, { batchId, targetStepId: s2, reason: "" }, c.ADMIN), "gerekçesi zorunlu");

    // B5: aynı adıma taşıma → no-op reddi (toplar hâlâ s1'de).
    await expectReject("guard: aynı adıma taşıma → red (B5)", () => svc.manualMove(wo.id, { batchId, targetStepId: s1, reason: "ayni adim" }, c.ADMIN), "zaten bu adımda");
  }

  // ═══ Geri taşımada downstream işlem engeli ═══
  console.log("\n── Geri taşımada işlem engeli ──");
  {
    const wo = await mkWo(c, [{ stationId: c.ST_INT }, { stationId: c.ST_TAMBUR }]);
    const [s1, s2] = wo.stepIds;
    const { rollIds } = await mkParty(c, wo.id, s2, 1); // Tambur'da
    await prisma.rollOperation.create({ data: { rollId: rollIds[0], workOrderStepId: s2, operationType: RollOperationType.TAMBUR_PROCESSED } });
    await expectReject("işlem engeli: geri taşıma reddedilir", () => svc.manualMove(wo.id, { rollIds: [rollIds[0]], targetStepId: s1, reason: "geri" }, c.ADMIN), "kesim/kalite");
    // İleri (aynı adımda kalıp ileri yok — tek adım sonrası) yerine: aynı topu Tambur'da bırakıp engel doğru mu diye ileriye de bak yok. Skip.
  }

  // ═══ WAREHOUSE topu üretime geri al → WO reopen ═══
  console.log("\n── Depo topunu üretime al (WO reopen) ──");
  {
    // Önce IN_PROGRESS'te attach (COMPLETED'a top bağlanamaz), sonra depoya + WO'yu tamamla.
    const wo = await mkWo(c, [{ stationId: c.ST_INT }, { stationId: c.ST_TAMBUR }]);
    const [s1, s2] = wo.stepIds;
    const { batchId, rollIds } = await mkParty(c, wo.id, s2, 1);
    await prisma.rollMovement.updateMany({ where: { rollId: { in: rollIds }, exitedAt: null }, data: { exitedAt: new Date() } });
    await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { status: RollStatus.WAREHOUSE, currentStepId: null, producedInStepId: s2 } });
    await prisma.workOrder.update({ where: { id: wo.id }, data: { status: WorkOrderStatus.COMPLETED } });

    await svc.manualMove(wo.id, { batchId, targetStepId: s1, reason: "depodan üretime" }, c.ADMIN);
    const roll = await prisma.roll.findUnique({ where: { id: rollIds[0] }, select: { status: true, currentStepId: true } });
    check("depo: top IN_PRODUCTION @ 1. adım", roll?.status === RollStatus.IN_PRODUCTION && roll?.currentStepId === s1);
    check("depo: WO COMPLETED→IN_PROGRESS", (await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { status: true } }))?.status === "IN_PROGRESS");
  }

  // ═══ B1: STOCK top (WAREHOUSE değil) COMPLETED WO'da → üretime al reopen ═══
  console.log("\n── STOCK topu üretime al (COMPLETED WO reopen · B1) ──");
  {
    // Tambur ham parçayı STOCK'a (üretime devam) kesmiş → tüm adım COMPLETED → WO COMPLETED.
    const wo = await mkWo(c, [{ stationId: c.ST_INT }, { stationId: c.ST_TAMBUR }]);
    const [s1, s2] = wo.stepIds;
    const { batchId, rollIds } = await mkParty(c, wo.id, s2, 1);
    await prisma.rollMovement.updateMany({ where: { rollId: { in: rollIds }, exitedAt: null }, data: { exitedAt: new Date() } });
    await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { status: RollStatus.STOCK, currentStepId: null, producedInStepId: s2 } });
    await prisma.workOrder.update({ where: { id: wo.id }, data: { status: WorkOrderStatus.COMPLETED } });

    await svc.manualMove(wo.id, { batchId, targetStepId: s1, reason: "stok üretime" }, c.ADMIN);
    const roll = await prisma.roll.findUnique({ where: { id: rollIds[0] }, select: { status: true, currentStepId: true } });
    check("B1: STOCK top IN_PRODUCTION @ 1. adım", roll?.status === RollStatus.IN_PRODUCTION && roll?.currentStepId === s1);
    check("B1: STOCK topu da COMPLETED WO'yu yeniden açtı", (await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { status: true } }))?.status === "IN_PROGRESS");
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    const ids = [...woIds];
    if (ids.length === 0) return;
    const batches = await prisma.batch.findMany({ where: { workOrderId: { in: ids } }, select: { id: true } });
    const batchIds = batches.map((b) => b.id);
    const rolls = await prisma.roll.findMany({ where: { OR: [{ batchId: { in: batchIds } }, { barcode: { startsWith: "TST-MOV-" } }] }, select: { id: true } });
    const rollIds = rolls.map((r) => r.id);
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: { in: ids } } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: ids } } });
    await prisma.batch.deleteMany({ where: { id: { in: batchIds }, splitFromId: { not: null } } });
    await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: ids } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...ids, ...batchIds] } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: ids } } });
    console.log("(temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main().catch((e) => { console.error("HATA:", e); fail++; }).finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
