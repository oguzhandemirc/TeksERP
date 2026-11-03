// =============================================================================
// İSTASYONDA BELGE OKUT — parti no yedeği + OCR toleransı (Gülkesim K30-E)
// =============================================================================
// HTTP + gerçek DB + sahte okuma servisi. Kullanıcı şablonuyla (`u-…`, Evrak No atanmamış) tanınan belgenin
// fotoğrafı `POST /api/gelen-belge/istasyon-okutma`ya gider (`gelen-belge-istasyon-okutma.service.ts`); karşılaştırma
// `helpers/doc-code-match.helper.ts`ten. Sınanan:
//   §1 ⭐ (i) kullanıcı şablonuyla tanınan, evrak no'suz belge → parti no ile TEK iş emri (open); okunan evrak no null
//   §2 ⭐ (ii) parti no OCR'da karışık ("P-I…", I↔1) → toleransla aynı iş emri
//   §3 ⭐ (iii) belge no yolu ÖNCE: evrak no + paylaşılan parti no → evrak no'nun TEK iş emri (parti üç İE verirdi);
//      evrak no OCR'da karışık (O↔0) → toleranslı belge no yine o İE
//   §4 ⭐ (iv) aynı parti no'lu üç açık iş emri → MULTIPLE (choose)
//   §5 ⭐ (v) tamamlanmış (kartı açık kalsa da) ve iptal iş emri parti no ile eşleşmez
//   §6 ⭐ (vi) hiçbiri → iş emri yok + cümle okunan evrak no ve parti no'yu söyler; yanıt şekli (outcome/workOrders/message)
// Negatif sonda (2026-11-04 ölçüldü, 15/5): parti no yedeği (`workOrdersOfBatchNos` dalı) kapatılınca §1/§2/§4/§5 kırmızı.
// =============================================================================
import { randomUUID, createHash } from "crypto";
import type { AddressInfo } from "net";
import http, { type Server } from "node:http";
import * as bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { setReaderUrlForTests } from "../src/lib/gelen-belge/url";
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

const TAG = `TEST-IBP${Date.now().toString(36).toUpperCase()}`;
const D = String(Date.now()).slice(-6);
const P1 = `P1${D}`; // §1–§2 tek İE
const P2 = `P2${D}`; // §3–§4 paylaşılan parti
const P4 = `P4${D}`; // §5 kapalı İE
const E5 = `70${D}`; // §3 belge no
const KEYWORD = `${TAG} IS TAKIP FORMU`;

/** Sahte okuma servisinin çizdiği form: başlık + etiket/değer satırları (değer etiketin sağında). */
type Spec = { musteri?: string; parti?: string; evrak?: string };
function ocrOf(spec: Spec): unknown {
  const rows: Array<[string, string | undefined]> = [[KEYWORD, undefined], ["MUSTERI", spec.musteri], ["PARTI NO", spec.parti], ["EVRAK NO", spec.evrak], ["HEDEF METRAJ", "1200"]];
  const el = (text: string, x: number, y: number) => ({ text, rect: { x, y, width: text.length * 18, height: 30 }, confidence: 0.95 });
  const blocks = rows.filter(([, v], i) => i === 0 || v !== undefined).map(([label, value], i) => {
    const y = 50 + i * 80;
    const lines = [{ text: label, rect: { x: 40, y, width: label.length * 18, height: 30 }, confidence: 0.95, angle: 0, elements: label.split(" ").map((t, j) => el(t, 40 + j * 120, y)) }];
    if (value) lines.push({ text: value, rect: { x: 300, y, width: value.length * 18, height: 30 }, confidence: 0.95, angle: 0, elements: [el(value, 300, y)] });
    return { text: lines.map((l) => l.text).join("\n"), rect: { x: 40, y, width: 800, height: 30 }, lines };
  });
  return { text: blocks.map((b) => b.text).join("\n"), blocks, imageWidth: 1000, imageHeight: 1400 };
}
const anchor = (labels: string[]) => [{ kind: "anchor", labels, direction: "right" }];
/** Tanıt rehberinin alanları; Evrak No atanmamış (sabah senaryosu). */
const USER_TEMPLATE = {
  identifiers: { keywords: [KEYWORD, "PARTI NO", "HEDEF METRAJ"], minScore: 0.6 },
  fields: [
    { key: "musteri", label: "Müşteri", type: "text", strategies: anchor(["MUSTERI"]) },
    { key: "partiNo", label: "Parti no", type: "text", strategies: anchor(["PARTI NO"]) },
  ],
};
/** Evrak No'lu sürüm (§3): aynı form, evrak no alanı da atanmış. */
const USER_TEMPLATE_WITH_DOC = { ...USER_TEMPLATE, fields: [...USER_TEMPLATE.fields, { key: "evrakNo", label: "Evrak no", type: "text", strategies: anchor(["EVRAK NO"]) }] };

