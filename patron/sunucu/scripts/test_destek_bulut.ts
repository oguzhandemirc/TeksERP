// =============================================================================
// BEKÇİ — ETKİLİ DESTEK, BULUT DİLİMİ (`/api/destek/*` + `POST /api/destek/webhook` + push)
// Koşum: npx tsx scripts/run-all-tests.ts destek_bulut     (yalnız *_test DB)
// =============================================================================
// Merkez SAHTE yerel HTTP sunucusudur (127.0.0.1); gerçek merkeze istek ATILMAZ (canlı kurulum). Anahtar kılavuzun
// deneme vektörü (`dst_test_ensar_000…`), webhook sırrı uydurma (`whsec_test…`). Push taşıyıcısı sahte (kayıtlı).
//
// §1 imza deneme vektörleri (JSON · GET · webhook) kopyalanan istemciyle tutuyor
// §2 KAPALI (anahtar yok/biçimsiz/HTTP): `durum` {etkin:false}, diğer uçlar 403 MODULE_DISABLED, webhook 404, merkeze
//    TEK istek bile gitmiyor; sır dosyası kuralları (0640 açık · 0644 red · boş = kapalı); özet satırında sır yok
// §3 kimlik OTURUMDAN: user.id = hesap id, isTenantAdmin true, tenant = lisans tesis kimliği (tesisId) + tesis adı;
//    gövdede user/tenant → 400 (katı); Idempotency-Key = clientToken; tekrar 200 + Idempotent-Replay; imza geçerli;
//    sorgu kimliği; denetim satırı mesaj metni taşımıyor
// §4 base64 ek doğrulaması merkeze gitmeden (tür · bozuk · içerik/tür · 6 dosya · 10 MB); geçerli ek multipart + imza;
//    genel uçta 256 KB, ekli uçta büyük gövde geçer
// §5 hata eşlemesi (404 · 409 · 410 · 429+Retry-After · 5xx→502 · 401→502 · bilinmeyen 4xx · ağ→502 · zaman aşımı→504);
//    merkez düşükken diğer uçlar etkilenmez; hiçbir yanıtta anahtar yok
// §6 webhook: doğru imza 200 · yinelenen eventId işlenmeden 200 · yanlış imza 401 · eski/ileri zaman 401 · bozuk gövde
//    400 · sır yok 404 · ping/status_changed/başka firma (UUID olmayan · hazır olmayan tesis) push üretmez
// §7 push: yalnız AKTİF + bildirimi açık hesapların cihazlarına, başlık "Destek yanıtı", gövde no + konu + ≤100 özet;
//    geçersiz cihaz pasife; taşıyıcı hatası 200'ü bozmaz; BILDIRIM_KIPI=kapali iken gönderim yok
// =============================================================================
import { createHash, createHmac, randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/http/app";
import { hmacHex, multipartBodyHash, requestStringToSign, sha256Hex, webhookStringToSign } from "../src/integrations/destek/signature";
import { withTesis } from "../src/lib/tenant";
import { RecordingTransport } from "../src/push/transports";
import type { CloudContext } from "../src/services/context";
import { createSupportRuntime, type SupportRuntime } from "../src/services/destek/config";
import { PUSH_TITLE } from "../src/services/destek/webhook.service";
import { ayar, ayarYaz, cihazKaydet } from "./lib/bildirim-fikstur";
import { api, hesapKur, kontrol, ortamKur, sonuc, temizleTesis, tesisKur, type Ortam, type Yanit } from "./lib/test-ortam";

// Kılavuzun deneme vektörü (gerçek anahtar DEĞİL) ve uydurma webhook sırrı.
const TEST_KEY = "dst_test_ensar_0000000000000000000000000000000000000000000";
const TEST_HOOK = "whsec_testDestekBulut0000";
const TICKET_ID = "5f0c2a1e-8d4b-4c61-9a57-1d2e3f4a5b6c";
const ATTACHMENT_ID = "a3e1c2d4-1111-4222-8333-944455556666";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");

// ── Sahte merkez ────────────────────────────────────────────────────────────
interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  signatureOk: boolean;
  payload: unknown;
  files: Buffer[];
}
const seen: Seen[] = [];
/** Bu bekçinin tesisi: merkezdeki firma kimliği (`supportTenantId`). */
let TENANT = "";
type Reply = { status: number; body?: unknown; headers?: Record<string, string>; delayMs?: number };
let override: ((s: Seen) => Reply | null) | null = null;
let replayNext = false;

function ticket(status = "NEW"): Record<string, unknown> {
  return { id: TICKET_ID, number: "DST-2026-000123", type: "BUG", status, subject: "Deneme", createdAt: "2026-11-15T09:12:44.120Z", updatedAt: "2026-11-15T09:12:44.120Z", closedAt: null, messages: [] };
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
  return { status: 404, body: { error: { code: "NOT_FOUND", message: "Talep bulunamadı." } } };
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
  return { method, url, headers, signatureOk, payload, files };
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
      res.end(r.body === undefined ? "" : JSON.stringify(r.body));
    })();
  });
});

