// =============================================================================
// GELEN BELGE — D3b okuma istemcisi + okuma işi + eşleme bekçisi (sahte loopback sidecar, gerçek DB)
// =============================================================================
// Karar belgesi TASARIM-KARARI-2026-10-28 §2 (egress istisnası) · §3.2–3.4 (okuma işi, çıkarım, eşleme) · §6 D3b.
//   §1i/§1j sayfa yönü: rotation → kutular fotoğraf çerçevesine döner; Zod `rotation` opsiyonel tam sayı
//   §1 egress NEGATİF SONDA: http://1.2.3.4:8765 ve http://okuma.local REDDEDİLİR; http://127.0.0.1:8765 ve
//      (beyanla) http://okuma:8765 geçer; `allowPlainHttpServiceHost` tek çağıran `lib/gelen-belge/url.ts` (AST/grep)
//   §2 servis yok: /okuma/durum "yok" · POST /taramalar/:id/oku → 503 OCR_SERVICE_UNAVAILABLE · iş ADRES_YOK, dış istek yok
//   §3 4 altın fikstür → 4 DRAFT: 0245 2 blok 21 satır + BLOK BAŞINA beyan (5/141,70/586 · 16/819,20/3.935) ·
//      0245 satır işlemi kendi bloğundan (§3f2) · 0246 2 bölge (zarf) · 0244 needsReview satırlar · 0243 başlık (evrak 90779, 2026-10-15) · top doğmaz · audit'te ham OCR yok
//   §4 sahte servis 5xx → tarama PENDING kalır (deneme sayacı artar), 3. denemede READ_FAILED, taslak doğmaz; okut → PENDING
//   §5 Zod fail-closed: şema dışı gövde / 4xx → KALICI okunamadı (doğrudan READ_FAILED); okut + düzelince READ
//   §6 iki iş aynı anda → tek okuma: `runReaderOnce` ikincisi MESGUL; iki eşzamanlı `claimNextScan` → tek CLAIMED; sidecar 1 isabet
//   §7 eşleme: "GÜLEÇSOY TEKSTİL" ↔ "Güleçsoy Tekstil San." ≥ 0,90 öneri · ilgisiz → boş · alias önce (ALIAS) · /eslestirme ucu
//   §6d bayat READING (10 dk+) yeniden alınır · §7f /eslestirme yok id → 404
//   §8 bağlı taslak: operatörün yazdığı başlık/satır EZİLMEZ, yalnız boş alanlar dolar; taslak DRAFT değilse tarama yine READ'e kapanır
//   §8e–§8g üst üste binen çekim: başka sayfada Top No + kg + metre birebir olan satır atlanır (uyarı), aynı Top No farklı sayı →
//      yazılır + needsReview; aynı taramanın eşit satırları ikisi de yazılır; paralel iki sayfa ortak satırı TEK kez yazar
//   §10 K6 PDF: yükleme READ_FAILED (deneme 0) doğar · eski PENDING PDF bile claim EDİLMEZ · sidecar'a 0 PDF isteği ·
//       okut → 400 DOCUMENT_SCAN_PDF_NOT_READABLE (servis yokken de 503'ten önce) · kuyruk sayaçlarına girmez
//   §3l–§3n okuma uyarıları: 0246 ikinci belge izi (SECOND_DOCUMENT_TRACE) detay `notices` ≡ okuma özeti `notices`;
//       0244 şüpheli satırlar `ocrRaw._suspect` + detay `problems` SUSPECT_VALUE (ocrRaw yanıta çıkmaz); oran ayarı okumaya uygulanır
//       NEGATİF SONDA (2026-11-02): `lineProblems` SUSPECT_VALUE satırı kapatılınca §3m + §3m2 düşer (90/2).
//   §14 tablet okuma özeti: NO_PAGES · NO_SERVICE · READING (+ yeniden deneme nedeni) · READ (satır/gözden geçirme/toplam
//       onay helper'ından) · toplam sapınca ok:false · FAILED · PARTIAL · izin write (read-only 403) · 404 · 400
//   §9 İSTEĞE BAĞLI (OKUMA_GERCEK_URL=http://127.0.0.1:8765): GERÇEK okuma servisi (okuma/, D6) — sağlık + sentetik PNG → READ +
//      Zod geçer + taslak · bozuk JPEG → servis 400 → KALICI READ_FAILED. Değişken yoksa atlanır (varsayılan sahte sunucu).
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
import { dropOverlapDuplicates, rectToPhotoFrame } from "../src/lib/gelen-belge/taslak";
import { OcrResultSchema } from "../src/lib/gelen-belge/okuma-istemcisi";
import { __resetDocumentReaderForTests, runReaderOnce } from "../src/jobs/gelen-belge-okuma.job";
import { claimNextScan, processClaimedScan } from "../src/services/gelen-belge-okuma.service";
import { aliasKey, suggestCustomer, suggestForNote } from "../src/services/gelen-belge-eslestirme.service";
import { FALLBACK_TEMPLATE_CODE, ensureSenderTemplate } from "../src/services/gelen-belge-sablon.service";
import bcrypt from "bcryptjs";

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

async function ayar(key: string, v: boolean | number): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

