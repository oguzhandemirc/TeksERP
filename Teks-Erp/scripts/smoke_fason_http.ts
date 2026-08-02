// LIVE SMOKE (HTTP): O1/O2/O3 fason uçlarını ÇALIŞAN sunucuya (localhost:4000) karşı
// uçtan uca dener — route + auth + RBAC + Zod + controller + service tam yolu. Birim
// testler bu katmanları atlar; bu smoke gerçek HTTP üzerinden doğrular.
// ÖN KOŞUL: backend ayakta olmalı. Çalıştır: npx tsx scripts/smoke_fason_http.ts
import prisma from "../src/lib/prisma";
import { ensureTestDyeHouse, ensureTestSander } from "./fixture-subcontractor";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus } from "@prisma/client";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:4000";
const cards = new TravelerCardService();
let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

let TOKEN = "";
async function api(method: string, path: string, body?: unknown, auth = true): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth && TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json: any = null;
  try { json = await res.json(); } catch { /* boş gövde */ }
  return { status: res.status, json };
}

let ITEM = "", GRADE = "", ADMIN = "", ST_ZIMPARA = "", ST_BOYA = "", ST_TAMBUR = "", SUB_KESTEL = "", SUB_BOYER = "";
const WIDTH = 250;
let bc = 0;
function barcode(): string { bc++; return `TST-SMK-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`; }
const woIds: string[] = [];

async function fx(): Promise<void> {
  const need = (v: { id: string } | null, l: string): string => { if (!v) throw new Error(`Seed eksik: ${l}`); return v.id; };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "1.KALITE");
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  ST_ZIMPARA = need(await prisma.station.findFirst({ where: { code: "ZIMPARA_FASON" }, select: { id: true } }), "ZIMPARA_FASON");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1");
  SUB_KESTEL = (await ensureTestSander()).id;
  SUB_BOYER = (await ensureTestDyeHouse()).id;
}
async function rollAtStep(qty: number, stepId: string): Promise<string> {
  const r = await prisma.roll.create({ data: { barcode: barcode(), itemId: ITEM, initialQty: qty, currentQty: qty, status: RollStatus.IN_PRODUCTION, currentStepId: stepId, qualityGrade: "1.KALITE", qualityGradeId: GRADE, width: WIDTH, createdById: ADMIN } });
  return r.id;
}
async function freeStock(qty: number): Promise<string> {
  const r = await prisma.roll.create({ data: { barcode: barcode(), itemId: ITEM, initialQty: qty, currentQty: qty, status: RollStatus.STOCK, qualityGrade: "1.KALITE", qualityGradeId: GRADE, width: WIDTH, createdById: ADMIN } });
  return r.id;
}
async function makeWo(): Promise<{ woId: string; zimparaStep: string; boyaStep: string }> {
  const stamp = `${Date.now()}`.slice(-6) + woIds.length;
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-SMK-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", width: WIDTH, targetQuantity: 1000, targetItemId: ITEM,
      steps: { create: [
        { stationId: ST_ZIMPARA, stepSequence: 1, status: "PENDING", plannedSubcontractorId: SUB_KESTEL },
        { stationId: ST_BOYA, stepSequence: 2, status: "PENDING", plannedSubcontractorId: SUB_BOYER },
        { stationId: ST_TAMBUR, stepSequence: 3, status: "PENDING" },
      ] },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woIds.push(wo.id);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  return { woId: wo.id, zimparaStep: wo.steps[0].id, boyaStep: wo.steps[1].id };
}

