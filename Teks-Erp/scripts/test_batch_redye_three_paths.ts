// TEST (Faz 4.1): Parti ayırma — REDYE_SAME_COLOR (aynı renk yeniden boyama).
//   Boyanmış parti seçili topları AYNI iş emrinde YENİ partiye ayrılıp boyahane
//   adımına geri sarılır (renk sıfırlanır). NEW_COLOR artık UYGULANDI (WO klonu +
//   yeni renk); bu test yalnız REDYE_SAME_COLOR'u uçtan uca doğrular, NEW_COLOR'u
//   yalnız kapı-kontrolleriyle (yeni renk zorunlu) yıkıcı-olmayan biçimde yoklar.
//   Refakat kartı WO başına (parti yeni kart üretmez), TravelerCard.workOrderId @unique.
// Çalıştır: npx tsx scripts/test_batch_redye_three_paths.ts
import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { RollStatus } from "@prisma/client";

const WIDTH = 250;
const wos = new WorkOrderService();
let pass = 0, fail = 0;
function check(l: string, ok: boolean, x = ""): void { if (ok) { pass++; console.log(`  ✓ ${l}${x ? ` — ${x}` : ""}`); } else { fail++; console.log(`  ✗ FAIL: ${l}${x ? ` — ${x}` : ""}`); } }
async function expectReject(l: string, fn: () => Promise<unknown>, needle: string): Promise<void> {
  let m: string | null = null;
  try { await fn(); } catch (e) { m = e instanceof Error ? e.message : String(e); }
  check(l, m !== null && m.includes(needle), m ?? "hata atılmadı");
}
let bcN = 0;
function bc(): string { bcN++; return `TST-RDY-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bcN}`; }
let woId = "";