// ── Sahte sidecar: JSON {imageBase64} içindeki "FIX:NNNN" damgasına göre altın fikstürü döner ─────────────────
const fake = { mode: "ok" as "ok" | "500" | "400" | "invalid", hits: 0, delayMs: 0, pdfHits: 0 };
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
      try {
        const sent = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { imageBase64?: string };
        if (Buffer.from(sent.imageBase64 ?? "", "base64").subarray(0, 4).toString("latin1") === "%PDF") fake.pdfHits++;
      } catch { /* gövde JSON değil — sayılmaz */ }
      setTimeout(() => {
        if (fake.mode === "500") { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ detail: "OCR hatası (sahte)" })); return; }
        if (fake.mode === "400") { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ detail: "bozuk görüntü (sahte)" })); return; }
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
  // §1i yön: servis yan sayfayı dikleştirdiyse (rotation) kutu saklanan fotoğrafın çerçevesine geri döner (DB'siz).
  // Foto 100×50, kutu {x:10,y:5,w:30,h:8}; saat yönü 90° → dik 50×100'de {x:37,y:10,w:8,h:30}; 270° → {x:5,y:60,w:8,h:30}.
  const foto = { x: 10, y: 5, width: 30, height: 8 };
  check("§1i rotation 90/270/180/0 → kutu fotoğraf çerçevesine döner",
    JSON.stringify(rectToPhotoFrame({ x: 37, y: 10, width: 8, height: 30 }, 90, 50, 100)) === JSON.stringify(foto)
    && JSON.stringify(rectToPhotoFrame({ x: 5, y: 60, width: 8, height: 30 }, 270, 50, 100)) === JSON.stringify(foto)
    && JSON.stringify(rectToPhotoFrame({ x: 60, y: 37, width: 30, height: 8 }, 180, 100, 50)) === JSON.stringify(foto)
    && rectToPhotoFrame(foto, 0, 100, 50) === foto && rectToPhotoFrame(foto, undefined, 100, 50) === foto);
  const zr = OcrResultSchema.safeParse({ text: "", blocks: [], imageWidth: 50, imageHeight: 100, rotation: 90 });
  const z0 = OcrResultSchema.safeParse({ text: "", blocks: [], imageWidth: 50, imageHeight: 100 });
  check("§1j Zod rotation alanını taşır; yokluğu (eski servis) geçer; kesirli reddedilir",
    zr.success && zr.data.rotation === 90 && z0.success && z0.data.rotation === undefined
    && !OcrResultSchema.safeParse({ text: "", blocks: [], imageWidth: 1, imageHeight: 1, rotation: 1.5 }).success);
  __clearPlainHttpServiceHostsForTests();

  const keys = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.GELEN_BELGE_OUTLIER_FACTOR];
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sidecar = await startFakeSidecar();
  const rollsBefore = await prisma.roll.count();
  // E2: şablon satırları koşum boyunca değişir → önceki hâl birebir geri yüklenir, bu koşumun doğurduğu satır silinir.
  const tplPrior = await prisma.senderTemplate.findMany();
  const tplRestore: typeof tplPrior = [];
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
    const callAs = async (token: string, method: string, path: string, body?: unknown): Promise<Resp> => {
      const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; details?: { code?: string } };
      return { status: r.status, code: j.details?.code, data: j.data };
    };
    const parola = kosumaOzguParola();
    const mkUser = async (suffix: string, perms: string[]): Promise<string> => {
      const ps = await prisma.permission.findMany({ where: { code: { in: perms } }, select: { id: true } });
      const u = await prisma.user.create({
        data: { username: `${TAG}-${suffix}`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} ${suffix}`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } },
        select: { id: true, username: true },
      });
      made.users.push(u.id);
      return login(u.username, parola);
    };
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
    const note = (id: string) => prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id }, select: { noteNo: true, status: true, sourceKind: true, ownerText: true, senderDocNo: true, senderDocDate: true, customerBatchNo: true, processText: true, declaredTopCount: true, totalsDeclared: true, warnings: true, lines: { select: { lineNo: true, blockNo: true, processText: true, meters: true, weightKg: true, needsReview: true, confidence: true, sourceRects: true, senderRollNo: true }, orderBy: { lineNo: "asc" } } } });
    const n45 = await note(all[0]!.noteId!);
    const blocks = (n45.totalsDeclared as { blocks: Array<{ blockNo: number; count: string; kg: string; m: string }> }).blocks;
    check("§3c 0245: DRAFT/OCR, GB numarası, 21 satır, 2 blok", n45.status === "DRAFT" && n45.sourceKind === "OCR" && /^GB/.test(n45.noteNo) && n45.lines.length === 21 && new Set(n45.lines.map((l) => l.blockNo)).size === 2, `${n45.noteNo} ${n45.lines.length}`);
    check("§3d 0245: BLOK BAŞINA beyan 5/141,70/586 · 16/819,20/3.935", JSON.stringify(blocks.map((b) => [b.blockNo, b.count, b.kg, b.m])) === JSON.stringify([[1, "5", "141.7", "586"], [2, "16", "819.2", "3935"]]), JSON.stringify(blocks));
    const sumM = (b: number) => n45.lines.filter((l) => l.blockNo === b).reduce((a, l) => a + Math.round(Number(l.meters) * 1000), 0);
    check("§3e 0245: Σ satır = beyan (blok 1 586 m, blok 2 3935 m) · her satırda rect + güven", sumM(1) === 586000 && sumM(2) === 3935000 && n45.lines.every((l) => !!l.sourceRects && Number(l.confidence) > 0), JSON.stringify([n45.lines.filter((l) => l.blockNo === 1).reduce((a, l) => a + Number(l.meters), 0), n45.lines.filter((l) => l.blockNo === 2).reduce((a, l) => a + Number(l.meters), 0), n45.lines.map((l) => Number(l.confidence))]));
    check("§3f 0245: başlık fiş no, tarih, parti, işlem, '4 TOP' beyanı yalnız uyarı", n45.senderDocNo === "914279" && n45.senderDocDate?.toISOString().slice(0, 10) === "2026-10-19" && n45.customerBatchNo === "P9918733" && n45.processText === "KDK APRE" && n45.declaredTopCount === 4 && (n45.warnings as string[]).some((w) => w.startsWith("DECLARED_TOP_COUNT_DIFF")), JSON.stringify({ no: n45.senderDocNo, p: n45.customerBatchNo, w: n45.warnings }));
    const proc45 = [...new Set(n45.lines.map((l) => `${l.blockNo}:${l.processText}`))].sort();
    check("§3f2 0245: satır işlemi KENDİ bloğundan yazılır (blok 2 YUMUŞAK APRE; iş emri planı iki grubu ayırır) + BLOCK_IDS_DIFFER", JSON.stringify(proc45) === JSON.stringify(["1:KDK APRE", "2:YUMUŞAK APRE"]) && (n45.warnings as string[]).some((w) => w.startsWith("BLOCK_IDS_DIFFER")), JSON.stringify(proc45));
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

    // ── §3l–§3n okuma uyarıları kullanıcıya: detay + okuma özeti TEK helper (`noteNotices`) ─────────────
    type Notice = { code: string; title: string; detail: string };
    type DetLine = { lineNo: number; senderRollNo: string | null; problems: string[]; ocrRaw?: unknown };
    const det = async (id: string) => (await call("GET", `/api/gelen-belge/irsaliyeler/${id}`)).data as unknown as { notices: Notice[]; lines: DetLine[] };
    const oz = async (id: string) => (await call("GET", `/api/gelen-belge/irsaliyeler/${id}/okuma-ozeti`)).data as unknown as { notices: Notice[] };
    const n46id = all[1]!.noteId!;
    const d46 = await det(n46id);
    const trace = d46.notices.find((x) => x.code === "SECOND_DOCUMENT_TRACE");
    check("§3l ⭐ 0246: ikinci belge izi uyarısı (Ürün sevk fişi, Sevk No 96399, 'ayrı fotoğrafla yükleyin') detayda; satır yine yalnız 241 m",
      !!trace && /Ürün sevk fişi \(Sevk No 96399\)/.test(trace.detail) && /ayrı fotoğrafla yükleyin/.test(trace.detail) && trace.title === "Sayfada ikinci belge var" && n46.lines.length === 1, JSON.stringify(d46.notices));
    check("§3l2 okuma özeti notices ≡ detay notices (aynı helper)", JSON.stringify((await oz(n46id)).notices) === JSON.stringify(d46.notices));
    const n44id = all[2]!.noteId!;
    const d44 = await det(n44id);
    const db44 = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: n44id }, select: { senderRollNo: true, ocrRaw: true } });
    const marked = db44.filter((l) => typeof (l.ocrRaw as Record<string, unknown>)?._suspect === "string").map((l) => l.senderRollNo).sort();
    const tagged = d44.lines.filter((l) => l.problems.includes("SUSPECT_VALUE")).map((l) => l.senderRollNo).sort();
    check("§3m ⭐ 0244: şüpheli hücreler DB'de işaretli ve detayda SUSPECT_VALUE (1,4,8,10,42,44,60); ocrRaw yanıtta yok; uyarı şeridinde GRID_SUSPECT_VALUES",
      JSON.stringify(marked) === JSON.stringify(["1", "10", "4", "42", "44", "60", "8"]) && JSON.stringify(tagged) === JSON.stringify(marked)
        && d44.lines.every((l) => !("ocrRaw" in l)) && d44.notices.some((x) => x.code === "GRID_SUSPECT_VALUES") && d44.notices.some((x) => x.code === "TOTAL_UNVERIFIED"),
      JSON.stringify({ marked, tagged, codes: d44.notices.map((x) => x.code) }));
    const sus1 = d44.lines.find((l) => l.senderRollNo === "1")!;
    const line1 = await prisma.customerDeliveryNoteLine.findFirstOrThrow({ where: { noteId: n44id, senderRollNo: "1" }, select: { id: true } });
    await call("PATCH", `/api/gelen-belge/irsaliyeler/${n44id}/satirlar/${line1.id}`, { meters: 137 });
    const after = (await det(n44id)).lines.find((l) => l.senderRollNo === "1");
    check("§3m2 şüpheli satırın metresi düzeltilince SUSPECT_VALUE (ve NEEDS_REVIEW) düşer", sus1.problems.includes("SUSPECT_VALUE") && !!after && !after.problems.includes("SUSPECT_VALUE") && !after.problems.includes("NEEDS_REVIEW"), JSON.stringify(after?.problems));
    await ayar(SETTING_KEYS.GELEN_BELGE_OUTLIER_FACTOR, 20);
    const s44k = await up("0244", {}, "oran-20");
    await runReaderOnce();
    const k20 = (await scan(s44k)).noteId;
    if (k20) made.notes.push(k20);
    const sus20 = k20 ? (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: k20 }, select: { senderRollNo: true, ocrRaw: true } })).filter((l) => (l.ocrRaw as Record<string, unknown>)?._suspect).map((l) => l.senderRollNo).sort() : [];
    check("§3n oran ayarı okumaya uygulanır: K=20 → 42 (16 m, medyan 100'ün 1/20'si üstü) artık şüpheli değil; harfli/çok küçükler kalır",
      !!k20 && !sus20.includes("42") && sus20.includes("1") && sus20.length < marked.length, JSON.stringify(sus20));
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.GELEN_BELGE_OUTLIER_FACTOR } });

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
    check("§5a şema dışı gövde → KALICI: doğrudan READ_FAILED (deneme 1), taslak yok", z1.outcomes[0] === "READ_FAILED" && pz.status === "READ_FAILED" && pz.attempts === 1 && pz.noteId === null, `${pz.status}/${pz.attempts}`);
    fake.mode = "400";
    const s4x = await up("0244", {}, "dortyuz");
    const q1 = await runReaderOnce();
    const p4x = await scan(s4x);
    check("§5c 4xx → KALICI: doğrudan READ_FAILED (yeniden denenmez)", q1.outcomes[0] === "READ_FAILED" && p4x.status === "READ_FAILED" && p4x.attempts === 1, `${p4x.status}/${p4x.attempts}`);
    const okz = await call("POST", `/api/gelen-belge/taramalar/${sz}/oku`);
    check("§5d okut → PENDING", okz.status === 202 && okz.data?.status === "PENDING");
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
    await prisma.documentScan.update({ where: { id: s6b }, data: { updatedAt: new Date(Date.now() - 11 * 60 * 1000) } });
    const c6d = await claimNextScan();
    const p6d = await scan(s6b);
    check("§6d bayat READING (10 dk+) yeniden alınır: CLAIMED, deneme 2", c6d.kind === "CLAIMED" && c6d.id === s6b && p6d.status === "READING" && p6d.attempts === 2, `${c6d.kind}/${p6d.attempts}`);
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
    check("§7e 'sahip = gönderen' varsayımı YOK: senderCustomerId/ownerCustomerId OCR'dan DOLMAZ", (await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: all[0]!.noteId! }, select: { ownerCustomerId: true, senderCustomerId: true } }).then((n) => n.ownerCustomerId === null && n.senderCustomerId === null)));
    const es404 = await call("GET", "/api/gelen-belge/irsaliyeler/00000000-0000-4000-8000-000000000000/eslestirme");
    check("§7f /eslestirme: olmayan irsaliye → 404 DELIVERY_NOTE_NOT_FOUND (fail-closed)", es404.status === 404 && es404.code === "DELIVERY_NOTE_NOT_FOUND", `${es404.status} ${es404.code}`);

    // ── §8 bağlı taslak: operatör verisi ezilmez ───────────────────────────
    const cr = await call("POST", "/api/gelen-belge/irsaliyeler", { sourceKind: "MANUAL", senderDocNo: `${TAG}-ELLE`, lines: [{ senderRollNo: "EL-1", meters: 50 }] });
    const manualId = cr.data?.id as string;
    made.notes.push(manualId);
    const s8 = await up("0245", { noteId: manualId }, "bagli");
    await runReaderOnce();
    const n8 = await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: manualId }, select: { senderDocNo: true, ownerText: true, customerBatchNo: true, lines: { select: { meters: true } } } });
    check("§8a bağlı taslak: senderDocNo ve operatör satırı korunur; boş ownerText/parti OCR'dan dolar; tarama READ", n8.senderDocNo === `${TAG}-ELLE` && n8.lines.length === 1 && Number(n8.lines[0]!.meters) === 50 && n8.ownerText === "ÖRNEK TEKSTİL A" && n8.customerBatchNo === "P9918733" && (await scan(s8)).status === "READ", JSON.stringify(n8));
    // §8b bağlı taslak DRAFT değil (onay sürüyor): taslağa dokunulmaz, tarama READ'e kapanır (READING'de kalıp bayat döngüye girmez)
    const cr2 = await call("POST", "/api/gelen-belge/irsaliyeler", { sourceKind: "MANUAL", senderDocNo: `${TAG}-KILIT` });
    const lockedId = cr2.data?.id as string;
    made.notes.push(lockedId);
    const s8b = await up("0245", { noteId: lockedId }, "kilitli");
    await prisma.customerDeliveryNote.update({ where: { id: lockedId }, data: { status: "APPROVING" } });
    const r8b = await runReaderOnce();
    const n8b = await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: lockedId }, select: { ownerText: true, _count: { select: { lines: true } } } });
    const p8b = await scan(s8b);
    check("§8b bağlı taslak DRAFT değil → taslak değişmez, tarama READ (ocrResult zarfta), yeniden kuyruğa girmez", r8b.outcomes[0] === "READ" && p8b.status === "READ" && p8b.noteId === lockedId && n8b.ownerText === null && n8b._count.lines === 0 && (await runReaderOnce()).outcome === "BOS", `${r8b.outcomes[0]} ${p8b.status} ${JSON.stringify(n8b)}`);
    // §8c çok sayfalı tablet taslağı (D7): her sayfanın satırları EKLENİR (blok kaydırılır), uyarılar birikir
    const cr3 = await call("POST", "/api/gelen-belge/irsaliyeler", { sourceKind: "MANUAL", senderDocNo: `${TAG}-COKSAYFA` });
    const multiId = cr3.data?.id as string;
    made.notes.push(multiId);
    const page1 = await up("0245", { noteId: multiId, pageNo: 1 }, "sayfa1");
    const page2 = await up("0246", { noteId: multiId, pageNo: 2 }, "sayfa2");
    await runReaderOnce();
    const n8c = await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: multiId }, select: { warnings: true, totalsDeclared: true, lines: { select: { lineNo: true, blockNo: true } } } });
    const w8c = n8c.warnings as string[];
    const tb8c = ((n8c.totalsDeclared as { blocks?: { blockNo: number }[] } | null)?.blocks ?? []).map((b) => b.blockNo);
    check("§8c çok sayfalı taslak: 2 sayfanın satırları birlikte (21+1), satır no tekil, blok no çakışmaz, iki sayfanın uyarıları ve blok beyanları korunur",
      n8c.lines.length === 22 && new Set(n8c.lines.map((l) => l.lineNo)).size === 22 && new Set(n8c.lines.map((l) => l.blockNo)).size === 3
        && w8c.some((w) => w.startsWith("DECLARED_TOP_COUNT_DIFF")) && w8c.some((w) => w.startsWith("MULTI_REGION")) && tb8c.includes(1) && tb8c.includes(2) && new Set(tb8c).size === tb8c.length,
      JSON.stringify({ l: n8c.lines.length, b: [...new Set(n8c.lines.map((l) => l.blockNo))], w: w8c, tb: tb8c }));
    // §8d E4 satır kaynağı: her satır KENDİ sayfasının taramasını taşır (sayfa no taramadan okunur), elle satır null; detay yanıtı döner.
    const det8d = await call("GET", `/api/gelen-belge/irsaliyeler/${multiId}`);
    const l8d = ((det8d.data?.lines ?? []) as Array<{ lineNo: number; scanId: string | null }>).slice().sort((a, b) => a.lineNo - b.lineNo);
    const man8d = await call("GET", `/api/gelen-belge/irsaliyeler/${manualId}`);
    const manLines = (man8d.data?.lines ?? []) as Array<{ scanId?: string | null }>;
    check("§8d E4 satır scanId: 2 sayfalı belgede sayfa 1'in 21 satırı → sayfa 1 taraması, sayfa 2'nin satırı → sayfa 2 taraması; elle satır null (detay yanıtında)",
      det8d.status === 200 && l8d.length === 22 && l8d.slice(0, 21).every((l) => l.scanId === page1) && l8d[21]?.scanId === page2 && page1 !== page2
        && manLines.length === 1 && manLines[0]!.scanId === null,
      JSON.stringify({ p1: page1, p2: page2, ids: [...new Set(l8d.map((l) => l.scanId))], man: manLines.map((l) => l.scanId) }));

    // ── §8e–§8h üst üste binen çekim: aynı kâğıt iki parça çekilince ortak satır ikilenmez ──
    // §8e saf: aynı taramanın eşit iki satırı birbirini ELEMEZ; mevcut tek eşi yalnız BİR yeni satırı yutar; sıra no anahtar değildir.
    const dl = (topNo: string | null, m: string, kg: string | null, siraNo?: string) => ({ blockNo: 1, lineKind: "TOP" as const, senderRollNo: topNo ?? siraNo ?? null, meters: m, weightKg: kg, widthCm: null, itemText: null, colorText: null, processText: null, confidence: 1, needsReview: false, sourceRects: {}, ocrRaw: (topNo ? { topNo } : { siraNo: siraNo ?? null }) as Record<string, string | null> });
    const ex = (topNo: string, m: string, kg: string | null) => ({ senderRollNo: topNo, meters: m, weightKg: kg, ocrRaw: { topNo } });
    const o1 = dropOverlapDuplicates([dl("T1", "100", "20"), dl("T1", "100", "20")], [], 2);
    const o2 = dropOverlapDuplicates([dl("t 1", "100.00", "20.0"), dl("T1", "100", "20")], [ex("T1", "100", "20")], 2);
    const o3 = dropOverlapDuplicates([dl(null, "100", "20", "1")], [{ senderRollNo: "1", meters: "100", weightKg: "20", ocrRaw: { siraNo: "1" } }], 2);
    check("§8e saf: tek taramada eşit iki satır → ikisi yazılır · mevcut tek eş tek satırı yutar (normalize Top No + 100.00=100), ikincisi needsReview · sıra no anahtar değil",
      o1.lines.length === 2 && o1.warnings.length === 0
        && o2.lines.length === 1 && o2.lines[0]!.needsReview && o2.warnings.some((w) => w.startsWith("OVERLAP_DUPLICATE_SKIPPED: Sayfa 2: 1 satır")) && o2.warnings.some((w) => w.startsWith("OVERLAP_ROLL_NO_CONFLICT: Sayfa 2: 1 satır"))
        && o3.lines.length === 1 && !o3.lines[0]!.needsReview && o3.warnings.length === 0,
      JSON.stringify({ o1: o1.lines.length, o2: o2.lines.map((l) => l.needsReview), w2: o2.warnings, o3: o3.warnings }));
    // §8f iki tarama: sayfa 1'den yalnız ilk 3 satır kalır (2'si birebir, 3.'nün metresi değişik) → sayfa 2 (aynı içerik) 2 atlar, 1 needsReview, 18 yazar
    for (let i = 0; i < 6 && (await runReaderOnce()).outcome !== "BOS"; i++) { /* önceki §'lerin kuyruğu boşalsın */ }
    const cr8f = await call("POST", "/api/gelen-belge/irsaliyeler", { sourceKind: "MANUAL", senderDocNo: `${TAG}-USTUSTE` });
    const ovId = cr8f.data?.id as string;
    made.notes.push(ovId);
    const ov1 = await up("0245", { noteId: ovId, pageNo: 1 }, "ust1");
    await runReaderOnce();
    await prisma.customerDeliveryNoteLine.deleteMany({ where: { noteId: ovId, lineNo: { gt: 3 } } });
    const third = await prisma.customerDeliveryNoteLine.findFirstOrThrow({ where: { noteId: ovId, lineNo: 3 }, select: { id: true, senderRollNo: true, meters: true } });
    await prisma.customerDeliveryNoteLine.update({ where: { id: third.id }, data: { meters: third.meters.plus(1) } });
    const ov2 = await up("0245", { noteId: ovId, pageNo: 2 }, "ust2");
    await runReaderOnce();
    const n8f = await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: ovId }, select: { warnings: true, lines: { select: { scanId: true, senderRollNo: true, needsReview: true } } } });
    const p2 = n8f.lines.filter((l) => l.scanId === ov2);
    const w8f = n8f.warnings as string[];
    check("§8f üst üste binen çekim: birebir 2 satır sayfa 2'de ATLANIR + Türkçe uyarı; aynı Top No farklı metre → yazılır + needsReview + uyarı; kalan 18 satır yazılır",
      n8f.lines.length === 22 && n8f.lines.filter((l) => l.scanId === ov1).length === 3 && p2.length === 19
        && p2.filter((l) => l.needsReview).map((l) => l.senderRollNo).join() === third.senderRollNo && (await scan(ov2)).status === "READ"
        && w8f.includes("OVERLAP_DUPLICATE_SKIPPED: Sayfa 2: 2 satır başka sayfada zaten vardı (üst üste binen çekim) — atlandı")
        && w8f.some((w) => w.startsWith("OVERLAP_ROLL_NO_CONFLICT: Sayfa 2: 1 satır")),
      JSON.stringify({ n: n8f.lines.length, p2: p2.length, rev: p2.filter((l) => l.needsReview).map((l) => l.senderRollNo), w: w8f.filter((w) => w.startsWith("OVERLAP")) }));
    // §8g yarış: aynı taslağın iki sayfası PARALEL okunur — DRAFT claim'inin satır kilidi ikinciyi bekletir, ortak 21 satır TEK kez yazılır
    const cr8g = await call("POST", "/api/gelen-belge/irsaliyeler", { sourceKind: "MANUAL", senderDocNo: `${TAG}-YARIS` });
    const raceId = cr8g.data?.id as string;
    made.notes.push(raceId);
    await up("0245", { noteId: raceId, pageNo: 1 }, "yaris1");
    await up("0245", { noteId: raceId, pageNo: 2 }, "yaris2");
    const [k1, k2] = [await claimNextScan(), await claimNextScan()];
    fake.delayMs = 150;
    const outs = k1.kind === "CLAIMED" && k2.kind === "CLAIMED" ? await Promise.all([processClaimedScan(k1.id, sidecar.url), processClaimedScan(k2.id, sidecar.url)]) : [];
    fake.delayMs = 0;
    const n8g = await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: raceId }, select: { warnings: true, lines: { select: { scanId: true } } } });
    const perScan = [...new Set(n8g.lines.map((l) => l.scanId))];
    check("§8g paralel iki sayfa (aynı içerik) → 21 satır TEK taramadan, diğeri 21 satırı atlar (uyarı), ikisi de READ",
      outs.join() === "READ,READ" && n8g.lines.length === 21 && perScan.length === 1
        && (n8g.warnings as string[]).some((w) => /^OVERLAP_DUPLICATE_SKIPPED: Sayfa [12]: 21 satır/.test(w)),
      JSON.stringify({ outs, n: n8g.lines.length, scans: perScan.length, w: (n8g.warnings as string[]).filter((w) => w.startsWith("OVERLAP")) }));

    // ── §10 K6 PDF: arşiv — kuyruğa girmez, sidecar'a gitmez, okut 400 ───────
    fake.mode = "ok";
    for (let i = 0; i < 6 && (await runReaderOnce()).outcome !== "BOS"; i++) { /* önceki §'lerin kuyruğu boşalsın */ }
    const q10a = await call("GET", "/api/gelen-belge/okuma/durum");
    const pdfDoc = (salt: string) => Buffer.from(`%PDF-1.4\n% ${TAG} ${salt}\n%%EOF\n`, "latin1");
    const up10 = await call("POST", "/api/gelen-belge/taramalar", { contentBase64: pdfDoc("yeni").toString("base64") });
    const pdfNew = (up10.data?.scan as { id: string } | undefined)?.id ?? "";
    if (pdfNew) made.scans.push(pdfNew);
    const p10 = pdfNew ? await scan(pdfNew) : null;
    check("§10a PDF yükleme → 201, READ_FAILED, deneme 0 (kuyruğa girmez)", up10.status === 201 && p10?.status === "READ_FAILED" && p10.attempts === 0, `${up10.status} ${p10?.status}/${p10?.attempts}`);
    // D2 döneminde yüklenmiş (PENDING kalmış) PDF'i taklit et: savunma claim WHERE'inde ölçülür.
    const legacy = await call("POST", "/api/gelen-belge/taramalar", { contentBase64: pdfDoc("eski").toString("base64") });
    const pdfOld = (legacy.data?.scan as { id: string } | undefined)?.id ?? "";
    if (pdfOld) made.scans.push(pdfOld);
    await prisma.documentScan.update({ where: { id: pdfOld }, data: { status: "PENDING" } });
    const pdfHits0 = fake.pdfHits;
    const r10 = await runReaderOnce();
    const c10 = await claimNextScan();
    const o10 = await scan(pdfOld);
    check("§10b eski PENDING PDF claim EDİLMEZ (tur BOS, claimNextScan NONE, PENDING/deneme 0)", r10.outcome === "BOS" && c10.kind === "NONE" && o10.status === "PENDING" && o10.attempts === 0, `${r10.outcome} ${c10.kind} ${o10.status}/${o10.attempts}`);
    check("§10c sidecar'a 0 PDF isteği", fake.pdfHits === pdfHits0 && fake.pdfHits === 0, String(fake.pdfHits));
    const ok10a = await call("POST", `/api/gelen-belge/taramalar/${pdfNew}/oku`);
    const ok10b = await call("POST", `/api/gelen-belge/taramalar/${pdfOld}/oku`);
    check("§10d PDF okut → 400 DOCUMENT_SCAN_PDF_NOT_READABLE (READ_FAILED ve PENDING), durum değişmez", ok10a.status === 400 && ok10a.code === "DOCUMENT_SCAN_PDF_NOT_READABLE" && ok10b.status === 400 && ok10b.code === "DOCUMENT_SCAN_PDF_NOT_READABLE" && (await scan(pdfNew)).status === "READ_FAILED", `${ok10a.status} ${ok10a.code} · ${ok10b.status} ${ok10b.code}`);
    setReaderUrlForTests(null);
    const ok10c = await call("POST", `/api/gelen-belge/taramalar/${pdfNew}/oku`);
    setReaderUrlForTests(sidecar.url);
    check("§10e servis yokken de PDF okut → 400 (503'ten önce)", ok10c.status === 400 && ok10c.code === "DOCUMENT_SCAN_PDF_NOT_READABLE", `${ok10c.status} ${ok10c.code}`);
    const q10b = await call("GET", "/api/gelen-belge/okuma/durum");
    const qc = (d: Resp) => JSON.stringify([d.data?.pending, d.data?.reading, d.data?.failed]);
    check("§10f PDF kuyruk sayaçlarına girmez (pending/reading/failed aynı)", qc(q10a) === qc(q10b), `${qc(q10a)} → ${qc(q10b)}`);

    // ── §11 şablon bağı (E2): taslak → SenderTemplate (code) ───────────────
    const n45t = await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: all[0]!.noteId! }, select: { templateId: true, template: { select: { code: true, hitCount: true } } } });
    check("§11a 0245 → note.templateId dolu, şablon kodu ceki-listesi-a", !!n45t.templateId && n45t.template?.code === "ceki-listesi-a", JSON.stringify(n45t));
    const n43t = await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: all[3]!.noteId! }, select: { template: { select: { code: true } } } });
    check("§11b 0243 → kesim-takip-formu (her belge kendi şablonuna)", n43t.template?.code === "kesim-takip-formu", JSON.stringify(n43t));
    const s11 = await up("0245", {}, "ikinci-okuma");
    await runReaderOnce();
    const p11 = await scan(s11);
    if (p11.noteId) made.notes.push(p11.noteId);
    const n11 = p11.noteId ? await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: p11.noteId }, select: { templateId: true } }) : null;
    const hit11 = await prisma.senderTemplate.findUniqueOrThrow({ where: { code: "ceki-listesi-a" }, select: { hitCount: true } });
    check("§11c aynı şablonla ikinci okuma AYNI SenderTemplate satırı + isabet sayacı arttı", n11?.templateId === n45t.templateId && hit11.hitCount > (n45t.template?.hitCount ?? 0) && (await prisma.senderTemplate.count({ where: { code: "ceki-listesi-a" } })) === 1, `${n11?.templateId} hit ${n45t.template?.hitCount}→${hit11.hitCount}`);
    check("§11d GENEL yedek sözlük bağlanmaz (ensure → null, satır yok)", (await ensureSenderTemplate(FALLBACK_TEMPLATE_CODE)) === null && (await prisma.senderTemplate.count({ where: { code: FALLBACK_TEMPLATE_CODE } })) === 0);
    // §11e paralel: satırı olmayan kod için eşzamanlı dört ensure → TEK satır (P2002 → yeniden oku)
    const PAR = "urun-sevk-fisi";
    const parPrior = await prisma.senderTemplate.findUnique({ where: { code: PAR } });
    const parRefs = parPrior ? await prisma.customerDeliveryNote.count({ where: { templateId: parPrior.id } }) : 0;
    if (parPrior && parRefs > 0) {
      console.log(`⏭️  §11e atlandı — '${PAR}' satırı başka taslaklarca kullanılıyor (${parRefs}); ortam verisi silinmez`);
    } else {
      if (parPrior) { tplRestore.push(parPrior); await prisma.senderTemplate.delete({ where: { id: parPrior.id } }); }
      const par = await Promise.allSettled([1, 2, 3, 4].map(() => ensureSenderTemplate(PAR)));
      const ids = new Set(par.map((p) => (p.status === "fulfilled" ? p.value?.id : `HATA:${(p.reason as Error).message.slice(0, 60)}`)));
      check("§11e eşzamanlı 4 ensure → hepsi başarılı, TEK satır, aynı id", par.every((p) => p.status === "fulfilled") && ids.size === 1 && (await prisma.senderTemplate.count({ where: { code: PAR } })) === 1, JSON.stringify([...ids]));
    }

    // ── §12 eşleme: şablon önceliği ───────────────────────────────────────
    const mavi = (await prisma.customer.findFirstOrThrow({ where: { id: { in: made.customers }, name: "Mavi Boya Apre Ltd." }, select: { id: true } })).id;
    const pasifC = await mkC("Pasif Gönderen Örme");
    await prisma.customer.update({ where: { id: pasifC }, data: { isActive: false } });
    const n45id = all[0]!.noteId!;
    const t1 = await call("PATCH", "/api/gelen-belge/sablonlar/ceki-listesi-a", { senderCustomerId: gul, isActive: true });
    const g1 = await suggestForNote(n45id);
    check("§12a şablonun gönderen carisi → gönderen önerisi o cari, kaynak TEMPLATE", t1.status === 200 && g1.sender.suggested?.id === gul && g1.sender.source === "TEMPLATE", `${t1.status} ${t1.code} ${JSON.stringify(g1.sender)}`);
    await call("PATCH", "/api/gelen-belge/sablonlar/ceki-listesi-a", { defaultOwnerCustomerId: mavi });
    const g2 = await suggestForNote(n45id);
    check("§12b sahip metni eşleşiyorsa ('ÖRNEK TEKSTİL A') o kazanır, varsayılan sahip DEĞİL", g2.owner.suggested?.id === ornek && g2.owner.source !== "TEMPLATE", JSON.stringify(g2.owner.suggested));
    await prisma.customerDeliveryNote.update({ where: { id: n45id }, data: { ownerText: "ZZQX OKUNAMAYAN" } });
    const g3 = await suggestForNote(n45id);
    check("§12c sahip metni eşleşmeyince şablonun varsayılan sahibi önerilir (TEMPLATE)", g3.owner.suggested?.id === mavi && g3.owner.source === "TEMPLATE", JSON.stringify(g3.owner));
    await call("PATCH", "/api/gelen-belge/sablonlar/ceki-listesi-a", { isActive: false });
    const g4 = await suggestForNote(n45id);
    check("§12d PASİF şablon öneri vermez (gönderen de sahip de)", g4.sender.source !== "TEMPLATE" && g4.owner.source !== "TEMPLATE" && g4.sender.suggested?.id !== gul && g4.owner.suggested === null, JSON.stringify([g4.sender.source, g4.owner.source]));
    await prisma.customerDeliveryNote.update({ where: { id: n45id }, data: { ownerText: "ÖRNEK TEKSTİL A" } });

    // ── §13 yönetim uçları ────────────────────────────────────────────────
    const l13 = await call("GET", "/api/gelen-belge/sablonlar");
    const rows13 = (l13.data as unknown as Array<{ code: string; id: string | null; isActive: boolean; hitCount: number }>) ?? [];
    check("§13a liste: 5 motor şablonu (GENEL yok), DB'li satır isActive/hitCount taşır", l13.status === 200 && rows13.filter((r) => r.code !== FALLBACK_TEMPLATE_CODE).length >= 5 && !rows13.some((r) => r.code === FALLBACK_TEMPLATE_CODE) && rows13.some((r) => r.code === "ceki-listesi-a" && r.id && r.isActive === false && r.hitCount >= 2), JSON.stringify(rows13.map((r) => [r.code, !!r.id, r.isActive])));
    const tplId = (await prisma.senderTemplate.findUniqueOrThrow({ where: { code: "ceki-listesi-a" }, select: { id: true } })).id;
    const au0 = await prisma.systemLog.count({ where: { tableName: "SENDER_TEMPLATE", recordId: tplId, action: "UPDATE" } });
    const p13 = await call("PATCH", "/api/gelen-belge/sablonlar/ceki-listesi-a", { isActive: true });
    const au1 = await prisma.systemLog.count({ where: { tableName: "SENDER_TEMPLATE", recordId: tplId, action: "UPDATE" } });
    check("§13b güncelleme 200 + audit TAM 1 satır", p13.status === 200 && au1 - au0 === 1, `${p13.status} audit +${au1 - au0}`);
    const p13c = await call("PATCH", "/api/gelen-belge/sablonlar/ceki-listesi-a", { senderCustomerId: pasifC });
    check("§13c pasif cari → 400 SENDER_TEMPLATE_CUSTOMER_INACTIVE", p13c.status === 400 && p13c.code === "SENDER_TEMPLATE_CUSTOMER_INACTIVE", `${p13c.status} ${p13c.code}`);
    const p13d = await call("PATCH", `/api/gelen-belge/sablonlar/${FALLBACK_TEMPLATE_CODE}`, { isActive: false });
    const p13d2 = await call("PATCH", "/api/gelen-belge/sablonlar/yok-boyle-sablon", { isActive: false });
    check("§13d GENEL / bilinmeyen kod → 404 SENDER_TEMPLATE_NOT_FOUND", p13d.status === 404 && p13d.code === "SENDER_TEMPLATE_NOT_FOUND" && p13d2.status === 404, `${p13d.status} ${p13d2.status}`);
    const p13e = await call("PATCH", "/api/gelen-belge/sablonlar/ceki-listesi-a", {});
    check("§13e boş gövde → 400", p13e.status === 400, String(p13e.status));
    const readerTk = await mkUser("okur", ["gelen-belge:read", "gelen-belge:write"]);
    const f1 = await callAs(readerTk, "GET", "/api/gelen-belge/sablonlar");
    const f2 = await callAs(readerTk, "PATCH", "/api/gelen-belge/sablonlar/ceki-listesi-a", { isActive: false });
    check("§13f gelen-belge:template izni yok → liste 403, güncelleme 403", f1.status === 403 && f2.status === 403, `${f1.status} ${f2.status}`);
    await ayar(SETTING_KEYS.GELEN_BELGE_ENABLED, false);
    const m1 = await call("GET", "/api/gelen-belge/sablonlar");
    const m2 = await call("PATCH", "/api/gelen-belge/sablonlar/ceki-listesi-a", { isActive: false });
    await ayar(SETTING_KEYS.GELEN_BELGE_ENABLED, true);
    check("§13g modül kapalı → 403 MODULE_DISABLED (liste + güncelleme)", m1.status === 403 && m1.code === "MODULE_DISABLED" && m2.status === 403 && m2.code === "MODULE_DISABLED", `${m1.status} ${m1.code} ${m2.status}`);
    const before13h = await prisma.senderTemplate.count();
    const l13h = await call("GET", "/api/gelen-belge/sablonlar");
    check("§13h GET gizli yazım yapmaz (satır sayısı değişmedi)", l13h.status === 200 && (await prisma.senderTemplate.count()) === before13h);

    // ── §14 tablet okuma özeti (`/irsaliyeler/:id/okuma-ozeti`, `gelen-belge:write`) ─────────────
    type Ozet = { noteNo: string; state: string; reason: string | null; pages: { total: number; waiting: number; read: number; failed: number }; lineCount: number; reviewCount: number; totals: { declared: boolean; ok: boolean | null; mismatches: string[] }; warnings: string[] };
    const tabletTk = await mkUser("tablet", ["gelen-belge:write"]);
    const ozet = async (id: string, token = tabletTk) => {
      const r = await callAs(token, "GET", `/api/gelen-belge/irsaliyeler/${id}/okuma-ozeti`);
      return { status: r.status, code: r.code, o: r.data as unknown as Ozet };
    };
    const tabletNote = async (suffix: string): Promise<string> => {
      const r = await callAs(tabletTk, "POST", "/api/gelen-belge/irsaliyeler", { sourceKind: "MANUAL", senderDocNo: `${TAG}-${suffix}` });
      made.notes.push(r.data?.id as string);
      return r.data?.id as string;
    };
    fake.mode = "ok";
    const n14 = await tabletNote("OZ1");
    const e14 = await ozet(n14);
    check("§14a sayfasız taslak → NO_PAGES + Türkçe neden; tablet izniyle 200", e14.status === 200 && e14.o.state === "NO_PAGES" && /fotoğraf/.test(e14.o.reason ?? "") && e14.o.lineCount === 0, JSON.stringify(e14));
    await up("0245", { noteId: n14 }, "ozet");
    setReaderUrlForTests(null);
    const ns14 = await ozet(n14);
    setReaderUrlForTests(sidecar.url);
    check("§14b bekleyen sayfa + servis adresi yok → NO_SERVICE (sonsuz 'okunuyor' yok)", ns14.o.state === "NO_SERVICE" && /okuma servisi yok/.test(ns14.o.reason ?? "") && ns14.o.pages.waiting === 1, JSON.stringify(ns14.o));
    const rd14 = await ozet(n14);
    check("§14c bekleyen sayfa + servis var → READING, neden yok", rd14.o.state === "READING" && rd14.o.reason === null && rd14.o.pages.total === 1, JSON.stringify(rd14.o));
    await runReaderOnce();
    const ok14 = await ozet(n14);
    const dbLines = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: n14 }, select: { needsReview: true } });
    check("§14d okundu → READ: satır 21, gözden geçirme = DB needsReview sayısı, 2 blok beyanı TUTUYOR, no GB", ok14.o.state === "READ" && ok14.o.reason === null && ok14.o.lineCount === 21 && ok14.o.reviewCount === dbLines.filter((l) => l.needsReview).length && ok14.o.totals.declared && ok14.o.totals.ok === true && ok14.o.totals.mismatches.length === 0 && /^GB/.test(ok14.o.noteNo) && ok14.o.pages.read === 1, JSON.stringify(ok14.o));
    // Toplam kapısı onayınkiyle aynı helper: bir satırın metresi bozulunca "tutmuyor" + onay kapısının metni.
    const firstLine = await prisma.customerDeliveryNoteLine.findFirstOrThrow({ where: { noteId: n14 }, orderBy: { lineNo: "asc" }, select: { id: true, meters: true } });
    await prisma.customerDeliveryNoteLine.update({ where: { id: firstLine.id }, data: { meters: firstLine.meters.plus(100) } });
    const mm14 = await ozet(n14);
    check("§14e satır toplamı beyandan saptı → totals.ok false + blok mesajı (onay `totalMismatches` metni)", mm14.o.totals.ok === false && mm14.o.totals.mismatches.some((m) => /^Blok 1: beyan .* m, satır toplamı/.test(m)), JSON.stringify(mm14.o.totals));
    fake.mode = "400";
    const n14f = await tabletNote("OZ2");
    await up("0243", { noteId: n14f }, "ozet-f");
    await runReaderOnce();
    const f14 = await ozet(n14f);
    check("§14f tek sayfa kalıcı okunamadı → FAILED + Türkçe neden", f14.o.state === "FAILED" && /okuyamadı/.test(f14.o.reason ?? "") && f14.o.pages.failed === 1, JSON.stringify(f14.o));
    fake.mode = "ok";
    await up("0243", { noteId: n14f, pageNo: 2 }, "ozet-f2");
    await runReaderOnce();
    const p14 = await ozet(n14f);
    check("§14g bir sayfa okundu bir sayfa düştü → PARTIAL ('1 sayfa okunamadı')", p14.o.state === "PARTIAL" && /^1 sayfa okunamadı/.test(p14.o.reason ?? "") && p14.o.pages.read === 1 && p14.o.pages.failed === 1, JSON.stringify(p14.o));
    fake.mode = "500";
    const n14r = await tabletNote("OZ3");
    await up("0244", { noteId: n14r }, "ozet-r");
    await runReaderOnce();
    const r14 = await ozet(n14r);
    check("§14h 5xx sonrası bekleyen sayfa → READING + 'yeniden deneniyor (deneme 2/3)'", r14.o.state === "READING" && /yeniden deneniyor \(deneme 2\/3\)/.test(r14.o.reason ?? ""), JSON.stringify(r14.o));
    fake.mode = "ok";
    await runReaderOnce();
    const okurTk = await mkUser("ozet-okur", ["gelen-belge:read"]);
    const d14 = await ozet(n14, okurTk);
    const nf14 = await ozet("00000000-0000-4000-8000-000000000000");
    const bad14 = await ozet("abc");
    check("§14i izin `gelen-belge:write` (yalnız read → 403) · yok id → 404 DELIVERY_NOTE_NOT_FOUND · bozuk id → 400", d14.status === 403 && nf14.status === 404 && nf14.code === "DELIVERY_NOTE_NOT_FOUND" && bad14.status === 400, `${d14.status} ${nf14.status} ${nf14.code} ${bad14.status}`);

    // ── §9 İSTEĞE BAĞLI: gerçek okuma servisi (okuma/) ─────────────────────
    const gercek = process.env.OKUMA_GERCEK_URL?.trim();
    if (!gercek) {
      console.log("⏭️  §9 atlandı — OKUMA_GERCEK_URL yok (gerçek servis koşumu isteğe bağlı)");
    } else {
      setReaderUrlForTests(gercek);
      __resetDocumentReaderForTests();
      const d9 = await call("GET", "/api/gelen-belge/okuma/durum");
      check("§9a gerçek servis sağlığı → 'var' + motor rapidocr-onnx", d9.data?.service === "var" && d9.data?.engine === "rapidocr-onnx", JSON.stringify(d9.data));
      // Sentetik (anonim) PNG; IEND sonrası etiket baytı sha256'yı koşuma özgü yapar (çözücü yok sayar).
      const png = Buffer.concat([readFileSync(join(__dirname, "..", "..", "okuma", "tests", "fikstur", "sentetik.png")), Buffer.from(TAG)]);
      const r9 = await call("POST", "/api/gelen-belge/taramalar", { contentBase64: png.toString("base64") });
      const s9 = (r9.data?.scan as { id: string } | undefined)?.id ?? "";
      if (s9) made.scans.push(s9);
      const o9 = await runReaderOnce();
      const p9 = await scan(s9);
      if (p9.noteId) made.notes.push(p9.noteId);
      check("§9b sentetik PNG → READ (Zod geçti), motor rapidocr-onnx, taslak doğdu", o9.outcomes[0] === "READ" && p9.status === "READ" && p9.ocrEngine === "rapidocr-onnx" && !!p9.noteId, `${o9.outcomes[0]} ${p9.status} ${p9.ocrEngine}`);
      check("§9c okunan metin taramada (4711-2026)", JSON.stringify(p9.ocrResult ?? "").includes("4711-2026"));
      const b9 = await up("0245", {}, "gercek-bozuk");
      const q9 = await runReaderOnce();
      const pb9 = await scan(b9);
      check("§9d bozuk JPEG → gerçek servis 400 → KALICI READ_FAILED", q9.outcomes[0] === "READ_FAILED" && pb9.status === "READ_FAILED" && pb9.attempts === 1, `${q9.outcomes[0]} ${pb9.status}`);
      check("§9e roll sayısı değişmedi (OCR deftere yazmaz)", (await prisma.roll.count()) === rollsBefore);
    }
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
    const priorCodes = new Set(tplPrior.map((t) => t.code));
    for (const t of tplPrior) {
      const data = { isActive: t.isActive, senderCustomerId: t.senderCustomerId, defaultOwnerCustomerId: t.defaultOwnerCustomerId, hitCount: t.hitCount };
      await prisma.senderTemplate.updateMany({ where: { id: t.id }, data });
    }
    const born = await prisma.senderTemplate.findMany({ where: { code: { notIn: [...priorCodes, "__yok__"] } }, select: { id: true } });
    for (const b of born) await prisma.senderTemplate.delete({ where: { id: b.id } }).catch(() => undefined);
    for (const t of tplRestore) {
      await prisma.senderTemplate.deleteMany({ where: { code: t.code, id: { not: t.id } } }).catch(() => undefined);
      await prisma.senderTemplate.create({ data: { id: t.id, code: t.code, version: t.version, template: t.template as object, isActive: t.isActive, senderCustomerId: t.senderCustomerId, defaultOwnerCustomerId: t.defaultOwnerCustomerId, hitCount: t.hitCount } }).catch(() => undefined);
    }
    await prisma.customer.deleteMany({ where: { id: { in: made.customers } } });
    await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => undefined);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) process.exitCode = 1;
}

if (!engel) {
  main()
    .catch((e) => { console.error("❌ beklenmeyen hata:", e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