// ── Bulut sunucuları (aynı bağlam, farklı destek çalışma zamanı) ─────────────
interface Bulut {
  o: Ortam;
  rt: SupportRuntime | null;
  kapat: () => Promise<void>;
}

async function bulut(o: Ortam, rt: SupportRuntime | null, ezme: Partial<CloudContext> = {}): Promise<Bulut> {
  const ctx: CloudContext = { ...o.ctx, destek: rt, ...ezme };
  const server = http.createServer(createApp(ctx));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const adres = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { o: { ...o, adres, ctx }, rt, kapat: () => new Promise<void>((r) => server.close(() => r())) };
}

function runtime(env: Record<string, string>): SupportRuntime {
  return createSupportRuntime(env as NodeJS.ProcessEnv);
}

async function hamPost(adres: string, yol: string, govde: string, basliklar: Record<string, string>): Promise<Yanit> {
  const res = await fetch(`${adres}${yol}`, { method: "POST", headers: basliklar, body: govde });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Yanit["json"]) : { success: false }, headers: res.headers };
}

function webhookBasliklari(govde: string, ts: number, sir = TEST_HOOK): Record<string, string> {
  const h = createHash("sha256").update(govde).digest("hex");
  const imza = createHmac("sha256", sir).update(`${ts}.${h}`).digest("hex");
  return { "content-type": "application/json", "x-destek-event": "ticket.replied", "x-destek-delivery": randomUUID(), "x-destek-timestamp": String(ts), "x-destek-signature": imza };
}

function olay(tur: string, g: { eventId?: string; externalUserId?: string; tenant?: string; excerpt?: string } = {}): string {
  return JSON.stringify({
    eventId: g.eventId ?? randomUUID(),
    type: tur,
    occurredAt: "2026-11-15T10:03:10.512Z",
    installationId: "00000000-0000-4000-8000-000000000001",
    data:
      tur === "ping"
        ? { message: "Deneme" }
        : {
            ticketId: TICKET_ID,
            number: "DST-2026-000123",
            status: "ANSWERED",
            subject: "Sipariş onay e-postası gitmiyor",
            externalUserId: g.externalUserId ?? randomUUID(),
            externalTenantId: g.tenant ?? TENANT,
            lastMessage: { id: randomUUID(), kind: "AGENT_REPLY", authorName: "Destek Ekibi", excerpt: g.excerpt ?? "Onay e-postasını yeniden gönderdik.", createdAt: "2026-11-15T10:03:10.400Z" },
            messageId: randomUUID(),
          },
  });
}

const anahtarYok = (r: Yanit): boolean => !JSON.stringify(r.json).includes(TEST_KEY) && !JSON.stringify(r.json).includes(TEST_HOOK);
const kod = (r: Yanit): string | undefined => r.json.details?.code;

async function bekle(rt: SupportRuntime | null): Promise<void> {
  for (let i = 0; i < 50 && rt; i++) {
    if (rt.pending.size === 0) return;
    await Promise.allSettled([...rt.pending]);
  }
}

// ── §1 ──────────────────────────────────────────────────────────────────────
function imzaVektorleri(): void {
  console.log("\n§1 imza deneme vektörleri (kılavuz §3)");
  const ts = "1763164800";
  const nonce = "n0nce0123456789abcdef";
  const body = '{"type":"BUG","subject":"Sipariş onayı gelmiyor"}';
  kontrol("§1a JSON istek imzası vektörle aynı", hmacHex(TEST_KEY, requestStringToSign(ts, nonce, "POST", "/api/v1/integration/tickets", sha256Hex(body))) === "6e1c58839690bf9254898b3cbcb71ec3d31b81560bb7aa0c017258239f895324");
  kontrol("§1b GET (sorgulu) istek imzası vektörle aynı", hmacHex(TEST_KEY, requestStringToSign(ts, nonce, "GET", "/api/v1/integration/tickets?userId=kullanici-88&scope=mine", sha256Hex(""))) === "cb227cf7207213f26c563ec59f568a4f9a0c4c893e510639c92a6c4b6b1b28f9");
  kontrol("§1c webhook imzası vektörle aynı", hmacHex("whsec_ornekSir", webhookStringToSign(ts, sha256Hex('{"eventId":"e-1","type":"ticket.replied"}'))) === "2f36ec169beb821e48a177871f17875f37429afdb740f1b4ebc847b7441a8872");
}

