// =============================================================================
// TEST: ONAYLI GELEN BELGE İPTALİ (K15) — önizleme + iptal (servis + HTTP, gerçek DB)
// =============================================================================
//   §1 ⭐ onaylı belge, biri başlamamış iş emrinde iki top: önizleme her topu + iş emrini (seçilebilir) listeler, YAZMAZ
//   §2 ⭐ iş emri seçilmeden iptal → 409 DELIVERY_NOTE_CANCEL_BLOCKED (WORK_ORDER_NOT_SELECTED), hiçbir şey yazılmaz;
//      ilgisiz iş emri kimliği → 400 DELIVERY_NOTE_CANCEL_WO_INVALID; sebepsiz → 400
//   §3 ⭐ iş emri seçili iptal → belge CANCELLED, toplar CANCELLED (GELEN_BELGE_IPTAL), iş emri CANCELLED; belge satırları,
//      ENTRY_RECEIPT defter satırları DURUR + her topa ROLL_CANCEL ters satırı; iş emri olayı belgeye bağlı
//   §4 ⭐ replay: aynı token+sebep → aynı yanıt; aynı token başka sebep → 409 CLIENT_TOKEN_COLLISION; yeni token → 409 NOT_CANCELLABLE
//   §5 ⭐ mükerrer: iptalden ÖNCE aynı senderDocNo reddedilir, SONRA yeni belge girilir
//   §6 ⭐ engeller: başlamış iş emri (seçili olsa da) + sevk edilmiş top → 409 BLOCKED (iki kod), belge/top/iş emri yerinde
//   §7 taslak → 409 DELIVERY_NOTE_NOT_CANCELLABLE (taslak silme ayrı yol)
//   §8 HTTP: yalnız gelen-belge:read → iki uç 403; admin önizleme 200 + engel listesi; kısa sebep 400
// Negatif sonda (2026-11-03 koşuldu): `evaluateNoteCancel`teki WORK_ORDER_NOT_SELECTED dalı silinince §2 kırmızı
// (iptal geçer, açık iş emri boşa düşer).
// Çalıştır: npx tsx scripts/test_gelen_belge_iptal.ts
// =============================================================================
import crypto from "node:crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";
import * as bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { AppError } from "../src/utils/app-error";
import { createDeliveryNote } from "../src/services/gelen-belge-note.service";
import { approveDeliveryNote } from "../src/services/gelen-belge-onay.service";
import { cancelDeliveryNote } from "../src/services/gelen-belge-iptal.service";
import { previewDeliveryNoteCancel } from "../src/services/gelen-belge-iptal-onizleme.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exitCode = 1;
}

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const TAG = `TST-GBI${Date.now().toString(36).toUpperCase()}Z`;
const SETTINGS = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED];
const made = { notes: [] as string[], items: [] as string[], customers: [] as string[], routes: [] as string[], stations: [] as string[], users: [] as string[] };
const svc = new WorkOrderService();

async function errorOf(fn: () => Promise<unknown>): Promise<{ status: number; code?: string; blockers?: Array<{ code: string }> } | null> {
  try { await fn(); return null; } catch (e) {
    if (e instanceof AppError) {
      const d = e.details as { code?: string; blockers?: Array<{ code: string }> } | undefined;
      return { status: e.statusCode, code: d?.code, blockers: d?.blockers };
    }
    return { status: 500, code: (e as Error).message.slice(0, 200) };
  }
}

interface Fx { actorId: string; owner: string; fabric: string; route: string }

