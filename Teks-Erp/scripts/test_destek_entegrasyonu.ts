// =============================================================================
// BEKÇİ — ETKİLİ DESTEK ENTEGRASYONU (`/api/etkili-destek/*`)
// Çalıştır: npx tsx scripts/run-all-tests.ts destek_entegrasyonu
// =============================================================================
// Merkez SAHTE bir yerel HTTP sunucusudur (127.0.0.1); gerçek merkeze istek ATILMAZ
// (canlı kurulum, gerçek talep açılırdı). Anahtar kılavuzdaki deneme vektörüdür.
//
// §1 imza deneme vektörleri (JSON · GET · multipart) kopyalanan istemciyle tutuyor
// §2 KAPALI (env eksik/geçersiz ya da lisans tesis kimliği yok): `/durum` {etkin:false}, diğer uçlar 403
//    MODULE_DISABLED ve merkeze TEK istek bile gitmiyor
// §3 kimlik OTURUMDAN: gövdedeki user/tenant/isTenantAdmin yok sayılır; ürün
//    sürümü + istemci türü/sürümü sunucudan; IP yok; imza geçerli; Idempotency-Key
//    = clientToken; audit satırı mesaj metni taşımıyor; tekrar ikinci iz bırakmıyor
// §4 scope=tenant yetkisiz kullanıcıda 403 (merkeze gitmeden), yöneticide geçer
// §5 base64 ek doğrulaması (tür · sayı · bozuk base64 · içerik/tür uyuşmazlığı ·
//    10 MB) merkeze gitmeden 400; geçerli ekler multipart + geçerli imzayla iletilir
// §6 merkez hata eşlemesi (404 · 409 · 410 · 429+Retry-After · 5xx→502 · 401→502 ·
//    ağ→502 · zaman aşımı→504) ve hiçbir yanıtta anahtar yok
// §7 `/durum.firmaYoneticisi` (scope=tenant ile aynı helper) · ek içeriği vekili
//    `/ekler/:id/icerik`: PNG/PDF baytları + başlıklar, izinsiz MIME/sahte imza →
//    502, merkez kökeni dışı adres → 502 ve o adrese istek YOK, 410 aynen,
//    yönlendirme izlenmez, 10 MB+pay tavanı, kapalıyken 403 ve dış istek yok
//
// §9 eski destek talebi (3d-2, `/api/destek`, satıcıya) ile ÇAKIŞMA yok: ayrı önek, eski uç izinsizde
//    yine 403, yeni `/durum` `support:create`siz kullanıcıya açık; eski önek 1 MB global gövde sınırında kalır
// §8 firma kimliği lisans HAK'ındaki `tesis.id` (küçük harf; patron bulutuyla aynı): sabit müşteri adı yok
// §10 lisans kapısı: her `/api/etkili-destek` ucu HER kademede ve etkinleştirme kilidinde açık (kurtarma yolu)
// §11 geliştirme yedeği `DESTEK_TENANT_ID`: yalnız lisansta tesis kimliği YOKSA ve biçim [a-z0-9-]{1,64} ise;
//     lisans kimliği varsa env onu EZEMEZ; bozuk değer yok sayılır (KAPALI)
//
// DB: kendi kullanıcılarını (zaman damgalı ad) yaratır; `finally`de oturum/izinleri siler, kullanıcıyı
// pasifleştirir (audit FK — sert silinmez).
//
// Negatif sondalar (2026-11-20, dosya dışında, md5 ile geri alındı): bkz. docs/bekci-harita/diger.md satırı.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import http from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as bcrypt from "bcryptjs";
import app from "../src/app";
import { AuthService } from "../src/services/auth.service";
import { reconcilePermissionCatalog } from "../src/jobs/permission-catalog.job";
import { APP_VERSION } from "../src/lib/app-version";
import { buyukGovdeYolu, effectiveBodyLimit, SUPPORT_BODY_LIMIT, VARSAYILAN_GOVDE_LIMITI } from "../src/constants/body-limits";
import { resolveSupportTenantId, setSupportTenantIdForTests } from "../src/services/helpers/destek-transport.helper";
import { isOpenInTier, isOpenWhenActivationLocked } from "../src/constants/license-routes";
import { STATE_TIERS } from "../src/lib/license/protocol";
import { hmacHex, multipartBodyHash, requestStringToSign, sha256Hex, signRequest } from "../src/integrations/destek/signature";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

// Kılavuzun deneme vektörü (gerçek anahtar DEĞİL).
const TEST_KEY = "dst_test_ensar_0000000000000000000000000000000000000000000";
const TICKET_ID = "5f0c2a1e-8d4b-4c61-9a57-1d2e3f4a5b6c";
const ATTACHMENT_ID = "a3e1c2d4-1111-4222-8333-944455556666";

// ── Sahte merkez ────────────────────────────────────────────────────────────
interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  raw: Buffer;
  signatureOk: boolean;
  payload: unknown;
  files: Buffer[];
}
const seen: Seen[] = [];
type Reply = { status: number; body?: unknown; raw?: Buffer; headers?: Record<string, string>; delayMs?: number };
let override: ((s: Seen) => Reply | null) | null = null;
let replayNext = false;

function ticket(status = "NEW"): Record<string, unknown> {
  return {
    id: TICKET_ID, number: "DST-2026-000123", type: "BUG", status, subject: "Deneme",
    createdAt: "2026-11-15T09:12:44.120Z", updatedAt: "2026-11-15T09:12:44.120Z", closedAt: null, messages: [],
  };
}

