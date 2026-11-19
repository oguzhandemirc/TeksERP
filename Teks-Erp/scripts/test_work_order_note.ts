// =============================================================================
// BEKÇİ — İŞ EMRİ PLANLAMA NOTU (2026-11-19)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_work_order_note
// =============================================================================
//  §1 Boş iş emri → body null · yaz (trim) → oku · son düzenleyen künyesi
//  §2 Aynı not → "değişmedi", audit yazılmaz · 2001 karakter 400 (servis + route şeması)
//  §3 Temizle (boş/boşluk) → body null, satır SİLİNMEZ (tek satır, body "")
//  §4 Audit: PLANNING_NOTE_SET + PLANNING_NOTE_CLEARED ayak izi
//  §5 Not iş emri detayına (`findById`) ve Tambur bağlamına SIZMAZ
//  §6 Route kapısı: GET read|write, PUT yalnız write · olmayan iş emri 404
//
// NEGATİF SONDALAR (2026-11-19, elle bozulup koşuldu, geri alındı):
//  S1 servisteki `rawBody.trim()` → `rawBody` → §1b/§3a kırmızı.
//  S2 PUT route'unda `requirePermission("workorder:write")` → `requireAnyPermission("workorder:read", "workorder:write")` → §6c kırmızı.
// =============================================================================
import type { NextFunction, Request, Response } from "express";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { WorkOrderService } from "../src/services/workorder.service";
import { getWorkOrderNote, setWorkOrderNote } from "../src/services/workorder-note.service";
import { workOrderPlanningRouter } from "../src/routes/workorder-planning.routes";
import { testActorId } from "./fixture-test-user";
import { findRouteLayer } from "./lib/router-katmani";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t} ──`); }

const STAMP = `${process.pid % 10000}${Date.now().toString(36).slice(-4)}`;
const P = `TEST-WONOTE-${STAMP}`;
const fx = { woIds: [] as string[], itemIds: [] as string[], stationIds: [] as string[] };

function gate(path: string, method: string, permissions: string[]): { ok: boolean; err: unknown } | null {
  const layer = findRouteLayer(workOrderPlanningRouter, path, method);
  if (!layer?.route) return null;
  const chain = layer.route.stack;
  if (chain.length < 3 || chain[0]!.name !== "verifyToken") return null;
  const req = { user: { userId: "x", permissions }, params: {}, body: {} } as unknown as Request;
  for (const l of chain.slice(1, -1)) {
    let called = false;
    let err: unknown;
    l.handle(req, {} as Response, ((e?: unknown) => { called = true; err = e; }) as NextFunction);
    if (!called || err) return { ok: false, err };
  }
  return { ok: true, err: null };
}

async function main(): Promise<void> {
  console.log("=== İş emri planlama notu ===");
  const actor = await testActorId();
  const item = await prisma.item.create({ data: { code: `${P}-ITM`, name: `TEST WONOTE ${STAMP}`, itemType: "FABRIC" }, select: { id: true } });
  fx.itemIds.push(item.id);
  const st = await prisma.station.create({ data: { code: `${P}-TMB`.slice(0, 32), name: `TEST WONOTE TMB ${STAMP}`, type: "INTERNAL", kind: "TAMBUR" }, select: { id: true } });
  fx.stationIds.push(st.id);
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${P}-WO1`, type: "STOCK_PRODUCTION", status: "PLANNED", targetItemId: item.id, steps: { create: [{ stationId: st.id, stepSequence: 1 }] } },
    select: { id: true },
  });
  fx.woIds.push(wo.id);
  const auditCount = (event: string) => prisma.systemLog.count({ where: { recordId: wo.id, newData: { path: ["event"], equals: event } } });

  section("§1 Yaz / oku");
  const empty = await getWorkOrderNote(wo.id);
  check("§1a not yok → body null", empty.data?.body === null && empty.data.updatedBy === null);
  await setWorkOrderNote(wo.id, "  Önce beyazlar boyansın.\nSonra krem.  ", actor);
  const r1 = await getWorkOrderNote(wo.id);
  check("§1b yazılan not kırpılarak okunur", r1.data?.body === "Önce beyazlar boyansın.\nSonra krem.", JSON.stringify(r1.data?.body));
  check("§1c son düzenleyen künyesi dolu", r1.data?.updatedBy?.id === actor && !!r1.data.updatedAt);

  section("§2 Değişmeyen not · sınır");
  const same = await setWorkOrderNote(wo.id, "Önce beyazlar boyansın.\nSonra krem.", actor);
  check("§2a aynı not → 'değişmedi', ek audit yok", same.message === "Not değişmedi." && (await auditCount("PLANNING_NOTE_SET")) === 1);
  let tooLong: unknown = null;
  try { await setWorkOrderNote(wo.id, "x".repeat(2001), actor); } catch (e) { tooLong = e; }
  check("§2b 2001 karakter → 400", tooLong instanceof AppError && tooLong.statusCode === 400);
  const ok2000 = await setWorkOrderNote(wo.id, "y".repeat(2000), actor);
  check("§2c 2000 karakter kabul", ok2000.data?.body?.length === 2000);

  section("§3 Temizle");
  await setWorkOrderNote(wo.id, "   ", actor);
  const cleared = await getWorkOrderNote(wo.id);
  const rows = await prisma.workOrderNote.findMany({ where: { workOrderId: wo.id }, select: { body: true } });
  check("§3a temizlenen not → body null", cleared.data?.body === null);
  check("§3b satır SİLİNMEZ: tek satır, body boş", rows.length === 1 && rows[0]!.body === "", JSON.stringify(rows));

  section("§4 Audit");
  check("§4 SET ×2 + CLEARED ×1", (await auditCount("PLANNING_NOTE_SET")) === 2 && (await auditCount("PLANNING_NOTE_CLEARED")) === 1);

  section("§5 Sızıntı yok");
  await setWorkOrderNote(wo.id, "GIZLI-PLAN-NOTU", actor);
  const detail = JSON.stringify((await new WorkOrderService().findById(wo.id)).data);
  check("§5 iş emri detayında not metni yok", !detail.includes("GIZLI-PLAN-NOTU") && !detail.includes("planningNote"));

  section("§6 Route kapısı");
  check("§6a GET read ile geçer", gate("/note", "get", ["workorder:read"])?.ok === true);
  check("§6b PUT write ile geçer", gate("/note", "put", ["workorder:write"])?.ok === true);
  const denied = gate("/note", "put", ["workorder:read"]);
  check("§6c PUT yalnız read → 403", denied?.ok === false && denied.err instanceof AppError && denied.err.statusCode === 403);
  let nf: unknown = null;
  try { await getWorkOrderNote("00000000-0000-4000-8000-000000000000"); } catch (e) { nf = e; }
  check("§6d olmayan iş emri → 404", nf instanceof AppError && nf.statusCode === 404);
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  await prisma.workOrderEvent.deleteMany({ where: { workOrderId: { in: fx.woIds } } }).catch(() => undefined);
  await del("not", () => prisma.workOrderNote.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("travelerCard", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("item", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  const left = await prisma.workOrder.count({ where: { workOrderNumber: { startsWith: P } } });
  check("temizlik: TEST-WONOTE kalıntısı yok", left === 0, String(left));
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    await cleanup().catch((e) => { fail++; console.error(e); });
    if (pass + fail === 0) { fail++; console.log("❌ hiçbir kontrol koşmadı"); }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end().catch(() => {});
  });