async function fixture(): Promise<Fx> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of SETTINGS) await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: true }, update: { value: true } });
  const owner = (await prisma.customer.create({ data: { code: `${TAG}-OWN`, name: `${TAG} sahip` }, select: { id: true } })).id;
  made.customers.push(owner);
  const fabric = (await prisma.item.create({ data: { code: `${TAG}-KUM`, name: `${TAG} perde`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  made.items.push(fabric);
  const station = await prisma.station.create({ data: { code: `${TAG}-STN`.slice(0, 32), name: `${TAG} kurşun`, type: "INTERNAL" }, select: { id: true } });
  made.stations.push(station.id);
  const route = await prisma.route.create({ data: { name: `${TAG} rota`, steps: { create: [{ stationId: station.id, sequence: 1 }] } }, select: { id: true } });
  made.routes.push(route.id);
  return { actorId: admin.id, owner, fabric, route: route.id };
}

async function approvedNote(fx: Fx, docNo: string, n: number): Promise<{ id: string; rolls: Array<{ id: string; barcode: string }> }> {
  const note = await createDeliveryNote({
    sourceKind: "MANUAL", ownerCustomerId: fx.owner, senderText: `${TAG} GÖNDEREN`, senderDocNo: docNo,
    lines: Array.from({ length: n }, (_, i) => ({ senderRollNo: `${docNo}-${i + 1}`, meters: 40 + i, itemId: fx.fabric })),
  }, fx.actorId);
  made.notes.push(note.id);
  await approveDeliveryNote(note.id, {}, fx.actorId);
  const lines = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: note.id, rollId: { not: null } }, orderBy: { lineNo: "asc" }, select: { roll: { select: { id: true, barcode: true } } } });
  return { id: note.id, rolls: lines.map((l) => ({ id: l.roll!.id, barcode: l.roll!.barcode! })) };
}

async function openWo(fx: Fx, barcodes: string[]): Promise<string> {
  const r = await svc.quickStart({ rollBarcodes: barcodes, routeTemplateId: fx.route }, fx.actorId);
  return r.data!.workOrder.id;
}

