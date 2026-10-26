// =============================================================================
// BEKÇİ — İSTEK BAŞLIĞI (`request_traces`) + `X-Request-Id` — izlenebilirlik B1
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts request_trace
//
// NEDEN: kullanıcı "kim hangi uca ne attı" sorusunu cevaplayamıyordu. Satır yalnız koşullu yazılır
//   (yazan yöntem ∧ (audit'li ∨ reddedilmiş)) ∨ (GET ∧ 403); GÖVDE/sorgu/başlık değeri ASLA saklanmaz
//   (PIN/parola/ayar şifresi). Tablo TELEMETRİDİR; tek yazar/okuyucu `request-trace.service.ts`.
//
// NE ÖLÇER
//   STATİK (asıl güvence, DB/HTTP'siz):
//   §1 şema: RequestTrace kolon kümesi BİREBİR beyanlı; gövde/sorgu/başlık/parola adlı kolon yok
//   §2 AST: `requestTrace` delegesi ve `request_traces` ham SQL'i yalnız request-trace.service.ts'te
//   §3 uç kalıbı: middleware `normalizeKeyPath` + `mountPrefix` kullanır (latency ile aynı normalleştirme)
//   §4 dışlama listesi: her satır gerçek route'a bakar (ölü yol yok) + eşleştirici doğru
//   §5 koşul tablosu: shouldRecordTrace / isTraceCandidate saf işlev davranışı
//   HTTP (gerçek app, gerçek DB):
//   §6 GET 200 → satır yok · GET 401 → yok · GET 403 → var · audit'siz 400 POST → var
//   §7 ⭐ çok satırlı kaydet (toplu etiket, 3 top) → TEK trace, auditCount = 3 = audit(requestId) sayısı
//   §8 ⭐ `X-Request-Id` = audit `requestId`; 409 → status 409 + errorCode
//   §9 ⭐ gövdedeki parola hiçbir kolonda yok; routeKey'de UUID yok (eşleşmeyen uç dahil)
//   §10 dışlama uygulanır (announce 4xx → satır yok)
//   §11 kova taşması `dusen` sayacına düşer
//   §12 budama yalnız yaş (genç satır kalır; 0 = budama yok)
//
// NEGATİF SONDALAR (2026-10-24, ölçüldü; md5 ile geri yüklendi):
//   (a) `isTraceCandidate` + `shouldRecordTrace` hep true: §5a + §5b + §6b + §6c = 4 KIRMIZI (GET 200 satır doğar)
//   (b) şemaya `body String?` kolonu: §1b + §1c = 2 KIRMIZI
//   (c) middleware'de `normalizeKeyPath(raw)` → `raw`: §3b + §9c = 2 KIRMIZI (eşleşmeyen uçta UUID sızar)
// =============================================================================
import type { Server } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import ts from "typescript";
import * as bcrypt from "bcryptjs";
import { RollEntrySource, RollStatus } from "@prisma/client";
import app from "../src/app";
import prisma from "../src/lib/prisma";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import {
  flushRequestTraces,
  getRequestTraceHealth,
  isTraceCandidate,
  pruneRequestTraces,
  setRequestTraceBucketForTest,
  shouldRecordTrace,
} from "../src/services/request-trace.service";
import { REQUEST_TRACE_EXCLUSIONS, isRequestTraceExcluded } from "../src/constants/request-trace-haric";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const TAG = `TEST-RT${Date.now().toString(36).slice(-5).toUpperCase()}`;
const olusan = { rollIds: [] as string[], userIds: [] as string[], itemId: null as string | null, traceIds: [] as string[] };

