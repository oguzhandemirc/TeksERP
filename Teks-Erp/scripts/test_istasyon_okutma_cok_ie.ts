// =============================================================================
// İSTASYONDA BELGE OKUT — çok iş emri: "burada bekliyor mu" + nerede + satır bilgisi (Gülkesim, 2026-11-06)
// =============================================================================
// HTTP + gerçek DB. Aynı parti no'lu dört açık İE (`q` araması = belge okumasının bulduğu küme); rota TAMBUR → KURŞUN,
// biri yalnız TAMBUR. "Burada" = isteyen ekranın açık kart listesinde (`helpers/station-open-step.helper.ts`, tek kaynak).
// Sınanan:
//   §1 ⭐ ekran bildirilmez (eski istemci) → atStation null, station null; ek alanlar (işlem, top/metre, müşteri İE no, nerede)
//   §2 ⭐ hiçbiri burada (kurşun ekranı, hepsi tamburda) → NOT_YET / NOT_ON_ROUTE, hiçbiri HERE
//   §3 ⭐ biri burada → yalnız o HERE; tambur ekranında o İE PASSED (tambur adımı bitti)
//   §4 ⭐ ikisi burada → iki HERE
//   §5 ⭐ HERE kümesi = o ekranın açık kart listesi (`/kursun-qc/open-cards?q=` · `/tambur/open-cards?stationId&q=`)
//   §6 fail-closed: TAMBUR'a tambur olmayan istasyon 400 · kurşuna stationId 400 · tanınmayan ekran 400
// Negatif sonda (2026-11-06): `markAtStation` HERE kümesini boş verince §3/§4/§5 kırmızı (ölçüm bekçi haritasında).
// =============================================================================
import { randomUUID } from "crypto";
import type { AddressInfo } from "net";
import type { Server } from "node:http";
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

const TAG = `TEST-OCI${Date.now().toString(36).toUpperCase()}`;
const D = String(Date.now()).slice(-6);
const P = `PC${D}`;

const made = { customers: [] as string[], users: [] as string[], notes: [] as string[], items: [] as string[], stations: [] as string[], routes: [] as string[], workOrders: [] as string[] };
const SETTINGS = [
  SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID,
  SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT,
  SETTING_KEYS.GELEN_BELGE_STATION_DOC_LOOKUP,
];

type WoRow = {
  id: string; workOrderNumber: string; batchNumbers: string[]; processText?: string | null; rollCount?: number; meters?: number;
  locationText?: string; atStation?: string | null; atStationText?: string | null;
  documents?: Array<{ customerOrderNo?: string | null }>;
};
type Data = { outcome?: string; workOrders?: WoRow[]; station?: { screen: string; label: string } | null; message?: string };
type Resp = { status: number; code?: string; data?: Data };

async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

