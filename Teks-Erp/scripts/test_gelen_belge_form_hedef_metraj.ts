// =============================================================================
// GELEN BELGE — İE formunda hedef metraj gelen metreyi izler (fason İE, Gülkesim 2026-11-04)
// =============================================================================
// HTTP + gerçek DB. Uç: `POST /api/gelen-belge/irsaliyeler/:id/is-emri`. Kapı fabrika ayarı
// `workorder.targetQuantityEnabled` (varsayılan kapalı = bugünkü davranış). Sınanan:
//   §0 ⭐ ayar kapalı → hedef verilmezse İE hedefi BOŞ (bugünkü)
//   §1 ⭐ ayar açık, tek parça, hedef yok → İE hedefi = kurşun metresi
//   §2 ⭐ verilen hedef türetmeyi ezer
//   §3 ⭐ çok parti SINGLE → tek İE hedefi = parti toplamı
//   §4 ⭐ çok parti PER_PARTY → her İE kendi parti metresi; verilen hedef yine 400 GELEN_BELGE_FORM_TARGET_PER_PARTY
// Negatif sonda: form servisindeki `deriveTarget` satırı kaldırılınca §1 kırmızı; `partyMeters` toplam yerine
// sabit verince §3 + §4 kırmızı.
// =============================================================================
import { randomUUID, createHash } from "crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";
import * as bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
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

const TAG = `TEST-GBH${Date.now().toString(36).toUpperCase()}`;
const made = { customers: [] as string[], users: [] as string[], notes: [] as string[], items: [] as string[], stations: [] as string[], routes: [] as string[], scans: [] as string[] };
const SETTINGS = [
  SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID,
  SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT,
  SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER, SETTING_KEYS.WORKORDER_TARGET_QUANTITY_ENABLED,
];

type Resp = { status: number; code?: string; data?: Record<string, unknown> & { [k: string]: unknown }; warnings?: string[] };

async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

async function addScan(noteId: string | null, ocrResult: unknown, pageNo = 1): Promise<string> {
  const content = Buffer.from(`${TAG}-${randomUUID()}`);
  const s = await prisma.documentScan.create({
    data: { noteId, pageNo, sha256: createHash("sha256").update(content).digest("hex"), mimeType: "image/jpeg", sizeBytes: content.length, content, status: "READ", ocrResult: ocrResult as never },
    select: { id: true },
  });
  made.scans.push(s.id);
  return s.id;
}