async function scenarioMain(fx: Fx): Promise<void> {
  const docNo = `${TAG}-A`;
  const a = await approvedNote(fx, docNo, 2);
  const wo = await openWo(fx, [a.rolls[0]!.barcode]);
  const woRow = await prisma.workOrder.findUnique({ where: { id: wo }, select: { status: true } });

  console.log("§1 Önizleme");
  const pv = await previewDeliveryNoteCancel(a.id);
  check("§1 ⭐ iki top listelenir, ikisi de CANCEL", pv.rolls.length === 2 && pv.rolls.every((r) => r.outcome === "CANCEL"), pv.rolls.map((r) => `${r.barcode}:${r.status}:${r.outcome}:${r.location}`).join(" "));
  const pw = pv.workOrders[0];
  check("§1 ⭐ işlem görmemiş (top bağlı, IN_PROGRESS) iş emri seçilebilir (1 belge topu, 0 başka)", pv.workOrders.length === 1 && pw?.id === wo && pw.selectable && pw.noteRollCount === 1 && pw.otherRollCount === 0, `${woRow?.status} ${JSON.stringify(pw)}`);
  check("§1 sert engel yok, cancellable", pv.cancellable && pv.blockers.length === 0, JSON.stringify(pv.blockers));
  const st = await prisma.customerDeliveryNote.findUnique({ where: { id: a.id }, select: { status: true } });
  check("§1 önizleme YAZMAZ (belge APPROVED)", st?.status === "APPROVED");

  console.log("§2 Seçimsiz / ilgisiz / sebepsiz");
  const token = crypto.randomUUID();
  const e1 = await errorOf(() => cancelDeliveryNote(a.id, { clientToken: crypto.randomUUID(), reason: "Yanlış belge girildi" }, fx.actorId));
  check("§2 ⭐ seçilmeyen açık iş emri → 409 BLOCKED (WORK_ORDER_NOT_SELECTED)", e1?.status === 409 && e1.code === "DELIVERY_NOTE_CANCEL_BLOCKED" && !!e1.blockers?.some((b) => b.code === "WORK_ORDER_NOT_SELECTED"), JSON.stringify(e1));
  const after1 = await prisma.customerDeliveryNote.findUnique({ where: { id: a.id }, select: { status: true, cancelClientToken: true } });
  const rollsAfter1 = await prisma.roll.findMany({ where: { id: { in: a.rolls.map((r) => r.id) } }, select: { status: true } });
  check("§2 ⭐ engelde hiçbir şey yazılmadı", after1?.status === "APPROVED" && after1.cancelClientToken === null && rollsAfter1.every((r) => r.status !== "CANCELLED"));
  const e2 = await errorOf(() => cancelDeliveryNote(a.id, { clientToken: crypto.randomUUID(), reason: "Yanlış belge", workOrderIds: [wo, crypto.randomUUID()] }, fx.actorId));
  check("§2 ilgisiz iş emri → 400 DELIVERY_NOTE_CANCEL_WO_INVALID", e2?.status === 400 && e2.code === "DELIVERY_NOTE_CANCEL_WO_INVALID", JSON.stringify(e2));
  const e3 = await errorOf(() => cancelDeliveryNote(a.id, { clientToken: crypto.randomUUID(), reason: " a ", workOrderIds: [wo] }, fx.actorId));
  check("§2 sebep < 3 → 400", e3?.status === 400, JSON.stringify(e3));

  console.log("§5a Mükerrer — iptalden önce");
  const dupBefore = await errorOf(() => createDeliveryNote({ sourceKind: "MANUAL", ownerCustomerId: fx.owner, senderDocNo: docNo }, fx.actorId));
  check("§5 iptalden ÖNCE aynı senderDocNo reddedilir (sonda geçerli)", dupBefore !== null && dupBefore.status === 409, JSON.stringify(dupBefore));

  console.log("§3 İptal (iş emri seçili)");
  const entryBefore = await prisma.warehouseMovement.count({ where: { rollId: { in: a.rolls.map((r) => r.id) } } });
  const res = await cancelDeliveryNote(a.id, { clientToken: token, reason: "Yanlış belge girildi", workOrderIds: [wo] }, fx.actorId);
  check("§3 ⭐ yanıt: belge CANCELLED, 2 top, 1 iş emri", res.note.status === "CANCELLED" && res.cancelledRollCount === 2 && res.cancelledWorkOrders.length === 1 && res.cancelledWorkOrders[0]!.id === wo, JSON.stringify(res));
  const rolls = await prisma.roll.findMany({ where: { id: { in: a.rolls.map((r) => r.id) } }, select: { status: true, cancelReasonCode: true, currentStepId: true } });
  check("§3 ⭐ toplar CANCELLED + GELEN_BELGE_IPTAL, adımsız", rolls.length === 2 && rolls.every((r) => r.status === "CANCELLED" && r.cancelReasonCode === "GELEN_BELGE_IPTAL" && r.currentStepId === null), JSON.stringify(rolls));
  const woAfter = await prisma.workOrder.findUnique({ where: { id: wo }, select: { status: true } });
  check("§3 ⭐ iş emri CANCELLED", woAfter?.status === "CANCELLED");
  const ev = await prisma.workOrderEvent.count({ where: { workOrderId: wo, refType: "CUSTOMER_DELIVERY_NOTE", refId: a.id, trigger: "DELIVERY_NOTE_CANCEL" } });
  check("§3 iş emri olayı belgeye bağlı (refType/refId/trigger)", ev > 0);
  const lineCount = await prisma.customerDeliveryNoteLine.count({ where: { noteId: a.id, rollId: { in: a.rolls.map((r) => r.id) } } });
  check("§3 ⭐ belge satırları + top bağları DURUR", lineCount === 2);
  const entry = await prisma.warehouseMovement.count({ where: { rollId: { in: a.rolls.map((r) => r.id) }, reasonCode: "ENTRY_RECEIPT" } });
  const back = await prisma.warehouseMovement.count({ where: { rollId: { in: a.rolls.map((r) => r.id) }, reasonCode: "ROLL_CANCEL" } });
  const total = await prisma.warehouseMovement.count({ where: { rollId: { in: a.rolls.map((r) => r.id) } } });
  check("§3 ⭐ defter: ENTRY_RECEIPT satırları durur, her topa ROLL_CANCEL ters satırı, hiçbir satır silinmedi", entry === 2 && back === 2 && total >= entryBefore + 2, `entry=${entry} cancel=${back} önce=${entryBefore} sonra=${total}`);

  console.log("§4 Replay / çift iptal");
  const again = await cancelDeliveryNote(a.id, { clientToken: token, reason: "Yanlış belge girildi", workOrderIds: [wo] }, fx.actorId);
  check("§4 ⭐ aynı token → aynı yanıt", JSON.stringify(again) === JSON.stringify(res));
  const col = await errorOf(() => cancelDeliveryNote(a.id, { clientToken: token, reason: "Başka sebep yazıldı" }, fx.actorId));
  check("§4 aynı token başka sebep → 409 CLIENT_TOKEN_COLLISION", col?.status === 409 && col.code === "CLIENT_TOKEN_COLLISION", JSON.stringify(col));
  const dbl = await errorOf(() => cancelDeliveryNote(a.id, { clientToken: crypto.randomUUID(), reason: "Yanlış belge girildi" }, fx.actorId));
  check("§4 ⭐ çift iptal (yeni token) → 409 DELIVERY_NOTE_NOT_CANCELLABLE", dbl?.status === 409 && dbl.code === "DELIVERY_NOTE_NOT_CANCELLABLE", JSON.stringify(dbl));

  console.log("§5b Mükerrer — iptalden sonra");
  const re = await createDeliveryNote({ sourceKind: "MANUAL", ownerCustomerId: fx.owner, senderDocNo: docNo }, fx.actorId);
  made.notes.push(re.id);
  check("§5 ⭐ iptal edilen kağıt yeniden girilir (mükerrer yok)", re.status === "DRAFT" && re.id !== a.id);

  console.log("§7 Taslak");
  const dr = await errorOf(() => cancelDeliveryNote(re.id, { clientToken: crypto.randomUUID(), reason: "Taslak iptali denemesi" }, fx.actorId));
  check("§7 taslak → 409 DELIVERY_NOTE_NOT_CANCELLABLE", dr?.status === 409 && dr.code === "DELIVERY_NOTE_NOT_CANCELLABLE", JSON.stringify(dr));
}

