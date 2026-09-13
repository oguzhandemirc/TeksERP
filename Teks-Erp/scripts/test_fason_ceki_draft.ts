// TEST: previewDownstreamFasonCeki — erken TASLAK boyahane çekisi, durum DEĞİŞTİRMEZ.
// Çalıştır: npx tsx scripts/test_fason_ceki_draft.ts
import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestDyeHouse, ensureTestSander } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus } from "@prisma/client";

let ITEM = "", GRADE = "", ADMIN = "", ST_ZIMPARA = "", ST_BOYA = "", ST_TAMBUR = "", SUB_KESTEL = "", SUB_BOYER = "";
let GRADE_CODE = "";
const WIDTH = 250;

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, l: string): string => { if (!v) throw new Error(`Seed eksik: ${l}`); return v.id; };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  const _gradeRow = await roleGrade("FIRST");
  GRADE = _gradeRow.id;
  GRADE_CODE = _gradeRow.code;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  ST_ZIMPARA = need(await prisma.station.findFirst({ where: { code: "ZIMPARA_FASON" }, select: { id: true } }), "ZIMPARA_FASON");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1");
  SUB_KESTEL = (await ensureTestSander()).id;
  SUB_BOYER = (await ensureTestDyeHouse()).id;
}
let BOYER_NAME = "";

const sub = new SubcontractorService();
const cards = new TravelerCardService();
let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
async function expectReject(label: string, fn: () => Promise<unknown>, needle: string): Promise<void> {
  let msg: string | null = null;
  try { await fn(); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  check(label, msg !== null && msg.includes(needle), msg ?? "hata atılmadı");
}
let bc = 0;
function barcode(): string { bc++; return `TST-CKD-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`; }
async function rollAtStep(qty: number, stepId: string): Promise<string> {
  const r = await prisma.roll.create({ data: { barcode: barcode(), itemId: ITEM, initialQty: qty, currentQty: qty, status: RollStatus.IN_PRODUCTION, currentStepId: stepId, qualityGrade: GRADE_CODE, qualityGradeId: GRADE, width: WIDTH, createdById: ADMIN } });
  return r.id;
}

let woId = "";
const stepIds: string[] = [];

async function main(): Promise<void> {
  await resolveFixtures();
  BOYER_NAME = (await ensureTestDyeHouse()).name;
  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-CKD-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", width: WIDTH, targetQuantity: 1000, targetItemId: ITEM,
      steps: { create: [
        { stationId: ST_ZIMPARA, stepSequence: 1, status: "PENDING", plannedSubcontractorId: SUB_KESTEL },
        { stationId: ST_BOYA, stepSequence: 2, status: "PENDING", plannedSubcontractorId: SUB_BOYER, notes: "Lacivert boya, yıkama yapma" },
        { stationId: ST_TAMBUR, stepSequence: 3, status: "PENDING" },
      ] },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woId = wo.id;
  const zimparaStep = wo.steps[0].id, boyaStep = wo.steps[1].id;
  stepIds.push(...wo.steps.map((s) => s.id));
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));

  // Boyahane adımı için, daha zımparaya sevk YAPILMADAN taslak → 400
  await expectReject(
    "Önceki fasonda mal yokken taslak reddedildi",
    () => sub.previewDownstreamFasonCeki(woId, boyaStep),
    "bekleyen mal yok",
  );
  // Zımpara adımı (öncesi yok) → 400
  await expectReject(
    "İlk fason adımında (öncesi yok) taslak reddedildi",
    () => sub.previewDownstreamFasonCeki(woId, zimparaStep),
    "öncesinde fason adımı yok",
  );

  // Zımparaya 2 top sevk
  const A = await rollAtStep(300, zimparaStep);
  const B = await rollAtStep(250, zimparaStep);
  await sub.bulkDispatchStep({ workOrderId: woId, stepId: zimparaStep }, ADMIN);

  // Durum SNAPSHOT (taslak öncesi)
  const before = await prisma.roll.findMany({ where: { id: { in: [A, B] } }, select: { id: true, status: true, currentStepId: true } });
  const dispBefore = await prisma.subcontractorDispatch.count({ where: { workOrderId: woId } });
  const recvBefore = await prisma.subcontractorReceipt.count({ where: { workOrderId: woId } });

  // Boyahane TASLAK çekisi üret
  const res = await sub.previewDownstreamFasonCeki(woId, boyaStep);
  const html = res.data.html;
  check("HTML döndü", typeof html === "string" && html.length > 200);
  check("TASLAK filigranı var", html.includes("TASLAK"));
  check("Boyahane firması (Boyer) çekide", html.includes(BOYER_NAME), BOYER_NAME);
  check("Doğru top sayısı (2) totals'da", html.includes(">2<"), "top say.");
  check("Toplam metre (550) çekide", html.includes("550"), "550 m");
  check("Fason talimatı (adım notu) çekide", html.includes("yıkama yapma"));
  check("İş emri parti kodu çekide", html.includes(wo.workOrderNumber));
  // ⚠️ EN = İŞ EMRİNİN eni, TEK değer (2026-08-06). Gerçek DB üzerinden kanıt:
  // payload iş emrinin enini taşıyor ve belge onu basıyor. Grid'de top başına
  // Cm sütunu ARTIK YOK — o sütun boş basılıp sahayı yanıltıyordu.
  check(`EN iş emrinden basılır (${WIDTH} cm)`, html.includes(`>${WIDTH} cm<`));
  // Grid'in Cm sütunu ELLE DOLDURULAN kutudur: başlık var, hücreler boş.
  // Toplar (WIDTH=250) dolu enle yaratıldığı hâlde kutulara değer YAZILMAZ.
  check("grid Cm kutuları boş basılır", !/<td class="c-cm">[^<]/.test(html));

  // Durum DEĞİŞMEDİ — taslak hiçbir kayda dokunmaz
  const after = await prisma.roll.findMany({ where: { id: { in: [A, B] } }, select: { id: true, status: true, currentStepId: true } });
  const same = before.every((b) => { const a = after.find((x) => x.id === b.id); return a && a.status === b.status && a.currentStepId === b.currentStepId; });
  check("Toplar AYNI durumda (taslak stok/durum değiştirmedi)", same);
  const dispAfter = await prisma.subcontractorDispatch.count({ where: { workOrderId: woId } });
  const recvAfter = await prisma.subcontractorReceipt.count({ where: { workOrderId: woId } });
  check("Yeni sevk kaydı oluşmadı", dispAfter === dispBefore, `${dispBefore}→${dispAfter}`);
  check("Yeni kabul kaydı oluşmadı", recvAfter === recvBefore, `${recvBefore}→${recvAfter}`);

  console.log(`\nSONUÇ: ${pass} geçti, ${fail} başarısız`);
}

async function cleanup(): Promise<void> {
  if (!woId) return;
  try {
    const rolls = await prisma.roll.findMany({ where: { OR: [{ currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } }, { parentReceipt: { workOrderId: woId } }, { barcode: { startsWith: "TST-CKD-" } }] }, select: { id: true } });
    const rollIds = rolls.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: woId }, select: { id: true } });
    const dispatchIds = dispatches.map((d) => d.id);
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: woId } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: woId } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...dispatchIds, woId] } } });
    await prisma.batch.deleteMany({ where: { workOrderId: woId } });
    await prisma.workOrder.delete({ where: { id: woId } });
    console.log("(temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main().catch((e) => { console.error("HATA:", e); fail++; }).finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
