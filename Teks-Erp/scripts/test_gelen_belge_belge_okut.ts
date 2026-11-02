// =============================================================================
// GELEN BELGE — iş emri ekranından "Belge okut": onay + SEÇİLEN rota (tasarım PARTI-METRE-TASARIM-2026-11-02 P3)
// =============================================================================
// HTTP + gerçek DB. Onay gövdesi `routeTemplateId` → onaydan sonra iş emri o rotayla (öneri zinciri ve `autoWorkOrder` ayarı
// yerine); istek onaydan ÖNCE doğrulanır, yerine getirilemiyorsa onay HİÇ koşmaz. Sınanan:
//   §1 alan yokken + ayar kapalı: yanıtta `autoWorkOrders` YOK, iş emri 0 (bugünkü yol bayt-aynı)
//   §2 pasif rota → 400 GELEN_BELGE_ROUTE_OVERRIDE_INVALID, belge DRAFT, top 0
//   §3 onay izni var, iş emri izni yok → 403 GELEN_BELGE_ROUTE_OVERRIDE_FORBIDDEN, belge DRAFT, top 0
//   §4 onay izni yok (yalnız yazma) → 403, belge DRAFT
//   §5 ⭐ PER_DOCUMENT + seçilen rota (öneri zincirinde BAŞKA rota varken, ayar kapalıyken) → 1 top, 1 iş emri, rota = seçilen,
//      top iş emrinde; yeniden onay 409 ve ikinci iş emri doğmaz
//   §6 geçersiz kimlik → 400 (allowlist)
// Negatif sonda: oto iş emrinde `opts.routeTemplateId ??` kaldırılınca §5 "rota = seçilen" kırmızı; route'taki `assertRouteOverride`
// çağrısı kaldırılınca §2/§3 "belge DRAFT" kırmızı.
// =============================================================================
import type { AddressInfo } from "net";
import type { Server } from "http";
import * as bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { buildWorkOrderPlan } from "../src/services/gelen-belge-is-emri.service";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exitCode = 1;
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const TAG = `TEST-GBO${Date.now().toString(36).toUpperCase()}`;
const made = { customers: [] as string[], users: [] as string[], notes: [] as string[], items: [] as string[], stations: [] as string[], routes: [] as string[] };
const SETTINGS = [
  SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID,
  SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER_PATTERNLESS, SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE,
];

type Resp = { status: number; code?: string; data?: Record<string, unknown> };
type AutoWo = { opened: number; manual: number; reason: string | null; groups: Array<{ outcome: string; workOrderId?: string; reason?: string }> };

async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

