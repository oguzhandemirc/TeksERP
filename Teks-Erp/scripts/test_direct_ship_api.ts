// TEST: Fasondan Doğrudan Sevk — GERÇEK HTTP/API + RBAC + Zod (mock YOK).
// Gerçek Express app'i (src/app) ephemeral portta ayağa kaldırır, GERÇEK login
// token'larıyla (admin + izinsiz kullanıcı fatma.satis) tüm uç noktayı sınar:
// 200/400/404/409/403 + Zod doğrulama + idempotency. verifyToken + requireAny
// + uuid-param + error.middleware zincirinin TAMAMI test edilir.
//
// Çalıştır (dev DB + .env JWT_SECRET): npx tsx scripts/test_direct_ship_api.ts
import type { AddressInfo } from "net";
import app from "../src/app";
import prisma from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { AuthService } from "../src/services/auth.service";
import { RollStatus } from "@prisma/client";

let ITEM = "", GRADE = "", ADMIN = "", ST_BOYA = "", SUB_BOYER = "", CUSTOMER = "";
// Geçici 0-izinli kullanıcı (seed test kullanıcıları kaldırıldı — test kendi üretir/temizler).
let NOPERM_USER_ID = "";
const NOPERM_USERNAME = `dsapinoperm${Date.now()}`;
const sub = new SubcontractorService();
const cards = new TravelerCardService();
let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

let bc = 0;
const barcode = () => `TST-API-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc++}`;
const woIds: string[] = [], stepIds: string[] = [], orderIds: string[] = [];

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, l: string): string => { if (!v) throw new Error(`fixture eksik: ${l}`); return v.id; };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "grade");
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  SUB_BOYER = need(await prisma.subcontractor.findFirst({ where: { code: "BOYER" }, select: { id: true } }), "BOYER");
  CUSTOMER = need(await prisma.customer.findFirst({ where: { code: "MUS-001" }, select: { id: true } }), "MUS-001");
  // İzinsiz (0-permission) test kullanıcısı — RBAC 403 senaryosu için.
  const nop = await prisma.user.create({
    data: { username: NOPERM_USERNAME, fullName: "DS API NoPerm", passwordHash: await AuthService.hashPassword("test123456") },
    select: { id: true },
  });
  NOPERM_USER_ID = nop.id;
}

