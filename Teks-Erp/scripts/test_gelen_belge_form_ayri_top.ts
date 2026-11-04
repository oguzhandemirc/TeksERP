// =============================================================================
// GELEN BELGE → İŞ EMRİ FORMU: "Toplar ayrı geldi" (Gülkesim fason, 2026-11-04)
// =============================================================================
// HTTP + gerçek DB. Uçlar: `POST /irsaliyeler/:id/is-emri` (`rollMode` + `rolls[]`), `GET /irsaliyeler/:id/okuma-ozeti`
// (`docRolls`). Sınanan:
//   §5 ⭐ SEPARATE 3 top → 3 top (metre / kg / gönderen top no), 1 İE (3 top bağlı), kurşun metresi = topların toplamı
//      (gövdedeki değer değil), giriş sebebi "<no> top N"; ⭐ aynı token replay aynı İE, yeni top yok; tek top da çalışır
//   §6 400: SEPARATE + rolls yok (GELEN_BELGE_FORM_ROLLS_REQUIRED), rolls + SINGLE / rollMode'suz (_ROLLS_NEED_SEPARATE),
//      rolls + parties (_ROLLS_WITH_PARTIES), strict top nesnesi, metre ≤ 0; hepsinde belge DRAFT, top doğmaz
//   §7 ⭐ okuma özeti `docRolls`: TOP satırları (SKIPPED ve ARABA hariç, sıra), onay sonrası özet satırı hariç
// Negatif sonda: `rollsAsParties` eşlemesi null dönünce (tek parça yoluna düşer) §5 kırmızı.
// =============================================================================
import { randomUUID, createHash } from "crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";
import * as bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { partyLineId } from "../src/services/gelen-belge-kontrol.service";
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

