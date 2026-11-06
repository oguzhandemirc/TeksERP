// =============================================================================
// İSTASYONDA BELGE OKUT — DOĞRULAMA PUANI (Gülkesim, kullanıcı onayı 2026-11-06)
// =============================================================================
// Anahtar (fiş / parti no) aday İE'yi bulur; aynı fotoğrafın öteki alanları adayın kayıtlarıyla puanlanır; eşik altı
// KENDİLİĞİNDEN AÇILMAZ. Puan saf `helpers/station-scan-score.helper.ts`, uygulama `helpers/station-scan-verify.helper.ts`.
// Sınanan:
//   §1 ⭐ (saf) doğru belge yüksek puan → geçer · yanlış numara + farklı bileşenler düşük → geçmez · kanıtsız alan payda
//      dışı · top listesi yoksa puan 100 bile geçemez · anahtar alan kendini doğrulamaz · eşik değişince karar değişir · 0 = kapalı
//   §2 ⭐ (DB) gerçek İE + belge satırları: doğru okuma VERIFIED, yanlış okuma `unverifiedWorkOrders`a taşınır (workOrders
//      boş → eski tablet açamaz), eşik 50'ye inince aynı okuma geçer; okutma izi (TELEMETRİ) karar + puanla yazılır
//   §3 ⭐ (HTTP) top listesiz fotoğraf (parti no ile bulunan) → UNVERIFIED + "doğrulanamadı", workOrders boş; eşik 0 → SINGLE
//   §4 ⭐ açılan İE bildirimi tek sefer (CONFIRMED → 200, ikinci 409); "son okutmalar" listesi puan + onayı gösterir
//   §5 ⭐ ayar: varsayılan 80 · PUT 70 yazılır · 150 → 400 · null → varsayılan; ham ayar ucuna kapalı
// Negatif sonda (2026-11-06 ölçüldü): `isScanVerified` her zaman true → 10 kırmızı (§1 ×4, §2 ×2, §3 ×2, §4 ×2);
// `strongEvidence` şartı kaldırılınca §1 "top listesi okunamadı" kırmızı (§3'te anahtar hariç tutulunca puan zaten yok).
// =============================================================================
import { randomUUID, createHash } from "crypto";
import type { AddressInfo } from "net";
import http, { type Server } from "node:http";
import * as bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { INCOMING_DOC_DEDICATED_SETTING_KEYS } from "../src/services/gelen-belge-ayar-anahtarlari";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { setReaderUrlForTests } from "../src/lib/gelen-belge/url";
import { isScanVerified, scoreScan, type ScanEvidence, type TargetRecord } from "../src/services/helpers/station-scan-score.helper";
import { verifyScanCandidates } from "../src/services/helpers/station-scan-verify.helper";
import { loadWorkOrders } from "../src/services/helpers/station-lookup-rows.helper";
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

const TAG = `TEST-IOD${Date.now().toString(36).toUpperCase()}`;
const D = String(Date.now()).slice(-6);
const P1 = `P7${D}`;
const KEYWORD = `${TAG} IS TAKIP FORMU`;

// ── §1 saf puan ──────────────────────────────────────────────────────────────
const target: TargetRecord = {
  rollNos: ["1", "2", "3", "4"], meters: [101.5, 98, 120, 87.5], batchNos: ["PX-100"], orderNos: ["MS-77"],
  ownerNames: ["Akdeniz Perdecilik"], senderNames: ["Marmara Boyahane"], docDays: ["2026-11-05"],
};
const ev = (o: Partial<ScanEvidence> = {}): ScanEvidence => ({
  rollNos: ["1", "2", "3", "4"], meters: [101.5, 98, 120, 87.5], rollCount: 4, batchNos: ["PX-100"], orderNo: "MS-77",
  ownerText: "AKDENİZ PERDECİLİK", senderText: "Marmara Boyahane", docDay: "2026-11-05", ...o,
});