async function scenarioBlocked(fx: Fx): Promise<string> {
  console.log("§6 Engeller");
  const b = await approvedNote(fx, `${TAG}-B`, 2);
  const wo = await openWo(fx, [b.rolls[0]!.barcode]);
  // Fikstür kısayolu: "işlem gördü" = adım tamamlandı; "sevk edildi" = SHIPPED (her ikisi de engelin kendisini ölçer).
  await prisma.workOrderStep.updateMany({ where: { workOrderId: wo }, data: { status: "COMPLETED" } });
  await prisma.roll.update({ where: { id: b.rolls[1]!.id }, data: { status: "SHIPPED" } });
  const pv = await previewDeliveryNoteCancel(b.id);
  const codes = pv.blockers.map((x) => x.code);
  check("§6 ⭐ önizleme: WORK_ORDER_STARTED + ROLL_STATUS, cancellable=false, iş emri seçilemez", !pv.cancellable && codes.includes("WORK_ORDER_STARTED") && codes.includes("ROLL_STATUS") && pv.workOrders[0]?.selectable === false, codes.join(","));
  check("§6 engel mesajı Türkçe + ne yapılmalı", pv.blockers.every((x) => /önce|iptal edilemez|düşürülemez/.test(x.message)), pv.blockers.map((x) => x.message).join(" | "));
  const e = await errorOf(() => cancelDeliveryNote(b.id, { clientToken: crypto.randomUUID(), reason: "Yanlış belge girildi", workOrderIds: [wo] }, fx.actorId));
  check("§6 ⭐ seçili ama başlamış iş emri + sevkli top → 409 BLOCKED", e?.status === 409 && e.code === "DELIVERY_NOTE_CANCEL_BLOCKED" && !!e.blockers?.some((x) => x.code === "WORK_ORDER_STARTED") && !!e.blockers?.some((x) => x.code === "ROLL_STATUS"), JSON.stringify(e));
  const n = await prisma.customerDeliveryNote.findUnique({ where: { id: b.id }, select: { status: true } });
  const w = await prisma.workOrder.findUnique({ where: { id: wo }, select: { status: true } });
  const r0 = await prisma.roll.findUnique({ where: { id: b.rolls[0]!.id }, select: { status: true } });
  check("§6 ⭐ belge/iş emri/top yerinde", n?.status === "APPROVED" && w?.status !== "CANCELLED" && r0?.status !== "CANCELLED", `${n?.status} ${w?.status} ${r0?.status}`);
  return b.id;
}