const TAG = `TEST-GAT${Date.now().toString(36).toUpperCase()}`;
const made = { props: [] as string[], customers: [] as string[], users: [] as string[], notes: [] as string[], items: [] as string[], colors: [] as string[], stations: [] as string[], routes: [] as string[], scans: [] as string[] };
const SETTINGS = [
  SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID,
  SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT,
  SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER, SETTING_KEYS.GELEN_BELGE_DESEN_RENK_ESLESME, SETTING_KEYS.GELEN_BELGE_TABLET_IE_GIRISI,
  SETTING_KEYS.PRODUCTION_ROUTE_MODE,
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

const num = (v: unknown): number | null => (v == null ? null : Number(v));

async function run(url: string): Promise<void> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
  for (const k of [SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE,
    SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER, SETTING_KEYS.GELEN_BELGE_DESEN_RENK_ESLESME, SETTING_KEYS.GELEN_BELGE_TABLET_IE_GIRISI]) await setSetting(k, null);
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
  const mkItem = async (suffix: string, name: string, itemType: "FABRIC") => {
    const id = (await prisma.item.create({ data: { code: `${TAG}-${suffix}`, name, itemType, unit: "MT" }, select: { id: true } })).id;
    made.items.push(id);
    return id;
  };
  const fabric = await mkItem("MM", `${TAG} müşteri malı`, "FABRIC");
  await setSetting(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, fabric);
  const station = (await prisma.station.create({ data: { code: `${TAG}-STN`.slice(0, 32), name: `${TAG} kurşun`, type: "INTERNAL" }, select: { id: true } })).id;
  made.stations.push(station);
  const route = (await prisma.route.create({ data: { name: `${TAG} rota`, steps: { create: [{ stationId: station, sequence: 1 }] } }, select: { id: true } })).id;
  made.routes.push(route);

  /** Tek partili sade belge: iki satır, 1 sayfa taranmış. `ocr` verilirse taramanın okuma sonucu odur. */
  const mkNote = async (ocr: unknown = { ocr: { text: TAG } }) => {
    const r = await call("POST", "/api/gelen-belge/irsaliyeler", tk, {
      sourceKind: "MANUAL", senderText: `${TAG} GÖNDEREN`,
      lines: [100, 110].map((m, i) => ({ senderRollNo: `${TAG}-${made.notes.length}-${i}`, meters: m, itemText: "Kumaş" })),
    });
    const id = (r.data as { id?: string } | undefined)?.id ?? "";
    made.notes.push(id);
    await addScan(id, ocr, 1);
    check(`taslak (${made.notes.length})`, r.status === 201 && !!id, `${r.status} ${r.code ?? ""}`);
    return id;
  };
  const body = (extra: Record<string, unknown> = {}) => ({ clientToken: randomUUID(), ownerCustomerId: owner, kursunMeters: "210", routeTemplateId: route, ...extra });
  const formWo = (id: string, b: unknown) => call("POST", `/api/gelen-belge/irsaliyeler/${id}/is-emri`, woUser, b);

  type RollRow = { meters: number; weightKg: number | null; senderRollNo: string | null; entryReason: string | null; batchId: string | null };
  const noteRolls = async (noteId: string): Promise<RollRow[]> => (await prisma.customerDeliveryNoteLine.findMany({
    where: { noteId, rollId: { not: null } }, orderBy: [{ blockNo: "asc" }, { lineNo: "asc" }],
    select: { senderRollNo: true, roll: { select: { initialQty: true, weightKg: true, entryReason: true, batchId: true } } },
  })).map((l) => ({ meters: Number(l.roll!.initialQty), weightKg: num(l.roll!.weightKg), senderRollNo: l.senderRollNo, entryReason: l.roll!.entryReason, batchId: l.roll!.batchId }));
  const noteHead = (id: string) => prisma.customerDeliveryNote.findUnique({ where: { id }, select: { status: true, noteNo: true, kursunMeters: true } });

  console.log("§5 toplar ayrı");
  const n5 = await mkNote();
  const rolls5 = [{ meters: 50.5, weightKg: 10.25, senderRollNo: "T-1" }, { meters: 60, weightKg: null, senderRollNo: "T-2" }, { meters: 70.25, weightKg: 12 }];
  const b5 = body({ kursunMeters: "999", rollMode: "SEPARATE", rolls: rolls5 });
  const r5 = await formWo(n5, b5);
  const h5 = await noteHead(n5);
  const rr5 = await noteRolls(n5);
  check("§5 ⭐ 201; 3 top doğdu", r5.status === 201 && rr5.length === 3, `${r5.status} ${r5.code ?? ""} ${rr5.length}`);
  check("§5 ⭐ top metre / kg / gönderen top no sırayla gövdeden",
    JSON.stringify(rr5.map((r) => [r.meters, r.weightKg, r.senderRollNo])) === JSON.stringify([[50.5, 10.25, "T-1"], [60, null, "T-2"], [70.25, 12, null]]),
    JSON.stringify(rr5));
  check("§5 ⭐ kurşun metresi = topların toplamı (180.75; gövdedeki 999 değil)", num(h5?.kursunMeters) === 180.75, String(h5?.kursunMeters));
  const wo5 = await prisma.workOrder.findMany({ where: { batches: { some: { rolls: { some: { id: { in: (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: n5, rollId: { not: null } }, select: { rollId: true } })).map((l) => l.rollId!) } } } } } }, select: { id: true } });
  check("§5 ⭐ tek İE, 3 top aynı partide", wo5.length === 1 && wo5[0]!.id === r5.data?.workOrderId && new Set(rr5.map((r) => r.batchId)).size === 1 && !!rr5[0]?.batchId, JSON.stringify({ wo5, b: rr5.map((r) => r.batchId) }));
  check("§5 giriş sebebi '<no> top N'", rr5.map((r) => r.entryReason).join("|") === [1, 2, 3].map((n) => `${h5?.noteNo} top ${n}`).join("|"), rr5.map((r) => r.entryReason).join("|"));
  check("§5 uyarı 'Toplar ayrı: 3 top'", (r5.warnings ?? []).some((w) => w.startsWith("Toplar ayrı: 3 top")), JSON.stringify(r5.warnings));
  const rp5 = await formWo(n5, b5);
  const rr5b = await noteRolls(n5);
  check("§5 ⭐ aynı token replay → aynı İE, yeni top yok", rp5.status === 201 && rp5.data?.workOrderId === r5.data?.workOrderId && rr5b.length === 3, `${rp5.status} ${rp5.code ?? ""} ${rr5b.length}`);
  const n5b = await mkNote();
  const r5b = await formWo(n5b, body({ rollMode: "SEPARATE", rolls: [{ meters: 42, weightKg: 7, senderRollNo: "TEK" }] }));
  const rr5c = await noteRolls(n5b);
  check("§5 tek top: 201, 1 top 42 m / 7 kg, kurşun 42", r5b.status === 201 && rr5c.length === 1 && rr5c[0]!.meters === 42 && rr5c[0]!.weightKg === 7 && num((await noteHead(n5b))?.kursunMeters) === 42, `${r5b.status} ${r5b.code ?? ""} ${JSON.stringify(rr5c)}`);

  console.log("§6 400'ler");
  const n6 = await mkNote();
  const bad = async (label: string, extra: Record<string, unknown>, code?: string) => {
    const r = await formWo(n6, body(extra));
    check(`§6 ${label} → 400${code ? ` ${code}` : ""}; belge DRAFT, top yok`, r.status === 400 && (!code || r.code === code) && (await noteHead(n6))?.status === "DRAFT" && (await noteRolls(n6)).length === 0, `${r.status} ${r.code ?? ""}`);
  };
  await bad("⭐ SEPARATE + rolls yok", { rollMode: "SEPARATE" }, "GELEN_BELGE_FORM_ROLLS_REQUIRED");
  await bad("⭐ rolls + SINGLE", { rollMode: "SINGLE", rolls: [{ meters: 10 }] }, "GELEN_BELGE_FORM_ROLLS_NEED_SEPARATE");
  await bad("rolls + rollMode yok", { rolls: [{ meters: 10 }] }, "GELEN_BELGE_FORM_ROLLS_NEED_SEPARATE");
  await bad("⭐ rolls + parties", { rollMode: "SEPARATE", rolls: [{ meters: 10 }], parties: [{ blockNo: 1, meters: 100 }, { blockNo: 2, meters: 110 }] }, "GELEN_BELGE_FORM_ROLLS_WITH_PARTIES");
  await bad("strict: top nesnesinde bilinmeyen alan", { rollMode: "SEPARATE", rolls: [{ meters: 10, color: "x" }] });
  await bad("top metresi 0", { rollMode: "SEPARATE", rolls: [{ meters: 0 }] });
  await bad("boş top listesi", { rollMode: "SEPARATE", rolls: [] });
  await bad("tanınmayan rollMode", { rollMode: "AYRI" });
  const r6 = await formWo(n6, body({ rollMode: "SINGLE" }));
  check("§6 rollMode SINGLE + rolls yok = bugünkü tek parça (1 top = kurşun 210)", r6.status === 201 && (await noteRolls(n6)).map((r) => r.meters).join() === "210", `${r6.status} ${r6.code ?? ""}`);

  console.log("§7 okuma özeti docRolls");
  const n7 = await mkNote();
  const ls7 = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: n7 }, orderBy: { lineNo: "asc" }, select: { id: true, lineNo: true } });
  await prisma.customerDeliveryNoteLine.update({ where: { id: ls7[0]!.id }, data: { weightKg: 21.5 } });
  await prisma.customerDeliveryNoteLine.createMany({ data: [
    { noteId: n7, lineNo: 3, blockNo: 1, lineKind: "ARABA", meters: 120, status: "PENDING" },
    { noteId: n7, lineNo: 4, blockNo: 1, lineKind: "TOP", senderRollNo: "ATLA", meters: 130, status: "SKIPPED" },
  ] });
  const docRolls = async (id: string) => ((await call("GET", `/api/gelen-belge/irsaliyeler/${id}/okuma-ozeti`, woUser)).data?.docRolls ?? null) as Array<{ lineNo: number; meters: number; weightKg: number | null; senderRollNo: string | null }> | null;
  const d7 = await docRolls(n7);
  check("§7 ⭐ docRolls = TOP satırları (ARABA/SKIPPED hariç), sırayla metre/kg/top no",
    JSON.stringify(d7) === JSON.stringify(ls7.map((l, i) => ({ lineNo: l.lineNo, meters: [100, 110][i], weightKg: i === 0 ? 21.5 : null, senderRollNo: `${TAG}-${made.notes.indexOf(n7)}-${i}` }))),
    JSON.stringify(d7));
  const d5 = await docRolls(n5);
  check("§7 ⭐ onaylı ayrı top belgesinde özet (top) satırları docRolls'a girmez", Array.isArray(d5) && d5.length === 2 && d5.every((r) => r.meters === 100 || r.meters === 110) && !d5.some((r) => r.senderRollNo === "T-1"), JSON.stringify(d5));
  check("§7 özet satırı kimliği partyLineId (blok 1..3)", (await prisma.customerDeliveryNoteLine.count({ where: { id: { in: [1, 2, 3].map((b) => partyLineId(n5, b)) }, lineKind: "TOP", rollId: { not: null } } })) === 3);
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  const wos = (await prisma.workOrder.findMany({ where: { OR: [{ routeTemplateId: { in: made.routes } }, { batches: { some: { rolls: { some: { id: { in: rollIds } } } } } }] }, select: { id: true } })).map((w) => w.id);
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
  await prisma.fabricProperty.deleteMany({ where: { id: { in: made.props } } }).catch(swallow);
  await prisma.station.deleteMany({ where: { id: { in: made.stations } } }).catch(swallow);
  await prisma.item.deleteMany({ where: { id: { in: made.items } } }).catch(swallow);
  await prisma.color.deleteMany({ where: { id: { in: made.colors } } }).catch(swallow);
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } }).catch(swallow);
  await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(swallow);
}

async function main(): Promise<void> {
  console.log("=== Gelen belge İE formu — toplar ayrı geldi bekçisi ===\n");
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