// ─── §1 şema ────────────────────────────────────────────────────────────────
const BEYANLI_KOLONLAR = [
  "id", "userId", "deviceRefId", "deviceLocalId", "clientType", "appVersion", "ip", "method", "routeKey",
  "status", "durationMs", "errorCode", "auditCount", "createdAt", "updatedAt", "device",
];
function section1(): void {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
  const m = schema.match(/^model RequestTrace \{([\s\S]*?)^\}/m);
  check("§1a RequestTrace modeli şemada", !!m);
  const fields = (m?.[1] ?? "").split("\n").map((l) => l.trim()).filter((l) => /^[a-zA-Z]/.test(l)).map((l) => l.split(/\s+/)[0]!);
  const fazla = fields.filter((f) => !BEYANLI_KOLONLAR.includes(f));
  const eksik = BEYANLI_KOLONLAR.filter((f) => !fields.includes(f));
  check("§1b ⭐ kolon kümesi BİREBİR beyanlı (yeni kolon = bu bekçide bilinçli karar)", fazla.length === 0 && eksik.length === 0, `fazla=[${fazla}] eksik=[${eksik}]`);
  const yasak = fields.filter((f) => /body|g[oö]vde|query|sorgu|header|ba[sş]l[iı]k|payload|param|password|parola|pin|secret|token/i.test(f));
  check("§1c ⭐ gövde/sorgu/başlık/parola adlı kolon YOK", yasak.length === 0, yasak.join(","));
  check("§1d id'de @default YOK (kimlik = ALS requestId)", /^\s*id\s+String\s+@id\s+@db\.Uuid\s*$/m.test(m?.[1] ?? ""));
}