async function scenarioHttp(fx: Fx, blockedNoteId: string): Promise<void> {
  console.log("§8 HTTP");
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
    const login = async (username: string, password: string) => {
      const r = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType: "electron" }) });
      return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
    };
    const call = async (method: string, path: string, token: string, body?: unknown) => {
      const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { data?: { blockers?: unknown[] }; details?: { code?: string } };
      return { status: r.status, code: j.details?.code, data: j.data };
    };
    const tk = await login(admin.username, admin.password);
    const parola = kosumaOzguParola();
    const ps = await prisma.permission.findMany({ where: { code: { in: ["gelen-belge:read", "gelen-belge:write", "gelen-belge:approve"] } }, select: { id: true } });
    const ru = await prisma.user.create({
      data: { username: `${TAG}-okur`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} okur`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } },
      select: { id: true, username: true },
    });
    made.users.push(ru.id);
    const reader = await login(ru.username, parola);
    const base = `/api/gelen-belge/irsaliyeler/${blockedNoteId}`;
    const g403 = await call("GET", `${base}/iptal-onizleme`, reader);
    const p403 = await call("POST", `${base}/iptal`, reader, { clientToken: crypto.randomUUID(), reason: "Yanlış belge" });
    check("§8 ⭐ gelen-belge:cancel yok (onay var) → iki uç 403", g403.status === 403 && p403.status === 403, `${g403.status}/${p403.status}`);
    const pv = await call("GET", `${base}/iptal-onizleme`, tk);
    check("§8 admin önizleme 200 + engel listesi", pv.status === 200 && (pv.data?.blockers?.length ?? 0) >= 2, String(pv.status));
    const bad = await call("POST", `${base}/iptal`, tk, { clientToken: crypto.randomUUID(), reason: "a" });
    check("§8 kısa sebep → 400", bad.status === 400, String(bad.status));
    const blk = await call("POST", `${base}/iptal`, tk, { clientToken: crypto.randomUUID(), reason: "Yanlış belge girildi" });
    check("§8 engel → 409 details.code DELIVERY_NOTE_CANCEL_BLOCKED", blk.status === 409 && blk.code === "DELIVERY_NOTE_CANCEL_BLOCKED", `${blk.status} ${blk.code}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  const wos = (await prisma.workOrder.findMany({ where: { routeTemplateId: { in: made.routes } }, select: { id: true } })).map((w) => w.id);
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } });
  for (const t of ["rollProperty", "rollOperation", "rollMovement", "rollVariance", "rollStatusEvent", "warehouseMovement"] as const) {
    await (prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { rollId: { in: rollIds } } }).catch(swallow);
  }
  await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { currentStepId: null, batchId: null } }).catch(swallow);
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(swallow);
  for (const id of wos) {
    await prisma.workOrderTargetValue.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.workOrderTargetProperty.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.workOrderEvent.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: id } } }).catch(swallow);
    await prisma.travelerCard.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.batch.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.workOrder.deleteMany({ where: { id } }).catch(swallow);
  }
  await prisma.route.deleteMany({ where: { id: { in: made.routes } } }).catch(swallow);
  await prisma.station.deleteMany({ where: { id: { in: made.stations } } }).catch(swallow);
  await prisma.deliveryNoteAlias.deleteMany({ where: { targetId: { in: [...made.items, ...made.customers] } } }).catch(swallow);
  await prisma.item.deleteMany({ where: { id: { in: made.items } } }).catch(swallow);
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } }).catch(swallow);
  // Bekçi kullanıcısı sert silinmez (sözleşme): pasife alınır.
  await prisma.user.updateMany({ where: { id: { in: made.users } }, data: { isActive: false } }).catch(swallow);
}

async function main(): Promise<void> {
  console.log("=== Onaylı gelen belge iptali bekçisi (K15) ===\n");
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: SETTINGS } }, select: { key: true, value: true } });
  try {
    const fx = await fixture();
    await scenarioMain(fx);
    const blocked = await scenarioBlocked(fx);
    await scenarioHttp(fx, blocked);
  } catch (e) {
    fail++;
    console.error("HATA:", e);
  } finally {
    stopNotificationJobs();
    for (const k of SETTINGS) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    await cleanup().catch((e) => check("temizlik", false, (e as Error).message.replace(/\s+/g, " ").slice(0, 300)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız === (test verisi temizlendi)`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!engel) void main();
else void prisma.$disconnect();