function pureChecks(): void {
  console.log("§1 saf puan");
  const good = scoreScan(ev(), target);
  check("§1 ⭐ doğru belge → %100, top listesi kanıtı var, %80'i geçer", good.score === 100 && good.strongEvidence && isScanVerified(good, 80), JSON.stringify(good.score));
  const ocrish = scoreScan(ev({ rollNos: ["01", "2", "3", "4"], meters: [101.6, 98, 120, 87.5], orderNo: "M5-77" }), target);
  check("§1 OCR gürültüsü (baştaki sıfır, 0,1 m, S↔5) hâlâ geçer", isScanVerified(ocrish, 80), `${ocrish.score}`);
  const wrong = scoreScan(ev({ rollNos: ["11", "12", "13"], meters: [55, 60, 70], rollCount: 3, orderNo: "MS-90", docDay: "2026-10-01" }), target);
  check("§1 ⭐ yanlış belge (farklı top/metre/sipariş/tarih) → düşük puan, geçmez", (wrong.score ?? 100) < 40 && !isScanVerified(wrong, 80), `${wrong.score}`);
  const sparse = scoreScan(ev({ batchNos: [], orderNo: null, ownerText: null, senderText: null, docDay: null, rollCount: null }), target);
  check("§1 ⭐ kanıtı olmayan alan paydaya girmez (yalnız top no + metre → %100)", sparse.score === 100 && sparse.components.length === 2, JSON.stringify(sparse.components.map((c) => c.key)));
  const noRolls = scoreScan(ev({ rollNos: [], meters: [], rollCount: null }), target);
  check("§1 ⭐ top listesi okunamadı → başlık %100 tutsa bile eşik GEÇİLEMEZ", noRolls.score === 100 && !noRolls.strongEvidence && !isScanVerified(noRolls, 80), `${noRolls.score} strong=${noRolls.strongEvidence}`);
  const keyOnly = scoreScan(ev({ rollNos: [], meters: [], rollCount: null, orderNo: null, ownerText: null, senderText: null, docDay: null }), target, ["BATCH_NO"]);
  check("§1 anahtar alan (parti no ile bulundu) kendini doğrulamaz → puan yok", keyOnly.score === null && !isScanVerified(keyOnly, 80));
  const half = scoreScan(ev({ rollNos: ["1", "2", "9", "8"], meters: [101.5, 98, 50, 51] }), target);
  check("§1 ⭐ eşik değişince karar değişir (yarı tutan okuma: %80 geçmez, %50 geçer)", !isScanVerified(half, 80) && isScanVerified(half, 50), `${half.score}`);
  check("§1 eşik 0 = doğrulama kapalı (bugünkü davranış) → her aday geçer", isScanVerified(wrong, 0) && isScanVerified(noRolls, 0));
  const detail = half.components.find((c) => c.key === "ROLL_NOS");
  check("§1 bileşen ayrıntısı görevliye 'top no 2/4' der", detail?.detail === "2/4" && detail.matched === false, JSON.stringify(detail));
}

// ── fikstür ──────────────────────────────────────────────────────────────────
type Resp = { status: number; code?: string; data?: Record<string, unknown> & { workOrders?: Array<{ id: string; workOrderNumber: string }>; unverifiedWorkOrders?: Array<{ id: string }>; outcome?: string; message?: string; checkId?: string | null } };
const SETTINGS = [
  SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID,
  SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT,
  SETTING_KEYS.GELEN_BELGE_STATION_DOC_LOOKUP, SETTING_KEYS.GELEN_BELGE_STATION_VERIFY_THRESHOLD,
];
const made = { customers: [] as string[], users: [] as string[], notes: [] as string[], items: [] as string[], stations: [] as string[], routes: [] as string[], scans: [] as string[], workOrders: [] as string[], templates: [] as string[], checks: [] as string[] };

async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