// ─── §2 AST ─────────────────────────────────────────────────────────────────
const OWNER = path.join("services", "request-trace.service.ts");
const DELEGATE_METHODS = new Set([
  "create", "createMany", "createManyAndReturn", "findMany", "findFirst", "findFirstOrThrow", "findUnique",
  "findUniqueOrThrow", "update", "updateMany", "upsert", "delete", "deleteMany", "count", "groupBy", "aggregate",
]);
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}
export function findTraceAccess(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const at = (n: ts.Node) => `${path.relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === "requestTrace" && ts.isPropertyAccessExpression(node.parent)
      && DELEGATE_METHODS.has(node.parent.name.text)) hits.push(`${at(node)} .requestTrace.${node.parent.name.text}`);
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
      && /\brequest_traces\b/.test(node.text)) hits.push(`${at(node)} "request_traces"`);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}
function section2(): void {
  const offenders: string[] = [];
  let ownerHits = 0;
  for (const f of walk(SRC)) {
    const hits = findTraceAccess(f, readFileSync(f, "utf8"));
    if (path.relative(SRC, f) === OWNER) ownerHits += hits.length;
    else offenders.push(...hits);
  }
  check("§2a sahip dosya delegeyi gerçekten kullanıyor (tarayıcı kör değil)", ownerHits >= 5, `isabet=${ownerHits}`);
  check("§2b ⭐ requestTrace delegesi / request_traces ham SQL'i yalnız request-trace.service.ts'te", offenders.length === 0, offenders.join(" · "));
  const probe = findTraceAccess("probe.ts", "async function x(){ await prisma.requestTrace.count({}); await db.$queryRawUnsafe('SELECT 1 FROM request_traces'); const a = ctx.requestTrace; }");
  check("§2c tarayıcı sondası: delege + ham SQL yakalanır, düz alan erişimi yakalanmaz", probe.length === 2, probe.join(" · "));
}

// ─── §3 uç kalıbı ───────────────────────────────────────────────────────────
function section3(): void {
  const mw = readFileSync(path.join(SRC, "middlewares/request-trace.middleware.ts"), "utf8");
  const lat = readFileSync(path.join(SRC, "middlewares/latency.middleware.ts"), "utf8");
  check("§3a latency `normalizeKeyPath` dışa açık", /export function normalizeKeyPath\(/.test(lat));
  check("§3b ⭐ middleware routeKey'i `normalizeKeyPath(` ile kurar", /normalizeKeyPath\(raw\)/.test(mw) && /from "\.\/latency\.middleware"/.test(mw));
  check("§3c middleware `mountPrefix(` kullanır (hata zincirinde önek korunur)", /mountPrefix\(req,/.test(mw));
  const appTs = readFileSync(path.join(SRC, "app.ts"), "utf8");
  const ctxAt = appTs.indexOf("runWithRequestContext(req, next)");
  const mwAt = appTs.indexOf("app.use(requestTraceMiddleware)");
  check("§3d middleware istek bağlamından HEMEN sonra bağlı", ctxAt > 0 && mwAt > ctxAt && appTs.slice(ctxAt, mwAt).split("\n").filter((l) => l.trim().startsWith("app.")).length === 0, `ctx@${ctxAt} mw@${mwAt}`);
  check("§3e CORS exposedHeaders `X-Request-Id` içerir", /exposedHeaders:\s*\[[^\]]*"X-Request-Id"/.test(appTs));
}

// ─── §4 dışlama listesi ─────────────────────────────────────────────────────
function section4(): void {
  const appTs = readFileSync(path.join(SRC, "app.ts"), "utf8");
  const olu: string[] = [];
  for (const h of REQUEST_TRACE_EXCLUSIONS) {
    const src = readFileSync(path.join(SRC, h.file), "utf8");
    if (!src.includes(h.pattern)) olu.push(`${h.routeKey} (kalıp yok: ${h.pattern})`);
    if (h.routeKey.startsWith("/api/")) {
      const prefix = h.routeKey.slice(0, h.routeKey.lastIndexOf("/"));
      if (!appTs.includes(`app.use("${prefix}"`)) olu.push(`${h.routeKey} (mount yok: ${prefix})`);
    }
    if (!h.reason || h.reason.length < 10) olu.push(`${h.routeKey} (gerekçe yok)`);
  }
  check("§4a ⭐ dışlama listesinde ölü yol yok, her satır gerekçeli", olu.length === 0 && REQUEST_TRACE_EXCLUSIONS.length >= 4, olu.join(" · "));
  check("§4b eşleştirici: önekli /health/yerel dışlanır, /healthz dışlanmaz", isRequestTraceExcluded("GET", "/health/yerel") && !isRequestTraceExcluded("GET", "/healthz"));
  check("§4c eşleştirici yöntem duyarlı (GET announce dışlanmaz)", isRequestTraceExcluded("POST", "/api/devices/announce") && !isRequestTraceExcluded("GET", "/api/devices/announce"));
}

// ─── §5 koşul tablosu ───────────────────────────────────────────────────────
function section5(): void {
  const T: Array<[string, number, number, boolean]> = [
    ["GET", 200, 0, false], ["GET", 401, 0, false], ["GET", 404, 0, false], ["GET", 403, 0, true],
    ["POST", 200, 0, false], ["POST", 201, 2, true], ["POST", 400, 0, true], ["PATCH", 409, 0, true],
    ["DELETE", 200, 1, true], ["PUT", 204, 0, false], ["OPTIONS", 403, 0, false],
  ];
  const yanlis = T.filter(([m, s, a, w]) => (shouldRecordTrace(m, s, a) && isTraceCandidate(m, s)) !== w).map(([m, s, a]) => `${m} ${s} a=${a}`);
  check("§5a ⭐ yazım koşulu tablosu", yanlis.length === 0, yanlis.join(" · "));
  check("§5b GET 200 kuyruğa bile girmez (aday değil)", !isTraceCandidate("GET", 200));
}

type Resp = { status: number; requestId: string | null; body: { data?: Record<string, unknown>; details?: Record<string, unknown>; message?: string } & Record<string, unknown> };

async function main() {
  section1();
  section2();
  section3();
  section4();
  section5();

  const server: Server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, p: string, token: string, body?: unknown): Promise<Resp> => {
    const r = await fetch(`${base}${p}`, {
      method,
      headers: { "Content-Type": "application/json", "X-Client-Kind": "electron", "X-Client-Version": "9.9.9", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const requestId = r.headers.get("x-request-id");
    if (requestId) olusan.traceIds.push(requestId);
    return { status: r.status, requestId, body: (await r.json().catch(() => ({}))) as Resp["body"] };
  };
  const login = async (username: string, password: string) =>
    String((await call("POST", "/api/auth/login", "", { username, password, clientType: "electron" })).body.data?.token ?? "");
  // Bekçi okuması: sahiplik kuralı src/ içindir; bekçi satırı doğrudan okur. Kuyruk ~1 sn'de boşalır.
  const traceOf = async (id: string | null) => {
    if (!id) return null;
    for (let i = 0; i < 25; i++) {
      await flushRequestTraces();
      const t = await prisma.requestTrace.findUnique({ where: { id } });
      if (t) return t;
      await new Promise((r) => setTimeout(r, 80));
    }
    return null;
  };
  const yokMu = async (id: string | null) => {
    await new Promise((r) => setTimeout(r, 200));
    await flushRequestTraces();
    return id != null && (await prisma.requestTrace.count({ where: { id } })) === 0;
  };

  try {
    setRequestTraceBucketForTest(50, 200);
    const admin = await ensureTestAdmin();
    const adminToken = await login(admin.username, admin.password);
    check("admin login", adminToken.length > 20);

    const parola = kosumaOzguParola();
    const labelPrint = await prisma.permission.findFirstOrThrow({ where: { code: "label:print" }, select: { id: true } });
    const dar = await prisma.user.create({
      data: {
        username: `${TAG}-dar`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} Dar`, isActive: true,
        permissions: { create: { permissionId: labelPrint.id, grantedById: admin.id } },
      },
      select: { id: true, username: true },
    });
    olusan.userIds.push(dar.id);
    const darToken = await login(dar.username, parola);
    check("dar kullanıcı login", darToken.length > 20);

    // §6 — koşullu yazım
    const g200 = await call("GET", "/api/print-jobs?limit=1", adminToken);
    check("§6a yanıtta X-Request-Id (UUID)", !!g200.requestId && UUID_RE.test(g200.requestId), String(g200.requestId));
    check("§6b ⭐ GET 200 → satır YOK", g200.status === 200 && (await yokMu(g200.requestId)), `status=${g200.status}`);
    const g401 = await call("GET", "/api/print-jobs", "");
    check("§6c GET 401 (oturum düşmesi) → satır YOK", g401.status === 401 && (await yokMu(g401.requestId)), `status=${g401.status}`);
    const g403 = await call("GET", `/api/print-jobs/${randomUUID()}`, darToken);
    const t403 = await traceOf(g403.requestId);
    check("§6d ⭐ GET 403 → satır VAR (kullanıcı + sürüm künyesiyle)", g403.status === 403 && t403?.status === 403 && t403.userId === dar.id && t403.appVersion === "9.9.9" && t403.clientType === "electron", `status=${g403.status} trace=${JSON.stringify(t403 && { u: t403.userId, v: t403.appVersion, k: t403.clientType })}`);
    check("§6e 403 routeKey kalıp, UUID yok", t403?.routeKey === "/api/print-jobs/:id", String(t403?.routeKey));
    const p400 = await call("POST", "/api/print-jobs", darToken, { subjectKind: "ETIKET_TOP", status: "ILETILDI" });
    const t400 = await traceOf(p400.requestId);
    check("§6f ⭐ audit'siz 400 POST → satır VAR, auditCount 0", p400.status === 400 && t400?.status === 400 && t400.auditCount === 0, `status=${p400.status}`);

    // §7 — çok satırlı kaydet: toplu etiket (3 top → 3 audit)
    const item = await prisma.item.create({ data: { code: `${TAG}-ITM`, name: `${TAG} KUMAS`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
    olusan.itemId = item.id;
    for (let i = 0; i < 3; i++) {
      const r = await prisma.roll.create({
        data: { barcode: `${TAG}-${i + 1}`, itemId: item.id, width: 150, initialQty: 100, currentQty: 100, status: RollStatus.WAREHOUSE, entrySource: RollEntrySource.SUPPLIER_RECEIPT },
        select: { id: true },
      });
      olusan.rollIds.push(r.id);
    }
    const bulk = await call("POST", "/api/labels/rolls/bulk-print-event", adminToken, { rollIds: olusan.rollIds });
    const t7 = await traceOf(bulk.requestId);
    await new Promise((r) => setTimeout(r, 150));
    const audit7 = await prisma.systemLog.count({ where: { requestId: bulk.requestId ?? undefined } });
    const etiket7 = await prisma.systemLog.count({ where: { requestId: bulk.requestId ?? undefined, tableName: "LABEL_PRINT_EVENT" } });
    check("§7a toplu uç 200", bulk.status === 200, `status=${bulk.status} ${bulk.body.message ?? ""}`);
    check("§7b ⭐ TEK trace + N audit; auditCount = audit(requestId) sayısı ≥ 3", !!t7 && etiket7 === 3 && t7.auditCount === audit7 && audit7 >= 3, `auditCount=${t7?.auditCount} audit=${audit7} etiket=${etiket7}`);
    check("§7c trace routeKey + yöntem + süre", t7?.routeKey === "/api/labels/rolls/bulk-print-event" && t7.method === "POST" && t7.durationMs >= 0, String(t7?.routeKey));

    // §8 — X-Request-Id = audit requestId; 409 errorCode
    const zincir = await prisma.systemLog.findMany({ where: { requestId: bulk.requestId ?? undefined }, select: { requestId: true } });
    check("§8a ⭐ X-Request-Id = o isteğin audit requestId'si", zincir.length > 0 && zincir.every((z) => z.requestId === bulk.requestId));
    const tok = randomUUID();
    const rep = { clientToken: tok, subjectKind: "ETIKET_TOP", status: "ILETILDI", subjectTable: "rolls", subjectId: olusan.rollIds[0], printerName: `${TAG}-Y` };
    await call("POST", "/api/print-jobs", darToken, rep);
    const c409 = await call("POST", "/api/print-jobs", darToken, { ...rep, status: "HATA", errorCode: "KAGIT_YOK" });
    const t409 = await traceOf(c409.requestId);
    check("§8b ⭐ 409 → trace status 409 + errorCode = details.code", c409.status === 409 && t409?.status === 409 && !!t409.errorCode && t409.errorCode === c409.body.details?.code, `status=${c409.status} code=${t409?.errorCode}`);

    // §9 — gövde yok; UUID yok
    const gizli = `Gizli-${randomUUID().slice(0, 8)}-Parola`;
    const bad = await call("POST", "/api/auth/login", "", { username: `${TAG}-yok`, password: gizli, clientType: "electron" });
    const tBad = await traceOf(bad.requestId);
    const satirMetni = bad.requestId
      ? (await prisma.$queryRawUnsafe<Array<{ t: string }>>(`SELECT row_to_json(r)::text AS t FROM request_traces r WHERE id = $1::uuid`, bad.requestId))[0]?.t ?? ""
      : "";
    check("§9a hatalı giriş (POST 4xx) iz bırakır", bad.status >= 400 && !!tBad, `status=${bad.status}`);
    check("§9b ⭐ gövdedeki parola/kullanıcı adı satırın HİÇBİR kolonunda yok", satirMetni.length > 0 && !satirMetni.includes(gizli) && !satirMetni.includes(`${TAG}-yok`), satirMetni.slice(0, 160));
    const u404 = await call("POST", `/api/print-jobs/${randomUUID()}/uydurma?x=${gizli}`, adminToken, { password: gizli });
    const t404 = await traceOf(u404.requestId);
    check("§9c ⭐ eşleşmeyen uçta da routeKey'de UUID/sorgu yok", !!t404 && !UUID_RE.test(t404.routeKey) && !t404.routeKey.includes("?") && !t404.routeKey.includes(gizli), String(t404?.routeKey));
    const tumu = await prisma.$queryRawUnsafe<Array<{ t: string }>>(`SELECT row_to_json(r)::text AS t FROM request_traces r WHERE id = ANY($1::uuid[])`, olusan.traceIds);
    check("§9d bu koşumun hiçbir satırında parola yok", tumu.length >= 5 && tumu.every((r) => !r.t.includes(gizli)), `satır=${tumu.length}`);

    // §10 — dışlama
    const ann = await call("POST", "/api/devices/announce", "", { bozuk: true });
    check("§10a ⭐ dışlanan uç (announce) reddedilse de satır YOK", ann.status >= 400 && (await yokMu(ann.requestId)), `status=${ann.status}`);

    // §11 — kova taşması
    setRequestTraceBucketForTest(0, 1);
    const once = getRequestTraceHealth().dusen;
    const k1 = await call("GET", `/api/print-jobs/${randomUUID()}`, darToken);
    const k2 = await call("GET", `/api/print-jobs/${randomUUID()}`, darToken);
    await new Promise((r) => setTimeout(r, 150));
    await flushRequestTraces();
    const yazildi = await prisma.requestTrace.count({ where: { id: { in: [k1.requestId!, k2.requestId!] } } });
    check("§11 ⭐ kova taşması: 2 adaydan 1'i yazılır, düşen sayaçta", yazildi === 1 && getRequestTraceHealth().dusen - once === 1, `yazildi=${yazildi} dusenFark=${getRequestTraceHealth().dusen - once}`);
    setRequestTraceBucketForTest(50, 200);

    // §12 — budama yalnız yaş
    const yasli = randomUUID();
    const genc = randomUUID();
    olusan.traceIds.push(yasli, genc);
    await prisma.requestTrace.createMany({ data: [
      { id: yasli, method: "POST", routeKey: "/api/test", status: 400, durationMs: 1, createdAt: new Date(Date.now() - 91 * 86_400_000) },
      { id: genc, method: "POST", routeKey: "/api/test", status: 400, durationMs: 1, createdAt: new Date(Date.now() - 89 * 86_400_000) },
    ] });
    const p0 = await pruneRequestTraces(new Date(), 0);
    check("§12a retentionDays 0 → budama yok", p0.deleted === 0 && p0.cutoff === null);
    await pruneRequestTraces(new Date(), 90);
    const kalan = await prisma.requestTrace.findMany({ where: { id: { in: [yasli, genc] } }, select: { id: true } });
    check("§12b ⭐ 90 gün: yaşlı satır gider, genç kalır", kalan.length === 1 && kalan[0]!.id === genc);
    await server.close();
  } catch (e) {
    console.error("\n💥 ÇÖKTÜ:", e instanceof Error ? e.stack : e);
    fail++;
    server.close();
  }
}

async function temizlik(): Promise<void> {
  const adim = async (f: () => Promise<unknown>) => { await f().catch(() => undefined); };
  await adim(() => flushRequestTraces());
  await adim(() => prisma.requestTrace.deleteMany({ where: { OR: [{ id: { in: olusan.traceIds } }, { userId: { in: olusan.userIds } }] } }));
  await adim(() => prisma.printJob.deleteMany({ where: { OR: [{ userId: { in: olusan.userIds } }, { subjectIds: { hasSome: olusan.rollIds } }, { subjectId: { in: olusan.rollIds } }] } }));
  if (olusan.rollIds.length) {
    await adim(() => prisma.rollMovement.deleteMany({ where: { rollId: { in: olusan.rollIds } } }));
    await adim(() => prisma.rollOperation.deleteMany({ where: { rollId: { in: olusan.rollIds } } }));
    await adim(() => prisma.roll.deleteMany({ where: { id: { in: olusan.rollIds } } }));
  }
  if (olusan.itemId) await adim(() => prisma.item.deleteMany({ where: { id: olusan.itemId! } }));
  for (const id of olusan.userIds) {
    await adim(() => prisma.session.deleteMany({ where: { userId: id } }));
    await adim(() => prisma.systemLog.deleteMany({ where: { userId: id } }));
    await adim(() => prisma.userPermission.deleteMany({ where: { userId: id } }));
    await adim(() => prisma.user.delete({ where: { id } }));
  }
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    await temizlik();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