const photo = (spec: Spec) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${TAG} ${randomUUID()} SPEC:${Buffer.from(JSON.stringify(spec)).toString("base64url")}:END`)]).toString("base64");

function startFakeSidecar(): Promise<{ server: Server; url: string }> {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/ocr")) { res.writeHead(404); res.end(); return; }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { imageBase64: string };
      const m = /SPEC:([A-Za-z0-9_-]+):END/.exec(Buffer.from(body.imageBase64, "base64").toString("utf8"));
      if (!m) { res.writeHead(400); res.end(); return; }
      res.writeHead(200, { "content-type": "application/json", "x-okuma-version": "0.0-test" });
      res.end(JSON.stringify(ocrOf(JSON.parse(Buffer.from(m[1]!, "base64url").toString("utf8")) as Spec)));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

const made = { customers: [] as string[], users: [] as string[], notes: [] as string[], items: [] as string[], stations: [] as string[], routes: [] as string[], scans: [] as string[], workOrders: [] as string[], templates: [] as string[] };
const SETTINGS = [
  SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID,
  SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT,
  SETTING_KEYS.GELEN_BELGE_STATION_DOC_LOOKUP,
];

type WoRow = { id: string; workOrderNumber: string; cardBarcode: string; batchNumbers: string[] };
type Lookup = { outcome?: string; source?: string; read?: { senderDocNo?: string | null } | null; workOrders?: WoRow[]; message?: string };
type Resp = { status: number; code?: string; data?: Record<string, unknown> & Lookup };

async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

async function run(url: string, sidecar: { url: string }): Promise<void> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_STATION_DOC_LOOKUP]) await setSetting(k, true);
  for (const k of [SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE]) await setSetting(k, null);
  await setSetting(SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, "WITH_WORK_ORDER");
  await setSetting(SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, "DOCUMENT");
  const login = async (username: string, password: string, clientType?: "electron") => {
    const r = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, ...(clientType ? { clientType } : {}) }) });
    return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
  };
  const call = async (method: string, path: string, token: string, body?: unknown): Promise<Resp> => {
    const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; details?: { code?: string } };
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
  const kursunOp = await mkUser("K", ["mobile:kk2-kursun"]);
  const woUser = await mkUser("W", ["gelen-belge:read", "gelen-belge:write", "mobile:hizli-is-emri"]);
  const owner = (await prisma.customer.create({ data: { code: `${TAG}-O`, name: `${TAG} Akdeniz Perde` }, select: { id: true } })).id;
  made.customers.push(owner);
  const fabric = (await prisma.item.create({ data: { code: `${TAG}-MM`, name: `${TAG} müşteri malı`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  made.items.push(fabric);
  await setSetting(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, fabric);
  const station = (await prisma.station.create({ data: { code: `${TAG}-KRS`.slice(0, 32), name: `${TAG} KRS`, type: "INTERNAL", kind: "PROCESS_QC", appliesQuality: true }, select: { id: true } })).id;
  made.stations.push(station);
  const route = (await prisma.route.create({ data: { name: `${TAG} kurşun`, steps: { create: [{ stationId: station, sequence: 1 }] } }, select: { id: true } })).id;
  made.routes.push(route);

  // Kullanıcı şablonu (tanıt): Evrak No atanmamış.
  const tpl = await call("POST", "/api/gelen-belge/sablonlar/ozel", tk, { name: `${TAG} iş takip formu`, template: USER_TEMPLATE, clientToken: randomUUID() });
  const code = (tpl.data as { code?: string } | undefined)?.code ?? "";
  const tplRow = await prisma.senderTemplate.findUnique({ where: { code }, select: { id: true, version: true } });
  if (tplRow) made.templates.push(tplRow.id);
  check("kullanıcı şablonu kaydedildi (u-…)", tpl.status === 201 && code.startsWith("u-"), `${tpl.status} ${tpl.code ?? ""} ${code}`);

  const mkWo = async (suffix: string, head: Record<string, unknown>, batch: string) => {
    const r = await call("POST", "/api/gelen-belge/irsaliyeler", tk, { sourceKind: "MANUAL", ...head, lines: [{ senderRollNo: `${TAG}-${suffix}`, meters: 100, itemText: "Kumaş" }] });
    const id = (r.data as { id?: string } | undefined)?.id ?? "";
    made.notes.push(id);
    const content = Buffer.from(`${TAG} FOTO-${suffix}`);
    const s = await prisma.documentScan.create({
      data: { noteId: id, sha256: createHash("sha256").update(content).digest("hex"), mimeType: "image/jpeg", sizeBytes: content.length, content, status: "READ", ocrResult: { ocr: { text: `${TAG} ${suffix}` } } },
      select: { id: true },
    });
    made.scans.push(s.id);
    const w = await call("POST", `/api/gelen-belge/irsaliyeler/${id}/is-emri`, woUser, { clientToken: randomUUID(), ownerCustomerId: owner, ourBatchNo: batch, kursunMeters: "100", routeTemplateId: route, stepPlanning: [{ sequence: 1 }] });
    const d = w.data as { workOrderId?: string; workOrderNo?: string } | undefined;
    if (d?.workOrderId) made.workOrders.push(d.workOrderId);
    check(`belge ${suffix} → İE (${batch})`, r.status === 201 && w.status === 201 && !!d?.workOrderId, `${r.status} ${w.status} ${w.code ?? ""}`);
    return d?.workOrderId ?? "";
  };
  const wo1 = await mkWo("1", {}, P1);
  const wo2 = await mkWo("2", {}, P2);
  const wo3 = await mkWo("3", {}, P2);
  const wo5 = await mkWo("5", { senderDocNo: E5 }, P2);
  const wo4 = await mkWo("4", {}, P4);

  setReaderUrlForTests(sidecar.url);
  const lookup = (spec: Spec) => call("POST", "/api/gelen-belge/istasyon-okutma", kursunOp, { contentBase64: photo(spec) });
  const ids = (r: Resp) => (r.data?.workOrders ?? []).map((w) => w.id).sort().join(",");

  console.log("§1 (i) evrak no'suz kullanıcı şablonu → parti no");
  const r1 = await lookup({ musteri: "AKDENIZ PERDE", parti: P1 });
  check("§1 ⭐ parti no ile TEK iş emri (SINGLE → tablet açar), okunan evrak no yok", r1.status === 200 && r1.data?.source === "OCR" && r1.data?.outcome === "SINGLE" && ids(r1) === wo1 && r1.data?.read?.senderDocNo === null,
    `${r1.status} ${r1.code ?? ""} ${r1.data?.outcome} ${ids(r1)} ${r1.data?.message}`);
  check("§1 tablet sözleşmesi: kart kodu + parti no", !!r1.data?.workOrders?.[0]?.cardBarcode && (r1.data?.workOrders?.[0]?.batchNumbers ?? []).includes(P1), JSON.stringify(r1.data?.workOrders?.[0]));

  console.log("§2 (ii) OCR karışık parti no");
  const r2 = await lookup({ parti: `P-I${D}` });
  check("§2 ⭐ 'P-I…' (I↔1, tire) → toleransla aynı İE", r2.data?.outcome === "SINGLE" && ids(r2) === wo1, `${r2.data?.outcome} ${ids(r2)} ${r2.data?.message}`);

  console.log("§3 (iii) belge no önce");
  const up = await call("PUT", `/api/gelen-belge/sablonlar/ozel/${code}`, tk, { expectedVersion: tplRow?.version ?? 1, template: USER_TEMPLATE_WITH_DOC });
  check("şablona Evrak No eklendi", up.status === 200, `${up.status} ${up.code ?? ""}`);
  const r3 = await lookup({ parti: P2, evrak: E5 });
  check("§3 ⭐ evrak no + paylaşılan parti → evrak no'nun TEK İE'si", r3.data?.outcome === "SINGLE" && ids(r3) === wo5 && r3.data?.read?.senderDocNo === E5, `${r3.data?.outcome} ${ids(r3)} ${r3.data?.read?.senderDocNo}`);
  const r3b = await lookup({ evrak: `7O${D}` });
  check("§3 ⭐ evrak no OCR'da karışık (O↔0) → toleranslı belge no aynı İE", r3b.data?.outcome === "SINGLE" && ids(r3b) === wo5, `${r3b.data?.outcome} ${ids(r3b)} ${r3b.data?.message}`);

  console.log("§4 (iv) aynı parti iki+ açık İE");
  const r4 = await lookup({ parti: P2 });
  check("§4 ⭐ aynı parti no'lu açık İE'ler → MULTIPLE (choose)", r4.data?.outcome === "MULTIPLE" && ids(r4) === [wo2, wo3, wo5].sort().join(","), `${r4.data?.outcome} ${ids(r4)}`);

  console.log("§5 (v) kapalı / iptal İE eşleşmez");
  const r5a = await lookup({ parti: P4 });
  check("§5 açıkken parti no ile bulunur (kontrol)", r5a.data?.outcome === "SINGLE" && ids(r5a) === wo4, `${r5a.data?.outcome} ${ids(r5a)}`);
  await prisma.workOrder.update({ where: { id: wo4 }, data: { status: "COMPLETED" } });
  const r5b = await lookup({ parti: P4 });
  await prisma.workOrder.update({ where: { id: wo4 }, data: { status: "CANCELLED" } });
  const r5c = await lookup({ parti: P4 });
  check("§5 ⭐ tamamlanmış İE (kartı açık kalsa da) eşleşmez", (r5b.data?.workOrders ?? []).length === 0, `${r5b.data?.outcome} ${ids(r5b)}`);
  check("§5 ⭐ iptal İE eşleşmez", (r5c.data?.workOrders ?? []).length === 0, `${r5c.data?.outcome} ${ids(r5c)}`);

  console.log("§6 (vi) hiçbiri");
  const noDoc = `6${D}6`;
  const noBatch = `Z9${D}`;
  const r6 = await lookup({ parti: noBatch, evrak: noDoc });
  const msg = r6.data?.message ?? "";
  check("§6 ⭐ iş emri yok; cümle okunan evrak no + parti no'yu söyler", r6.status === 200 && (r6.data?.workOrders ?? []).length === 0 && msg.includes(`evrak no: ${noDoc}`) && msg.includes(`parti no: ${noBatch}`) && msg.includes("eşleşen açık") && msg.includes("elle arayın"), `${r6.data?.outcome} ${msg}`);
  const r6b = await lookup({ parti: noBatch });
  const msgB = r6b.data?.message ?? "";
  check("§6 evrak no okunmadıysa cümle 'okunamadı' der", (r6b.data?.workOrders ?? []).length === 0 && msgB.includes("evrak no: okunamadı") && msgB.includes(noBatch), msgB);
  check("§6 yanıt şekli değişmedi (outcome · source · read · notes · workOrders · message)", ["outcome", "source", "read", "notes", "workOrders", "message"].every((k) => r6.data !== undefined && k in r6.data), JSON.stringify(Object.keys(r6.data ?? {})));
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  const wos = [...new Set([...made.workOrders, ...(await prisma.workOrder.findMany({ where: { routeTemplateId: { in: made.routes } }, select: { id: true } })).map((w) => w.id)])];
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
  await prisma.senderTemplateVersion.deleteMany({ where: { templateId: { in: made.templates } } }).catch(swallow);
  await prisma.senderTemplate.deleteMany({ where: { id: { in: made.templates } } }).catch(swallow);
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
  console.log("=== İstasyonda belge okut: parti no yedeği (K30-E) bekçisi ===\n");
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: SETTINGS } }, select: { key: true, value: true } });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const sidecar = await startFakeSidecar();
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, sidecar);
  } catch (e) {
    fail++;
    console.error("HATA:", e);
  } finally {
    setReaderUrlForTests(null);
    server.close();
    sidecar.server.close();
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