// ── §2 ──────────────────────────────────────────────────────────────────────
async function kapali(o: Ortam, belirtec: string, merkez: string): Promise<void> {
  console.log("\n§2 KAPALI: dış istek yok");
  const varyantlar: [string, Record<string, string>][] = [
    ["ortam boş", {}],
    ["anahtar yok", { DESTEK_API_URL: merkez }],
    ["adres yok", { DESTEK_API_KEY: TEST_KEY }],
    ["düz HTTP (döngü dışı)", { DESTEK_API_URL: "http://destek.ornek.invalid/api/v1/integration", DESTEK_API_KEY: TEST_KEY }],
    ["anahtar biçimsiz", { DESTEK_API_URL: merkez, DESTEK_API_KEY: "sk_baska_bir_sey_0000000000" }],
  ];
  for (const [ad, env] of varyantlar) {
    const rt = runtime(env);
    kontrol(`§2a ${ad} → özellik kapalı, özet sırsız`, rt.api === null && !rt.summary.includes(TEST_KEY), rt.summary);
  }
  const b = await bulut(o, runtime({}));
  const once = seen.length;
  try {
    const d = await api(b.o, "GET", "/api/destek/durum", { belirtec });
    kontrol("§2b GET /destek/durum → 200 {etkin:false}", d.status === 200 && (d.json.data as { etkin: boolean }).etkin === false);
    const uclar: [string, string, unknown?][] = [
      ["POST", "/api/destek/talepler", { type: "BUG", subject: "x", message: "y", clientToken: "t-1" }],
      ["GET", "/api/destek/talepler"],
      ["GET", `/api/destek/talepler/${TICKET_ID}`],
      ["POST", `/api/destek/talepler/${TICKET_ID}/mesajlar`, { message: "y" }],
      ["POST", `/api/destek/talepler/${TICKET_ID}/kapat`, {}],
      ["POST", `/api/destek/talepler/${TICKET_ID}/okundu`, {}],
      ["GET", "/api/destek/okunmamis"],
      ["GET", `/api/destek/ekler/${ATTACHMENT_ID}/baglanti`],
      ["POST", "/api/destek/talepler", { gecersiz: true }],
    ];
    for (const [m, yol, govde] of uclar) {
      const r = await api(b.o, m, yol, { belirtec, ...(govde === undefined ? {} : { govde }) });
      kontrol(`§2c ${m} ${yol} → 403 MODULE_DISABLED`, r.status === 403 && kod(r) === "MODULE_DISABLED" && r.json.details?.modul === "destek", `${r.status} ${kod(r)}`);
    }
    const w = await hamPost(b.o.adres, "/api/destek/webhook", olay("ticket.replied"), webhookBasliklari(olay("ping"), Math.floor(o.saat.simdi() / 1000)));
    kontrol("§2d webhook sırrı yokken 404", w.status === 404, String(w.status));
    kontrol("§2e kapalıyken merkeze istek 0", seen.length === once, `${seen.length - once}`);
    const yetkisiz = await api(b.o, "GET", "/api/destek/durum");
    kontrol("§2f oturumsuz durum → 401", yetkisiz.status === 401);
  } finally {
    await b.kapat();
  }
  // Sır dosyası: 0640 açılır, herkese okunur 0644 reddedilir (özellik kapalı), boş dosya = kapalı.
  const dizin = mkdtempSync(path.join(os.tmpdir(), "destek-sir-"));
  try {
    const f = path.join(dizin, "anahtar");
    writeFileSync(f, `${TEST_KEY}\n`);
    chmodSync(f, 0o640);
    kontrol("§2g DESTEK_API_KEY_DOSYASI (0640) okunur → açık", runtime({ DESTEK_API_URL: merkez, DESTEK_API_KEY_DOSYASI: f }).api?.apiKey === TEST_KEY);
    chmodSync(f, 0o644);
    const acik = runtime({ DESTEK_API_URL: merkez, DESTEK_API_KEY_DOSYASI: f });
    kontrol("§2h herkese okunur sır dosyası → kapalı (neden adıyla)", acik.api === null && /herkese okunur/.test(acik.summary), acik.summary);
    writeFileSync(f, "");
    chmodSync(f, 0o640);
    kontrol("§2i boş sır dosyası → kapalı", runtime({ DESTEK_API_URL: merkez, DESTEK_API_KEY_DOSYASI: f }).api === null);
    kontrol("§2j ortam + dosya birlikte → belirsiz, kapalı", runtime({ DESTEK_API_URL: merkez, DESTEK_API_KEY: TEST_KEY, DESTEK_API_KEY_DOSYASI: f }).api === null);
  } finally {
    rmSync(dizin, { recursive: true, force: true });
  }
}