/** Sahte okuma servisinin çizdiği BAŞLIK-ONLY form (top listesi yok): parti no ile bulunur. */
function ocrOf(parti: string): unknown {
  const rows: Array<[string, string | undefined]> = [[KEYWORD, undefined], ["PARTI NO", parti], ["HEDEF METRAJ", "300"]];
  const el = (text: string, x: number, y: number) => ({ text, rect: { x, y, width: text.length * 18, height: 30 }, confidence: 0.95 });
  const blocks = rows.map(([label, value], i) => {
    const y = 50 + i * 80;
    const lines = [{ text: label, rect: { x: 40, y, width: label.length * 18, height: 30 }, confidence: 0.95, angle: 0, elements: label.split(" ").map((t, j) => el(t, 40 + j * 120, y)) }];
    if (value) lines.push({ text: value, rect: { x: 300, y, width: value.length * 18, height: 30 }, confidence: 0.95, angle: 0, elements: [el(value, 300, y)] });
    return { text: lines.map((l) => l.text).join("\n"), rect: { x: 40, y, width: 800, height: 30 }, lines };
  });
  return { text: blocks.map((b) => b.text).join("\n"), blocks, imageWidth: 1000, imageHeight: 1400 };
}
const USER_TEMPLATE = {
  identifiers: { keywords: [KEYWORD, "PARTI NO", "HEDEF METRAJ"], minScore: 0.6 },
  fields: [{ key: "partiNo", label: "Parti no", type: "text", strategies: [{ kind: "anchor", labels: ["PARTI NO"], direction: "right" }] }],
};
const photo = (parti: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${TAG} ${randomUUID()} SPEC:${Buffer.from(parti).toString("base64url")}:END`)]).toString("base64");

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
      res.end(JSON.stringify(ocrOf(Buffer.from(m[1]!, "base64url").toString("utf8"))));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

type Ctx = { call: (m: string, p: string, t: string, b?: unknown) => Promise<Resp>; tk: string; op: string; woId: string; noteId: string };

async function login(url: string, username: string, password: string, clientType?: "electron"): Promise<string> {
  const r = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, ...(clientType ? { clientType } : {}) }) });
  return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
}

async function mkUser(url: string, adminId: string, suffix: string, perms: string[]): Promise<string> {
  const parola = kosumaOzguParola();
  const ps = await prisma.permission.findMany({ where: { code: { in: perms } }, select: { id: true } });
  const u = await prisma.user.create({
    data: { username: `${TAG}-${suffix}`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} ${suffix}`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: adminId })) } },
    select: { id: true, username: true },
  });
  made.users.push(u.id);
  return login(url, u.username, parola);
}

