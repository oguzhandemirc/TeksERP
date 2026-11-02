// =============================================================================
// GELEN BELGE — istasyonda belgeden iş emri bulma (Gülkesim K17; fabrika cevabı 23 / 23-ek)
// =============================================================================
// HTTP + gerçek DB + sahte okuma servisi. `GET/POST /api/gelen-belge/istasyon-okutma`
// (`gelen-belge-istasyon-okutma.service.ts`), liste araması `GET /api/kursun-qc/open-cards?q=`, `/api/tambur/open-cards?q=`,
// `GET /api/work-orders?search=` (`workorder-doc-search.helper.ts`). Sınanan:
//   §1 ayar `gelenBelge.stationDocLookup` varsayılan false (bugünkü), dedicated (ham uca kapalı); durum ucu enabled false
//   §2 ⭐ izin: istasyon izni olmayan 403; mobile:kk2-kursun ile ayar kapalı → 403 GELEN_BELGE_STATION_LOOKUP_DISABLED,
//      açık → 200; üretim modülü kapalı → 403 MODULE_DISABLED; gelen belge modülü kapalı → 403 MODULE_DISABLED
//   §3 ⭐ eşleme okuması HİÇBİR satır doğurmaz (tarama / belge / satır / şablon / iş emri sayımı sabit)
//   §4 ⭐ aynı fotoğraf (sha256) → okuma servisi ÇAĞRILMADAN belgenin iş emri (SINGLE, SAME_PHOTO)
//   §5 ⭐ yeni fotoğraf → okuma → gönderen belge no → iki belge (iki gönderen) → iki İE (MULTIPLE); okunan sahip metni
//      tek belgeye daraltır → SINGLE; okunamayan fotoğraf UNREADABLE; PDF 400
//   §6 ⭐ bir belgeden iki İE (belgenin topu ikinci İE'nin partisinde) → MULTIPLE, iki İE de aynı belgeyi gösterir
//   §7 ⭐ bilinmeyen belge no → NO_DOCUMENT; İE'siz onaylı belge → NO_WORK_ORDER (fotoğraf + elle arama); okuyucu yok 503
//   §8 ⭐ q ile kurşun + tambur açık kart, panel İE listesi fiş no / GB no / parti no'dan bulur; iptal belge eşleşmez
// Negatif sonda: `whereWorkOrdersOfRolls`tan `batches` dalı çıkarılınca §6 kırmızı; `assertStationLookupEnabled`ten
// ayar koşulu kaldırılınca §2 kırmızı; arama yükleminden `LOOKUP_NOTE_STATUSES` çıkarılınca §8 iptal kırmızı.
// =============================================================================
import { randomUUID, createHash } from "crypto";
import type { AddressInfo } from "net";
import http, { type Server } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { INCOMING_DOC_DEDICATED_SETTING_KEYS } from "../src/services/gelen-belge-ayar.service";
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