// ── §3 ──────────────────────────────────────────────────────────────────────
async function kimlik(b: Bulut, h: { belirtec: string; accountId: string; tesisId: string }, tesisAdi: string): Promise<void> {
  console.log("\n§3 kimlik oturumdan");
  const o = b.o;
  const d = await api(o, "GET", "/api/destek/durum", { belirtec: h.belirtec });
  kontrol("§3a durum {etkin:true}", d.status === 200 && (d.json.data as { etkin: boolean }).etkin === true);
  let once = seen.length;
  const sahte = await api(o, "POST", "/api/destek/talepler", { belirtec: h.belirtec, govde: { type: "BUG", subject: "x", message: "y", clientToken: "t-1", user: { id: "baskasi", name: "X" } } });
  kontrol("§3b gövdede user → 400 (katı gövde), merkeze gitmez", sahte.status === 400 && kod(sahte) === "GOVDE_GECERSIZ" && seen.length === once, `${sahte.status}`);
  const token = randomUUID();
  const govde = { type: "BUG", subject: "  İrsaliye yazdırılmıyor ", message: "Boş sayfa çıkıyor.", clientToken: token, context: { screen: "Pano", client: { os: "iOS 18", appVersion: "1.2.3" }, productVersion: "99.0.0", technical: { son: "hata" } } };
  once = seen.length;
  const r = await api(o, "POST", "/api/destek/talepler", { belirtec: h.belirtec, govde });
  const c = seen[once];
  const p = (c?.payload ?? {}) as { user?: Record<string, unknown>; tenant?: Record<string, unknown>; subject?: string; context?: { productVersion?: string; client?: Record<string, unknown>; technical?: Record<string, unknown> } };
  kontrol("§3c yeni talep → 201, idempotentReplay false", r.status === 201 && (r.json.data as { idempotentReplay: boolean }).idempotentReplay === false, String(r.status));
  kontrol("§3d merkeze TEK istek, imza geçerli, Idempotency-Key = clientToken", seen.length === once + 1 && !!c?.signatureOk && c.headers["idempotency-key"] === token);
  kontrol("§3e user.id = oturum hesabı, isTenantAdmin true, rol Yönetici", p.user?.id === h.accountId && p.user?.isTenantAdmin === true && p.user?.role === "Yönetici" && typeof p.user?.name === "string", JSON.stringify(p.user));
  kontrol("§3f tenant.id = oturumun tesis kimliği (müşteri sabiti değil), ad = tesis adı", p.tenant?.id === h.tesisId.toLowerCase() && p.tenant?.name === tesisAdi, JSON.stringify(p.tenant));
  kontrol("§3g konu kırpıldı; istemcinin productVersion'ı yok sayıldı; clientKind patron; client.appVersion geçti; IP yok", p.subject === "İrsaliye yazdırılmıyor" && p.context?.productVersion !== "99.0.0" && p.context?.technical?.clientKind === "patron" && p.context?.client?.appVersion === "1.2.3" && !JSON.stringify(p).includes("127.0.0.1"));
  replayNext = true;
  const tekrar = await api(o, "POST", "/api/destek/talepler", { belirtec: h.belirtec, govde });
  kontrol("§3h aynı clientToken → 200 + Idempotent-Replay + idempotentReplay true", tekrar.status === 200 && tekrar.headers.get("idempotent-replay") === "true" && (tekrar.json.data as { idempotentReplay: boolean }).idempotentReplay === true);
  const iz = await withTesis(o.goc, { tesisId: h.tesisId }, (tx) => tx.accountAudit.findMany({ where: { tesisId: h.tesisId, event: "DESTEK_TALEP_ACILDI" } }));
  kontrol("§3i denetim: tek satır (tekrar iz bırakmaz), yükte metin YOK", iz.length === 1 && !JSON.stringify(iz[0]?.summary).includes("Boş sayfa") && (iz[0]?.summary as { kod?: string })?.kod === "DST-2026-000123", `${iz.length}`);
  once = seen.length;
  const l = await api(o, "GET", "/api/destek/talepler?scope=tenant&status=NEW,ANSWERED&limit=10", { belirtec: h.belirtec });
  const q = new URL(seen[once]?.url ?? "/", "http://x").searchParams;
  kontrol("§3j liste: scope=tenant izinli; sorgu kimliği oturumdan (userId · tenantId · isTenantAdmin)", l.status === 200 && q.get("userId") === h.accountId && q.get("tenantId") === h.tesisId.toLowerCase() && q.get("isTenantAdmin") === "true" && q.get("scope") === "tenant" && q.get("status") === "NEW,ANSWERED" && !!seen[once]?.signatureOk);
  const kotu = await api(o, "GET", "/api/destek/talepler?status=YOK", { belirtec: h.belirtec });
  kontrol("§3k bilinmeyen durum → 400 merkeze gitmeden", kotu.status === 400 && seen.length === once + 1);
  const yanit = await api(o, "POST", `/api/destek/talepler/${TICKET_ID}/mesajlar`, { belirtec: h.belirtec, govde: { message: "Ekledim." } });
  const yp = seen[seen.length - 1]?.payload as { user?: { id?: string }; tenant?: { id?: string } };
  kontrol("§3l yanıt → 201; user + tenant oturumdan", yanit.status === 201 && yp?.user?.id === h.accountId && yp?.tenant?.id === h.tesisId.toLowerCase());
  const kapa = await api(o, "POST", `/api/destek/talepler/${TICKET_ID}/kapat`, { belirtec: h.belirtec, govde: {} });
  const oku = await api(o, "POST", `/api/destek/talepler/${TICKET_ID}/okundu`, { belirtec: h.belirtec, govde: {} });
  const ayr = await api(o, "GET", `/api/destek/talepler/${TICKET_ID}`, { belirtec: h.belirtec });
  const rozet = await api(o, "GET", "/api/destek/okunmamis?scope=tenant", { belirtec: h.belirtec });
  const ek = await api(o, "GET", `/api/destek/ekler/${ATTACHMENT_ID}/baglanti?variant=thumb`, { belirtec: h.belirtec });
  const ekUrl = new URL(seen[seen.length - 1]?.url ?? "/", "http://x");
  kontrol("§3m kapat 200 CLOSED · okundu 200 · ayrıntı 200 · rozet {count,tickets} · ek bağlantısı (variant=thumb)", kapa.status === 200 && (kapa.json.data as { status: string }).status === "CLOSED" && oku.status === 200 && ayr.status === 200 && (rozet.json.data as { tickets: number }).tickets === 2 && ek.status === 200 && ekUrl.searchParams.get("variant") === "thumb");
  const idsiz = await api(o, "GET", "/api/destek/talepler/kimlik-degil", { belirtec: h.belirtec });
  kontrol("§3n UUID olmayan kimlik → 404 BULUNAMADI merkeze gitmeden", idsiz.status === 404 && kod(idsiz) === "BULUNAMADI");
}