async function run(url: string): Promise<void> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
  for (const k of [SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE]) await setSetting(k, null);
  const login = async (username: string, password: string) => {
    const r = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType: "electron" }) });
    return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
  };
  const call = async (method: string, path: string, token: string, body?: unknown): Promise<Resp> => {
    const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; details?: { code?: string } };
    return { status: r.status, code: j.details?.code, data: j.data };
  };
  const tk = await login(admin.username, admin.password);
  check("admin login", tk.length > 0);
  const parola = kosumaOzguParola();
  const mkUser = async (suffix: string, perms: string[]) => {
    const ps = await prisma.permission.findMany({ where: { code: { in: perms } }, select: { id: true } });
    const u = await prisma.user.create({
      data: { username: `${TAG}-${suffix}`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} ${suffix}`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } },
      select: { id: true, username: true },
    });
    made.users.push(u.id);
    return login(u.username, parola);
  };
  const writer = await mkUser("W", ["gelen-belge:read", "gelen-belge:write"]);
  const approverNoWo = await mkUser("A", ["gelen-belge:read", "gelen-belge:write", "gelen-belge:approve"]);

  const owner = (await prisma.customer.create({ data: { code: `${TAG}-OWN`, name: `${TAG} sahip` }, select: { id: true } })).id;
  made.customers.push(owner);
  const fabric = (await prisma.item.create({ data: { code: `${TAG}-MM`, name: `${TAG} müşteri malı`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  made.items.push(fabric);
  await setSetting(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, fabric);
  await setSetting(SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, "PER_DOCUMENT");
  await setSetting(SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER_PATTERNLESS, "OPEN");
  const station = (await prisma.station.create({ data: { code: `${TAG}-STN`.slice(0, 32), name: `${TAG} kurşun`, type: "INTERNAL" }, select: { id: true } })).id;
  made.stations.push(station);
  const mkRoute = async (name: string, extra: Record<string, unknown> = {}) => {
    const r = await prisma.route.create({ data: { name: `${TAG} ${name}`, steps: { create: [{ stationId: station, sequence: 1 }] }, ...extra }, select: { id: true } });
    made.routes.push(r.id);
    return r.id;
  };
  // Öneri zinciri müşteri rotasını bulur (tek aday); seçilen rota ondan FARKLI olmalı ki geçersiz kılma ölçülsün.
  const suggested = await mkRoute("önerilen", { customerId: owner });
  const chosen = await mkRoute("seçilen");
  const passive = await mkRoute("pasif", { isActive: false });

  const mkNote = async () => {
    const lines = Array.from({ length: 3 }, (_, i) => ({ senderRollNo: `${TAG}-${made.notes.length}-${i + 1}`, meters: 100 + i, itemText: "Kumaş" }));
    const r = await call("POST", "/api/gelen-belge/irsaliyeler", tk, { sourceKind: "MANUAL", ownerCustomerId: owner, senderText: `${TAG} GÖNDEREN`, lines });
    const id = (r.data as { id?: string } | undefined)?.id ?? "";
    made.notes.push(id);
    const p = await call("PATCH", `/api/gelen-belge/irsaliyeler/${id}`, tk, { kursunMeters: 4521, ourBatchNo: "214279" });
    check(`taslak + kurşun metresi (${made.notes.length})`, r.status === 201 && p.status === 200, `${r.status} ${p.status} ${p.code ?? ""}`);
    return id;
  };
  const onay = (id: string, token: string, body: Record<string, unknown>) => call("POST", `/api/gelen-belge/irsaliyeler/${id}/onay`, token, body);
  const statusOf = async (id: string) => (await prisma.customerDeliveryNote.findUnique({ where: { id }, select: { status: true } }))?.status;
  const rollsOf = async (id: string) => (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: id, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  const woCount = () => prisma.workOrder.count();

  console.log("§1 alan yok + ayar kapalı");
  const n1 = await mkNote();
  const w1 = await woCount();
  const r1 = await onay(n1, tk, {});
  check("§1 onay 200, `autoWorkOrders` YOK, iş emri 0", r1.status === 200 && !!r1.data && !("autoWorkOrders" in r1.data) && (await woCount()) === w1, `${r1.status} ${r1.code ?? ""} ${Object.keys(r1.data ?? {}).join(",")}`);

  console.log("§2 pasif rota");
  const n2 = await mkNote();
  const r2 = await onay(n2, tk, { routeTemplateId: passive });
  check("§2 ⭐ 400 GELEN_BELGE_ROUTE_OVERRIDE_INVALID", r2.status === 400 && r2.code === "GELEN_BELGE_ROUTE_OVERRIDE_INVALID", `${r2.status} ${r2.code ?? ""}`);
  check("§2 ⭐ belge DRAFT, top 0 (onay koşmadı)", (await statusOf(n2)) === "DRAFT" && (await rollsOf(n2)).length === 0);

  console.log("§3 iş emri izni yok");
  const r3 = await onay(n2, approverNoWo, { routeTemplateId: chosen });
  check("§3 ⭐ 403 GELEN_BELGE_ROUTE_OVERRIDE_FORBIDDEN", r3.status === 403 && r3.code === "GELEN_BELGE_ROUTE_OVERRIDE_FORBIDDEN", `${r3.status} ${r3.code ?? ""}`);
  check("§3 ⭐ belge DRAFT, top 0", (await statusOf(n2)) === "DRAFT" && (await rollsOf(n2)).length === 0);

  console.log("§4 onay izni yok");
  const r4 = await onay(n2, writer, { routeTemplateId: chosen });
  check("§4 ⭐ yalnız yazma izni → 403, belge DRAFT", r4.status === 403 && (await statusOf(n2)) === "DRAFT", `${r4.status} ${r4.code ?? ""}`);

  console.log("§5 seçilen rotayla onay");
  const plan = await buildWorkOrderPlan(n2).catch(() => null);
  check("§5 ön koşul: öneri zinciri BAŞKA rotayı önerir (müşteri rotası)", plan === null || plan.suggestedRouteTemplateId === null || plan.suggestedRouteTemplateId === suggested, String(plan?.suggestedRouteTemplateId));
  const w5 = await woCount();
  const r5 = await onay(n2, tk, { routeTemplateId: chosen });
  const auto = r5.data?.autoWorkOrders as AutoWo | undefined;
  const rolls = await rollsOf(n2);
  check("§5 onay 200 + APPROVED + 1 top", r5.status === 200 && (await statusOf(n2)) === "APPROVED" && rolls.length === 1, `${r5.status} ${r5.code ?? ""} top=${rolls.length}`);
  check("§5 ⭐ ayar kapalıyken de 1 iş emri açıldı", auto?.opened === 1 && (await woCount()) === w5 + 1, JSON.stringify(auto));
  const woId = auto?.groups.find((g) => g.outcome === "OPENED")?.workOrderId ?? "";
  const wo = woId ? await prisma.workOrder.findUnique({ where: { id: woId }, select: { routeTemplateId: true, batches: { select: { rolls: { select: { id: true } } } } } }) : null;
  check("§5 ⭐ iş emri rotası = SEÇİLEN (önerilen değil)", wo?.routeTemplateId === chosen, `${wo?.routeTemplateId} (seçilen ${chosen}, önerilen ${suggested})`);
  check("§5 belgenin topu iş emrinde", !!wo && wo.batches.some((b) => b.rolls.some((r) => r.id === rolls[0])));
  const again = await onay(n2, tk, { routeTemplateId: chosen });
  check("§5 yeniden onay 409, ikinci iş emri doğmaz", again.status === 409 && (await woCount()) === w5 + 1, `${again.status} ${again.code ?? ""}`);

  console.log("§6 allowlist");
  const n6 = await mkNote();
  const r6 = await onay(n6, tk, { routeTemplateId: "yok" });
  check("§6 geçersiz kimlik → 400, belge DRAFT", r6.status === 400 && (await statusOf(n6)) === "DRAFT", `${r6.status}`);
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  const wos = (await prisma.workOrder.findMany({ where: { OR: [{ routeTemplateId: { in: made.routes } }, { batches: { some: { rolls: { some: { id: { in: rollIds } } } } } }] }, select: { id: true } })).map((w) => w.id);
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } });
  for (const t of ["rollProperty", "rollOperation", "rollMovement", "rollVariance", "warehouseMovement"] as const) {
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
  await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(swallow);
}

async function main(): Promise<void> {
  console.log("=== Gelen belge 'Belge okut' (seçilen rota) bekçisi ===\n");
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: SETTINGS } }, select: { key: true, value: true } });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } catch (e) {
    fail++;
    console.error("HATA:", e);
  } finally {
    server.close();
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