async function main(): Promise<void> {
  await fx();

  // ── AUTH ──
  const login = await api("POST", "/api/auth/login", { username: "admin", password: "123123" }, false);
  TOKEN = login.json?.data?.token ?? login.json?.token ?? "";
  check("login 200 + token", login.status === 200 && TOKEN.length > 0, `status=${login.status}`);

  const { woId, zimparaStep, boyaStep } = await makeWo();
  const A = await rollAtStep(300, zimparaStep);
  const B = await rollAtStep(300, zimparaStep);

  // ── RBAC: token'sız preview → 401 ──
  const noAuth = await api("GET", `/api/subcontractor/dispatches/${"00000000-0000-0000-0000-000000000000"}/undo-transfer-preview`, undefined, false);
  check("Token'sız istek 401", noAuth.status === 401, `status=${noAuth.status}`);

  // ── O2: ROUTE_SKIP (serbest stoğu doğrudan boyahaneye) ──
  const C = await freeStock(200);
  const skip = await api("POST", "/api/subcontractor/dispatch", { workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER, rollIds: [C] });
  check("Doğrudan boyahane sevki 400 + ROUTE_SKIP", skip.status === 400 && skip.json?.details?.code === "ROUTE_SKIP", `status=${skip.status} code=${skip.json?.details?.code}`);
  const skipOk = await api("POST", "/api/subcontractor/dispatch", { workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER, rollIds: [C], allowRouteSkip: true });
  check("allowRouteSkip:true ile sevk 201", skipOk.status === 201, `status=${skipOk.status}`);

  // ── Aktarım kurulumu: zımparaya bulk sevk + sonraki fasona aktar ──
  const bulk = await api("POST", "/api/subcontractor/dispatch/bulk", { workOrderId: woId, stepId: zimparaStep });
  check("Zımpara bulk sevk 201", bulk.status === 201, `status=${bulk.status}`);
  const transfer = await api("POST", "/api/subcontractor/transfer-next", { workOrderId: woId, stepId: zimparaStep });
  const boyaDispatchId = transfer.json?.data?.id as string;
  check("transfer-next 201 + dispatchId", transfer.status === 201 && !!boyaDispatchId, `status=${transfer.status}`);

  // ── O1: undo-transfer-preview (HTTP) ──
  const prev = await api("GET", `/api/subcontractor/dispatches/${boyaDispatchId}/undo-transfer-preview`);
  check("undo-transfer-preview 200 + safe=true", prev.status === 200 && prev.json?.data?.safe === true, `status=${prev.status} safe=${prev.json?.data?.safe}`);
  check("preview born=2 + kaynak kabul>=1", (prev.json?.data?.bornRolls?.length === 2) && (prev.json?.data?.sourceReceipts?.length >= 1), `born=${prev.json?.data?.bornRolls?.length} rcpt=${prev.json?.data?.sourceReceipts?.length}`);

  // ── O1: undo-transfer (HTTP) ──
  const undo = await api("POST", `/api/subcontractor/dispatches/${boyaDispatchId}/undo-transfer`, { reason: "smoke: yanlış aktarım geri alma" });
  check("undo-transfer 200", undo.status === 200, `status=${undo.status} msg=${undo.json?.message ?? ""}`);

  // DB doğrulama: A,B kaynak fasona döndü
  const aAfter = await prisma.roll.findUnique({ where: { id: A }, select: { status: true, currentStepId: true } });
  check("A geri döndü AT_SUBCONTRACTOR @ zımpara", aAfter?.status === RollStatus.AT_SUBCONTRACTOR && aAfter?.currentStepId === zimparaStep, String(aAfter?.status));
  void B;

  // ── O3: branches HTTP — isTransferOutput alanı + boyahane CANCELLED + boş RETURNED yok ──
  const branches = await api("GET", `/api/work-orders/${woId}/branches`);
  const bs = (branches.json?.data?.branches ?? []) as Array<{ dispatchId: string; status: string; isTransferOutput: boolean; currentPositions: unknown[] }>;
  check("branches 200", branches.status === 200, `status=${branches.status}`);
  check("branch.isTransferOutput alanı geliyor", bs.every((b) => typeof b.isTransferOutput === "boolean"), `n=${bs.length}`);
  check("boyahane dalı CANCELLED", bs.some((b) => b.dispatchId === boyaDispatchId && b.status === "CANCELLED"), bs.map((b) => b.status).join(","));
  check("boş RETURNED artefaktı yok", !bs.some((b) => b.status === "RETURNED" && b.currentPositions.length === 0), "ok");

  // ── Negatif: çift undo → 409 ──
  const undo2 = await api("POST", `/api/subcontractor/dispatches/${boyaDispatchId}/undo-transfer`, { reason: "ikinci kez" });
  check("Çift undo 409", undo2.status === 409, `status=${undo2.status}`);

  // ── Negatif: reason < 3 → 400 (Zod) ──
  const badReason = await api("POST", `/api/subcontractor/dispatches/${boyaDispatchId}/undo-transfer`, { reason: "x" });
  check("Kısa sebep 400 (Zod)", badReason.status === 400, `status=${badReason.status}`);

  console.log(`\nSONUÇ: ${pass} geçti, ${fail} başarısız`);
}

async function cleanup(): Promise<void> {
  if (woIds.length === 0) return;
  try {
    const stepRows = await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const stepIds = stepRows.map((s) => s.id);
    const rolls = await prisma.roll.findMany({ where: { OR: [{ currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } }, { parentReceipt: { workOrderId: { in: woIds } } }, { barcode: { startsWith: "TST-SMK-" } }] }, select: { id: true } });
    const rollIds = rolls.map((r) => r.id);
    const receipts = await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const receiptIds = receipts.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const dispatchIds = dispatches.map((d) => d.id);
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: { in: woIds } } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, ...woIds] } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    console.log("(temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main().catch((e) => { console.error("HATA:", e); fail++; }).finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