// ── §4 ──────────────────────────────────────────────────────────────────────
async function ekler(b: Bulut, belirtec: string): Promise<void> {
  console.log("\n§4 base64 ek doğrulaması");
  const o = b.o;
  const temel = { type: "BUG", subject: "Ek", message: "Ekte.", clientToken: randomUUID() };
  const durumlar: [string, unknown[], string, number?][] = [
    ["izinsiz tür", [{ name: "a.exe", contentType: "application/x-msdownload", dataBase64: PNG.toString("base64") }], "ATTACHMENT_INVALID", 0],
    ["bozuk base64", [{ name: "a.png", contentType: "image/png", dataBase64: "@@@@" }], "ATTACHMENT_INVALID", 0],
    ["içerik/tür uyuşmuyor (2. ek)", [{ name: "a.png", contentType: "image/png", dataBase64: PNG.toString("base64") }, { name: "b.pdf", contentType: "application/pdf", dataBase64: PNG.toString("base64") }], "ATTACHMENT_INVALID", 1],
    ["6 dosya", Array.from({ length: 6 }, () => ({ name: "a.png", contentType: "image/png", dataBase64: PNG.toString("base64") })), "GOVDE_GECERSIZ"],
  ];
  for (const [ad, files, beklenen, sira] of durumlar) {
    const once = seen.length;
    const r = await api(o, "POST", "/api/destek/talepler", { belirtec, govde: { ...temel, files } });
    kontrol(`§4a ${ad} → 400 ${beklenen} merkeze gitmeden`, r.status === 400 && kod(r) === beklenen && (sira === undefined || r.json.details?.index === sira) && seen.length === once, `${r.status} ${kod(r)} ${String(r.json.details?.index)}`);
  }
  const buyuk = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);
  let once = seen.length;
  const r10 = await api(o, "POST", "/api/destek/talepler", { belirtec, govde: { ...temel, files: [{ name: "b.png", contentType: "image/png", dataBase64: buyuk.toString("base64") }] } });
  kontrol("§4b 10 MB üstü → 400 ATTACHMENT_TOO_LARGE (büyük gövde ekli uçta okunur, merkeze gitmez)", r10.status === 400 && kod(r10) === "ATTACHMENT_TOO_LARGE" && seen.length === once, `${r10.status} ${kod(r10)}`);
  once = seen.length;
  const ok = await api(o, "POST", `/api/destek/talepler/${TICKET_ID}/mesajlar`, { belirtec, govde: { message: "Görsel", files: [{ name: "../../gizli/ekran.png", contentType: "IMAGE/PNG", dataBase64: PNG.toString("base64").replace(/(.{8})/g, "$1\n") }] } });
  const c = seen[once];
  kontrol("§4c geçerli ek → multipart, imza geçerli, bayt aynı", ok.status === 201 && !!c?.signatureOk && c.files.length === 1 && c.files[0]!.equals(PNG) && String(c.headers["content-type"]).startsWith("multipart/form-data"));
  const genel = await api(o, "POST", `/api/destek/talepler/${TICKET_ID}/kapat`, { belirtec, govde: { dolgu: "x".repeat(300 * 1024) } });
  kontrol("§4d ekli OLMAYAN uçta genel 256 KB sınırı → 413", genel.status === 413, String(genel.status));
}

