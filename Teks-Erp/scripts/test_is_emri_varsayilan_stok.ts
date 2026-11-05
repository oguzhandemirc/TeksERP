// =============================================================================
// İŞ EMRİ VARSAYILAN STOK KARTI (`workorder.defaultTargetItemId`) — 1e kararı 2026-11-06
// =============================================================================
// HTTP + gerçek DB. Uçlar: `GET|PUT /api/work-orders/default-target-item`, `POST /api/work-orders` (panel stoğa üretim),
// `POST /api/gelen-belge/irsaliyeler/:id/is-emri` (belgeden İE), ham `PUT /api/admin/settings/:key`. Sınanan:
//   §1 ⭐ ayar boş = bugünkü: panel hedefsiz STOCK 400; belge yolu fabrika varsayılanı; ipucu kaynakları
//   §2 yazım kapısı: top doğuramayan kart 400 WORK_ORDER_DEFAULT_ITEM_INVALID; ham ayar ucu 400 SETTING_KEY_RESERVED
//   §3 ⭐ ayar dolu: panel boş hedef → varsayılan + CREATED olayı `defaultTargetItemApplied` + uyarı; elle seçim ezilmez
//   §4 ⭐ ÖNCELİK (belge yolu, top itemId ile): form hedefi > müşteri varsayılanı > İE varsayılanı > fabrika
//   §5 pasif kart: panel + belge yolu 409 WORK_ORDER_DEFAULT_ITEM_UNUSABLE (sessiz düşme yok); ipucu `problem` taşır
// Negatif sonda: prepareCreate'teki resolver `null` yapılınca §3 kırmızı; `resolveNoteWorkOrderDefaultItem`teki müşteri
// kontrolü kaldırılınca §4 müşteri vakası kırmızı.
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

const TAG = `TEST-IEV${Date.now().toString(36).toUpperCase()}`;
const made = { customers: [] as string[], users: [] as string[], notes: [] as string[], items: [] as string[], stations: [] as string[], routes: [] as string[], scans: [] as string[], wos: [] as string[] };
const SETTINGS = [
  SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID,
  SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT,
  SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER, SETTING_KEYS.GELEN_BELGE_TABLET_IE_GIRISI, SETTING_KEYS.PRODUCTION_ROUTE_MODE,
  SETTING_KEYS.WORKORDER_DEFAULT_TARGET_ITEM_ID,
];

type Resp = { status: number; code?: string; data?: Record<string, unknown>; warnings?: string[] };

async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