const TAG = `TEST-GBI${Date.now().toString(36).toUpperCase()}`;
// Gerçek fikstürdeki fiş no (0245 → 914279) koşuma özgü numarayla değiştirilir: ortak test DB'sinde başka belgeyle çakışmaz.
const UNIQ = `9${String(Date.now()).slice(-7)}`;
const UNIQ_NONE = `8${String(Date.now()).slice(-7)}`;
const FIKSTUR = join(__dirname, "..", "src", "lib", "gelen-belge", "motor", "__tests__", "fikstur", "gercek");
const fixture0245 = (docNo: string): unknown => {
  const raw = readFileSync(join(FIKSTUR, readdirSync(FIKSTUR).find((f) => f.startsWith("0245"))!), "utf8");
  return JSON.parse(raw.split("914279").join(docNo));
};
const jpeg = (salt: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${TAG} ${salt}`)]);

const made = { customers: [] as string[], users: [] as string[], notes: [] as string[], items: [] as string[], stations: [] as string[], routes: [] as string[], scans: [] as string[], workOrders: [] as string[] };
const SETTINGS = [
  SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID,
  SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT,
  SETTING_KEYS.GELEN_BELGE_STATION_DOC_LOOKUP,
];

type WoRow = { id: string; workOrderNumber: string; cardBarcode: string; batchNumbers: string[]; documents: Array<{ noteNo: string; senderDocNo: string | null }> };
type Lookup = { outcome?: string; source?: string; read?: { senderDocNo?: string | null; ownerText?: string | null } | null; workOrders?: WoRow[]; notes?: Array<{ id: string }>; message?: string };
type Resp = { status: number; code?: string; data?: Record<string, unknown> & Lookup };

async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

/** Sahte okuma servisi: gövdede `DOC:<no>` → 0245 fikstürü o fiş no ile; yoksa 400 (okunamayan fotoğraf). */
function startFakeSidecar(): Promise<{ server: Server; url: string; hits: () => number }> {
  let hits = 0;
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/ocr")) { res.writeHead(404); res.end(); return; }
    hits++;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { imageBase64: string };
      const m = /DOC:(\d+)/.exec(Buffer.from(body.imageBase64, "base64").toString("utf8"));
      if (!m) { res.writeHead(400); res.end(); return; }
      res.writeHead(200, { "content-type": "application/json", "x-okuma-version": "0.0-test" });
      res.end(JSON.stringify(fixture0245(m[1]!)));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits: () => hits })));
}

async function run(url: string, sidecar: { url: string; hits: () => number }): Promise<void> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
  for (const k of [SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_STATION_DOC_LOOKUP]) await setSetting(k, null);
  await setSetting(SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, "WITH_WORK_ORDER");
  await setSetting(SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, "DOCUMENT");
  // İstasyon kullanıcısının web izni yok: panel girişi (clientType electron) 403 verir → istemci türsüz giriş (tablet gibi).
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
  const stranger = await mkUser("X", ["mobile:kk1"]);
  const woUser = await mkUser("W", ["gelen-belge:read", "gelen-belge:write", "mobile:hizli-is-emri"]);

  const mkCustomer = async (suffix: string, name: string) => {
    const c = (await prisma.customer.create({ data: { code: `${TAG}-${suffix}`, name }, select: { id: true } })).id;
    made.customers.push(c);
    return c;
  };
  const owner1 = await mkCustomer("O1", `${TAG} Akdeniz Perdecilik`);
  const owner2 = await mkCustomer("O2", `${TAG} Ege Perde`);
  const sender1 = await mkCustomer("S1", `${TAG} Marmara Boyahane`);
  const sender2 = await mkCustomer("S2", `${TAG} Trakya Apre`);
  const fabric = (await prisma.item.create({ data: { code: `${TAG}-MM`, name: `${TAG} müşteri malı`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  made.items.push(fabric);
  await setSetting(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, fabric);
  const mkStation = async (suffix: string, kind: "PROCESS_QC" | "TAMBUR") => {
    const s = (await prisma.station.create({ data: { code: `${TAG}-${suffix}`.slice(0, 32), name: `${TAG} ${suffix}`, type: "INTERNAL", kind, ...(kind === "PROCESS_QC" ? { appliesQuality: true } : {}) }, select: { id: true } })).id;
    made.stations.push(s);
    return s;
  };
  const kStation = await mkStation("KRS", "PROCESS_QC");
  const tStation = await mkStation("TMB", "TAMBUR");
  const mkRoute = async (name: string, stationId: string) => {
    const r = await prisma.route.create({ data: { name: `${TAG} ${name}`, steps: { create: [{ stationId, sequence: 1 }] } }, select: { id: true } });
    made.routes.push(r.id);
    return r.id;
  };
  const kRoute = await mkRoute("kurşun", kStation);
  const tRoute = await mkRoute("tambur", tStation);

  /** Okunmuş taramalı taslak; tarama baytı = istasyonun "aynı fotoğrafı". */
  const mkNote = async (suffix: string, head: Record<string, unknown>) => {
    const r = await call("POST", "/api/gelen-belge/irsaliyeler", tk, { sourceKind: "MANUAL", ...head, lines: [{ senderRollNo: `${TAG}-${suffix}`, meters: 100, itemText: "Kumaş" }] });
    const id = (r.data as { id?: string } | undefined)?.id ?? "";
    made.notes.push(id);
    const content = jpeg(`FOTO-${suffix}`);
    const s = await prisma.documentScan.create({
      data: { noteId: id, sha256: createHash("sha256").update(content).digest("hex"), mimeType: "image/jpeg", sizeBytes: content.length, content, status: "READ", ocrResult: { ocr: { text: `${TAG} ${suffix}` } } },
      select: { id: true },
    });
    made.scans.push(s.id);
    check(`taslak ${suffix}`, r.status === 201 && !!id, `${r.status} ${r.code ?? ""}`);
    return { id, photo: content.toString("base64") };
  };
  const formWo = async (noteId: string, owner: string, batch: string, routeTemplateId: string) => {
    const r = await call("POST", `/api/gelen-belge/irsaliyeler/${noteId}/is-emri`, woUser, { clientToken: randomUUID(), ownerCustomerId: owner, ourBatchNo: batch, kursunMeters: "100", routeTemplateId, stepPlanning: [{ sequence: 1 }] });
    const d = r.data as { workOrderId?: string; workOrderNo?: string } | undefined;
    if (d?.workOrderId) made.workOrders.push(d.workOrderId);
    check(`belge → İE (${batch})`, r.status === 201 && !!d?.workOrderId, `${r.status} ${r.code ?? ""}`);
    return { id: d?.workOrderId ?? "", no: d?.workOrderNo ?? "" };
  };
  const lookup = (token: string, body: unknown) => call("POST", "/api/gelen-belge/istasyon-okutma", token, body);
  const ids = (r: Resp) => (r.data?.workOrders ?? []).map((w) => w.id).sort().join(",");

  // Belge A (gönderen 1) → İE1 kurşun · belge B (gönderen 2, AYNI fiş no) → İE2 tambur · belge C onaylı, İE'siz.
  const noteA = await mkNote("A", { senderCustomerId: sender1, senderDocNo: UNIQ });
  const noteB = await mkNote("B", { senderCustomerId: sender2, senderDocNo: UNIQ });
  const noteC = await mkNote("C", { senderCustomerId: sender1, senderDocNo: `${UNIQ}C`, ownerCustomerId: owner1 });
  const wo1 = await formWo(noteA.id, owner1, `${TAG}-PA`, kRoute);
  const wo2 = await formWo(noteB.id, owner2, `${TAG}-PB`, tRoute);
  const onayC = await call("POST", `/api/gelen-belge/irsaliyeler/${noteC.id}/onay`, tk, {});
  check("belge C onaylı, İE'siz", onayC.status === 200, `${onayC.status} ${onayC.code ?? ""}`);

  console.log("§1 ayar varsayılanı");
  const s1 = await call("GET", "/api/gelen-belge/ayarlar", tk);
  check("§1 stationDocLookup varsayılan false (bugünkü)", s1.data?.stationDocLookup === false, String(s1.data?.stationDocLookup));
  check("§1 anahtar dedicated (ham uç kapalı)", INCOMING_DOC_DEDICATED_SETTING_KEYS.has(SETTING_KEYS.GELEN_BELGE_STATION_DOC_LOOKUP));
  const st1 = await call("GET", "/api/gelen-belge/istasyon-okutma", kursunOp);
  check("§1 durum ucu: enabled false (istasyon izniyle okunur)", st1.status === 200 && st1.data?.enabled === false, `${st1.status} ${JSON.stringify(st1.data)}`);

  console.log("§2 izin + ayar + modül kapısı");
  const r2a = await lookup(stranger, { q: UNIQ });
  check("§2 ⭐ istasyon izni olmayan → 403", r2a.status === 403, `${r2a.status} ${r2a.code ?? ""}`);
  const r2b = await lookup(kursunOp, { q: UNIQ });
  check("§2 ⭐ ayar kapalı → 403 GELEN_BELGE_STATION_LOOKUP_DISABLED", r2b.status === 403 && r2b.code === "GELEN_BELGE_STATION_LOOKUP_DISABLED", `${r2b.status} ${r2b.code ?? ""}`);
  await setSetting(SETTING_KEYS.GELEN_BELGE_STATION_DOC_LOOKUP, true);
  const r2c = await lookup(kursunOp, { q: UNIQ });
  check("§2 ayar açık + mobile:kk2-kursun → 200", r2c.status === 200, `${r2c.status} ${r2c.code ?? ""}`);
  await setSetting(SETTING_KEYS.PRODUCTION_ENABLED, false);
  const r2d = await lookup(kursunOp, { q: UNIQ });
  const st2 = await call("GET", "/api/gelen-belge/istasyon-okutma", kursunOp);
  await setSetting(SETTING_KEYS.PRODUCTION_ENABLED, true);
  check("§2 ⭐ üretim modülü kapalı → 403 MODULE_DISABLED; durum enabled false", r2d.status === 403 && r2d.code === "MODULE_DISABLED" && st2.data?.enabled === false, `${r2d.status} ${r2d.code ?? ""} ${String(st2.data?.enabled)}`);
  await setSetting(SETTING_KEYS.GELEN_BELGE_ENABLED, false);
  const r2e = await lookup(kursunOp, { q: UNIQ });
  await setSetting(SETTING_KEYS.GELEN_BELGE_ENABLED, true);
  check("§2 ⭐ gelen belge modülü kapalı → 403 MODULE_DISABLED", r2e.status === 403 && r2e.code === "MODULE_DISABLED", `${r2e.status} ${r2e.code ?? ""}`);
  const r2f = await lookup(kursunOp, { q: "x" });
  check("§2 kısa arama 400", r2f.status === 400, `${r2f.status}`);

  const counts = async () => [
    await prisma.documentScan.count(), await prisma.customerDeliveryNote.count(), await prisma.customerDeliveryNoteLine.count(),
    await prisma.senderTemplate.count(), await prisma.workOrder.count(), await prisma.roll.count(),
  ].join(",");
  const before = await counts();
  setReaderUrlForTests(sidecar.url);

  console.log("§4 aynı fotoğraf");
  const r4 = await lookup(kursunOp, { contentBase64: noteA.photo });
  check("§4 ⭐ aynı fotoğraf → SAME_PHOTO, SINGLE, İE1, okuma servisi çağrılmadı", r4.status === 200 && r4.data?.source === "SAME_PHOTO" && r4.data?.outcome === "SINGLE" && ids(r4) === wo1.id && sidecar.hits() === 0, `${r4.status} ${r4.code ?? ""} ${r4.data?.source} ${r4.data?.outcome} hits=${sidecar.hits()}`);
  const w4 = r4.data?.workOrders?.[0];
  check("§4 yanıt: kart kodu, parti no, belge no", !!w4?.cardBarcode && (w4?.batchNumbers ?? []).includes(`${TAG}-PA`) && (w4?.documents ?? []).some((d) => d.senderDocNo === UNIQ), JSON.stringify(w4));

  console.log("§5 yeni fotoğraf → okuma → belge no");
  const r5 = await lookup(kursunOp, { contentBase64: jpeg(`YENI DOC:${UNIQ}`).toString("base64") });
  check("§5 ⭐ okunan fiş no = belge no; iki belge → iki İE (MULTIPLE)", r5.status === 200 && r5.data?.source === "OCR" && r5.data?.read?.senderDocNo === UNIQ && r5.data?.outcome === "MULTIPLE" && ids(r5) === [wo1.id, wo2.id].sort().join(","), `${r5.status} ${r5.code ?? ""} ${r5.data?.outcome} ${r5.data?.read?.senderDocNo} ${ids(r5)}`);
  const ownerRead = r5.data?.read?.ownerText ?? null;
  if (ownerRead) {
    await prisma.customerDeliveryNote.update({ where: { id: noteB.id }, data: { ownerText: ownerRead } });
    const r5b = await lookup(kursunOp, { contentBase64: jpeg(`IKINCI DOC:${UNIQ}`).toString("base64") });
    check("§5 ⭐ okunan sahip metni tek belgeye daraltır → SINGLE İE2", r5b.data?.outcome === "SINGLE" && ids(r5b) === wo2.id, `${r5b.data?.outcome} ${ids(r5b)}`);
    await prisma.customerDeliveryNote.update({ where: { id: noteB.id }, data: { ownerText: null } });
  } else check("§5 fikstür sahip metni okundu", false, "ownerText boş");
  const r5c = await lookup(kursunOp, { contentBase64: jpeg("BULANIK").toString("base64") });
  check("§5 okunamayan fotoğraf → UNREADABLE", r5c.status === 200 && r5c.data?.outcome === "UNREADABLE", `${r5c.status} ${r5c.data?.outcome}`);
  const r5d = await lookup(kursunOp, { contentBase64: Buffer.from(`%PDF-1.4\n${TAG}`).toString("base64") });
  check("§5 PDF → 400", r5d.status === 400, `${r5d.status} ${r5d.code ?? ""}`);

  console.log("§7 belge yok / İE yok / okuyucu yok");
  const r7a = await lookup(kursunOp, { contentBase64: jpeg(`YOK DOC:${UNIQ_NONE}`).toString("base64") });
  check("§7 ⭐ bilinmeyen fiş no → NO_DOCUMENT", r7a.data?.outcome === "NO_DOCUMENT" && (r7a.data?.workOrders ?? []).length === 0, `${r7a.data?.outcome}`);
  const r7b = await lookup(kursunOp, { contentBase64: noteC.photo });
  const r7c = await lookup(kursunOp, { q: `${UNIQ}C` });
  check("§7 ⭐ İE'siz onaylı belge → NO_WORK_ORDER (fotoğraf + elle arama)", r7b.data?.outcome === "NO_WORK_ORDER" && !!r7b.data?.message?.startsWith("Bu belgeye ait ") && r7c.data?.outcome === "NO_WORK_ORDER", `${r7b.data?.outcome} ${r7b.data?.message} ${r7c.data?.outcome}`);
  setReaderUrlForTests(null);
  const r7d = await lookup(kursunOp, { contentBase64: jpeg(`SERVISSIZ DOC:${UNIQ}`).toString("base64") });
  const r7e = await lookup(kursunOp, { contentBase64: noteA.photo });
  check("§7 okuyucu yok → yeni fotoğraf 503 OCR_SERVICE_UNAVAILABLE; aynı fotoğraf yine bulunur", r7d.status === 503 && r7d.code === "OCR_SERVICE_UNAVAILABLE" && r7e.data?.outcome === "SINGLE", `${r7d.status} ${r7d.code ?? ""} ${r7e.data?.outcome}`);
  const after = await counts();
  check("§3 ⭐ eşleme okuması satır doğurmaz (tarama/belge/satır/şablon/İE/top sabit)", before === after, `${before} → ${after}`);

  console.log("§6 bir belgeden iki iş emri");
  // Belge A'nın topu İE2'nin partisine de bağlanır (S1a: tek belge, çok İE — bağ topun partisinden).
  const rollA = (await prisma.customerDeliveryNoteLine.findFirst({ where: { noteId: noteA.id, rollId: { not: null } }, select: { rollId: true } }))?.rollId ?? "";
  const rollA2 = await prisma.roll.findUnique({ where: { id: rollA }, select: { batchId: true } });
  const batch2 = await prisma.batch.findFirst({ where: { workOrderId: wo2.id }, select: { id: true } });
  await prisma.roll.update({ where: { id: rollA }, data: { batchId: batch2?.id ?? null } });
  const r6 = await lookup(kursunOp, { contentBase64: noteA.photo });
  await prisma.roll.update({ where: { id: rollA }, data: { batchId: rollA2?.batchId ?? null } });
  check("§6 ⭐ bir belgeden iki İE → MULTIPLE, ikisi de belge A'yı gösterir", r6.data?.outcome === "MULTIPLE" && ids(r6) === [wo1.id, wo2.id].sort().join(",") && (r6.data?.workOrders ?? []).every((w) => w.documents.some((d) => d.senderDocNo === UNIQ)), `${r6.data?.outcome} ${ids(r6)}`);

  console.log("§8 liste araması");
  type Card = { workOrderId: string };
  const kursunCards = async (q: string) => (((await call("GET", `/api/kursun-qc/open-cards?q=${encodeURIComponent(q)}`, kursunOp)).data as unknown as Card[] | undefined) ?? []).map((c) => c.workOrderId);
  const tamburCards = async (q: string) => (((await call("GET", `/api/tambur/open-cards?q=${encodeURIComponent(q)}`, tk)).data as unknown as Card[] | undefined) ?? []).map((c) => c.workOrderId);
  const panel = async (q: string) => (((await call("GET", `/api/work-orders?pageSize=50&search=${encodeURIComponent(q)}`, tk)).data as unknown as Array<{ id: string }> | undefined) ?? []).map((w) => w.id);
  const noteNoA = (await prisma.customerDeliveryNote.findUnique({ where: { id: noteA.id }, select: { noteNo: true } }))?.noteNo ?? "";
  const kAll = (((await call("GET", "/api/kursun-qc/open-cards", kursunOp)).data as unknown as Card[] | undefined) ?? []).map((c) => c.workOrderId);
  check("§8 aramasız kurşun listesi İE1'i içerir (bugünkü liste)", kAll.includes(wo1.id), `${kAll.length}`);
  const k8 = await kursunCards(UNIQ);
  check("§8 ⭐ kurşun açık kart: fiş no → İE1 (İE2 tambur listesinde)", k8.includes(wo1.id) && !k8.includes(wo2.id), JSON.stringify(k8));
  check("§8 ⭐ kurşun açık kart: GB no + parti no + İE no", (await kursunCards(noteNoA)).includes(wo1.id) && (await kursunCards(`${TAG}-PA`)).includes(wo1.id) && (await kursunCards(wo1.no)).includes(wo1.id));
  const k8none = await kursunCards(UNIQ_NONE);
  check("§8 uymayan arama boş", !k8none.includes(wo1.id), JSON.stringify(k8none));
  const t8 = await tamburCards(UNIQ);
  check("§8 ⭐ tambur açık kart: fiş no → İE2", t8.includes(wo2.id) && !t8.includes(wo1.id), JSON.stringify(t8));
  const p8 = await panel(UNIQ);
  check("§8 ⭐ panel İE listesi: fiş no → İE1 + İE2", p8.includes(wo1.id) && p8.includes(wo2.id), JSON.stringify(p8));
  await prisma.customerDeliveryNote.update({ where: { id: noteB.id }, data: { status: "CANCELLED" } });
  const p8c = await panel(UNIQ);
  const l8c = await lookup(kursunOp, { q: UNIQ });
  await prisma.customerDeliveryNote.update({ where: { id: noteB.id }, data: { status: "APPROVED" } });
  check("§8 ⭐ iptal belge eşleşmez (panel + elle arama)", p8c.includes(wo1.id) && !p8c.includes(wo2.id) && l8c.data?.outcome === "SINGLE" && ids(l8c) === wo1.id, `${JSON.stringify(p8c)} ${l8c.data?.outcome}`);
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
  console.log("=== Gelen belge istasyonda belgeden iş emri (K17) bekçisi ===\n");
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