// ── §5 ──────────────────────────────────────────────────────────────────────
async function hatalar(b: Bulut, o0: Ortam, belirtec: string): Promise<void> {
  console.log("\n§5 hata eşlemesi");
  const o = b.o;
  const durumlar: [string, Reply, number, string, ((r: Yanit) => boolean)?][] = [
    ["404 NOT_FOUND", { status: 404, body: { error: { code: "NOT_FOUND", message: "Talep bulunamadı." } } }, 404, "NOT_FOUND", (r) => r.json.message === "Talep bulunamadı."],
    ["409 REOPEN_WINDOW_EXPIRED", { status: 409, body: { error: { code: "REOPEN_WINDOW_EXPIRED", message: "Süre doldu." } } }, 409, "REOPEN_WINDOW_EXPIRED"],
    ["410 ATTACHMENT_EXPIRED", { status: 410, body: { error: { code: "ATTACHMENT_EXPIRED", message: "Silindi." } } }, 410, "ATTACHMENT_EXPIRED"],
    ["429 + Retry-After", { status: 429, body: { error: { code: "RATE_LIMITED", message: "Yavaş." } }, headers: { "Retry-After": "17" } }, 429, "RATE_LIMITED", (r) => r.json.details?.retryAfterSec === 17 && r.headers.get("retry-after") === "17"],
    ["5xx → 502", { status: 503, body: { error: { code: "INTERNAL_ERROR", message: "x" } } }, 502, "DESTEK_ULASILAMADI", (r) => r.json.details?.merkezKodu === "INTERNAL_ERROR"],
    ["401 INVALID_API_KEY → 502 (oturum düşmesin)", { status: 401, body: { error: { code: "INVALID_API_KEY", message: "Anahtar yanlış." } } }, 502, "DESTEK_YAPILANDIRMA"],
    ["403 INSTALLATION_INACTIVE → 502", { status: 403, body: { error: { code: "INSTALLATION_INACTIVE", message: "Pasif." } } }, 502, "DESTEK_YAPILANDIRMA"],
    ["409 REPLAYED → 502", { status: 409, body: { error: { code: "REPLAYED", message: "Tekrar." } } }, 502, "DESTEK_ULASILAMADI"],
    ["bilinmeyen 4xx kodu → DESTEK_HATASI", { status: 400, body: { error: { code: "YENI_BIR_KOD", message: "Merkez metni." } } }, 400, "DESTEK_HATASI", (r) => r.json.details?.merkezKodu === "YENI_BIR_KOD"],
  ];
  for (const [ad, reply, http_, kodu, ek] of durumlar) {
    override = () => reply;
    const r = await api(o, "GET", `/api/destek/talepler/${TICKET_ID}`, { belirtec });
    kontrol(`§5a ${ad} → ${http_} ${kodu}, anahtar yanıtta yok`, r.status === http_ && kod(r) === kodu && (ek ? ek(r) : true) && anahtarYok(r), `${r.status} ${kod(r)}`);
  }
  override = () => ({ status: 200, body: { count: 1, tickets: 1 }, delayMs: 6_000 });
  const t0 = Date.now();
  const yavas = await api(o, "GET", "/api/destek/okunmamis", { belirtec });
  kontrol("§5b rozet 5 sn zaman aşımı → 504 DESTEK_ZAMAN_ASIMI", yavas.status === 504 && kod(yavas) === "DESTEK_ZAMAN_ASIMI" && Date.now() - t0 < 5_900, `${yavas.status} ${Date.now() - t0}ms`);
  override = null;
  // Merkez erişilemez: kapalı port → 502; bulutun diğer uçları etkilenmez.
  const kapaliPort = await new Promise<number>((r) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => r(p));
    });
  });
  const d = await bulut(o0, runtime({ DESTEK_API_URL: `http://127.0.0.1:${kapaliPort}/api/v1/integration`, DESTEK_API_KEY: TEST_KEY }));
  try {
    const ag = await api(d.o, "GET", "/api/destek/talepler", { belirtec });
    kontrol("§5c ağ hatası → 502 DESTEK_ULASILAMADI (merkezKodu NETWORK_ERROR)", ag.status === 502 && kod(ag) === "DESTEK_ULASILAMADI" && ag.json.details?.merkezKodu === "NETWORK_ERROR" && anahtarYok(ag));
    const oturum = await api(d.o, "GET", "/api/oturum", { belirtec });
    kontrol("§5d merkez düşükken diğer uçlar etkilenmez (GET /api/oturum 200)", oturum.status === 200);
  } finally {
    await d.kapat();
  }
}

