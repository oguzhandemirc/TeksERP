// =============================================================================
// BEKÇİ — GELEN BELGE "BİLGİSAYARDA İKİNCİ OKUMA" (`gelenBelge.serverOcrEnabled`): kapalıyken okuma servisine OCR/dönüştürme
// isteği GİTMEZ; cihazın okuyamadığı sayfa PENDING'de takılmaz (READ_FAILED); açıkken bugünkü davranış aynı.
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts gelen_belge_sunucu_okuma_ayari   (gerçek DB; sahte loopback okuma servisi,
//   isabet sayacıyla; app.listen(0)). Fikstür SENTETİK (uydurma şablon + uydurma OCR).
//   §0 TEK BOĞAZ (statik): `getReaderUrl` yalnız `lib/gelen-belge/url.ts` + `gelen-belge-sunucu-okuyucu.service.ts`te;
//      `GELEN_BELGE_OKUMA_URL` yalnız url.ts'te; `setReaderUrlForTests` src'de çağrılmaz
//   §1 ayar: kayıt yokken true (+ default true) · PUT false yazılır, audit ayak izi · ham ayar ucuna kapalı · bozuk Zod 400
//   §2 ⭐ KAPALI: okuma işi AYAR_KAPALI, isabet 0, bekleyen PENDING'e dokunulmaz · durum ucu serverOcrEnabled=false + bekleyen sayısı
//      · özet NO_SERVICE · yeniden okut 409 SERVER_OCR_DISABLED · cihaz okumasız yükleme READ_FAILED/0 · cihaz okuması düşerse
//      READ_FAILED (deviceOcr FAILED) · özet FAILED "yeniden çekin" · boş başlık alanı sunucuya okutulmaz (failed künyesi)
//      · HEIC 503 (reason SERVER_OCR_DISABLED) · istasyon okutma 409 + readerConfigured=false — hepsinde isabet 0
//   §3 AÇIK (bugünkü): bekleyen sayfa okunur · cihaz düşerse PENDING (FALLBACK) · okumasız yükleme PENDING · boş alan
//      sunucuya bir kez okutulur · yeniden okut 202
// ⭐ NEGATİF SONDA (2026-11-09, betikle koşuldu, her biri yedekten geri yüklendi): rapor/arşiv notunda sayılarıyla.
// =============================================================================
import type { AddressInfo } from "net";
import http, { type Server } from "node:http";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { INCOMING_DOC_DEDICATED_SETTING_KEYS } from "../src/services/gelen-belge-ayar.service";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { setReaderUrlForTests } from "../src/lib/gelen-belge/url";
import { __resetDocumentReaderForTests, runReaderOnce } from "../src/jobs/gelen-belge-okuma.job";
import { uploadScanWithDeviceRead } from "../src/services/gelen-belge-istemci-okuma.service";
import { processClaimedScan } from "../src/services/gelen-belge-okuma.service";
import { stationDocLookup, stationLookupStatus } from "../src/services/gelen-belge-istasyon-okutma.service";
import type { DocumentTemplate, OcrBlock, OcrResult } from "../src/lib/gelen-belge/motor";
import type { ClientOcr } from "../src/lib/gelen-belge/istemci-ocr";
import { AppError } from "../src/utils/app-error";

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

const TAG = `GBO${Date.now().toString(36).toUpperCase()}`;
const CODE = `u-test-okuma-ayar-${TAG.toLowerCase()}`;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const jpeg = (salt: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${TAG} ${salt}`)]);
const heic = (salt: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.from(`${TAG} ${salt}`)]);

const TEMPLATE: DocumentTemplate = {
  id: CODE, name: "Okuma ayarı deneme formu", version: 1,
  identifiers: { keywords: [`OKAYFORM ${TAG}`, "OKUMA AYARI DENEMESI"], minScore: 0.6 },
  fields: [
    { key: "musteri", label: "Müşteri", type: "text", strategies: [{ kind: "anchor", labels: ["Müşteri"], direction: "right" }], maxLength: 80, postProcess: ["collapseSpaces", "trimPunct"] },
    { key: "partiNo", label: "Parti No", type: "alnum", strategies: [{ kind: "anchor", labels: ["Parti No"], direction: "right" }], postProcess: ["upper", "stripSpaces"] },
  ],
};

function ocrOf(rows: Array<[text: string, x: number, y: number]>): OcrResult {
  const blocks: OcrBlock[] = rows.map(([text, x, y]) => {
    let cx = x;
    const elements = text.split(" ").map((t) => {
      const e = { text: t, rect: { x: cx, y, width: t.length * 20, height: 40 }, confidence: 0.95 };
      cx += t.length * 20 + 15;
      return e;
    });
    const rect = { x, y, width: cx - 15 - x, height: 40 };
    return { text, rect, lines: [{ text, rect, confidence: 0.95, angle: 0, elements }] };
  });
  return { text: rows.map((r) => r[0]).join("\n"), blocks, imageWidth: 2000, imageHeight: 1500, engine: "test", rotation: 0 };
}
const page = (o: { musteri?: string; parti?: string }) => ocrOf([
  [`OKAYFORM ${TAG}`, 100, 50], ["OKUMA AYARI DENEMESI", 100, 110],
  ["Müşteri:", 100, 300], ...(o.musteri ? [[o.musteri, 400, 300] as [string, number, number]] : []),
  ["Parti No:", 100, 400], ...(o.parti ? [[o.parti, 400, 400] as [string, number, number]] : []),
]);
function asClient(r: OcrResult): ClientOcr {
  const lines = r.blocks.flatMap((b) => b.lines);
  const q = (x: { x: number; y: number; width: number; height: number }): [number, number][] => [[x.x, x.y], [x.x + x.width, x.y], [x.x + x.width, x.y + x.height], [x.x, x.y + x.height]];
  return { engine: "mlkit", width: r.imageWidth, height: r.imageHeight, rotation: 0, ms: 50, words: lines.flatMap((l, i) => l.elements.map((e) => ({ t: e.text, c: q(e.rect), l: i, p: 0.95 }))), lines: lines.map((l) => ({ c: q(l.rect), p: 0.95 })) };
}

/** Sahte okuma servisi: OCR + dönüştürme isabetleri sayılır (sağlık yoklaması OCR değildir, ayrı sayılır). */
const fake = { ocr: 0, convert: 0, health: 0 };
const ocrHits = () => fake.ocr + fake.convert;
function startFakeReader(): Promise<{ server: Server; url: string }> {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      fake.health++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", engine: "sahte", version: "0.0-test" }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (req.method === "POST" && req.url?.startsWith("/donustur")) { fake.convert++; res.writeHead(400); res.end(); return; }
      if (req.method !== "POST" || !req.url?.startsWith("/ocr")) { res.writeHead(404); res.end(); return; }
      fake.ocr++;
      res.writeHead(200, { "content-type": "application/json", "x-okuma-version": "0.0-test" });
      res.end(JSON.stringify(page({ musteri: "SUNUCU MUSTERI", parti: "SV1234" })));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

function staticGuard(): void {
  console.log("§0 tek boğaz (statik)");
  const SRC = join(__dirname, "..", "src");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f)) files.push(p);
    }
  };
  walk(SRC);
  const rel = (p: string) => relative(SRC, p).split("\\").join("/");
  const hits = (re: RegExp) => files.filter((f) => re.test(readFileSync(f, "utf8"))).map(rel).sort();
  const reader = hits(/\bgetReaderUrl\b/);
  check("§0a ⭐ getReaderUrl yalnız url.ts + sunucu-okuyucu boğazında", JSON.stringify(reader) === JSON.stringify(["lib/gelen-belge/url.ts", "services/gelen-belge-sunucu-okuyucu.service.ts"]), JSON.stringify(reader));
  const env = hits(/GELEN_BELGE_OKUMA_URL/).filter((f) => /process\.env\.GELEN_BELGE_OKUMA_URL|process\.env\[["']GELEN_BELGE_OKUMA_URL/.test(readFileSync(join(SRC, f), "utf8")));
  check("§0b GELEN_BELGE_OKUMA_URL ortamdan yalnız url.ts'te okunur", JSON.stringify(env) === '["lib/gelen-belge/url.ts"]', JSON.stringify(env));
  const testHook = hits(/setReaderUrlForTests\(/).filter((f) => f !== "lib/gelen-belge/url.ts");
  check("§0c setReaderUrlForTests src'de çağrılmaz", testHook.length === 0, JSON.stringify(testHook));
}

type Resp = { status: number; code?: string; details?: Record<string, unknown>; data?: Record<string, unknown> };
type Made = { shas: string[]; notes: string[] };

async function main(): Promise<void> {
  console.log("=== Gelen belge bilgisayarda ikinci okuma ayarı bekçisi ===\n");
  staticGuard();
  const keys = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.GELEN_BELGE_SERVER_OCR_ENABLED, SETTING_KEYS.GELEN_BELGE_STATION_DOC_LOOKUP, SETTING_KEYS.PRODUCTION_ENABLED];
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: keys } } });
  const made: Made = { shas: [], notes: [] };
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const reader = await startFakeReader();
  const startedAt = new Date();
  const setSetting = async (key: string, v: boolean | null) => {
    if (v === null) await prisma.systemSetting.deleteMany({ where: { key } });
    else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  };
  try {
    await prisma.senderTemplate.create({ data: { code: CODE, version: 1, template: JSON.parse(JSON.stringify({ ...TEMPLATE, id: undefined })), isActive: true } });
    await setSetting(SETTING_KEYS.EMANET_ENABLED, true);
    await setSetting(SETTING_KEYS.GELEN_BELGE_ENABLED, true);
    await setSetting(SETTING_KEYS.GELEN_BELGE_SERVER_OCR_ENABLED, null);
    setReaderUrlForTests(reader.url);
    __resetDocumentReaderForTests();

    const lr = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: admin.username, password: admin.password, clientType: "electron" }) });
    const tk = ((await lr.json()) as { data?: { token?: string } }).data?.token ?? "";
    check("admin login", tk.length > 0);
    const call = async (method: string, path: string, body?: unknown): Promise<Resp> => {
      const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { data?: Record<string, unknown>; details?: Record<string, unknown> & { code?: string } };
      return { status: r.status, code: j.details?.code, details: j.details, data: j.data };
    };
    const track = (scan: { id: string; noteId: string | null } | undefined, bytes: Buffer) => {
      made.shas.push(sha(bytes));
      if (scan?.noteId && !made.notes.includes(scan.noteId)) made.notes.push(scan.noteId);
    };
    const newNote = async (suffix: string): Promise<string> => {
      const r = await call("POST", "/api/gelen-belge/irsaliyeler", { sourceKind: "MANUAL", senderDocNo: `${TAG}-${suffix}` });
      const id = (r.data?.id as string) ?? "";
      if (id) made.notes.push(id);
      return id;
    };
    const upload = async (bytes: Buffer, noteId: string): Promise<Resp> => {
      const r = await call("POST", "/api/gelen-belge/taramalar", { contentBase64: bytes.toString("base64"), noteId, pageNo: 1 });
      track(r.data?.scan as { id: string; noteId: string | null } | undefined, bytes);
      return r;
    };
    const scanRow = (id: string) => prisma.documentScan.findUniqueOrThrow({ where: { id }, select: { status: true, attempts: true, ocrResult: true, noteId: true } });
    const summary = async (noteId: string) => (await call("GET", `/api/gelen-belge/irsaliyeler/${noteId}/okuma-ozeti`)).data as { state?: string; reason?: string } | undefined;
    const throwingProcess: typeof processClaimedScan = async () => { throw new Error("sonda: cihaz okuması işlenemedi"); };
    /** Cihaz okumalı yükleme (servis katmanı; tamamlama gerçek okuyucuyla, sahte servise). */
    const deviceUpload = async (salt: string, ocr: OcrResult, opts: { process?: typeof processClaimedScan } = {}) => {
      const b = jpeg(salt);
      const r = await uploadScanWithDeviceRead({ contentBase64: b.toString("base64"), noteId: null, pageNo: 1, clientOcr: asClient(ocr) }, admin.id, opts.process);
      track(r.scan, b);
      const row = await scanRow(r.scan.id);
      if (row.noteId && !made.notes.includes(row.noteId)) made.notes.push(row.noteId);
      return { r, row, env: row.ocrResult as { serverComplement?: { failed?: string | null; filled?: string[] } } | null };
    };

    // ── §1 ayar ─────────────────────────────────────────────────────────────────
    console.log("§1 ayar");
    const g0 = await call("GET", "/api/gelen-belge/ayarlar");
    check("§1a kayıt yokken serverOcrEnabled=true, default true (= bugünkü)", g0.data?.serverOcrEnabled === true && g0.data?.defaultServerOcrEnabled === true, JSON.stringify({ v: g0.data?.serverOcrEnabled, d: g0.data?.defaultServerOcrEnabled }));
    check("§1b anahtar ham ayar ucuna kapalı (dedicated)", INCOMING_DOC_DEDICATED_SETTING_KEYS.has(SETTING_KEYS.GELEN_BELGE_SERVER_OCR_ENABLED));
    const bad = await call("PUT", "/api/gelen-belge/ayarlar", { serverOcrEnabled: "hayir" });
    check("§1c bozuk değer 400", bad.status === 400, `${bad.status} ${bad.code ?? ""}`);

    // Bekleyen sayfa AÇIKKEN doğar (okuma işi çalışmıyor) — §2'de dokunulmadığı, §3'te okunduğu ölçülür.
    const nPending = await newNote("PEND");
    const pendBytes = jpeg("pending");
    const pend = await upload(pendBytes, nPending);
    const pendId = (pend.data?.scan as { id?: string } | undefined)?.id ?? "";
    check("§1d açıkken cihaz okumasız yükleme PENDING doğar (bugünkü)", (await scanRow(pendId)).status === "PENDING", (await scanRow(pendId)).status);
    // Yeniden okut için READ_FAILED sayfa (servisin reddettiği sayfanın künyesi).
    const nFailed = await newNote("FAIL");
    const failBytes = jpeg("failed");
    const failUp = await upload(failBytes, nFailed);
    const failId = (failUp.data?.scan as { id?: string } | undefined)?.id ?? "";
    await prisma.documentScan.update({ where: { id: failId }, data: { status: "READ_FAILED", attempts: 1 } });

    const put = await call("PUT", "/api/gelen-belge/ayarlar", { serverOcrEnabled: false });
    check("§1e PUT false yazılır", put.status === 200 && put.data?.serverOcrEnabled === false, `${put.status} ${put.code ?? ""}`);
    const audit = await prisma.systemLog.findFirst({ where: { tableName: "SYSTEM_SETTING", recordId: SETTING_KEYS.GELEN_BELGE_SERVER_OCR_ENABLED, createdAt: { gte: startedAt } }, select: { newData: true } });
    check("§1f audit ayak izi (SYSTEM_SETTING, value=false)", (audit?.newData as { value?: unknown } | null)?.value === false, JSON.stringify(audit?.newData));

    // ── §2 KAPALI ───────────────────────────────────────────────────────────────
    console.log("§2 kapalı");
    fake.ocr = 0; fake.convert = 0;
    const run = await runReaderOnce();
    check("§2a ⭐ okuma işi AYAR_KAPALI, okuma servisine isabet 0", run.outcome === "AYAR_KAPALI" && ocrHits() === 0, `${run.outcome} isabet ${ocrHits()}`);
    check("§2b bekleyen sayfaya dokunulmaz (PENDING kalır, açılınca okunur)", (await scanRow(pendId)).status === "PENDING");
    const durum = await call("GET", "/api/gelen-belge/okuma/durum");
    check("§2c durum ucu serverOcrEnabled=false + bekleyen sayısı (≥1)", durum.data?.serverOcrEnabled === false && Number(durum.data?.pending) >= 1, JSON.stringify({ e: durum.data?.serverOcrEnabled, p: durum.data?.pending }));
    const s1 = await summary(nPending);
    check("§2d bekleyen sayfalı taslağın özeti NO_SERVICE (ikinci okuma kapalı)", s1?.state === "NO_SERVICE" && /ikinci okuma kapalı/.test(s1?.reason ?? ""), JSON.stringify(s1 && { s: s1.state, r: s1.reason }));
    const rr = await call("POST", `/api/gelen-belge/taramalar/${failId}/oku`);
    check("§2e ⭐ yeniden okut 409 SERVER_OCR_DISABLED, Türkçe mesaj, isabet 0, sayfa değişmez", rr.status === 409 && rr.code === "SERVER_OCR_DISABLED" && ocrHits() === 0 && (await scanRow(failId)).status === "READ_FAILED", `${rr.status} ${rr.code ?? ""} isabet ${ocrHits()}`);
    const nOff = await newNote("OFF");
    const offBytes = jpeg("off-plain");
    const offUp = await upload(offBytes, nOff);
    const offRow = await scanRow((offUp.data?.scan as { id?: string } | undefined)?.id ?? "");
    check("§2f ⭐ cihaz okumasız yükleme READ_FAILED/0 doğar (PENDING'de takılmaz)", offUp.status === 201 && offRow.status === "READ_FAILED" && offRow.attempts === 0, `${offUp.status} ${offRow.status}/${offRow.attempts}`);
    const s2 = await summary(nOff);
    check("§2g özet FAILED + \"yeniden çekin\"", s2?.state === "FAILED" && /yeniden çekin/.test(s2?.reason ?? ""), JSON.stringify(s2 && { s: s2.state, r: s2.reason }));
    const devFail = await deviceUpload("dev-fail-off", page({ musteri: "CIHAZ", parti: "AB1234" }), { process: throwingProcess });
    check("§2h ⭐ cihaz okuması düşerse READ_FAILED (deviceOcr FAILED), PENDING değil", devFail.r.deviceOcr === "FAILED" && devFail.row.status === "READ_FAILED", `${devFail.r.deviceOcr} ${devFail.row.status}`);
    const devPart = await deviceUpload("dev-part-off", page({ parti: "AB1234" }));
    check("§2i ⭐ boş başlık alanı sunucuya okutulmaz: isabet 0, READ, failed=SERVER_OCR_DISABLED", ocrHits() === 0 && devPart.row.status === "READ" && devPart.env?.serverComplement?.failed === "SERVER_OCR_DISABLED", `isabet ${ocrHits()} ${devPart.row.status} ${devPart.env?.serverComplement?.failed}`);
    const nHeic = await newNote("HEIC");
    const hb = heic("off");
    const hr = await call("POST", "/api/gelen-belge/taramalar", { contentBase64: hb.toString("base64"), noteId: nHeic, pageNo: 1 });
    check("§2j HEIC 503 HEIC_CONVERT_UNAVAILABLE (reason SERVER_OCR_DISABLED), dönüştürme isabeti 0", hr.status === 503 && hr.code === "HEIC_CONVERT_UNAVAILABLE" && hr.details?.reason === "SERVER_OCR_DISABLED" && fake.convert === 0, `${hr.status} ${hr.code ?? ""} ${String(hr.details?.reason)} ${fake.convert}`);
    await setSetting(SETTING_KEYS.GELEN_BELGE_STATION_DOC_LOOKUP, true);
    await setSetting(SETTING_KEYS.PRODUCTION_ENABLED, true);
    const st = await stationLookupStatus();
    let stErr: unknown = null;
    await stationDocLookup({ contentBase64: jpeg("station-off").toString("base64") }).catch((e: unknown) => { stErr = e; });
    const stCode = stErr instanceof AppError ? (stErr.details as { code?: string } | undefined)?.code : String(stErr);
    check("§2k istasyon okutma: readerConfigured=false, fotoğraf 409 SERVER_OCR_DISABLED, isabet 0", st.readerConfigured === false && stCode === "SERVER_OCR_DISABLED" && ocrHits() === 0, `${st.readerConfigured} ${stCode} ${ocrHits()}`);
    check("§2l kapalı turun tamamında okuma servisine OCR/dönüştürme isabeti 0", ocrHits() === 0, String(ocrHits()));

    // ── §3 AÇIK (bugünkü davranış) ──────────────────────────────────────────────
    console.log("§3 açık");
    await setSetting(SETTING_KEYS.GELEN_BELGE_SERVER_OCR_ENABLED, null);
    fake.ocr = 0;
    const st3 = await stationLookupStatus();
    check("§3a ayar açılınca istasyon readerConfigured=true (anında, yeniden başlatmasız)", st3.readerConfigured === true);
    await runReaderOnce();
    check("§3b ⭐ bekleyen sayfa açılınca okunur (READ, isabet ≥1)", (await scanRow(pendId)).status === "READ" && fake.ocr >= 1, `${(await scanRow(pendId)).status} ${fake.ocr}`);
    const devFallback = await deviceUpload("dev-fail-on", page({ musteri: "CIHAZ", parti: "AB1234" }), { process: throwingProcess });
    check("§3c cihaz okuması düşerse PENDING (FALLBACK) — bugünkü", devFallback.r.deviceOcr === "FALLBACK" && devFallback.row.status === "PENDING", `${devFallback.r.deviceOcr} ${devFallback.row.status}`);
    const nOn = await newNote("ON");
    const onBytes = jpeg("on-plain");
    const onUp = await upload(onBytes, nOn);
    check("§3d cihaz okumasız yükleme PENDING — bugünkü", (await scanRow((onUp.data?.scan as { id?: string } | undefined)?.id ?? "")).status === "PENDING");
    fake.ocr = 0;
    const devPartOn = await deviceUpload("dev-part-on", page({ parti: "AB1234" }));
    check("§3e boş başlık alanı sunucuya TAM bir kez okutulur (failed yok)", fake.ocr === 1 && devPartOn.row.status === "READ" && !devPartOn.env?.serverComplement?.failed, `${fake.ocr} ${devPartOn.row.status} ${devPartOn.env?.serverComplement?.failed}`);
    const rr3 = await call("POST", `/api/gelen-belge/taramalar/${failId}/oku`);
    check("§3f yeniden okut 202 (READ_FAILED → PENDING)", rr3.status === 202 && (await scanRow(failId)).status === "PENDING", `${rr3.status} ${rr3.code ?? ""}`);
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    __resetDocumentReaderForTests();
    setReaderUrlForTests(null);
    // Okuma işinin kendi açtığı taslaklar da (taramadan ya da bu bekçinin şablonundan; yarım kalmış önceki koşum dahil) toplanır.
    const tpls = await prisma.senderTemplate.findMany({ where: { code: { startsWith: "u-test-okuma-ayar-" } }, select: { id: true, code: true } });
    const bound = await prisma.documentScan.findMany({ where: { sha256: { in: made.shas }, noteId: { not: null } }, select: { noteId: true } });
    const byTpl = await prisma.customerDeliveryNote.findMany({ where: { templateId: { in: tpls.map((t) => t.id) } }, select: { id: true } });
    for (const id of [...bound.map((b) => b.noteId!), ...byTpl.map((n) => n.id)]) if (!made.notes.includes(id)) made.notes.push(id);
    await prisma.documentScan.updateMany({ where: { OR: [{ sha256: { in: made.shas } }, { noteId: { in: made.notes } }] }, data: { noteId: null } }).catch(() => undefined);
    await prisma.customerDeliveryNoteLine.deleteMany({ where: { noteId: { in: made.notes } } }).catch(() => undefined);
    await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } }).catch((e) => check("temizlik", false, String(e)));
    await prisma.documentScan.deleteMany({ where: { sha256: { in: made.shas } } }).catch((e) => check("temizlik", false, String(e)));
    const codes = [...new Set([CODE, ...tpls.map((t) => t.code)])];
    await prisma.senderTemplateVersion.deleteMany({ where: { senderTemplate: { code: { in: codes } } } }).catch((e) => check("temizlik", false, String(e)));
    await prisma.senderTemplate.deleteMany({ where: { code: { in: codes } } }).catch((e) => check("temizlik", false, String(e)));
    for (const k of keys) {
      const p = prior.find((r) => r.key === k);
      if (p) await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: p.value as never, description: p.description }, update: { value: p.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => reader.server.close(() => r()));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!engel) void main();