async function run(url: string): Promise<void> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
  for (const k of [SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER, SETTING_KEYS.WORKORDER_TARGET_QUANTITY_ENABLED]) await setSetting(k, null);
  await setSetting(SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, "DOCUMENT");
  await setSetting(SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, "WITH_WORK_ORDER");
  const login = async (username: string, password: string) => {
    const r = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType: "electron" }) });
    return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
  };
  const call = async (method: string, path: string, token: string, body?: unknown): Promise<Resp> => {
    const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; details?: { code?: string }; warnings?: string[] };
    return { status: r.status, code: j.details?.code, data: j.data, warnings: j.warnings };
  };
  const tk = await login(admin.username, admin.password);
  check("admin login", tk.length > 0);
  const parola = kosumaOzguParola();
  const ps = await prisma.permission.findMany({ where: { code: { in: ["gelen-belge:read", "gelen-belge:write", "mobile:hizli-is-emri"] } }, select: { id: true } });
  const wu = await prisma.user.create({
    data: { username: `${TAG}-w`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} W`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } },
    select: { id: true, username: true },
  });
  made.users.push(wu.id);
  const woUser = await login(wu.username, parola);

  const owner = (await prisma.customer.create({ data: { code: `${TAG}-OWN`, name: `${TAG} Sahip` }, select: { id: true } })).id;
  made.customers.push(owner);
  const fabric = (await prisma.item.create({ data: { code: `${TAG}-MM`, name: `${TAG} müşteri malı`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  made.items.push(fabric);
  await setSetting(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, fabric);
  const station = (await prisma.station.create({ data: { code: `${TAG}-STN`.slice(0, 32), name: `${TAG} kurşun`, type: "INTERNAL" }, select: { id: true } })).id;
  made.stations.push(station);
  const route = (await prisma.route.create({ data: { name: `${TAG} rota`, steps: { create: [{ stationId: station, sequence: 1 }] } }, select: { id: true } })).id;
  made.routes.push(route);

  /** Taslak belge: `multi` ise 3+2 satırlık iki parti (330 / 410 m), değilse tek parça 2 satır (520 m). */
  const mkNote = async (multi: boolean) => {
    const meters = multi ? [100, 110, 120, 200, 210] : [250, 270];
    const r = await call("POST", "/api/gelen-belge/irsaliyeler", tk, {
      sourceKind: "MANUAL", senderText: `${TAG} FASON`,
      lines: meters.map((m, i) => ({ senderRollNo: `${TAG}-${made.notes.length}-${i}`, meters: m, itemText: "Kumaş" })),
    });
    const id = (r.data as { id?: string } | undefined)?.id ?? "";
    made.notes.push(id);
    if (multi) {
      const lines = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: id }, orderBy: { lineNo: "asc" }, select: { id: true } });
      await prisma.customerDeliveryNoteLine.updateMany({ where: { id: { in: lines.slice(3).map((l) => l.id) } }, data: { blockNo: 2 } });
    }
    await addScan(id, { ocr: { text: TAG } }, 1);
    check(`taslak (${made.notes.length})`, r.status === 201 && !!id, `${r.status} ${r.code ?? ""}`);
    return id;
  };
  const n = () => made.notes.length;
  const single = (extra: Record<string, unknown> = {}) => ({ clientToken: randomUUID(), ownerCustomerId: owner, kursunMeters: "520", routeTemplateId: route, ...extra });
  const multiBody = (extra: Record<string, unknown> = {}) => ({
    clientToken: randomUUID(), ownerCustomerId: owner, kursunMeters: "740", routeTemplateId: route,
    parties: [{ blockNo: 1, batchNo: `${TAG}-P${n()}A`, meters: 330 }, { blockNo: 2, batchNo: `${TAG}-P${n()}B`, meters: 410.5 }], ...extra,
  });
  const formWo = (id: string, b: unknown) => call("POST", `/api/gelen-belge/irsaliyeler/${id}/is-emri`, woUser, b);
  const targetOf = async (woId: unknown) => {
    const w = await prisma.workOrder.findUnique({ where: { id: String(woId) }, select: { targetQuantity: true } });
    return w?.targetQuantity == null ? null : Number(w.targetQuantity);
  };

  console.log("§0 ayar kapalı");
  const n0 = await mkNote(false);
  const r0 = await formWo(n0, single());
  const t0 = await targetOf(r0.data?.workOrderId);
  check("§0 ⭐ ayar kapalı → hedef verilmedi → İE hedefi boş (bugünkü)", r0.status === 201 && t0 === null, `${r0.status} ${r0.code ?? ""} t=${t0}`);

  await setSetting(SETTING_KEYS.WORKORDER_TARGET_QUANTITY_ENABLED, true);
  console.log("§1 tek parça türetme");
  const n1 = await mkNote(false);
  const r1 = await formWo(n1, single());
  const t1 = await targetOf(r1.data?.workOrderId);
  check("§1 ⭐ ayar açık, hedef yok → İE hedefi = kurşun metresi (520)", r1.status === 201 && t1 === 520, `${r1.status} ${r1.code ?? ""} t=${t1}`);

  console.log("§2 verilen hedef ezer");
  const n2 = await mkNote(false);
  const r2 = await formWo(n2, single({ targetQuantity: 480 }));
  const t2 = await targetOf(r2.data?.workOrderId);
  check("§2 ⭐ verilen hedef (480) türetmeyi ezer", r2.status === 201 && t2 === 480, `${r2.status} ${r2.code ?? ""} t=${t2}`);

  console.log("§3 çok parti SINGLE");
  const n3 = await mkNote(true);
  const r3 = await formWo(n3, multiBody());
  const t3 = await targetOf(r3.data?.workOrderId);
  check("§3 ⭐ SINGLE → tek İE hedefi = parti toplamı (740,5)", r3.status === 201 && r3.data?.mode === "SINGLE" && t3 === 740.5, `${r3.status} ${r3.code ?? ""} t=${t3}`);

  console.log("§4 çok parti PER_PARTY");
  const n4 = await mkNote(true);
  const r4 = await formWo(n4, multiBody({ mode: "PER_PARTY" }));
  const list4 = (r4.data?.workOrders ?? []) as Array<{ workOrderId: string; blockNos: number[] }>;
  const t4 = await Promise.all(list4.map((w) => targetOf(w.workOrderId)));
  check("§4 ⭐ PER_PARTY → 2 İE, hedefler 330 / 410,5", r4.status === 201 && list4.length === 2 && t4[0] === 330 && t4[1] === 410.5, `${r4.status} ${r4.code ?? ""} t=${JSON.stringify(t4)}`);
  const n4b = await mkNote(true);
  const r4b = await formWo(n4b, multiBody({ mode: "PER_PARTY", targetQuantity: 700 }));
  check("§4 PER_PARTY + verilen hedef → 400 GELEN_BELGE_FORM_TARGET_PER_PARTY (değişmedi)", r4b.status === 400 && r4b.code === "GELEN_BELGE_FORM_TARGET_PER_PARTY", `${r4b.status} ${r4b.code ?? ""}`);
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  const wos = (await prisma.workOrder.findMany({ where: { OR: [{ routeTemplateId: { in: made.routes } }, { batches: { some: { rolls: { some: { id: { in: rollIds } } } } } }] }, select: { id: true } })).map((w) => w.id);
  // Satırlar taramaya bağlı olabilir (scanId) → tarama silinmeden önce bağ çözülür.
  await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: { in: made.notes } }, data: { scanId: null } }).catch(swallow);
  await prisma.documentScan.deleteMany({ where: { id: { in: made.scans } } }).catch(swallow);
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
  await prisma.stationProperty.deleteMany({ where: { stationId: { in: made.stations } } }).catch(swallow);
  await prisma.station.deleteMany({ where: { id: { in: made.stations } } }).catch(swallow);
  await prisma.item.deleteMany({ where: { id: { in: made.items } } }).catch(swallow);
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } }).catch(swallow);
  await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(swallow);
}

async function main(): Promise<void> {
  console.log("=== Gelen belge İE formu hedef metraj türetme bekçisi ===\n");
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