// ── §6 + §7 ─────────────────────────────────────────────────────────────────
async function webhook(b: Bulut, transport: RecordingTransport, g: { tesisId: string; talepEden: string; cihazlar: { a: string; b: string; kapali: string; pasif: string } }): Promise<void> {
  console.log("\n§6 webhook (kılavuz §6)");
  const o = b.o;
  const simdi = (): number => Math.floor(o.saat.simdi() / 1000);
  const uzun = "Ö".repeat(250);
  const govde = olay("ticket.replied", { externalUserId: g.talepEden, excerpt: uzun });
  let gonderilen = transport.sent.length;
  const ilk = await hamPost(o.adres, "/api/destek/webhook", govde, webhookBasliklari(govde, simdi()));
  kontrol("§6a doğru imza → 200 {alindi, yinelenen:false}", ilk.status === 200 && (ilk.json.data as { yinelenen: boolean }).yinelenen === false, `${ilk.status} ${JSON.stringify(ilk.json)}`);
  await bekle(b.rt);
  const gidenler = transport.sent.slice(gonderilen);
  const hedefler = new Set(gidenler.map((x) => x.target.token));
  console.log("\n§7 push");
  kontrol("§7a yalnız AKTİF + bildirimi açık hesapların cihazları (talep eden + diğer patron)", hedefler.size === 2 && hedefler.has(g.cihazlar.a) && hedefler.has(g.cihazlar.b) && !hedefler.has(g.cihazlar.kapali) && !hedefler.has(g.cihazlar.pasif), [...hedefler].join(","));
  const m = gidenler[0]?.msg;
  const satirlar = (m?.body ?? "").split("\n");
  kontrol("§7b başlık 'Destek yanıtı'; gövde no + konu; özet ≤ 100 karakter; rota /destek/<id>", m?.title === PUSH_TITLE && satirlar[0] === "DST-2026-000123 · Sipariş onay e-postası gitmiyor" && (satirlar[1]?.length ?? 999) <= 100 && m?.route === `/destek/${TICKET_ID}`, JSON.stringify(m));
  gonderilen = transport.sent.length;
  const tekrar = await hamPost(o.adres, "/api/destek/webhook", govde, webhookBasliklari(govde, simdi()));
  await bekle(b.rt);
  kontrol("§6b aynı eventId ikinci kez → 200 yinelenen:true, push YOK", tekrar.status === 200 && (tekrar.json.data as { yinelenen: boolean }).yinelenen === true && transport.sent.length === gonderilen);
  const yeni = olay("ticket.replied");
  const yanlis = await hamPost(o.adres, "/api/destek/webhook", yeni, webhookBasliklari(yeni, simdi(), "whsec_baskaSir0000000"));
  kontrol("§6c yanlış sır → 401 INVALID_SIGNATURE", yanlis.status === 401 && kod(yanlis) === "INVALID_SIGNATURE" && anahtarYok(yanlis));
  const oynanmis = webhookBasliklari(yeni, simdi());
  const degismis = yeni.replace("Sipariş", "Sipariş!");
  const bozuk = await hamPost(o.adres, "/api/destek/webhook", degismis, oynanmis);
  kontrol("§6d gövde değişmiş (ham gövde imzası tutmaz) → 401", bozuk.status === 401 && kod(bozuk) === "INVALID_SIGNATURE");
  const eski = await hamPost(o.adres, "/api/destek/webhook", yeni, webhookBasliklari(yeni, simdi() - 301));
  const ileri = await hamPost(o.adres, "/api/destek/webhook", yeni, webhookBasliklari(yeni, simdi() + 301));
  kontrol("§6e zaman damgası ±300 sn dışı → 401 TIMESTAMP_OUT_OF_RANGE (eski · ileri)", eski.status === 401 && kod(eski) === "TIMESTAMP_OUT_OF_RANGE" && ileri.status === 401 && kod(ileri) === "TIMESTAMP_OUT_OF_RANGE");
  const ping = olay("ping");
  const pingR = await hamPost(o.adres, "/api/destek/webhook", ping, webhookBasliklari(ping, simdi() - 299));
  const basliksiz = await hamPost(o.adres, "/api/destek/webhook", ping, { "content-type": "application/json" });
  kontrol("§6f imza başlıkları eksik → 401; sınır içi (−299 sn) ping → 200", basliksiz.status === 401 && pingR.status === 200, `${basliksiz.status} ${pingR.status}`);
  const json = "{bozuk";
  const bj = await hamPost(o.adres, "/api/destek/webhook", json, webhookBasliklari(json, simdi()));
  kontrol("§6g imzası doğru ama gövde JSON değil → 400 INVALID_PAYLOAD", bj.status === 400 && kod(bj) === "INVALID_PAYLOAD");
  gonderilen = transport.sent.length;
  const baskaTesis = randomUUID();
  for (const [ad, v] of [["ping", olay("ping")], ["status_changed", olay("ticket.status_changed")], ["başka firma (UUID değil)", olay("ticket.replied", { tenant: "baska-firma" })], ["başka tesis (bu bulutta hazır değil)", olay("ticket.replied", { tenant: baskaTesis })]] as const) {
    const r = await hamPost(o.adres, "/api/destek/webhook", v, webhookBasliklari(v, simdi()));
    kontrol(`§6h ${ad} → 200, push yok`, r.status === 200);
  }
  await bekle(b.rt);
  kontrol("§6i ping / status_changed / başka firma / başka tesis push üretmedi", transport.sent.length === gonderilen, `${transport.sent.length - gonderilen}`);
  const buyuk = olay("ticket.replied", { tenant: g.tesisId.toUpperCase() });
  await hamPost(o.adres, "/api/destek/webhook", buyuk, webhookBasliklari(buyuk, simdi()));
  await bekle(b.rt);
  kontrol("§6j tesis kimliği büyük harfle gelse de aynı tesise push", transport.sent.length > gonderilen, `${transport.sent.length - gonderilen}`);
  // Geçersiz cihaz pasife; taşıyıcı istisnası yanıtı bozmaz.
  transport.forced.set(g.cihazlar.b, { kind: "GECERSIZ_CIHAZ", code: "EXPO_CIHAZ_KAYITSIZ" });
  const iki = olay("ticket.replied");
  const r2 = await hamPost(o.adres, "/api/destek/webhook", iki, webhookBasliklari(iki, simdi()));
  await bekle(b.rt);
  const aktif = await withTesis(o.goc, { tesisId: g.tesisId }, (tx) => tx.pushDevice.findMany({ where: { token: g.cihazlar.b }, select: { active: true } }));
  kontrol("§7c geçersiz cihaz pasife çekildi; yanıt 200", r2.status === 200 && aktif.length === 1 && aktif[0]!.active === false);
  const firlatan = { send: () => Promise.reject(new Error("taşıyıcı çöktü")) };
  const fb = await bulut(o, b.rt, { notifications: { transport: firlatan, webPushKey: null } });
  try {
    const uc = olay("ticket.replied");
    const r3 = await hamPost(fb.o.adres, "/api/destek/webhook", uc, webhookBasliklari(uc, simdi()));
    await bekle(fb.rt);
    kontrol("§7d taşıyıcı istisnası → webhook yine 200", r3.status === 200);
  } finally {
    await fb.kapat();
  }
  const kb = await bulut(o, b.rt, { notifications: null });
  try {
    gonderilen = transport.sent.length;
    const dort = olay("ticket.replied");
    const r4 = await hamPost(kb.o.adres, "/api/destek/webhook", dort, webhookBasliklari(dort, simdi()));
    await bekle(kb.rt);
    kontrol("§7e BILDIRIM_KIPI=kapali → 200, gönderim yok", r4.status === 200 && transport.sent.length === gonderilen);
  } finally {
    await kb.kapat();
  }
}