async function run(url: string): Promise<void> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_STATION_DOC_LOOKUP]) await setSetting(k, true);
  for (const k of [SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE]) await setSetting(k, null);
  await setSetting(SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, "WITH_WORK_ORDER");
  await setSetting(SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, "DOCUMENT");
  const login = async (username: string, password: string, clientType?: "electron") => {
    const r = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, ...(clientType ? { clientType } : {}) }) });
    return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
  };
  const call = async <T = Data>(method: string, path: string, token: string, body?: unknown): Promise<{ status: number; code?: string; data?: T }> => {
    const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { data?: T; details?: { code?: string } };
    return { status: r.status, code: j.details?.code, data: j.data };
  };
  const tk = await login(admin.username, admin.password, "electron");
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
  const op = await mkUser("K", ["mobile:kk2-kursun", "mobile:tambur"]);
  const woUser = await mkUser("W", ["gelen-belge:read", "gelen-belge:write", "mobile:hizli-is-emri"]);
  const owner = (await prisma.customer.create({ data: { code: `${TAG}-O`, name: `${TAG} Akdeniz Perde` }, select: { id: true } })).id;
  made.customers.push(owner);
  const fabric = (await prisma.item.create({ data: { code: `${TAG}-MM`, name: `${TAG} müşteri malı`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  made.items.push(fabric);
  await setSetting(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, fabric);
  const mkStation = async (suffix: string, data: { kind: "TAMBUR" | "PROCESS_QC"; appliesQuality?: boolean }) => {
    const id = (await prisma.station.create({ data: { code: `${TAG}-${suffix}`.slice(0, 32), name: `${TAG} ${suffix}`, type: "INTERNAL", ...data }, select: { id: true } })).id;
    made.stations.push(id);
    return id;
  };
  const T = await mkStation("TMB", { kind: "TAMBUR" });
  const K = await mkStation("KRS", { kind: "PROCESS_QC", appliesQuality: true });
  const mkRoute = async (name: string, stations: string[]) => {
    const id = (await prisma.route.create({ data: { name: `${TAG} ${name}`, steps: { create: stations.map((stationId, i) => ({ stationId, sequence: i + 1 })) } }, select: { id: true } })).id;
    made.routes.push(id);
    return id;
  };
  const routeTK = await mkRoute("tambur-kursun", [T, K]);
  const routeT = await mkRoute("yalniz-tambur", [T]);

  const mkWo = async (n: number, route: string, steps: number) => {
    const r = await call<{ id?: string }>("POST", "/api/gelen-belge/irsaliyeler", tk, {
      sourceKind: "MANUAL", customerOrderNo: `MS-${D}-${n}`,
      lines: [{ senderRollNo: `${TAG}-${n}`, meters: 100, itemText: "Kumaş" }],
    });
    const id = r.data?.id ?? "";
    made.notes.push(id);
    const w = await call<{ workOrderId?: string }>("POST", `/api/gelen-belge/irsaliyeler/${id}/is-emri`, woUser, {
      clientToken: randomUUID(), ownerCustomerId: owner, ourBatchNo: P, kursunMeters: "100", routeTemplateId: route,
      stepPlanning: Array.from({ length: steps }, (_, i) => ({ sequence: i + 1 })),
    });
    const wo = w.data?.workOrderId ?? "";
    if (wo) made.workOrders.push(wo);
    check(`belge ${n} → İE (${P})`, r.status === 201 && w.status === 201 && !!wo, `${r.status} ${r.code ?? ""} ${w.status} ${w.code ?? ""}`);
    // İşlem metni belge satırında (okumanın yazdığı yer); yalnız wo1'e — ötekiler rota adına düşer.
    if (n === 1) await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: id }, data: { processText: "YIKAMA" } });
    const rolls = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: id, rollId: { not: null } }, select: { rollId: true } })).map((l) => l.rollId!);
    const stepOf = async (stationId: string) => (await prisma.workOrderStep.findFirst({ where: { workOrderId: wo, stationId }, select: { id: true } }))?.id ?? null;
    return { id: wo, rolls, tStep: await stepOf(T), kStep: await stepOf(K) };
  };
  const wo1 = await mkWo(1, routeTK, 2);
  const wo2 = await mkWo(2, routeTK, 2);
  const wo3 = await mkWo(3, routeTK, 2);
  const wo4 = await mkWo(4, routeT, 1);
  // Kurulum: bütün toplar tambur adımında (rota başı) — ölçüm aşağıdaki §2'de; yine de belirlenimli olsun diye yazılır.
  const moveTo = async (wo: { rolls: string[] }, stepId: string | null) => prisma.roll.updateMany({ where: { id: { in: wo.rolls } }, data: { currentStepId: stepId, status: "IN_PRODUCTION" } });
  for (const w of [wo1, wo2, wo3, wo4]) await moveTo(w, w.tStep);
  await prisma.workOrderStep.updateMany({ where: { workOrderId: { in: [wo1.id, wo2.id, wo3.id, wo4.id] } }, data: { status: "PENDING" } });

  const lookup = (query = "") => call("POST", `/api/gelen-belge/istasyon-okutma${query}`, op, { q: P });
  const byId = (r: Resp) => new Map((r.data?.workOrders ?? []).map((w) => [w.id, w]));
  const at = (r: Resp) => [wo1, wo2, wo3, wo4].map((w) => byId(r).get(w.id)?.atStation ?? "∅").join(",");

  console.log("§1 ekran yok (eski istemci) + ek alanlar");
  const r1 = await lookup();
  const w1 = byId(r1).get(wo1.id);
  check("§1 ⭐ dört İE bulundu (MULTIPLE)", r1.status === 200 && r1.data?.outcome === "MULTIPLE" && byId(r1).size === 4, `${r1.status} ${r1.code ?? ""} ${r1.data?.outcome} ${byId(r1).size}`);
  check("§1 ⭐ ekran yok → atStation null, station null", (r1.data?.workOrders ?? []).every((w) => w.atStation === null && w.atStationText === null) && r1.data?.station === null, at(r1));
  check("§1 ⭐ satır: işlem (belge satırı) · top/metre · müşteri İE no", w1?.processText === "YIKAMA" && w1?.rollCount === 1 && w1?.meters === 100 && (w1?.documents ?? []).some((d) => d.customerOrderNo === `MS-${D}-1`) && (w1?.batchNumbers ?? []).includes(P), JSON.stringify(w1));
  check("§1 işlem satırda yoksa rota adı", byId(r1).get(wo2.id)?.processText === `${TAG} tambur-kursun`, byId(r1).get(wo2.id)?.processText ?? "null");
  check("§1 ⭐ nerede: konum helper'ından (tambur istasyonu adı + top)", (w1?.locationText ?? "").includes(`${TAG} TMB (1 top)`), w1?.locationText);

  console.log("§2 hiçbiri burada");
  const r2 = await lookup("?screen=KURSUN_QC");
  check("§2 ⭐ kurşun ekranı, hepsi tamburda → HERE yok; rotada kurşun olan NOT_YET, olmayan NOT_ON_ROUTE", at(r2) === "NOT_YET,NOT_YET,NOT_YET,NOT_ON_ROUTE", at(r2));
  check("§2 metin + istasyon etiketi (oturumsuz → genel)", byId(r2).get(wo1.id)?.atStationText === "Buraya henüz gelmedi" && r2.data?.station?.label === "Kurşun / KK" && r2.data?.station?.screen === "KURSUN_QC", JSON.stringify(r2.data?.station));
  const r2t = await lookup(`?screen=TAMBUR&stationId=${T}`);
  check("§2 kontrol: tambur ekranında dördü de HERE", at(r2t) === "HERE,HERE,HERE,HERE" && r2t.data?.station?.label === `${TAG} TMB`, at(r2t));

  console.log("§3 biri burada");
  await moveTo(wo1, wo1.kStep);
  await prisma.workOrderStep.updateMany({ where: { id: wo1.tStep! }, data: { status: "COMPLETED" } });
  const r3 = await lookup("?screen=KURSUN_QC");
  check("§3 ⭐ kurşun ekranı: yalnız wo1 HERE", at(r3) === "HERE,NOT_YET,NOT_YET,NOT_ON_ROUTE", at(r3));
  const r3t = await lookup(`?screen=TAMBUR&stationId=${T}`);
  check("§3 ⭐ tambur ekranı: wo1 PASSED (tambur adımı bitti), diğerleri HERE", at(r3t) === "PASSED,HERE,HERE,HERE" && byId(r3t).get(wo1.id)?.atStationText === "Buradan geçti", at(r3t));

  console.log("§4 ikisi burada");
  await moveTo(wo2, wo2.kStep);
  const r4 = await lookup("?screen=KURSUN_QC");
  check("§4 ⭐ kurşun ekranı: wo1 + wo2 HERE", at(r4) === "HERE,HERE,NOT_YET,NOT_ON_ROUTE", at(r4));
  const r4t = await lookup(`?screen=TAMBUR&stationId=${T}`);
  check("§4 tambur ekranı: wo2 tambur adımı açık ama topu yok → NOT_YET", at(r4t) === "PASSED,NOT_YET,HERE,HERE", at(r4t));

  console.log("§5 HERE = açık kart listesi (tek kaynak)");
  const ours = new Set([wo1.id, wo2.id, wo3.id, wo4.id]);
  const listIds = async (path: string) => {
    const r = await call<Array<{ workOrderId: string }>>("GET", path, op);
    return (r.data ?? []).map((c) => c.workOrderId).filter((id) => ours.has(id)).sort().join(",");
  };
  const hereIds = (r: Resp) => (r.data?.workOrders ?? []).filter((w) => w.atStation === "HERE").map((w) => w.id).sort().join(",");
  const kList = await listIds(`/api/kursun-qc/open-cards?q=${P}`);
  check("§5 ⭐ kurşun: HERE kümesi = kurşun açık kart listesi", kList === hereIds(r4) && kList.length > 0, `${kList} | ${hereIds(r4)}`);
  const tList = await listIds(`/api/tambur/open-cards?stationId=${T}&q=${P}`);
  check("§5 ⭐ tambur: HERE kümesi = tambur açık kart listesi", tList === hereIds(r4t) && tList.length > 0, `${tList} | ${hereIds(r4t)}`);

  console.log("§6 fail-closed");
  const r6a = await lookup(`?screen=TAMBUR&stationId=${K}`);
  check("§6 TAMBUR ekranına tambur olmayan istasyon → 400 STATION_NOT_TAMBUR", r6a.status === 400 && r6a.code === "STATION_NOT_TAMBUR", `${r6a.status} ${r6a.code ?? ""}`);
  const r6b = await lookup(`?screen=KURSUN_QC&stationId=${K}`);
  check("§6 kurşun ekranına stationId → 400", r6b.status === 400, `${r6b.status} ${r6b.code ?? ""}`);
  const r6c = await lookup("?screen=DOKUMA");
  check("§6 tanınmayan ekran → 400", r6c.status === 400, `${r6c.status} ${r6c.code ?? ""}`);
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  const wos = [...new Set([...made.workOrders, ...(await prisma.workOrder.findMany({ where: { routeTemplateId: { in: made.routes } }, select: { id: true } })).map((w) => w.id)])];
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
  console.log("=== İstasyonda belge okut: çok İE — burada bekliyor mu (2026-11-06) bekçisi ===\n");
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