async function run(url: string): Promise<void> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
  for (const k of [SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE,
    SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER, SETTING_KEYS.GELEN_BELGE_TABLET_IE_GIRISI, SETTING_KEYS.PRODUCTION_ROUTE_MODE, SETTING_KEYS.WORKORDER_DEFAULT_TARGET_ITEM_ID]) await setSetting(k, null);
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

  const mkCustomer = async (suffix: string) => {
    const id = (await prisma.customer.create({ data: { code: `${TAG}-${suffix}`, name: `${TAG} ${suffix}` }, select: { id: true } })).id;
    made.customers.push(id);
    return id;
  };
  const owner = await mkCustomer("OWN");
  const ownerCust = await mkCustomer("OWC");
  const mkItem = async (suffix: string, itemType: "FABRIC" | "YARN" = "FABRIC") => {
    const id = (await prisma.item.create({ data: { code: `${TAG}-${suffix}`, name: `${TAG} ${suffix}`, itemType, unit: "MT" }, select: { id: true } })).id;
    made.items.push(id);
    return id;
  };
  const factoryItem = await mkItem("FAB");
  const woDefItem = await mkItem("IEV");
  const custItem = await mkItem("MUS");
  const formItem = await mkItem("FRM");
  const manualItem = await mkItem("ELL");
  const yarn = await mkItem("IPL", "YARN");
  await setSetting(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, factoryItem);
  await prisma.deliveryNoteCustomerDefault.create({ data: { customerId: ownerCust, defaultItemId: custItem } });

  const station = (await prisma.station.create({ data: { code: `${TAG}-STN`.slice(0, 32), name: `${TAG} kurşun`, type: "INTERNAL" }, select: { id: true } })).id;
  made.stations.push(station);
  const route = (await prisma.route.create({ data: { name: `${TAG} rota`, steps: { create: [{ stationId: station, sequence: 1 }] } }, select: { id: true } })).id;
  made.routes.push(route);

  const mkNote = async () => {
    const r = await call("POST", "/api/gelen-belge/irsaliyeler", tk, {
      sourceKind: "MANUAL", senderText: `${TAG} GÖNDEREN`,
      lines: [100, 110].map((m, i) => ({ senderRollNo: `${TAG}-${made.notes.length}-${i}`, meters: m, itemText: "Kumaş" })),
    });
    const id = (r.data as { id?: string } | undefined)?.id ?? "";
    made.notes.push(id);
    const content = Buffer.from(`${TAG}-${randomUUID()}`);
    const s = await prisma.documentScan.create({
      data: { noteId: id, pageNo: 1, sha256: createHash("sha256").update(content).digest("hex"), mimeType: "image/jpeg", sizeBytes: content.length, content, status: "READ", ocrResult: { ocr: { text: TAG } } as never },
      select: { id: true },
    });
    made.scans.push(s.id);
    return id;
  };
  /** Belgeden İE; dönüş: yanıt + doğan topların itemId'leri (öncelik ölçüsü). */
  const noteWo = async (ownerId: string, extra: Record<string, unknown> = {}) => {
    const n = await mkNote();
    const r = await call("POST", `/api/gelen-belge/irsaliyeler/${n}/is-emri`, woUser, { clientToken: randomUUID(), ownerCustomerId: ownerId, kursunMeters: "210", routeTemplateId: route, ...extra });
    const items = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: n, rollId: { not: null } }, select: { roll: { select: { itemId: true } } } })).map((l) => l.roll?.itemId);
    return { r, items, only: (id: string) => items.length > 0 && items.every((i) => i === id) };
  };
  const panelWo = async (extra: Record<string, unknown> = {}) => {
    const r = await call("POST", "/api/work-orders", tk, { type: "STOCK_PRODUCTION", routeTemplateId: route, ...extra });
    const id = typeof r.data?.id === "string" ? r.data.id : "";
    if (id) made.wos.push(id);
    const wo = id ? await prisma.workOrder.findUnique({ where: { id }, select: { targetItemId: true } }) : null;
    const ev = id ? await prisma.workOrderEvent.findFirst({ where: { workOrderId: id, type: "CREATED" }, select: { payload: true } }) : null;
    const applied = (ev?.payload as { defaultTargetItemApplied?: boolean } | null)?.defaultTargetItemApplied === true;
    return { r, targetItemId: wo?.targetItemId ?? null, applied, warned: (r.warnings ?? []).some((w) => w.includes("varsayılan stok kartı")) };
  };
  const hint = (q = "") => call("GET", `/api/work-orders/default-target-item${q}`, tk);
  const hintOf = (r: Resp) => ({ src: r.data?.source ?? null, id: (r.data?.item as { id?: string } | null)?.id ?? null, problem: (r.data?.item as { problem?: string | null } | null)?.problem ?? null });

  console.log("§1 ayar boş = bugünkü");
  const p1 = await panelWo();
  check("§1 ⭐ panel hedefsiz STOCK → 400 (bugünkü)", p1.r.status === 400, `${p1.r.status} ${p1.r.code ?? ""}`);
  const n1 = await noteWo(owner);
  check("§1 ⭐ belge yolu hedefsiz → fabrika varsayılanı", n1.r.status === 201 && n1.only(factoryItem), `${n1.r.status} ${n1.r.code ?? ""} ${JSON.stringify(n1.items)}`);
  const h1a = hintOf(await hint());
  const h1b = hintOf(await hint(`?forNote=true&customerId=${owner}`));
  check("§1 ipucu: panel null; belge FACTORY", h1a.src === null && h1a.id === null && h1b.src === "FACTORY" && h1b.id === factoryItem, JSON.stringify({ h1a, h1b }));
  const bad1 = await hint("?forNote=evet");
  check("§1 tanınmayan sorgu 400", bad1.status === 400, String(bad1.status));

  console.log("§2 yazım kapısı");
  const w2 = await call("PUT", "/api/work-orders/default-target-item", tk, { itemId: yarn });
  check("§2 top doğuramayan kart 400 WORK_ORDER_DEFAULT_ITEM_INVALID", w2.status === 400 && w2.code === "WORK_ORDER_DEFAULT_ITEM_INVALID", `${w2.status} ${w2.code ?? ""}`);
  const raw2 = await call("PUT", `/api/admin/settings/${SETTING_KEYS.WORKORDER_DEFAULT_TARGET_ITEM_ID}`, tk, { value: woDefItem });
  check("§2 ham ayar ucu 400 SETTING_KEY_RESERVED", raw2.status === 400 && raw2.code === "SETTING_KEY_RESERVED", `${raw2.status} ${raw2.code ?? ""}`);
  const noPerm = await call("PUT", "/api/work-orders/default-target-item", woUser, { itemId: woDefItem });
  check("§2 izinsiz yazım 403", noPerm.status === 403, String(noPerm.status));
  const ok2 = await call("PUT", "/api/work-orders/default-target-item", tk, { itemId: woDefItem });
  check("§2 geçerli kart yazılır", ok2.status === 200 && ok2.data?.id === woDefItem, `${ok2.status} ${ok2.code ?? ""}`);

  console.log("§3 ayar dolu: panel");
  const p3 = await panelWo();
  check("§3 ⭐ panel boş hedef → İE varsayılanı + olay işareti + uyarı", p3.r.status === 201 && p3.targetItemId === woDefItem && p3.applied && p3.warned,
    `${p3.r.status} ${p3.r.code ?? ""} ${JSON.stringify({ t: p3.targetItemId, a: p3.applied, w: p3.warned })}`);
  const p3m = await panelWo({ targetItemId: manualItem });
  check("§3 ⭐ elle seçim ezilmez (işaret/uyarı yok)", p3m.r.status === 201 && p3m.targetItemId === manualItem && !p3m.applied && !p3m.warned,
    `${p3m.r.status} ${p3m.r.code ?? ""} ${p3m.targetItemId}`);

  console.log("§4 öncelik (belge yolu)");
  const n4a = await noteWo(owner);
  check("§4 ⭐ müşteri varsayılanı yok → İE varsayılanı (fabrika değil) + uyarı",
    n4a.r.status === 201 && n4a.only(woDefItem) && (n4a.r.warnings ?? []).some((w) => w.includes("varsayılan stok kartı")), `${n4a.r.status} ${n4a.r.code ?? ""} ${JSON.stringify(n4a.items)}`);
  const n4b = await noteWo(ownerCust);
  check("§4 ⭐ müşteri varsayılanı > İE varsayılanı", n4b.r.status === 201 && n4b.only(custItem), `${n4b.r.status} ${n4b.r.code ?? ""} ${JSON.stringify(n4b.items)}`);
  const n4c = await noteWo(ownerCust, { targetItemId: formItem });
  check("§4 ⭐ form hedefi > müşteri varsayılanı", n4c.r.status === 201 && n4c.only(formItem), `${n4c.r.status} ${n4c.r.code ?? ""} ${JSON.stringify(n4c.items)}`);
  const h4a = hintOf(await hint());
  const h4b = hintOf(await hint(`?forNote=true&customerId=${owner}`));
  const h4c = hintOf(await hint(`?forNote=true&customerId=${ownerCust}`));
  check("§4 ipucu kaynakları açılışla aynı sıra (WORK_ORDER / WORK_ORDER / CUSTOMER)",
    h4a.src === "WORK_ORDER" && h4a.id === woDefItem && h4b.src === "WORK_ORDER" && h4b.id === woDefItem && h4c.src === "CUSTOMER" && h4c.id === custItem, JSON.stringify({ h4a, h4b, h4c }));

  console.log("§5 pasif kart");
  await prisma.item.update({ where: { id: woDefItem }, data: { lifecycleStatus: "ARCHIVED", isActive: false } });
  const p5 = await panelWo();
  check("§5 ⭐ panel 409 WORK_ORDER_DEFAULT_ITEM_UNUSABLE (fabrikaya düşmez)", p5.r.status === 409 && p5.r.code === "WORK_ORDER_DEFAULT_ITEM_UNUSABLE", `${p5.r.status} ${p5.r.code ?? ""}`);
  const n5 = await noteWo(owner);
  check("§5 ⭐ belge yolu 409 WORK_ORDER_DEFAULT_ITEM_UNUSABLE; top doğmaz", n5.r.status === 409 && n5.r.code === "WORK_ORDER_DEFAULT_ITEM_UNUSABLE" && n5.items.length === 0, `${n5.r.status} ${n5.r.code ?? ""}`);
  const p5m = await panelWo({ targetItemId: manualItem });
  check("§5 elle seçimde pasif varsayılan engel değil", p5m.r.status === 201 && p5m.targetItemId === manualItem, `${p5m.r.status} ${p5m.r.code ?? ""}`);
  const h5 = hintOf(await hint());
  check("§5 ipucu kartı problem'le döner", h5.id === woDefItem && !!h5.problem, JSON.stringify(h5));
  const clr = await call("PUT", "/api/work-orders/default-target-item", tk, { itemId: null });
  const p5c = await panelWo();
  check("§5 temizlenince bugünkü 400'e döner", clr.status === 200 && clr.data === null && p5c.r.status === 400, `${clr.status} ${p5c.r.status}`);
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  const wos = (await prisma.workOrder.findMany({ where: { OR: [{ id: { in: made.wos } }, { routeTemplateId: { in: made.routes } }, { batches: { some: { rolls: { some: { id: { in: rollIds } } } } } }] }, select: { id: true } })).map((w) => w.id);
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
  await prisma.deliveryNoteCustomerDefault.deleteMany({ where: { customerId: { in: made.customers } } }).catch(swallow);
  await prisma.route.deleteMany({ where: { id: { in: made.routes } } }).catch(swallow);
  await prisma.station.deleteMany({ where: { id: { in: made.stations } } }).catch(swallow);
  await prisma.item.deleteMany({ where: { id: { in: made.items } } }).catch(swallow);
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } }).catch(swallow);
  await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(swallow);
}

async function main(): Promise<void> {
  console.log("=== İş emri varsayılan stok kartı bekçisi ===\n");
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