async function main(): Promise<void> {
  const need = (v: { id: string } | null, l: string): string => { if (!v) throw new Error(`Seed eksik: ${l}`); return v.id; };
  const ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  const GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "1.KALITE");
  const ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  const ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  const ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1");
  const CAT_BOYA = need(await prisma.subcontractorCategory.findFirst({ where: { code: "BOYA" }, select: { id: true } }), "BOYA");
  const COLOR = need(await prisma.color.findFirst({ where: { code: "MAVI" }, select: { id: true } }), "MAVI");

  const stamp = `${Date.now()}`.slice(-6);
  // step1 = BOYA_FASON (renk veren = colorStep), step2 = TAMBUR (boyahane sonrası).
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-RDY-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", width: WIDTH, targetQuantity: 1000, targetItemId: ITEM,
      steps: { create: [
        { stationId: ST_BOYA, stepSequence: 1, status: "PENDING", requiredCategoryId: CAT_BOYA },
        { stationId: ST_TAMBUR, stepSequence: 2, status: "PENDING" },
      ] },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woId = wo.id;
  const boyaStep = wo.steps[0].id;
  const tamburStep = wo.steps[1].id;

  // Kart WO açılışında doğar (karekod=İE). Test WO'yu doğrudan yarattığı için burada
  // simüle et — REDYE parti ayırmada yeni kart ÜRETİLMEDİĞİNİ (WO başına tek kart) doğrulayacağız.
  await prisma.travelerCard.create({
    data: { cardNumber: wo.workOrderNumber, barcode: wo.workOrderNumber, workOrderId: woId, version: 1, status: "ACTIVE", printedById: ADMIN },
  });

  // 4 STOCK top → attach → parti P1 (boyahane adımında IN_PRODUCTION).
  const bcs = [bc(), bc(), bc(), bc()];
  for (const b of bcs) await prisma.roll.create({ data: { barcode: b, itemId: ITEM, initialQty: 100, currentQty: 100, status: RollStatus.STOCK, qualityGrade: "1.KALITE", qualityGradeId: GRADE, width: WIDTH, createdById: ADMIN } });
  const attach = await wos.attachRolls(woId, bcs, ADMIN);
  const p1Id = attach.data!.batch!.id;

  // Boyanmış + döndü simülasyonu: topları Tambur adımına al + renk ver (MAVI).
  await prisma.roll.updateMany({ where: { batchId: p1Id }, data: { currentStepId: tamburStep, colorId: COLOR } });

  // Gate (yıkıcı DEĞİL — hiçbiri partiyi tüketmez): NEW_COLOR yeni renk ZORUNLU (400),
  // REDYE_SAME_COLOR'da yeni renk YASAK (400). Her ikisi de claim'den ÖNCE reddeder.
  await expectReject("NEW_COLOR'da yeni renk zorunlu (400)", () => wos.splitBranch(woId, { batchId: p1Id, mode: "NEW_COLOR" }, ADMIN), "yeni renk seçilmeli");
  await expectReject("REDYE_SAME_COLOR'da yeni renk yasak (400)", () => wos.splitBranch(woId, { batchId: p1Id, mode: "REDYE_SAME_COLOR", newColorId: COLOR }, ADMIN), "yeni renk verilemez");

  // Önizleme: REDYE_SAME_COLOR + NEW_COLOR izinli olmalı.
  const preview = await wos.getSplitPreview(woId, p1Id);
  const allowed = (preview.data as { allowedModes: string[] }).allowedModes;
  check("önizleme: REDYE_SAME_COLOR + NEW_COLOR izinli", allowed.includes("REDYE_SAME_COLOR") && allowed.includes("NEW_COLOR"), allowed.join(","));

  // REDYE_SAME_COLOR (tüm parti).
  const redye = await wos.splitBranch(woId, { batchId: p1Id, mode: "REDYE_SAME_COLOR" }, ADMIN);
  const p2Id = (redye.data as { newBatchId: string }).newBatchId;
  check("REDYE: yeni parti P2 oluştu", !!p2Id && p2Id !== p1Id, (redye.data as { newBatchNumber: string }).newBatchNumber);
  const p2 = await prisma.batch.findUnique({ where: { id: p2Id }, select: { splitFromId: true } });
  check("REDYE: P2 splitFrom = P1", p2?.splitFromId === p1Id);

  const p2Rolls = await prisma.roll.findMany({ where: { batchId: p2Id }, select: { status: true, currentStepId: true, colorId: true } });
  check("REDYE: 4 top P2'de", p2Rolls.length === 4, `n=${p2Rolls.length}`);
  check("REDYE: toplar boyahane adımına geri sarıldı", p2Rolls.every((r) => r.currentStepId === boyaStep), `steps=${[...new Set(p2Rolls.map(r=>r.currentStepId))].length}`);
  check("REDYE: toplar IN_PRODUCTION", p2Rolls.every((r) => r.status === RollStatus.IN_PRODUCTION));
  check("REDYE: renk sıfırlandı (yeniden boyanacak)", p2Rolls.every((r) => r.colorId === null));

  // Kart WO başına (parti kart üretmez): REDYE aynı WO içinde kaldığından yeni kart doğmaz —
  // WO'nun tek ACTIVE kartı hâlâ 1.
  check("REDYE: parti yeni kart üretmedi (WO başına tek ACTIVE kart)", (await prisma.travelerCard.count({ where: { workOrderId: woId, status: "ACTIVE" } })) === 1);
  check("REDYE: kaynak P1 soy-bağı düğümü olarak KALDI (boş)", (await prisma.batch.findUnique({ where: { id: p1Id }, select: { id: true } })) !== null && (await prisma.roll.count({ where: { batchId: p1Id } })) === 0);
  const openMv = await prisma.rollMovement.count({ where: { rollId: { in: p2Rolls.length ? (await prisma.roll.findMany({ where: { batchId: p2Id }, select: { id: true } })).map(r => r.id) : [] }, workOrderStepId: boyaStep, exitedAt: null } });
  check("REDYE: boyahanede taze açık movement var", openMv === 4, `open=${openMv}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  if (!woId) return;
  try {
    const batches = await prisma.batch.findMany({ where: { workOrderId: woId }, select: { id: true } });
    const batchIds = batches.map((b) => b.id);
    const rolls = await prisma.roll.findMany({ where: { OR: [{ batchId: { in: batchIds } }, { barcode: { startsWith: "TST-RDY-" } }] }, select: { id: true } });
    const rollIds = rolls.map((r) => r.id);
    await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    // Kart WO başına (workOrderId @unique) — batchId alanı yok.
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: woId } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: woId } });
    // splitFrom self-FK: çocukları önce (splitFromId dolu) sil.
    await prisma.batch.deleteMany({ where: { id: { in: batchIds }, splitFromId: { not: null } } });
    await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: woId } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, woId, ...batchIds] } } });
    await prisma.workOrder.delete({ where: { id: woId } });
    console.log("(temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main().catch((e) => { console.error("HATA:", e); fail++; }).finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