function defaultReply(s: Seen): Reply {
  const p = new URL(s.url, "http://x").pathname.replace("/api/v1/integration", "");
  if (s.method === "POST" && p === "/tickets") {
    const r: Reply = { status: replayNext ? 200 : 201, body: ticket(), headers: replayNext ? { "Idempotent-Replayed": "true" } : {} };
    replayNext = false;
    return r;
  }
  if (s.method === "GET" && p === "/tickets") return { status: 200, body: { items: [], total: 0, page: 1, limit: 20 } };
  if (s.method === "GET" && p === `/tickets/${TICKET_ID}`) return { status: 200, body: ticket() };
  if (p.endsWith("/messages")) return { status: 201, body: ticket("IN_PROGRESS") };
  if (p.endsWith("/close")) return { status: 200, body: ticket("CLOSED") };
  if (p.endsWith("/read")) return { status: 200, body: { lastReadAt: "2026-11-15T10:05:00.000Z" } };
  if (p === "/unread-count") return { status: 200, body: { count: 3, tickets: 2 } };
  if (p.endsWith("/link")) return { status: 200, body: { url: "https://ornek.invalid/d", expiresAt: "2026-11-15T10:10:00.000Z" } };
  return { status: 404, body: { error: { code: "NOT_FOUND", message: "Yok." } } };
}

async function inspect(method: string, url: string, headers: http.IncomingHttpHeaders, raw: Buffer): Promise<Seen> {
  const ct = String(headers["content-type"] ?? "");
  let bodyHash = sha256Hex(raw);
  let payload: unknown = undefined;
  const files: Buffer[] = [];
  if (ct.startsWith("multipart/form-data")) {
    const form = await new Request("http://x/", { method: "POST", headers: { "content-type": ct }, body: new Uint8Array(raw) }).formData();
    const text = String(form.get("payload") ?? "");
    payload = JSON.parse(text);
    for (const f of form.getAll("files")) if (f instanceof Blob) files.push(Buffer.from(await f.arrayBuffer()));
    bodyHash = multipartBodyHash({ payload: text }, files.map((b) => sha256Hex(b)));
  } else if (raw.length) {
    payload = JSON.parse(raw.toString("utf8"));
  }
  const ts = String(headers["x-destek-timestamp"] ?? "");
  const nonce = String(headers["x-destek-nonce"] ?? "");
  const expected = hmacHex(TEST_KEY, requestStringToSign(ts, nonce, method, url, bodyHash));
  const signatureOk = headers.authorization === `Bearer ${TEST_KEY}` && headers["x-destek-signature"] === expected;
  return { method, url, headers, raw, signatureOk, payload, files };
}

const fake = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    void (async () => {
      const s = await inspect(req.method ?? "", req.url ?? "", req.headers, Buffer.concat(chunks));
      seen.push(s);
      const r = override?.(s) ?? defaultReply(s);
      if (r.delayMs) await new Promise((ok) => setTimeout(ok, r.delayMs));
      if (res.destroyed) return;
      res.writeHead(r.status, { "content-type": "application/json", ...(r.headers ?? {}) });
      res.end(r.raw ?? (r.body === undefined ? "" : JSON.stringify(r.body)));
    })();
  });
});

