// =============================================================================
// GELEN BELGE — D3b okuma istemcisi + okuma işi + eşleme bekçisi (sahte loopback sidecar, gerçek DB)
// =============================================================================
// Karar belgesi TASARIM-KARARI-2026-10-28 §2 (egress istisnası) · §3.2–3.4 (okuma işi, çıkarım, eşleme) · §6 D3b.
//   §1 egress NEGATİF SONDA: http://1.2.3.4:8765 ve http://okuma.local REDDEDİLİR; http://127.0.0.1:8765 ve
//      (beyanla) http://okuma:8765 geçer; `allowPlainHttpServiceHost` tek çağıran `lib/gelen-belge/url.ts` (AST/grep)
//   §2 servis yok: /okuma/durum "yok" · POST /taramalar/:id/oku → 503 OCR_SERVICE_UNAVAILABLE · iş ADRES_YOK, dış istek yok
//   §3 4 altın fikstür → 4 DRAFT: 0245 2 blok 21 satır + BLOK BAŞINA beyan (5/141,70/586 · 16/819,20/3.935) ·
//      0246 2 bölge (zarf) · 0244 needsReview satırlar · 0243 başlık (evrak 90779, 2026-10-15) · top doğmaz · audit'te ham OCR yok
//   §4 sahte servis 5xx → tarama PENDING kalır (deneme sayacı artar), 3. denemede READ_FAILED, taslak doğmaz; okut → PENDING
//   §5 Zod fail-closed: şema dışı gövde → okunamadı (PENDING), düzelince READ
//   §6 iki iş aynı anda → tek okuma: `runReaderOnce` ikincisi MESGUL; iki eşzamanlı `claimNextScan` → tek CLAIMED; sidecar 1 isabet
//   §7 eşleme: "GÜLEÇSOY TEKSTİL" ↔ "Güleçsoy Tekstil San." ≥ 0,90 öneri · ilgisiz → boş · alias önce (ALIAS) · /eslestirme ucu
//   §8 bağlı taslak: operatörün yazdığı başlık/satır EZİLMEZ, yalnız boş alanlar dolar
// Emsal: scripts/test_gelen_belge_taslak.ts (app.listen(0) + ensureTestAdmin + ayar()).
// =============================================================================
import type { AddressInfo } from "net";
import http, { type Server } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { __clearPlainHttpServiceHostsForTests, allowPlainHttpServiceHost, isEgressTargetAllowed } from "../src/lib/http-egress";
import { resolveReaderUrl, setReaderUrlForTests } from "../src/lib/gelen-belge/url";
import { __resetDocumentReaderForTests, runReaderOnce } from "../src/jobs/gelen-belge-okuma.job";
import { claimNextScan } from "../src/services/gelen-belge-okuma.service";
import { aliasKey, suggestCustomer } from "../src/services/gelen-belge-eslestirme.service";

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
const FIKSTUR = join(__dirname, "..", "src", "lib", "gelen-belge", "motor", "__tests__", "fikstur", "gercek");
const fixtureOf = (no: string): unknown => JSON.parse(readFileSync(join(FIKSTUR, readdirSync(FIKSTUR).find((f) => f.startsWith(no))!), "utf8"));
const jpeg = (no: string, salt = "") => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${TAG} FIX:${no} ${salt}`)]);
const made = { customers: [] as string[], users: [] as string[], notes: [] as string[], scans: [] as string[], aliases: [] as string[] };
type Resp = { status: number; code?: string; data?: Record<string, unknown> & { scan?: { id: string }; id?: string } };

async function ayar(key: string, v: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

// ── Sahte sidecar: JSON {imageBase64} içindeki "FIX:NNNN" damgasına göre altın fikstürü döner ─────────────────
const fake = { mode: "ok" as "ok" | "500" | "invalid", hits: 0, delayMs: 0 };
function startFakeSidecar(): Promise<{ server: Server; url: string }> {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", engine: "sahte-paddle", version: "0.0-test" }));
      return;
    }
    if (req.method !== "POST" || !req.url?.startsWith("/ocr")) { res.writeHead(404); res.end(); return; }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      fake.hits++;
      setTimeout(() => {
        if (fake.mode === "500") { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ detail: "OCR hatası (sahte)" })); return; }
        if (fake.mode === "invalid") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ foo: 1, blocks: "yok" })); return; }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { imageBase64: string };
        const m = /FIX:(\d{4})/.exec(Buffer.from(body.imageBase64, "base64").toString("utf8"));
        if (!m) { res.writeHead(400); res.end(); return; }
        res.writeHead(200, { "content-type": "application/json", "x-okuma-version": "0.0-test" });
        res.end(JSON.stringify(fixtureOf(m[1]!)));
      }, fake.delayMs);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

async function main(): Promise<void> {
  console.log("=== Gelen belge D3b okuma bekçisi ===\n");

  // ── §1 egress negatif sonda (DB'siz) ──────────────────────────────────────
  __clearPlainHttpServiceHostsForTests();
  check("§1a http://1.2.3.4:8765 REDDEDİLİR (IP, düz HTTP)", resolveReaderUrl("http://1.2.3.4:8765").source === "gecersiz" && !isEgressTargetAllowed(new URL("http://1.2.3.4:8765")));
  check("§1b http://okuma.local REDDEDİLİR (noktalı ad)", resolveReaderUrl("http://okuma.local").source === "gecersiz" && !isEgressTargetAllowed(new URL("http://okuma.local")));
  check("§1c http://127.0.0.1:8765 geçer (döngü)", resolveReaderUrl("http://127.0.0.1:8765").url === "http://127.0.0.1:8765");
  check("§1d http://okuma:8765 geçer (BEYANLI compose servis adı)", resolveReaderUrl("http://okuma:8765").url === "http://okuma:8765" && isEgressTargetAllowed(new URL("http://okuma:8765/ocr")));
  check("§1e beyan başka adı AÇMAZ: okuma2 / okuma.local hâlâ kapalı", !isEgressTargetAllowed(new URL("http://okuma2:8765")) && !isEgressTargetAllowed(new URL("http://okuma.local:8765")));
  check("§1f allowPlainHttpServiceHost IP/noktalı/döngü adı reddeder", !allowPlainHttpServiceHost("1.2.3.4") && !allowPlainHttpServiceHost("okuma.local") && !allowPlainHttpServiceHost("localhost"));
  check("§1g yol/sorgu/parola taşıyan adres geçersiz · boş = kapalı", resolveReaderUrl("http://127.0.0.1:8765/ocr").source === "gecersiz" && resolveReaderUrl("http://a:b@127.0.0.1:8765").source === "gecersiz" && resolveReaderUrl("").source === "kapali");
  const srcDir = join(__dirname, "..", "src");
  const callers: string[] = [];
  const walk = (d: string): void => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".ts") && readFileSync(p, "utf8").includes("allowPlainHttpServiceHost(")) callers.push(p.slice(srcDir.length + 1)); } };
  walk(srcDir);
  check("§1h allowPlainHttpServiceHost TEK çağıran: lib/gelen-belge/url.ts (+ tanım)", callers.sort().join(",") === "lib/gelen-belge/url.ts,lib/http-egress.ts", callers.join(","));
  __clearPlainHttpServiceHostsForTests();

  const keys = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED];
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sidecar = await startFakeSidecar();
  const rollsBefore = await prisma.roll.count();
  try {
    await ayar(SETTING_KEYS.EMANET_ENABLED, true);
    await ayar(SETTING_KEYS.GELEN_BELGE_ENABLED, true);
    const login = async (username: string, password: string) => {
      const r = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType: "electron" }) });
      return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
    };
    const call = async (method: string, path: string, body?: unknown): Promise<Resp> => {
      const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; details?: { code?: string } };
      return { status: r.status, code: j.details?.code, data: j.data };
    };
    const tk = await login(admin.username, admin.password);
    check("admin login", tk.length > 0);
    const up = async (no: string, extra: Record<string, unknown> = {}, salt = ""): Promise<string> => {
      const r = await call("POST", "/api/gelen-belge/taramalar", { contentBase64: jpeg(no, salt).toString("base64"), ...extra });
      const id = (r.data?.scan as { id: string } | undefined)?.id ?? "";
      if (id) made.scans.push(id);
      return id;
    };
    const scan = (id: string) => prisma.documentScan.findUniqueOrThrow({ where: { id }, select: { status: true, attempts: true, noteId: true, ocrEngine: true, ocrVersion: true, ocrDurationMs: true, ocrResult: true } });

    // ── §2 servis yok ──────────────────────────────────────────────────────
    setReaderUrlForTests(null);
    __resetDocumentReaderForTests();
    const s0 = await up("0245", {}, "servis-yok");
    const d0 = await call("GET", "/api/gelen-belge/okuma/durum");
    check("§2a /okuma/durum servis yok → 'yok', kuyrukta ≥1 PENDING", d0.status === 200 && d0.data?.service === "yok" && (d0.data?.pending as number) >= 1, JSON.stringify(d0.data));
    const o0 = await call("POST", `/api/gelen-belge/taramalar/${s0}/oku`);
    check("§2b okut → 503 OCR_SERVICE_UNAVAILABLE", o0.status === 503 && o0.code === "OCR_SERVICE_UNAVAILABLE", `${o0.status} ${o0.code}`);
    const r0 = await runReaderOnce();
    check("§2c iş ADRES_YOK: dış istek yok, tarama PENDING kalır", r0.outcome === "ADRES_YOK" && fake.hits === 0 && (await scan(s0)).status === "PENDING", r0.outcome);
    await ayar(SETTING_KEYS.GELEN_BELGE_ENABLED, false);
    setReaderUrlForTests(sidecar.url);
    const rk = await runReaderOnce();
    check("§2d modül kapalı → KAPALI (adres olsa da çıkmaz)", rk.outcome === "KAPALI" && fake.hits === 0, rk.outcome);
    await ayar(SETTING_KEYS.GELEN_BELGE_ENABLED, true);
    const d1 = await call("GET", "/api/gelen-belge/okuma/durum");
    check("§2e servis var → 'var' + motor adı sağlıktan", d1.data?.service === "var" && d1.data?.engine === "sahte-paddle", JSON.stringify(d1.data));

    // ── §3 4 altın fikstür → 4 DRAFT ──────────────────────────────────────
    // s0 (0245) zaten kuyrukta; 0246/0244/0243 eklenir; tek tur en çok 5 tarama işler.
    const s46 = await up("0246");
    const s44 = await up("0244");
    const s43 = await up("0243");
    const r1 = await runReaderOnce();
    check("§3a tek tur 4 tarama okudu (BASARILI, 4 READ)", r1.outcome === "BASARILI" && r1.processed === 4 && r1.outcomes.every((o) => o === "READ"), JSON.stringify(r1));
    const all = await Promise.all([s0, s46, s44, s43].map(scan));
    check("§3b 4 tarama READ + motor adı OcrResult.engine'den, sürüm başlıktan, süre + ocrResult zarfı (sidecar'sız yeniden çıkarım)", all.every((s) => s.status === "READ" && s.noteId && s.ocrEngine === "paddle" && s.ocrVersion === "0.0-test" && typeof s.ocrDurationMs === "number" && !!s.ocrResult), JSON.stringify(all.map((s) => [s.status, s.ocrEngine, s.ocrVersion, s.ocrDurationMs, !!s.ocrResult])));
    for (const s of all) if (s.noteId) made.notes.push(s.noteId);
    const note = (id: string) => prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id }, select: { noteNo: true, status: true, sourceKind: true, ownerText: true, senderDocNo: true, senderDocDate: true, customerBatchNo: true, processText: true, declaredTopCount: true, totalsDeclared: true, warnings: true, lines: { select: { lineNo: true, blockNo: true, meters: true, weightKg: true, needsReview: true, confidence: true, sourceRects: true, senderRollNo: true }, orderBy: { lineNo: "asc" } } } });
    const n45 = await note(all[0]!.noteId!);
    const blocks = (n45.totalsDeclared as { blocks: Array<{ blockNo: number; count: string; kg: string; m: string }> }).blocks;
    check("§3c 0245: DRAFT/OCR, GB numarası, 21 satır, 2 blok", n45.status === "DRAFT" && n45.sourceKind === "OCR" && /^GB/.test(n45.noteNo) && n45.lines.length === 21 && new Set(n45.lines.map((l) => l.blockNo)).size === 2, `${n45.noteNo} ${n45.lines.length}`);
    check("§3d 0245: BLOK BAŞINA beyan 5/141,70/586 · 16/819,20/3.935", JSON.stringify(blocks.map((b) => [b.blockNo, b.count, b.kg, b.m])) === JSON.stringify([[1, "5", "141.7", "586"], [2, "16", "819.2", "3935"]]), JSON.stringify(blocks));
    const sumM = (b: number) => n45.lines.filter((l) => l.blockNo === b).reduce((a, l) => a + Math.round(Number(l.meters) * 1000), 0);
    check("§3e 0245: Σ satır = beyan (blok 1 586 m, blok 2 3935 m) · her satırda rect + güven", sumM(1) === 586000 && sumM(2) === 3935000 && n45.lines.every((l) => !!l.sourceRects && Number(l.confidence) > 0), JSON.stringify([n45.lines.filter((l) => l.blockNo === 1).reduce((a, l) => a + Number(l.meters), 0), n45.lines.filter((l) => l.blockNo === 2).reduce((a, l) => a + Number(l.meters), 0), n45.lines.map((l) => Number(l.confidence))]));
    check("§3f 0245: başlık fiş no, tarih, parti, işlem, '4 TOP' beyanı yalnız uyarı", n45.senderDocNo === "914279" && n45.senderDocDate?.toISOString().slice(0, 10) === "2026-10-19" && n45.customerBatchNo === "P9918733" && n45.processText === "KDK APRE" && n45.declaredTopCount === 4 && (n45.warnings as string[]).some((w) => w.startsWith("DECLARED_TOP_COUNT_DIFF")), JSON.stringify({ no: n45.senderDocNo, p: n45.customerBatchNo, w: n45.warnings }));
    const n46 = await note(all[1]!.noteId!);
    const env46 = all[1]!.ocrResult as { regions: Array<{ regionNo: number; templateId: string }> };
    check("§3g 0246: 2 bölge zarfta (cikis-ceki-listesi + urun-sevk-fisi), MULTI_REGION uyarısı, ARABA 241 m satırı", env46.regions.length === 2 && env46.regions[1]!.templateId === "urun-sevk-fisi" && (n46.warnings as string[]).some((w) => w.startsWith("MULTI_REGION")) && n46.lines.length === 1 && Number(n46.lines[0]!.meters) === 241, JSON.stringify(env46.regions));
    const n44 = await note(all[2]!.noteId!);
    check("§3h 0244: el yazısı ızgarası → ≥10 satır, HEPSİ needsReview, sıra no taşır, kg yok", n44.lines.length >= 10 && n44.lines.every((l) => l.needsReview && l.senderRollNo && l.weightKg === null), String(n44.lines.length));
    const n43 = await note(all[3]!.noteId!);
    check("§3i 0243: başlık evrak 90779 + 2026-10-15, satırsız form → tek top 1775 önerisi (needsReview)", n43.senderDocNo === "90779" && n43.senderDocDate?.toISOString().slice(0, 10) === "2026-10-15" && n43.lines.length === 1 && Number(n43.lines[0]!.meters) === 1775 && n43.lines[0]!.needsReview, JSON.stringify({ no: n43.senderDocNo, l: n43.lines.length }));
    check("§3j DEFTER: top doğmadı (roll sayısı değişmedi)", (await prisma.roll.count()) === rollsBefore);
    const logs = await prisma.systemLog.findMany({ where: { tableName: "CUSTOMER_DELIVERY_NOTE", recordId: { in: made.notes } }, select: { newData: true } });
    const dump = JSON.stringify(logs);
    check("§3k audit'te ham OCR yok (blocks/imageBase64/ÖRNEK metni yok), künye var", logs.length >= 4 && !dump.includes("imageBase64") && !/"blocks"/.test(dump) && !dump.includes("ÖRNEK") && dump.includes("lineCount"));

    // ── §4 5xx → PENDING kalır, 3. denemede READ_FAILED ─────────────────────
    fake.mode = "500";
    const s5 = await up("0245", {}, "bes-yuz");
    const notesBefore = await prisma.customerDeliveryNote.count();
    const a1 = await runReaderOnce();
    const p1 = await scan(s5);
    check("§4a 5xx → tarama PENDING kalır, deneme 1", a1.outcomes[0] === "RETRY" && p1.status === "PENDING" && p1.attempts === 1 && p1.noteId === null, `${p1.status}/${p1.attempts}`);
    await runReaderOnce();
    const a3 = await runReaderOnce();
    const p3 = await scan(s5);
    check("§4b 3. denemede READ_FAILED, taslak doğmadı", a3.outcomes[0] === "READ_FAILED" && p3.status === "READ_FAILED" && p3.attempts === 3 && (await prisma.customerDeliveryNote.count()) === notesBefore, `${p3.status}/${p3.attempts}`);
    const a4 = await runReaderOnce();
    check("§4c READ_FAILED yeniden alınmaz (kuyruk BOS)", a4.outcome === "BOS" && (await scan(s5)).attempts === 3, a4.outcome);
    const okut = await call("POST", `/api/gelen-belge/taramalar/${s5}/oku`);
    check("§4d okut → 202, PENDING, deneme 0", okut.status === 202 && okut.data?.status === "PENDING" && okut.data?.attempts === 0, `${okut.status} ${JSON.stringify(okut.data)}`);
    fake.mode = "ok";
    await runReaderOnce();
    const p5 = await scan(s5);
    check("§4e servis düzelince READ + taslak", p5.status === "READ" && !!p5.noteId);
    if (p5.noteId) made.notes.push(p5.noteId);
    const okut2 = await call("POST", `/api/gelen-belge/taramalar/${s5}/oku`);
    check("§4f okunmuş taramayı okut → 409 DOCUMENT_SCAN_ALREADY_READ", okut2.status === 409 && okut2.code === "DOCUMENT_SCAN_ALREADY_READ");

    // ── §5 Zod fail-closed ──────────────────────────────────────────────────
    fake.mode = "invalid";
    const sz = await up("0243", {}, "zod");
    const z1 = await runReaderOnce();
    const pz = await scan(sz);
    check("§5a şema dışı gövde → okunamadı sayılır (PENDING, deneme 1), taslak yok", z1.outcomes[0] === "RETRY" && pz.status === "PENDING" && pz.noteId === null, `${pz.status}/${pz.attempts}`);
    fake.mode = "ok";
    await runReaderOnce();
    const pz2 = await scan(sz);
    check("§5b düzelince READ", pz2.status === "READ" && !!pz2.noteId);
    if (pz2.noteId) made.notes.push(pz2.noteId);

    // ── §6 iki iş aynı anda → tek okuma ────────────────────────────────────
    fake.delayMs = 300;
    const s6 = await up("0245", {}, "yaris");
    const hitsBefore = fake.hits;
    const [x1, x2] = await Promise.all([runReaderOnce(), runReaderOnce()]);
    check("§6a eşzamanlı iki tur → biri MESGUL, sidecar TEK isabet, tarama READ", [x1.outcome, x2.outcome].sort().join("/") === "BASARILI/MESGUL" && fake.hits - hitsBefore === 1 && (await scan(s6)).status === "READ", `${x1.outcome}/${x2.outcome} hits+${fake.hits - hitsBefore}`);
    const n6 = (await scan(s6)).noteId;
    if (n6) made.notes.push(n6);
    fake.delayMs = 0;
    const s6b = await up("0243", {}, "claim");
    const [c1, c2] = await Promise.all([claimNextScan(), claimNextScan()]);
    const claimed = [c1, c2].filter((c) => c.kind === "CLAIMED");
    check("§6b iki eşzamanlı claim → tek CLAIMED (updateMany WHERE {id, status})", claimed.length === 1 && (claimed[0] as { id: string }).id === s6b && (await scan(s6b)).status === "READING" && (await scan(s6b)).attempts === 1, `${c1.kind}/${c2.kind}`);
    const stuck = await runReaderOnce();
    check("§6c READING'deki tarama (bayat değil) ikinci tur tarafından ALINMAZ", stuck.outcome === "BOS", stuck.outcome);
    await prisma.documentScan.update({ where: { id: s6b }, data: { status: "PENDING" } });
    await runReaderOnce();
    const n6b = (await scan(s6b)).noteId;
    if (n6b) made.notes.push(n6b);

    // ── §7 eşleme ─────────────────────────────────────────────────────────
    const mkC = async (name: string): Promise<string> => { const c = await prisma.customer.create({ data: { code: `${TAG}-${made.customers.length}`, name }, select: { id: true } }); made.customers.push(c.id); return c.id; };
    const gul = await mkC("Güleçsoy Tekstil San.");
    await mkC("Mavi Boya Apre Ltd.");
    const ornek = await mkC("Örnek Tekstil A");
    const e1 = await suggestCustomer("GÜLEÇSOY TEKSTİL");
    check("§7a 'GÜLEÇSOY TEKSTİL' ↔ 'Güleçsoy Tekstil San.' ≥ 0,90 → ÖNERİ (SIMILARITY)", e1.suggested?.id === gul && e1.suggested.score >= 0.9 && e1.source === "SIMILARITY", JSON.stringify({ s: e1.suggested?.score, src: e1.source }));
    const e2 = await suggestCustomer("ZÜMRÜT İPLİK");
    check("§7b ilgisiz metin → öneri yok, liste boş", e2.suggested === null && e2.list.length === 0, JSON.stringify(e2.list));
    const al = await prisma.deliveryNoteAlias.create({ data: { scope: "SENDER", rawKey: aliasKey("SENDER", "GLÇSY TKS"), targetId: gul }, select: { id: true } });
    made.aliases.push(al.id);
    const e3 = await suggestCustomer("GLÇSY TKS");
    check("§7c alias ÖNCE: benzerlik tutmasa da ALIAS isabeti", e3.suggested?.id === gul && e3.source === "ALIAS", e3.source);
    const es = await call("GET", `/api/gelen-belge/irsaliyeler/${all[0]!.noteId}/eslestirme`);
    const owner = es.data?.owner as { suggested?: { id: string }; rawText: string } | undefined;
    check("§7d /eslestirme: 0245 sahibi 'ÖRNEK TEKSTİL A' → Örnek Tekstil A önerisi; 21 satır için satır önerileri", es.status === 200 && owner?.suggested?.id === ornek && (es.data?.lines as unknown[]).length === 21, JSON.stringify(owner));
    check("§7e 'sahip = gönderen' varsayımı YOK: senderCustomerId/ownerCustomerId OCR'dan DOLMAZ", (await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: all[0]!.noteId! }, select: { ownerCustomerId: true, senderCustomerId: true } })).ownerCustomerId === null);

    // ── §8 bağlı taslak: operatör verisi ezilmez ───────────────────────────
    const cr = await call("POST", "/api/gelen-belge/irsaliyeler", { sourceKind: "MANUAL", senderDocNo: `${TAG}-ELLE`, lines: [{ senderRollNo: "EL-1", meters: 50 }] });
    const manualId = cr.data?.id as string;
    made.notes.push(manualId);
    const s8 = await up("0245", { noteId: manualId }, "bagli");
    await runReaderOnce();
    const n8 = await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: manualId }, select: { senderDocNo: true, ownerText: true, customerBatchNo: true, lines: { select: { meters: true } } } });
    check("§8a bağlı taslak: senderDocNo ve operatör satırı korunur; boş ownerText/parti OCR'dan dolar; tarama READ", n8.senderDocNo === `${TAG}-ELLE` && n8.lines.length === 1 && Number(n8.lines[0]!.meters) === 50 && n8.ownerText === "ÖRNEK TEKSTİL A" && n8.customerBatchNo === "P9918733" && (await scan(s8)).status === "READ", JSON.stringify(n8));
  } finally {
    stopNotificationJobs();
    __resetDocumentReaderForTests();
    setReaderUrlForTests(null);
    await new Promise<void>((r) => sidecar.server.close(() => r()));
    await new Promise<void>((r) => server.close(() => r()));
    for (const k of keys) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as object } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    await prisma.deliveryNoteAlias.deleteMany({ where: { id: { in: made.aliases } } });
    await prisma.documentScan.updateMany({ where: { id: { in: made.scans } }, data: { noteId: null } });
    await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } });
    await prisma.documentScan.deleteMany({ where: { id: { in: made.scans } } });
    await prisma.customer.deleteMany({ where: { id: { in: made.customers } } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) process.exitCode = 1;
}

if (!engel) {
  main()
    .catch((e) => { console.error("❌ beklenmeyen hata:", e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