/** Dört toplu belge (top no 1–4, metreler, sipariş no, tarih) → kurşun rotalı İE (parti P1). */
async function setup(url: string): Promise<Ctx> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_STATION_DOC_LOOKUP]) await setSetting(k, true);
  for (const k of [SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_STATION_VERIFY_THRESHOLD]) await setSetting(k, null);
  await setSetting(SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, "WITH_WORK_ORDER");
  await setSetting(SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, "DOCUMENT");
  const call = async (method: string, path: string, token: string, body?: unknown): Promise<Resp> => {
    const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; details?: { code?: string } };
    return { status: r.status, code: j.details?.code, data: j.data };
  };
  const tk = await login(url, admin.username, admin.password, "electron");
  const op = await mkUser(url, admin.id, "K", ["mobile:kk2-kursun"]);
  const woUser = await mkUser(url, admin.id, "W", ["gelen-belge:read", "gelen-belge:write", "mobile:hizli-is-emri"]);
  const owner = (await prisma.customer.create({ data: { code: `${TAG}-O`, name: `${TAG} Akdeniz Perde` }, select: { id: true } })).id;
  made.customers.push(owner);
  const fabric = (await prisma.item.create({ data: { code: `${TAG}-MM`, name: `${TAG} müşteri malı`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  made.items.push(fabric);
  await setSetting(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, fabric);
  const station = (await prisma.station.create({ data: { code: `${TAG}-KRS`.slice(0, 32), name: `${TAG} KRS`, type: "INTERNAL", kind: "PROCESS_QC", appliesQuality: true }, select: { id: true } })).id;
  made.stations.push(station);
  const route = (await prisma.route.create({ data: { name: `${TAG} kurşun`, steps: { create: [{ stationId: station, sequence: 1 }] } }, select: { id: true } })).id;
  made.routes.push(route);
  const lines = [["1", 101.5], ["2", 98], ["3", 120], ["4", 87.5]].map(([n, m]) => ({ senderRollNo: String(n), meters: m, itemText: "Kumaş" }));
  const r = await call("POST", "/api/gelen-belge/irsaliyeler", tk, { sourceKind: "MANUAL", senderDocNo: `9${D}`, customerOrderNo: `MS-${D}`, senderDocDate: "2026-11-05", lines });
  const noteId = (r.data as { id?: string } | undefined)?.id ?? "";
  made.notes.push(noteId);
  const content = Buffer.from(`${TAG} FOTO`);
  made.scans.push((await prisma.documentScan.create({
    data: { noteId, sha256: createHash("sha256").update(content).digest("hex"), mimeType: "image/jpeg", sizeBytes: content.length, content, status: "READ", ocrResult: { ocr: { text: TAG } } }, select: { id: true },
  })).id);
  const w = await call("POST", `/api/gelen-belge/irsaliyeler/${noteId}/is-emri`, woUser, { clientToken: randomUUID(), ownerCustomerId: owner, ourBatchNo: P1, kursunMeters: "407", routeTemplateId: route, stepPlanning: [{ sequence: 1 }] });
  const woId = (w.data as { workOrderId?: string } | undefined)?.workOrderId ?? "";
  if (woId) made.workOrders.push(woId);
  check("fikstür: 4 toplu belge → İE", r.status === 201 && w.status === 201 && !!woId, `${r.status} ${w.status} ${w.code ?? ""}`);
  const tpl = await call("POST", "/api/gelen-belge/sablonlar/ozel", tk, { name: `${TAG} iş takip formu`, template: USER_TEMPLATE, clientToken: randomUUID() });
  const tplRow = await prisma.senderTemplate.findUnique({ where: { code: (tpl.data as { code?: string } | undefined)?.code ?? "" }, select: { id: true } });
  if (tplRow) made.templates.push(tplRow.id);
  check("fikstür: başlık-only kullanıcı şablonu", tpl.status === 201 && !!tplRow, `${tpl.status} ${tpl.code ?? ""}`);
  return { call, tk, op, woId, noteId };
}

// ── §2 DB: gerçek kayıtla puan + bölme + iz ───────────────────────────────────
async function dbChecks(c: Ctx): Promise<void> {
  console.log("§2 gerçek İE + belge satırları");
  const { workOrders } = await loadWorkOrders({ id: c.woId }, null);
  const base = { workOrders, noteIds: [c.noteId], source: "OCR", screen: "KURSUN_QC" };
  const right: ScanEvidence = { ...ev(), batchNos: [P1], orderNo: `MS-${D}`, ownerText: null, senderText: null };
  const okV = await verifyScanCandidates(base, { evidence: right, key: "DOC_NO", readDocNo: `9${D}` });
  if (okV.checkId) made.checks.push(okV.checkId);
  check("§2 ⭐ doğru okuma → workOrders'ta, puan ≥ 80", okV.workOrders.length === 1 && okV.unverifiedWorkOrders.length === 0 && (okV.verification.bestScore ?? 0) >= 80, `${okV.verification.bestScore}`);
  const wrongEv: ScanEvidence = { ...ev({ rollNos: ["21", "22", "3"], meters: [50, 60, 120], rollCount: 3, docDay: "2026-09-01" }), batchNos: [], orderNo: "MS-000", ownerText: null, senderText: null };
  const badV = await verifyScanCandidates(base, { evidence: wrongEv, key: "DOC_NO", readDocNo: `9${D}` });
  if (badV.checkId) made.checks.push(badV.checkId);
  check("§2 ⭐ yanlış belge numarası + farklı bileşenler → workOrders BOŞ (eski tablet açamaz), aday unverified'da", badV.workOrders.length === 0 && badV.unverifiedWorkOrders.length === 1 && (badV.verification.bestScore ?? 100) < 50, `${badV.verification.bestScore}`);
  const row = badV.checkId ? await prisma.stationScanCheck.findUnique({ where: { id: badV.checkId } }) : null;
  check("§2 okutma izi: UNSURE + puan + eşik 80 + bileşenler", row?.decision === "UNSURE" && row.bestScore === badV.verification.bestScore && row.threshold === 80 && Array.isArray(row.components), JSON.stringify({ d: row?.decision, s: row?.bestScore, t: row?.threshold }));
  await setSetting(SETTING_KEYS.GELEN_BELGE_STATION_VERIFY_THRESHOLD, 15);
  const lowV = await verifyScanCandidates(base, { evidence: wrongEv, key: "DOC_NO", readDocNo: `9${D}` });
  if (lowV.checkId) made.checks.push(lowV.checkId);
  check("§2 ⭐ eşik 15'e inince AYNI okuma (%18) geçer (karar eşikten)", lowV.workOrders.length === 1 && lowV.verification.threshold === 15, `${lowV.verification.bestScore}`);
  await setSetting(SETTING_KEYS.GELEN_BELGE_STATION_VERIFY_THRESHOLD, null);
}

// ── §3–§5 HTTP ───────────────────────────────────────────────────────────────
async function httpChecks(c: Ctx, sidecarUrl: string): Promise<void> {
  console.log("§3 top listesiz fotoğraf");
  setReaderUrlForTests(sidecarUrl);
  const r = await c.call("POST", "/api/gelen-belge/istasyon-okutma?screen=KURSUN_QC", c.op, { contentBase64: photo(P1) });
  if (r.data?.checkId) made.checks.push(r.data.checkId);
  check("§3 ⭐ parti no ile bulundu ama top listesi yok → UNVERIFIED, workOrders boş, aday unverified'da",
    r.status === 200 && r.data?.outcome === "UNVERIFIED" && (r.data?.workOrders ?? []).length === 0 && (r.data?.unverifiedWorkOrders ?? []).some((w) => w.id === c.woId), `${r.status} ${r.code ?? ""} ${r.data?.outcome} ${r.data?.message}`);
  check("§3 sade Türkçe cümle: doğrulanamadı + listeden seçin", (r.data?.message ?? "").startsWith("Belge doğrulanamadı") && (r.data?.message ?? "").includes("listeden seçin"), r.data?.message);
  await setSetting(SETTING_KEYS.GELEN_BELGE_STATION_VERIFY_THRESHOLD, 0);
  const off = await c.call("POST", "/api/gelen-belge/istasyon-okutma", c.op, { contentBase64: photo(P1) });
  if (off.data?.checkId) made.checks.push(off.data.checkId);
  check("§3 ⭐ eşik 0 (kapalı) → bugünkü davranış: SINGLE", off.data?.outcome === "SINGLE" && (off.data?.workOrders ?? [])[0]?.id === c.woId, `${off.data?.outcome}`);
  await setSetting(SETTING_KEYS.GELEN_BELGE_STATION_VERIFY_THRESHOLD, null);

  console.log("§4 açılan İE bildirimi + son okutmalar");
  const id = r.data?.checkId ?? "";
  const no = (r.data?.unverifiedWorkOrders as Array<{ workOrderNumber: string }> | undefined)?.[0]?.workOrderNumber ?? "";
  const a1 = await c.call("POST", `/api/gelen-belge/istasyon-okutma/${id}/acilan`, c.op, { workOrderNumber: no, how: "CONFIRMED" });
  const a2 = await c.call("POST", `/api/gelen-belge/istasyon-okutma/${id}/acilan`, c.op, { workOrderNumber: no, how: "AUTO" });
  check("§4 ⭐ bildirim tek sefer: 200 sonra 409 STATION_SCAN_CHECK_CLOSED", !!id && a1.status === 200 && a2.status === 409 && a2.code === "STATION_SCAN_CHECK_CLOSED", `${a1.status} ${a2.status} ${a2.code ?? ""}`);
  const list = await c.call("GET", "/api/gelen-belge/istasyon-okutma/son?take=200", c.tk);
  const mine = (list.data as unknown as Array<{ id: string; decision: string; openedHow: string | null; openedWorkOrderNumber: string | null }> | undefined)?.find((x) => x.id === id);
  check("§4 ⭐ son okutmalar: karar UNSURE + görevli onayladı + açılan İE", list.status === 200 && mine?.decision === "UNSURE" && mine.openedHow === "CONFIRMED" && mine.openedWorkOrderNumber === no, JSON.stringify(mine));
  const denied = await c.call("GET", "/api/gelen-belge/istasyon-okutma/son", c.op);
  check("§4 son okutmalar istasyon kullanıcısına kapalı (gelen-belge:read)", denied.status === 403, `${denied.status}`);
}

async function settingChecks(c: Ctx): Promise<void> {
  console.log("§5 ayar");
  const g = await c.call("GET", "/api/gelen-belge/ayarlar", c.tk);
  check("§5 ⭐ varsayılan 80 (kayıt yok)", g.data?.stationVerifyThreshold === 80 && g.data?.defaultStationVerifyThreshold === 80, JSON.stringify([g.data?.stationVerifyThreshold, g.data?.defaultStationVerifyThreshold]));
  const p1 = await c.call("PUT", "/api/gelen-belge/ayarlar", c.tk, { stationVerifyThreshold: 70 });
  check("§5 PUT 70 yazılır", p1.status === 200 && p1.data?.stationVerifyThreshold === 70, `${p1.status} ${p1.code ?? ""}`);
  const p2 = await c.call("PUT", "/api/gelen-belge/ayarlar", c.tk, { stationVerifyThreshold: 150 });
  const p3 = await c.call("PUT", "/api/gelen-belge/ayarlar", c.tk, { stationVerifyThreshold: 75.5 });
  check("§5 aralık dışı / kesirli → 400", p2.status === 400 && p3.status === 400, `${p2.status} ${p3.status}`);
  const p4 = await c.call("PUT", "/api/gelen-belge/ayarlar", c.tk, { stationVerifyThreshold: null });
  check("§5 null → varsayılana döner", p4.status === 200 && p4.data?.stationVerifyThreshold === 80, `${p4.status} ${p4.data?.stationVerifyThreshold}`);
  check("§5 anahtar ham ayar ucuna kapalı (dedicated)", INCOMING_DOC_DEDICATED_SETTING_KEYS.has(SETTING_KEYS.GELEN_BELGE_STATION_VERIFY_THRESHOLD));
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  await prisma.stationScanCheck.deleteMany({ where: { id: { in: made.checks } } }).catch(swallow);
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  await prisma.documentScan.deleteMany({ where: { id: { in: made.scans } } }).catch(swallow);
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } });
  for (const t of ["rollProperty", "rollOperation", "rollMovement", "rollVariance", "warehouseMovement"] as const) {
    await (prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { rollId: { in: rollIds } } }).catch(swallow);
  }
  await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { currentStepId: null, batchId: null } }).catch(swallow);
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(swallow);
  for (const id of made.workOrders) {
    for (const t of ["workOrderTargetValue", "workOrderTargetProperty", "workOrderEvent", "travelerCard", "batch", "workOrderStep"] as const) {
      if (t === "travelerCard") await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: id } } }).catch(swallow);
      await (prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { workOrderId: id } }).catch(swallow);
    }
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
  console.log("=== İstasyonda belge okut: doğrulama puanı bekçisi ===\n");
  pureChecks();
  if (engel) return;
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: SETTINGS } }, select: { key: true, value: true } });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const sidecar = await startFakeSidecar();
  try {
    const ctx = await setup(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    await dbChecks(ctx);
    await httpChecks(ctx, sidecar.url);
    await settingChecks(ctx);
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

void main();