// ── Uygulama istemcisi ──────────────────────────────────────────────────────
let appPort = 0;
const bodies: string[] = [];
interface Resp {
  status: number;
  json: { success?: boolean; message?: string; data?: Record<string, unknown>; details?: { code?: string } };
  headers: Headers;
}
async function call(token: string | null, method: string, path: string, body?: unknown): Promise<Resp> {
  const r = await fetch(`http://127.0.0.1:${appPort}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
      "x-client-kind": "mobil",
      "x-client-version": "9.9.9",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  bodies.push(text);
  return { status: r.status, json: text ? JSON.parse(text) : {}, headers: r.headers };
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-govdesi")]);
const PDF = Buffer.from("%PDF-1.4\ndeneme\n");
const b64 = (b: Buffer): string => b.toString("base64");

function setEnv(url: string | undefined, key: string | undefined): void {
  if (url === undefined) delete process.env.DESTEK_API_URL;
  else process.env.DESTEK_API_URL = url;
  if (key === undefined) delete process.env.DESTEK_API_KEY;
  else process.env.DESTEK_API_KEY = key;
}

async function makeUser(tag: string, codes: string[]): Promise<{ id: string; fullName: string; token: string }> {
  const username = `TEST-DESTEK-${tag}-${Date.now()}`;
  const password = `Bekci-Destek-${Date.now()}-Anahtar!`;
  const fullName = `Destek Bekçisi ${tag}`;
  const user = await prisma.user.create({
    data: { username, fullName, passwordHash: await bcrypt.hash(password, 10), isActive: true },
    select: { id: true },
  });
  const perms = await prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
  await prisma.userPermission.createMany({ data: perms.map((p) => ({ userId: user.id, permissionId: p.id })) });
  const { token } = await AuthService.login(username, password);
  return { id: user.id, fullName, token };
}

// ── Bölümler ────────────────────────────────────────────────────────────────
function section1(): void {
  console.log("\n=== §1 imza deneme vektörleri ===");
  const ts = "1763164800";
  const nonce = "n0nce0123456789abcdef";
  const jsonBody = '{"type":"BUG","subject":"Sipariş onayı gelmiyor"}';
  check("§1 JSON vektörü", hmacHex(TEST_KEY, requestStringToSign(ts, nonce, "post", "/api/v1/integration/tickets", sha256Hex(jsonBody))) === "6e1c58839690bf9254898b3cbcb71ec3d31b81560bb7aa0c017258239f895324");
  const get = signRequest(TEST_KEY, { method: "GET", pathWithQuery: "/api/v1/integration/tickets?userId=kullanici-88&scope=mine", bodyHash: sha256Hex(""), timestampSec: Number(ts), nonce });
  check("§1 GET vektörü", get["X-Destek-Signature"] === "cb227cf7207213f26c563ec59f568a4f9a0c4c893e510639c92a6c4b6b1b28f9");
  check("§1 multipart vektörü", multipartBodyHash({ payload: '{"message":"Ekran görüntüsü ekte"}' }, [sha256Hex("PNG-1"), sha256Hex("PDF-2")]) === "636c3e8ebf5252e6c8354cafe85dc942db6bb44726483b22bc81d2c98baf513b");
}

async function section2(u: { token: string }, fakeUrl: string): Promise<void> {
  console.log("\n=== §2 KAPALI: dış istek yok ===");
  const before = seen.length;
  // Dördüncü öğe tesis kimliği kancası: `null` = lisans HAK'ı yok; `undefined` = gerçek lisans anlığı (test DB lisanssız).
  for (const [url, key, label, tesis] of [
    [undefined, undefined, "env yok", TEST_TESIS_ID],
    [fakeUrl, undefined, "yalnız adres", TEST_TESIS_ID],
    [undefined, TEST_KEY, "yalnız anahtar", TEST_TESIS_ID],
    ["http://destek.ornek.invalid/api/v1/integration", TEST_KEY, "düz HTTP dış adres", TEST_TESIS_ID],
    [fakeUrl, TEST_KEY, "env tam ama lisans tesis kimliği yok", null],
    [fakeUrl, TEST_KEY, "env tam, gerçek lisans anlığı (lisanssız kurulum)", undefined],
  ] as const) {
    setEnv(url, key);
    setSupportTenantIdForTests(tesis);
    const d = await call(u.token, "GET", "/api/etkili-destek/durum");
    check(`§2 ${label}: /durum 200 etkin=false`, d.status === 200 && d.json.data?.etkin === false, JSON.stringify(d.json));
    const o = await call(u.token, "POST", "/api/etkili-destek/talepler", { type: "BUG", subject: "x", message: "y", clientToken: "t-1" });
    check(`§2 ${label}: talep aç 403 MODULE_DISABLED`, o.status === 403 && o.json.details?.code === "MODULE_DISABLED", `${o.status} ${o.json.details?.code}`);
    const b = await call(u.token, "GET", "/api/etkili-destek/okunmamis");
    check(`§2 ${label}: rozet 403 MODULE_DISABLED`, b.status === 403 && b.json.details?.code === "MODULE_DISABLED");
  }
  check("§2 kapalıyken merkeze HİÇ istek gitmedi", seen.length === before, `${seen.length - before} istek`);
  setSupportTenantIdForTests(TEST_TESIS_ID);
  const anon = await call(null, "GET", "/api/etkili-destek/durum");
  check("§2 kimliksiz /durum 401", anon.status === 401);
}

const TEST_TESIS_ID = "5B0C6A4E-DE57-4000-8000-0000000000D1";
const tenantId = TEST_TESIS_ID.toLowerCase();

async function section3(u: { id: string; fullName: string; token: string }): Promise<void> {
  console.log("\n=== §3 kimlik oturumdan, bağlam sunucudan ===");
  const spoof = {
    type: "BUG", subject: "Sipariş onayı", message: "GIZLI-MESAJ-METNI", clientToken: "token-3a",
    user: { id: "sahte-kullanici", name: "Sahte", isTenantAdmin: true }, tenant: { id: "baska-firma", name: "Başka" }, isTenantAdmin: true,
    context: { screen: "Sipariş detayı", productVersion: "0.0.1", client: { os: "Android 14", device: "Tablet" }, technical: { lastError: "x" } },
  };
  const n = seen.length;
  const r = await call(u.token, "POST", "/api/etkili-destek/talepler", spoof);
  check("§3 talep açıldı 201 + zarf", r.status === 201 && r.json.success === true && r.json.data?.number === "DST-2026-000123", `${r.status}`);
  const s = seen[n];
  const p = (s?.payload ?? {}) as { user?: Record<string, unknown>; tenant?: Record<string, unknown>; context?: Record<string, unknown> & { client?: Record<string, unknown>; technical?: Record<string, unknown> }; isTenantAdmin?: unknown };
  check("§3 merkeze tek istek, imza geçerli", seen.length === n + 1 && s?.signatureOk === true);
  check("§3 user.id = oturum kullanıcısı", p.user?.id === u.id, String(p.user?.id));
  check("§3 user.name = DB fullName", p.user?.name === u.fullName);
  check("§3 isTenantAdmin gövdeden alınmadı (false)", p.user?.isTenantAdmin === false && p.isTenantAdmin === undefined);
  check("§3 tenant.id = lisans tesis kimliği (küçük harf)", p.tenant?.id === tenantId && typeof p.tenant?.name === "string" && p.tenant.name.length > 0, JSON.stringify(p.tenant));
  check("§3 productVersion = backend sürümü", p.context?.productVersion === APP_VERSION, String(p.context?.productVersion));
  check("§3 client.appVersion başlıktan + os gövdeden", p.context?.client?.appVersion === "9.9.9" && p.context?.client?.os === "Android 14");
  check("§3 istemci türü technical.clientKind", p.context?.technical?.clientKind === "mobil");
  const rawText = s?.raw.toString("utf8") ?? "";
  check("§3 IP gönderilmedi", !rawText.includes("127.0.0.1") && !/"ip(Address)?"\s*:/i.test(rawText));
  check("§3 Idempotency-Key = clientToken", s?.headers["idempotency-key"] === "token-3a");
  const logs = await prisma.systemLog.findMany({ where: { tableName: "destek_talepleri", recordId: TICKET_ID, userId: u.id }, select: { newData: true } });
  check("§3 audit: tek CREATE satırı", logs.length === 1, `${logs.length}`);
  check("§3 audit yükünde mesaj metni yok, talep no var", logs.length === 1 && !JSON.stringify(logs[0]?.newData).includes("GIZLI-MESAJ") && JSON.stringify(logs[0]?.newData).includes("DST-2026-000123"));
  replayNext = true;
  const again = await call(u.token, "POST", "/api/etkili-destek/talepler", spoof);
  const logs2 = await prisma.systemLog.count({ where: { tableName: "destek_talepleri", recordId: TICKET_ID, userId: u.id } });
  check("§3 tekrar: 200 + idempotentReplay, ikinci audit yok", again.status === 200 && again.json.data?.idempotentReplay === true && logs2 === 1, `${again.status} audit=${logs2}`);
}

async function section4(u: { id: string; token: string }, admin: { id: string; token: string }): Promise<void> {
  console.log("\n=== §4 scope=tenant yalnız yöneticiye ===");
  const n = seen.length;
  const a = await call(u.token, "GET", "/api/etkili-destek/talepler?scope=tenant");
  check("§4 yetkisiz liste scope=tenant 403 FORBIDDEN", a.status === 403 && a.json.details?.code === "FORBIDDEN");
  const b = await call(u.token, "GET", "/api/etkili-destek/okunmamis?scope=tenant");
  check("§4 yetkisiz rozet scope=tenant 403", b.status === 403 && b.json.details?.code === "FORBIDDEN");
  check("§4 yetkisiz istekte merkeze gidilmedi", seen.length === n);
  const c = await call(admin.token, "GET", "/api/etkili-destek/talepler?scope=tenant&status=NEW,ANSWERED&page=2&limit=10");
  const q = new URL(seen[seen.length - 1]?.url ?? "/", "http://x").searchParams;
  check("§4 yönetici scope=tenant 200", c.status === 200);
  check("§4 sorgu: userId+tenantId+isTenantAdmin+status", q.get("userId") === admin.id && q.get("tenantId") === tenantId && q.get("isTenantAdmin") === "true" && q.get("scope") === "tenant" && q.get("status") === "NEW,ANSWERED", q.toString());
  await call(u.token, "GET", "/api/etkili-destek/talepler");
  const q2 = new URL(seen[seen.length - 1]?.url ?? "/", "http://x").searchParams;
  check("§4 normal kullanıcı: isTenantAdmin yok, scope=mine", q2.get("userId") === u.id && !q2.has("isTenantAdmin") && q2.get("scope") === "mine", q2.toString());
  const bad = await call(u.token, "GET", "/api/etkili-destek/talepler?status=SILINDI");
  check("§4 geçersiz status 400", bad.status === 400);
  const r = await call(u.token, "GET", "/api/etkili-destek/okunmamis");
  check("§4 rozet 200 {count,tickets}", r.status === 200 && r.json.data?.count === 3 && r.json.data?.tickets === 2);
}

async function section5(u: { token: string }): Promise<void> {
  console.log("\n=== §5 base64 ek doğrulaması ===");
  const base = { type: "QUESTION", subject: "Ek", message: "Ekte", clientToken: `t5-${Date.now()}` };
  const n = seen.length;
  const cases: Array<[string, unknown, string | null]> = [
    ["tür (text/plain)", [{ name: "a.txt", contentType: "text/plain", dataBase64: b64(Buffer.from("x")) }], "ATTACHMENT_INVALID"],
    ["6 dosya", Array.from({ length: 6 }, () => ({ name: "a.png", contentType: "image/png", dataBase64: b64(PNG) })), null],
    ["bozuk base64", [{ name: "a.png", contentType: "image/png", dataBase64: "@@@###" }], "ATTACHMENT_INVALID"],
    ["PNG içerik, PDF bildirimi", [{ name: "a.pdf", contentType: "application/pdf", dataBase64: b64(PNG) }], "ATTACHMENT_INVALID"],
    ["10 MB + 1", [{ name: "b.pdf", contentType: "application/pdf", dataBase64: b64(Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024 + 1 - PDF.length)])) }], "ATTACHMENT_TOO_LARGE"],
  ];
  for (const [label, files, code] of cases) {
    const r = await call(u.token, "POST", "/api/etkili-destek/talepler", { ...base, files });
    check(`§5 ${label} → 400${code ? ` ${code}` : ""}`, r.status === 400 && (code === null || r.json.details?.code === code), `${r.status} ${r.json.details?.code ?? r.json.message}`);
  }
  check("§5 reddedilen eklerde merkeze gidilmedi", seen.length === n);
  const ok = await call(u.token, "POST", "/api/etkili-destek/talepler", {
    ...base,
    files: [{ name: "../../ekran.png", contentType: "image/png", dataBase64: b64(PNG) }, { name: "rapor.pdf", contentType: "application/pdf", dataBase64: b64(PDF) }],
  });
  const s = seen[seen.length - 1];
  check("§5 geçerli ekler → 201", ok.status === 201, `${ok.status} ${ok.json.message ?? ""}`);
  check("§5 multipart + imza geçerli + 2 dosya bayt-eşit", !!s && String(s.headers["content-type"]).startsWith("multipart/form-data") && s.signatureOk && s.files.length === 2 && s.files[0]!.equals(PNG) && s.files[1]!.equals(PDF));
  const msg = await call(u.token, "POST", `/api/etkili-destek/talepler/${TICKET_ID}/mesajlar`, { message: "Ek yanıt", files: [{ name: "e.png", contentType: "image/png", dataBase64: b64(PNG) }] });
  check("§5 yanıt + ek → 201", msg.status === 201 && seen[seen.length - 1]?.files.length === 1);
}

async function expectMapped(label: string, reply: Reply, req: () => Promise<Resp>, status: number, code: string, extra?: (r: Resp) => boolean): Promise<void> {
  override = () => reply;
  const r = await req();
  override = null;
  check(`§6 ${label} → ${status} ${code}`, r.status === status && r.json.details?.code === code && (extra ? extra(r) : true), `${r.status} ${r.json.details?.code} "${r.json.message}"`);
}

async function section6(u: { token: string }, fakeUrl: string): Promise<void> {
  console.log("\n=== §6 merkez hata eşlemesi ===");
  const get = (): Promise<Resp> => call(u.token, "GET", `/api/etkili-destek/talepler/${TICKET_ID}`);
  await expectMapped("404 NOT_FOUND (mesaj aynen)", { status: 404, body: { error: { code: "NOT_FOUND", message: "Talep bulunamadı." } } }, get, 404, "NOT_FOUND", (r) => r.json.message === "Talep bulunamadı.");
  await expectMapped("409 REOPEN_WINDOW_EXPIRED", { status: 409, body: { error: { code: "REOPEN_WINDOW_EXPIRED", message: "Süre doldu." } } }, () => call(u.token, "POST", `/api/etkili-destek/talepler/${TICKET_ID}/mesajlar`, { message: "x" }), 409, "REOPEN_WINDOW_EXPIRED");
  await expectMapped("410 ATTACHMENT_EXPIRED", { status: 410, body: { error: { code: "ATTACHMENT_EXPIRED", message: "Silindi." } } }, () => call(u.token, "GET", `/api/etkili-destek/ekler/${ATTACHMENT_ID}/baglanti?variant=thumb`), 410, "ATTACHMENT_EXPIRED");
  await expectMapped("429 + Retry-After", { status: 429, body: { error: { code: "RATE_LIMITED", message: "Çok istek." } }, headers: { "Retry-After": "7" } }, get, 429, "RATE_LIMITED", (r) => r.headers.get("retry-after") === "7");
  await expectMapped("500 → 502", { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "x" } } }, get, 502, "DESTEK_ULASILAMADI");
  await expectMapped("401 INVALID_API_KEY → 502 (oturum düşmesin)", { status: 401, body: { error: { code: "INVALID_API_KEY", message: "x" } } }, get, 502, "DESTEK_YAPILANDIRMA");
  const t0 = Date.now();
  await expectMapped("rozet zaman aşımı → 504", { status: 200, body: { count: 0, tickets: 0 }, delayMs: 6500 }, () => call(u.token, "GET", "/api/etkili-destek/okunmamis"), 504, "DESTEK_ZAMAN_ASIMI");
  check("§6 rozet ≈ 5 sn'de kesildi", Date.now() - t0 < 6400, `${Date.now() - t0} ms`);
  setEnv("http://127.0.0.1:1/api/v1/integration", TEST_KEY);
  const net = await get();
  check("§6 ağ hatası → 502 DESTEK_ULASILAMADI", net.status === 502 && net.json.details?.code === "DESTEK_ULASILAMADI");
  setEnv(fakeUrl, TEST_KEY);
  const close = await call(u.token, "POST", `/api/etkili-destek/talepler/${TICKET_ID}/kapat`);
  const read = await call(u.token, "POST", `/api/etkili-destek/talepler/${TICKET_ID}/okundu`);
  const link = await call(u.token, "GET", `/api/etkili-destek/ekler/${ATTACHMENT_ID}/baglanti`);
  check("§6 kapat/okundu/bağlantı 200", close.status === 200 && close.json.data?.status === "CLOSED" && read.status === 200 && link.status === 200);
  const badId = await call(u.token, "GET", "/api/etkili-destek/talepler/abc");
  check("§6 geçersiz kimlik 400 (merkeze gitmeden)", badId.status === 400);
  check("§6 hiçbir yanıt gövdesinde anahtar yok", bodies.every((b) => !b.includes(TEST_KEY)), `${bodies.length} yanıt`);
  const routeSrc = readFileSync(join(__dirname, "../src/routes/destek.routes.ts"), "utf8");
  check("§6 route dosyası prisma import etmiyor", !/lib\/prisma/.test(routeSrc));
  const serviceSrc = readFileSync(join(__dirname, "../src/services/destek.service.ts"), "utf8");
  check("§8 serviste sabit firma kimliği yok (tenant yapılandırmadan)", /resolveTenantId\(cfg\)/.test(serviceSrc) && !/tenant:\s*\{\s*id:\s*["'`]/.test(serviceSrc) && !/TENANT_ID\s*=\s*["'`]/.test(serviceSrc) && !/installationId/.test(serviceSrc));
  const transportSrc = readFileSync(join(__dirname, "../src/services/helpers/destek-transport.helper.ts"), "utf8");
  check("§8 tenant kaynağı lisans HAK tesis kimliği, küçük harf",
    /entitlement\?\.document\.tesis\.id/.test(transportSrc) && /licenseTenantId\.toLowerCase\(\)/.test(transportSrc) && /if \(!tenantId\) return null;/.test(transportSrc));
}

interface Raw {
  status: number;
  headers: Headers;
  bytes: Buffer;
  code?: string;
  merkezKodu?: string;
}
async function rawGet(token: string, path: string): Promise<Raw> {
  const r = await fetch(`http://127.0.0.1:${appPort}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const bytes = Buffer.from(await r.arrayBuffer());
  let code: string | undefined;
  let merkezKodu: string | undefined;
  if (String(r.headers.get("content-type")).includes("json")) {
    const j = JSON.parse(bytes.toString("utf8")) as { details?: { code?: string; merkezKodu?: string } };
    code = j.details?.code;
    merkezKodu = j.details?.merkezKodu;
    bodies.push(bytes.toString("utf8"));
  }
  return { status: r.status, headers: r.headers, bytes, code, merkezKodu };
}

/** Sahte merkez: `/link` verilen adresi döner, `/dl/*` verilen baytları verir. */
function serveFile(url: string, file: Reply | null): void {
  override = (s) => {
    if (s.url.includes("/link")) return { status: 200, body: { url, expiresAt: "2026-11-15T10:10:00.000Z" } };
    if (s.url.startsWith("/dl/")) return file;
    return null;
  };
}

async function section7(u: { token: string }, admin: { token: string }, fakeUrl: string): Promise<void> {
  console.log("\n=== §7 ek içeriği vekili + firmaYoneticisi ===");
  const origin = new URL(fakeUrl).origin;
  const path = `/api/etkili-destek/ekler/${ATTACHMENT_ID}/icerik`;
  const du = await call(u.token, "GET", "/api/etkili-destek/durum");
  const da = await call(admin.token, "GET", "/api/etkili-destek/durum");
  check("§7 /durum firmaYoneticisi: kullanıcı false, yönetici true", du.json.data?.firmaYoneticisi === false && da.json.data?.firmaYoneticisi === true, `${JSON.stringify(du.json.data)} ${JSON.stringify(da.json.data)}`);

  serveFile(`${origin}/dl/png?token=abc`, { status: 200, raw: PNG, headers: { "content-type": "image/png" } });
  let n = seen.length;
  const png = await rawGet(u.token, `${path}?variant=thumb`);
  const dl = seen[n + 1];
  check("§7 PNG → 200 bayt-eşit", png.status === 200 && png.bytes.equals(PNG), `${png.status}`);
  check("§7 PNG başlıkları: image/png · inline · private max-age=300", png.headers.get("content-type") === "image/png" && String(png.headers.get("content-disposition")).startsWith("inline") && png.headers.get("cache-control") === "private, max-age=300", `${png.headers.get("content-type")} | ${png.headers.get("content-disposition")} | ${png.headers.get("cache-control")}`);
  check("§7 bağlantı variant=thumb ile istendi", new URL(seen[n]?.url ?? "/", "http://x").searchParams.get("variant") === "thumb");
  check("§7 indirme isteği anahtar/imza taşımıyor", seen.length === n + 2 && !!dl && dl.headers.authorization === undefined && dl.headers["x-destek-signature"] === undefined);

  serveFile(`${origin}/dl/pdf`, { status: 200, raw: PDF, headers: { "content-type": "application/pdf; charset=binary" } });
  const pdf = await rawGet(u.token, path);
  check("§7 PDF → 200 application/pdf · attachment", pdf.status === 200 && pdf.headers.get("content-type") === "application/pdf" && String(pdf.headers.get("content-disposition")).startsWith("attachment") && pdf.bytes.equals(PDF), `${pdf.status} ${pdf.headers.get("content-disposition")}`);

  serveFile(`${origin}/dl/html`, { status: 200, raw: Buffer.from("<html>x</html>"), headers: { "content-type": "text/html" } });
  const html = await rawGet(u.token, path);
  check("§7 izinsiz MIME (text/html) → 502", html.status === 502 && html.code === "DESTEK_ULASILAMADI" && html.merkezKodu === "MIME_NOT_ALLOWED", `${html.status} ${html.code} ${html.merkezKodu}`);
  serveFile(`${origin}/dl/sahte`, { status: 200, raw: Buffer.from("<svg/>"), headers: { "content-type": "image/png" } });
  const fakePng = await rawGet(u.token, path);
  check("§7 PNG diye gelen PNG olmayan bayt → 502", fakePng.status === 502 && fakePng.merkezKodu === "MIME_NOT_ALLOWED");

  for (const [label, url] of [
    ["yabancı host", "https://baska.ornek.invalid/dl/png?token=abc"],
    ["aynı host farklı port", `http://127.0.0.1:1/dl/png`],
    ["localhost (farklı köken)", `${origin.replace("127.0.0.1", "localhost")}/dl/png`],
  ] as const) {
    serveFile(url, { status: 200, raw: PNG, headers: { "content-type": "image/png" } });
    n = seen.length;
    const f = await rawGet(u.token, path);
    check(`§7 ${label} → 502 FOREIGN_HOST, indirme isteği yok`, f.status === 502 && f.merkezKodu === "FOREIGN_HOST" && seen.length === n + 1, `${f.status} ${f.merkezKodu} istek=${seen.length - n}`);
  }

  override = (s) => (s.url.includes("/link") ? { status: 410, body: { error: { code: "ATTACHMENT_EXPIRED", message: "Silindi." } } } : null);
  const gone = await rawGet(u.token, path);
  check("§7 silinmiş ek (bağlantıda 410) → 410 ATTACHMENT_EXPIRED", gone.status === 410 && gone.code === "ATTACHMENT_EXPIRED");
  serveFile(`${origin}/dl/gone`, { status: 410, body: { error: { code: "ATTACHMENT_EXPIRED", message: "Silindi." } } });
  const gone2 = await rawGet(u.token, path);
  check("§7 indirmede 410 → 410 ATTACHMENT_EXPIRED", gone2.status === 410 && gone2.code === "ATTACHMENT_EXPIRED");
  serveFile(`${origin}/dl/redirect`, { status: 302, headers: { location: "https://baska.ornek.invalid/x" } });
  const redirect = await rawGet(u.token, path);
  check("§7 yönlendirme izlenmez → 502", redirect.status === 502 && redirect.merkezKodu === "HTTP_302");
  serveFile(`${origin}/dl/big`, { status: 200, raw: Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]), headers: { "content-type": "image/png" } });
  const big = await rawGet(u.token, path);
  check("§7 tavan aşımı (11 MB) → 502", big.status === 502 && big.code === "DESTEK_ULASILAMADI", `${big.status} ${big.merkezKodu}`);
  override = null;

  const bad = await rawGet(u.token, "/api/etkili-destek/ekler/abc/icerik");
  check("§7 geçersiz kimlik 400", bad.status === 400);
  setEnv(undefined, undefined);
  n = seen.length;
  const off = await rawGet(u.token, path);
  const offDurum = await call(admin.token, "GET", "/api/etkili-destek/durum");
  check("§7 kapalı: içerik 403 MODULE_DISABLED, dış istek yok", off.status === 403 && off.code === "MODULE_DISABLED" && seen.length === n);
  check("§7 kapalı: /durum yalnız { etkin:false }", JSON.stringify(offDurum.json.data) === '{"etkin":false}', JSON.stringify(offDurum.json.data));
  setEnv(fakeUrl, TEST_KEY);
}

async function section9(u: { token: string }): Promise<void> {
  console.log("\n=== §9 eski destek talebiyle (3d-2) çakışma yok ===");
  const yeni = await call(u.token, "GET", "/api/etkili-destek/durum");
  check("§9 support:create'siz kullanıcı yeni /durum'u okur (eski guard'a takılmaz)", yeni.status === 200 && yeni.json.data?.etkin === true, `${yeni.status}`);
  const eski = await call(u.token, "GET", "/api/destek");
  check("§9 eski /api/destek izinsizde hâlâ 403 (davranış değişmedi)", eski.status === 403, `${eski.status}`);
  check("§9 eski önek 1 MB global sınırda, yeni önek kendi sınırında",
    !buyukGovdeYolu("/api/destek") && effectiveBodyLimit("/api/destek") === VARSAYILAN_GOVDE_LIMITI
      && effectiveBodyLimit("/api/etkili-destek/talepler") === SUPPORT_BODY_LIMIT);
}

/** `router.<yöntem>("/yol"` satırlarından uç envanteri (route dosyası tek kaynak). */
function destekRoutes(): { m: string; path: string }[] {
  const src = readFileSync(join(__dirname, "../src/routes/destek.routes.ts"), "utf8");
  return [...src.matchAll(/router\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)].map((x) => ({
    m: x[1]!.toUpperCase(),
    path: `/api/etkili-destek${x[2]}`,
  }));
}

function section10(): void {
  console.log("\n=== §10 lisans kapısı: her kademede açık (kurtarma yolu) ===");
  const routes = destekRoutes();
  check("§10 körlük zemini: route envanteri ≥ 10 uç", routes.length >= 10, `${routes.length}`);
  for (const tier of STATE_TIERS) {
    const kapali = routes.filter((r) => !isOpenInTier(tier, r.m, r.path));
    check(`§10 ${tier}: her Etkili Destek ucu açık`, kapali.length === 0, kapali.map((r) => `${r.m} ${r.path}`).join(" | "));
  }
  for (const sinif of ["ETKINLESMEDI", "KOPYA", "KURULUM_HATASI"] as const) {
    const kapali = routes.filter((r) => !isOpenWhenActivationLocked(sinif, r.m, r.path));
    check(`§10 etkinleştirme kilidi ${sinif}: her uç açık`, kapali.length === 0, kapali.map((r) => `${r.m} ${r.path}`).join(" | "));
  }
  check("§10 desen yalnız kendi önekini açar (/api/etkili-destekx kapalı)", !isOpenInTier("DURDURULMUS", "POST", "/api/etkili-destekx/talepler"));
}

async function section11(u: { token: string }, fakeUrl: string): Promise<void> {
  console.log("\n=== §11 DESTEK_TENANT_ID geliştirme yedeği ===");
  const LIS = "5B0C6A4E-DE57-4000-8000-0000000000D1";
  const saf: Array<[string, string | null, string | undefined, string | null]> = [
    ["lisans var + env var → LİSANS kazanır (küçük harf)", LIS, "seyitoglu", LIS.toLowerCase()],
    ["lisans yok + geçerli env → env", null, "seyitoglu", "seyitoglu"],
    ["lisans yok + kenar boşluklu env → kırpılır", null, "  dev-1  ", "dev-1"],
    ["lisans yok + env yok → null (KAPALI)", null, undefined, null],
    ["lisans yok + boş env → null", null, "", null],
    ["lisans yok + büyük harfli env → yok sayılır", null, "Seyitoglu", null],
    ["lisans yok + boşluklu env → yok sayılır", null, "seyit oglu", null],
    ["lisans yok + alt çizgili env → yok sayılır", null, "seyit_oglu", null],
    ["lisans yok + 65 karakter → yok sayılır", null, "a".repeat(65), null],
    ["lisans yok + 64 karakter → kabul (sınır)", null, "a".repeat(64), "a".repeat(64)],
  ];
  for (const [label, lis, env, beklenen] of saf) {
    const got = resolveSupportTenantId(lis, env === undefined ? {} : { DESTEK_TENANT_ID: env });
    check(`§11 ${label}`, got === beklenen, String(got));
  }
  // Uçtan uca: kanca null = lisans tesis kimliği yok (lisanssız önizleme).
  setEnv(fakeUrl, TEST_KEY);
  setSupportTenantIdForTests(null);
  try {
    process.env.DESTEK_TENANT_ID = "dev-onizleme";
    const a = await call(u.token, "GET", "/api/etkili-destek/durum");
    check("§11 lisanssız + DESTEK_TENANT_ID → /durum etkin=true", a.status === 200 && a.json.data?.etkin === true, JSON.stringify(a.json.data));
    const n = seen.length;
    await call(u.token, "GET", "/api/etkili-destek/talepler");
    const q = new URL(seen[n]?.url ?? "/", "http://x").searchParams;
    check("§11 merkeze giden tenantId = env değeri", seen.length === n + 1 && q.get("tenantId") === "dev-onizleme", q.toString());
    process.env.DESTEK_TENANT_ID = "BOZUK DEGER";
    const b = await call(u.token, "GET", "/api/etkili-destek/durum");
    check("§11 bozuk DESTEK_TENANT_ID → /durum etkin=false (yok sayıldı)", b.status === 200 && b.json.data?.etkin === false);
    // Lisans kimliği varken env onu ezemez.
    setSupportTenantIdForTests(TEST_TESIS_ID);
    process.env.DESTEK_TENANT_ID = "ezmeye-calisan";
    const k = seen.length;
    await call(u.token, "GET", "/api/etkili-destek/talepler");
    const q2 = new URL(seen[k]?.url ?? "/", "http://x").searchParams;
    check("§11 lisans kimliği varken tenantId = LİSANS (env ezemedi)", q2.get("tenantId") === tenantId, q2.toString());
  } finally {
    delete process.env.DESTEK_TENANT_ID;
    setSupportTenantIdForTests(TEST_TESIS_ID);
  }
}

async function main(): Promise<void> {
  const eskiDevTenant = process.env.DESTEK_TENANT_ID;
  delete process.env.DESTEK_TENANT_ID;
  section1();
  section10();
  await reconcilePermissionCatalog();
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  appPort = (server.address() as { port: number }).port;
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  const fakeUrl = `http://127.0.0.1:${(fake.address() as { port: number }).port}/api/v1/integration`;
  const ids: string[] = [];
  // Test DB lisanssız: tesis kimliği kanca ile verilir (büyük harf → küçük harfe çevrilmeli).
  setSupportTenantIdForTests(TEST_TESIS_ID);
  try {
    const u = await makeUser("U", ["order:read"]);
    const admin = await makeUser("A", ["order:read", "admin:settings"]);
    ids.push(u.id, admin.id);
    await section2(u, fakeUrl);
    setEnv(fakeUrl, TEST_KEY);
    const d = await call(u.token, "GET", "/api/etkili-destek/durum");
    check("§3 açıkken /durum etkin=true", d.json.data?.etkin === true);
    await section3(u);
    await section4(u, admin);
    await section5(u);
    await section6(u, fakeUrl);
    await section7(u, admin, fakeUrl);
    await section9(u);
    await section11(u, fakeUrl);
  } finally {
    if (eskiDevTenant === undefined) delete process.env.DESTEK_TENANT_ID;
    else process.env.DESTEK_TENANT_ID = eskiDevTenant;
    setEnv(undefined, undefined);
    setSupportTenantIdForTests(undefined);
    await prisma.session.deleteMany({ where: { userId: { in: ids } } });
    await prisma.userPermission.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.updateMany({ where: { id: { in: ids } }, data: { isActive: false } });
    await new Promise<void>((r) => server.close(() => r()));
    fake.closeAllConnections();
    await new Promise<void>((r) => fake.close(() => r()));
  }
}

main()
  .catch((err) => {
    console.error("Beklenmeyen hata:", err);
    fail++;
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