async function main(): Promise<void> {
  imzaVektorleri();
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
  const merkez = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/api/v1/integration`;
  const o = await ortamKur({ BILDIRIM_KIPI: "sahte" });
  const transport = o.ctx.notifications!.transport as RecordingTransport;
  const tesisAdi = `Destek Bekçi ${randomUUID().slice(0, 6)}`;
  const k = await tesisKur(o, { ad: tesisAdi });
  TENANT = k.tesisId.toLowerCase();
  let b: Bulut | null = null;
  try {
    const a = await hesapKur(o, k.tesisId, ["bulut:ozet:oku"]);
    const ikinci = await hesapKur(o, k.tesisId, ["bulut:ozet:oku"]);
    const sessiz = await hesapKur(o, k.tesisId, ["bulut:ozet:oku"]);
    const kapanan = await hesapKur(o, k.tesisId, ["bulut:ozet:oku"]);
    const cihazlar = { a: await cihazKaydet(o, a), b: await cihazKaydet(o, ikinci), kapali: await cihazKaydet(o, sessiz), pasif: await cihazKaydet(o, kapanan) };
    for (const h of [a, ikinci, kapanan]) await ayarYaz(o, h, ayar());
    await ayarYaz(o, sessiz, ayar({ acik: false }));
    await withTesis(o.goc, { tesisId: k.tesisId }, (tx) => tx.account.update({ where: { id: kapanan.accountId }, data: { status: "PASIF", closedAt: new Date() } }));

    await kapali(o, a.belirtec, merkez);
    b = await bulut(o, runtime({ DESTEK_API_URL: merkez, DESTEK_API_KEY: TEST_KEY, DESTEK_WEBHOOK_SECRET: TEST_HOOK }));
    kontrol("§3 açık çalışma zamanı: özet sırsız", b.rt!.api !== null && b.rt!.webhookSecret !== null && !b.rt!.summary.includes(TEST_KEY) && !b.rt!.summary.includes(TEST_HOOK), b.rt!.summary);
    await kimlik(b, { ...a, tesisId: k.tesisId }, tesisAdi);
    await ekler(b, a.belirtec);
    await hatalar(b, o, a.belirtec);
    await webhook(b, transport, { tesisId: k.tesisId, talepEden: a.accountId, cihazlar });
  } finally {
    await b?.kapat();
    await temizleTesis(o, k.tesisId);
    await o.kapat();
    await new Promise<void>((r) => fake.close(() => r()));
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ beklenmeyen hata: ${err.stack ?? err.message}`);
  process.exit(1);
});