async function makeDispatch(): Promise<string> {
  const stamp = `${Date.now()}`.slice(-6) + Math.floor(Math.random() * 1000);
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `TST-API-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", width: 250, targetQuantity: 1000, targetItemId: ITEM, steps: { create: [{ stationId: ST_BOYA, stepSequence: 1, status: "PENDING" }] } },
    include: { steps: true },
  });
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  woIds.push(wo.id); stepIds.push(wo.steps[0].id);
  const r = await prisma.roll.create({ data: { barcode: barcode(), itemId: ITEM, initialQty: 300, currentQty: 300, status: RollStatus.STOCK, qualityGrade: "1.KALITE", qualityGradeId: GRADE, width: 250, createdById: ADMIN } });
  const d = await sub.dispatch({ workOrderId: wo.id, stepId: wo.steps[0].id, subcontractorId: SUB_BOYER, rollIds: [r.id] }, ADMIN);
  return (d.data as { id: string }).id;
}

async function main(): Promise<void> {
  await resolveFixtures();
  const server = app.listen(0);
  await new Promise<void>((res) => server.once("listening", () => res()));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  console.log(`Test server :${port}`);

  const login = async (username: string, password: string): Promise<string | null> => {
    const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
    if (r.status !== 200) return null;
    const b = await r.json();
    return b?.data?.token ?? b?.token ?? null;
  };
  type Resp = { status: number; body: { message?: string; data?: { dispatchNo?: string; alreadyDirectShipped?: boolean } } };
  const call = async (method: string, path: string, token: string | null, body?: unknown): Promise<Resp> => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let parsed: Resp["body"] = {};
    try { parsed = await r.json(); } catch { /* boş gövde */ }
    return { status: r.status, body: parsed };
  };

  try {
    const adminTok = await login("admin", "123123");
    const noPermTok = await login(NOPERM_USERNAME, "test123456");
    check("admin login → token", adminTok != null);
    check("izinsiz kullanıcı login → token", noPermTok != null);
    if (!adminTok) throw new Error("admin login başarısız — testler koşamaz");

    // --- RBAC ---
    console.log("\n--- RBAC ---");
    const d1 = await makeDispatch();
    const noAuth = await call("POST", `/api/subcontractor/dispatches/${d1}/direct-ship`, null, { reason: "token yok" });
    check("token YOK → 401", noAuth.status === 401, String(noAuth.status));
    if (noPermTok) {
      const r403 = await call("POST", `/api/subcontractor/dispatches/${d1}/direct-ship`, noPermTok, { reason: "izinsiz kullanıcı" });
      check("workorder:write OLMAYAN kullanıcı → 403", r403.status === 403, String(r403.status));
      const p403 = await call("GET", `/api/subcontractor/dispatches/${d1}/direct-ship-preview`, noPermTok);
      check("izinsiz preview → 403", p403.status === 403, String(p403.status));
    }

    // --- Zod / validation ---
    console.log("\n--- Zod doğrulama ---");
    const noReason = await call("POST", `/api/subcontractor/dispatches/${d1}/direct-ship`, adminTok, {});
    check("reason yok → 400", noReason.status === 400, String(noReason.status));
    const shortReason = await call("POST", `/api/subcontractor/dispatches/${d1}/direct-ship`, adminTok, { reason: "ab" });
    check("kısa reason → 400", shortReason.status === 400, String(shortReason.status));
    const badQty = await call("POST", `/api/subcontractor/dispatches/${d1}/direct-ship`, adminTok, { reason: "geçerli sebep", orderLineAllocations: [{ orderLineId: "11111111-1111-1111-1111-111111111111", qty: -5 }] });
    check("negatif qty → 400 (Zod positive)", badQty.status === 400, String(badQty.status));
    const badUuidInBody = await call("POST", `/api/subcontractor/dispatches/${d1}/direct-ship`, adminTok, { reason: "geçerli sebep", orderLineAllocations: [{ orderLineId: "not-a-uuid", qty: 5 }] });
    check("orderLineId geçersiz uuid → 400 (Zod)", badUuidInBody.status === 400, String(badUuidInBody.status));

    // --- 404 / geçersiz path uuid ---
    console.log("\n--- 404 / geçersiz id ---");
    const unknown = await call("POST", `/api/subcontractor/dispatches/99999999-9999-9999-9999-999999999999/direct-ship`, adminTok, { reason: "bilinmeyen dispatch" });
    check("bilinmeyen dispatchId → 404", unknown.status === 404, String(unknown.status));
    const badPath = await call("POST", `/api/subcontractor/dispatches/not-uuid/direct-ship`, adminTok, { reason: "geçersiz path uuid" });
    check("geçersiz path uuid → 4xx (500 DEĞİL)", badPath.status >= 400 && badPath.status < 500, String(badPath.status));

    // --- 200 geçerli + idempotency ---
    console.log("\n--- 200 geçerli akış + idempotency ---");
    const ok = await call("POST", `/api/subcontractor/dispatches/${d1}/direct-ship`, adminTok, { reason: "geçerli doğrudan sevk" });
    check("geçerli direct-ship → 200", ok.status === 200, `${ok.status} ${ok.body.message ?? ""}`);
    const retry = await call("POST", `/api/subcontractor/dispatches/${d1}/direct-ship`, adminTok, { reason: "idempotent retry" });
    check("aynı sevke tekrar → 200 (idempotent cached)", retry.status === 200 && retry.body.data?.alreadyDirectShipped === true, String(retry.status));

    // --- preview 200 ---
    console.log("\n--- preview 200 ---");
    const d2 = await makeDispatch();
    const pv = await call("GET", `/api/subcontractor/dispatches/${d2}/direct-ship-preview`, adminTok);
    check("preview (admin) → 200", pv.status === 200, String(pv.status));

    // --- 409 guard: iptal edilmiş sevk ---
    console.log("\n--- 409 guard ---");
    const d3 = await makeDispatch();
    await sub.cancel(d3, "api test iptal", ADMIN);
    const cancelled = await call("POST", `/api/subcontractor/dispatches/${d3}/direct-ship`, adminTok, { reason: "iptal edilmiş sevk" });
    check("iptal edilmiş sevk → 409", cancelled.status === 409, String(cancelled.status));

    console.log(`\n──────────────────────────────────────────`);
    console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  } finally {
    await new Promise<void>((res) => server.close(() => res()));
    await cleanup();
  }
}

async function cleanup(): Promise<void> {
  if (NOPERM_USER_ID) {
    await prisma.userPermission.deleteMany({ where: { userId: NOPERM_USER_ID } }).catch(() => {});
    // Login artık Session kaydı yaratıyor (jti registry) → user silmeden önce temizle
    // (sessions.userId onDelete Restrict).
    await prisma.session.deleteMany({ where: { userId: NOPERM_USER_ID } }).catch(() => {});
    await prisma.user.delete({ where: { id: NOPERM_USER_ID } }).catch(() => {});
  }
  if (woIds.length === 0) return;
  try {
    const rolls = await prisma.roll.findMany({ where: { OR: [{ currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } }, { barcode: { startsWith: "TST-API-" } }] }, select: { id: true } });
    const rollIds = rolls.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const dispatchIds = dispatches.map((d) => d.id);
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: dispatchIds } } });
    await prisma.subcontractorDirectShipAllocation.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...dispatchIds, ...woIds] } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata:", e instanceof Error ? e.message : e);
  }
}

main().catch((e) => { console.error("HATA:", e); fail++; }).finally(async () => { await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
