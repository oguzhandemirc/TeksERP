// =============================================================================
// BEKÇİ — İSTEK LOGU: erişim satırı (süre/rid/uid/code) + yavaş istek halkası teşhis künyesi
// =============================================================================
// Çalıştırma: npx tsx scripts/test_istek_log.ts   (DB YOK — süreç içi mini Express, gerçek middleware'ler)
//
// NEDEN (2026-11-07, Adnan Şahin canlı ölçümü): /api/rolls · /api/work-orders kuyruğu (%0,4 > 500 ms) hiçbir
//   sorgu şekliyle yeniden üretilemedi; erişim logunda süre/istek kimliği/kullanıcı yoktu, yavaş halka yalnız
//   route+ms tutuyor ve 1 sn eşiğiyle kuyruğu hiç görmüyordu.
//
// NE ÖLÇER
//   §1 saf: gelen `x-request-id` süzgeci · `details.code` okuyucu · maskeli sorgu · uyarı satırı biçimi
//   §2 ⭐ (a) 600 ms istek halkaya reqId+userId+clientType+maskeli sorgu ile düşer, 400 ms düşmez; tek UYARI satırı
//   §3 ⭐ (b) sorguda password=/token= maskeli — halkada, uyarı satırında, erişim satırında
//   §4 ⭐ (c) `X-Request-Id`: üretilir · geçerli gelen değer korunur · bozuk değer yeniden üretilir
//   §5 ⭐ (d) erişim satırı: 4xx'te code=<details.code>, 2xx'te code=-; süre + rid + uid; Authorization sızmaz
//   §6 app.ts kablolaması: requestIdMiddleware morgan'dan ÖNCE, üretim biçimi PROD_ACCESS_LOG_FORMAT
//   §7 ⭐ UYARI satırı hız sınırı: 25 yavaş → 20 satır + pencere kapanınca 1 özet (saat enjekte); halka etkilenmez
//
// NEGATİF SONDALAR (2026-11-07, ölçüldü; geri alındı):
//   (1) `redactedQueryOf` içinde `redactSecretQueryParams(url)` → `url`: §1e + §3a + §3b = 3 KIRMIZI (21/3)
//   (2) `SLOW_REQUEST_MS = 1_000`: §2a + §2b + §2c + §2d + §3a + §3b = 6 KIRMIZI (18/6)
//   (3) hız sınırı sökük (`SLOW_LOG_MAX_PER_WINDOW = Infinity`): §7a + §7c + §7d = 3 KIRMIZI (26/3)
//   (4) `quickpin` sır kümesinden sökük: §1h KIRMIZI (28/1)
// =============================================================================
import express, { type Request, type Response, type NextFunction } from "express";
import http from "http";
import type { AddressInfo } from "net";
import { readFileSync } from "fs";
import path from "path";
import morgan from "morgan";
import {
  requestIdMiddleware,
  sanitizeIncomingRequestId,
  readErrorCode,
} from "../src/middlewares/request-id.middleware";
import { latencyMiddleware, redactedQueryOf } from "../src/middlewares/latency.middleware";
import {
  latencySnapshot,
  resetLatencyStats,
  formatSlowRequestLine,
  recordLatency,
  setLatencyClockForTest,
  SLOW_REQUEST_MS,
  SLOW_LOG_MAX_PER_WINDOW,
  SLOW_LOG_WINDOW_MS,
} from "../src/services/latency-stats.service";
import { PROD_ACCESS_LOG_FORMAT, registerAccessLogTokens } from "../src/lib/access-log";
import type { JwtPayload } from "../src/types/api.types";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIR = { parola: "GizliParola-77", token: "tok-SIR-abc123", bearer: "eyJhbGciOiJTIR.BEARER-SIR.imza" };

// ─── §1 saf ─────────────────────────────────────────────────────────────────
function section1(): void {
  check("§1a geçerli gelen kimlik korunur", sanitizeIncomingRequestId("saha-test.01:a") === "saha-test.01:a");
  check(
    "§1b bozuk/kısa/uzun/boşluklu/satır sonlu kimlik reddedilir",
    [undefined, "", "kisa", "a".repeat(65), "bosluk var 1234", "satir\nsonu1234", "x<script>1234"].every(
      (v) => sanitizeIncomingRequestId(v) === null,
    ),
  );
  check("§1c dizi başlıkta ilk değer süzülür", sanitizeIncomingRequestId(["abcdefgh-1", "z"]) === "abcdefgh-1");
  check(
    "§1d readErrorCode yalnız details.code okur (body.code değil)",
    readErrorCode({ details: { code: "X_CODE" } }) === "X_CODE" && readErrorCode({ code: "UST" }) === null && readErrorCode(null) === null,
  );
  const q = redactedQueryOf(`/api/rolls?password=${SIR.parola}&token=${SIR.token}&status=OK`);
  check(
    "§1e ⭐ redactedQueryOf: password/token MASKELİ, diğer parametre korunur",
    q === "password=***&token=***&status=OK",
    String(q),
  );
  const q2 = redactedQueryOf("/api/x?quickPin=1234&apiKey=AK1&otp=99&imza=IM&signature=SG&key=K1&code=TKS-001");
  check(
    "§1h ek sır adları maskeli (quickPin/apiKey büyük-küçük harften bağımsız); `code` iş verisi olarak KALIR",
    q2 === "quickPin=***&apiKey=***&otp=***&imza=***&signature=***&key=***&code=TKS-001",
    String(q2),
  );
  check("§1f sorgusuz URL → null", redactedQueryOf("/api/rolls") === null && redactedQueryOf("/api/rolls?") === null);
  const line = formatSlowRequestLine({
    at: 0, method: "GET", route: "/api/rolls", status: 200, ms: 612,
    reqId: "r1", userId: null, clientType: "TABLET", query: null,
  });
  check("§1g uyarı satırı tek satır, boş alan '-'", line === "612ms GET /api/rolls status=200 rid=r1 uid=- client=TABLET q=-", line);
}

// ─── mini uygulama: gerçek middleware'ler, sahte kimlik ─────────────────────
const accessLines: string[] = [];
const warnLines: string[] = [];

function buildApp(): express.Express {
  registerAccessLogTokens(morgan);
  const app = express();
  app.use(requestIdMiddleware);
  app.use(morgan(PROD_ACCESS_LOG_FORMAT, { stream: { write: (l: string) => void accessLines.push(l) } }));
  app.use(latencyMiddleware);
  // verifyToken yerine: yalnız `x-test-user` varsa kullanıcı doldurulur (Authorization'a BAKILMAZ).
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const uid = req.headers["x-test-user"];
    if (typeof uid === "string") req.user = { userId: uid } as JwtPayload;
    next();
  });
  const bekle = (ms: number) => (_req: Request, res: Response) => {
    setTimeout(() => res.status(200).json({ success: true }), ms);
  };
  app.get("/api/yavas", bekle(600));
  app.get("/api/orta", bekle(400));
  app.get("/api/hizli", (_req, res) => void res.status(200).json({ success: true, data: [] }));
  app.post("/api/cakisma", (_req, res) =>
    void res.status(409).json({ success: false, message: "Çakışma", details: { code: "TEST_CONFLICT" } }),
  );
  return app;
}

interface Yanit { status: number; headers: http.IncomingHttpHeaders }
function istek(port: number, method: string, p: string, headers: Record<string, string> = {}): Promise<Yanit> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, path: p, method, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    r.on("error", reject);
    r.end();
  });
}

async function sections2to5(port: number): Promise<void> {
  resetLatencyStats();
  const yavasQ = `/api/yavas?password=${SIR.parola}&token=${SIR.token}&status=OK`;
  const ortaQ = "/api/orta?status=OK";
  const hdr = { "x-test-user": "u-yavas-1", "x-client-kind": "mobil", "x-request-id": "saha-yavas-0001", authorization: `Bearer ${SIR.bearer}` };
  await istek(port, "GET", yavasQ, hdr);
  await istek(port, "GET", ortaQ, { ...hdr, "x-request-id": "saha-orta-0001" });
  await new Promise((r) => setTimeout(r, 30));

  // §2 (a)
  const slow = latencySnapshot().slowRequests;
  const yavas = slow.find((s) => s.route === "/api/yavas");
  check("§2a ⭐ 600 ms istek yavaş halkaya düştü", !!yavas, JSON.stringify(slow));
  check(
    "§2b ⭐ halka kaydı reqId + userId + clientType taşır",
    yavas?.reqId === "saha-yavas-0001" && yavas?.userId === "u-yavas-1" && yavas?.clientType === "mobil",
    JSON.stringify(yavas),
  );
  check("§2c ⭐ 400 ms istek halkaya DÜŞMEZ (eşik 500)", !slow.some((s) => s.route === "/api/orta") && SLOW_REQUEST_MS === 500);
  const warn = warnLines.filter((l) => l.includes("[yavas-istek]"));
  check(
    "§2d ⭐ yavaş istek TEK greplenebilir UYARI satırı (yalnız 600 ms)",
    warn.length === 1 && warn[0]!.startsWith("UYARI [yavas-istek] ") && warn[0]!.includes("rid=saha-yavas-0001 uid=u-yavas-1 client=mobil") && !warn[0]!.includes("\n"),
    warn.join(" ¶ "),
  );

  // §3 (b)
  check("§3a ⭐ halkadaki sorgu maskeli", yavas?.query === "password=***&token=***&status=OK", String(yavas?.query));
  check("§3b ⭐ uyarı satırında sır yok, maske var", warn.length === 1 && !warn[0]!.includes(SIR.parola) && !warn[0]!.includes(SIR.token) && warn[0]!.includes("password=***"));
  const yavasAccess = accessLines.find((l) => l.includes("/api/yavas"));
  check(
    "§3c ⭐ erişim satırında sır yok (url maskeli, Authorization/Bearer hiç yok)",
    !!yavasAccess && !yavasAccess.includes(SIR.parola) && !yavasAccess.includes(SIR.token) && !accessLines.join("").includes("BEARER-SIR") && yavasAccess.includes("password=***"),
    String(yavasAccess),
  );

  // §4 (c)
  const uretilen = await istek(port, "GET", "/api/hizli");
  check("§4a ⭐ başlıksız istek: X-Request-Id üretilir (UUID)", UUID_RE.test(String(uretilen.headers["x-request-id"])), String(uretilen.headers["x-request-id"]));
  const korunan = await istek(port, "GET", "/api/hizli", { "x-request-id": "istemci-kimlik-42" });
  check("§4b ⭐ geçerli gelen değer korunur", korunan.headers["x-request-id"] === "istemci-kimlik-42");
  const bozuk = await istek(port, "GET", "/api/hizli", { "x-request-id": "kotu deger;<x>" });
  check(
    "§4c ⭐ bozuk değer yeniden üretilir",
    UUID_RE.test(String(bozuk.headers["x-request-id"])) && bozuk.headers["x-request-id"] !== "kotu deger;<x>",
    String(bozuk.headers["x-request-id"]),
  );

  // §5 (d)
  accessLines.length = 0;
  await istek(port, "POST", "/api/cakisma", { "x-test-user": "u-cakisma-2", "x-request-id": "cakisma-req-01" });
  await istek(port, "GET", "/api/hizli", { "x-request-id": "hizli-req-0001" });
  await new Promise((r) => setTimeout(r, 30));
  const c409 = accessLines.find((l) => l.includes("/api/cakisma")) ?? "";
  const c200 = accessLines.find((l) => l.includes("/api/hizli")) ?? "";
  check("§5a ⭐ 4xx satırı: code=<details.code>", / 409 .*code=TEST_CONFLICT\s*$/.test(c409), c409.trim());
  check("§5b ⭐ 2xx satırı: code=-", / 200 .*code=-\s*$/.test(c200), c200.trim());
  check("§5c satır süre + rid + uid taşır", /" \d+ms rid=cakisma-req-01 uid=u-cakisma-2 code=/.test(c409), c409.trim());
  check("§5d kullanıcısız istek uid=-; remote-user hep '-'", /rid=hizli-req-0001 uid=- /.test(c200) && /^\S+ - - \[/.test(c200), c200.trim());
}

// ─── §7 yavaş istek UYARI satırı hız sınırı (saat enjekte) ─────────────────
function section7(): void {
  const lines: string[] = [];
  const asil = console.warn;
  let t = 5_000_000;
  setLatencyClockForTest(() => t);
  resetLatencyStats();
  console.warn = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try {
    for (let i = 0; i < 25; i++) recordLatency("GET", "/api/sel", 200, 600 + i);
    const tekil = lines.filter((l) => l.startsWith("UYARI [yavas-istek] ") && l.includes("/api/sel"));
    check("§7a ⭐ 25 yavaş istek → pencerede 20 satır (tavan 20/60 sn)", tekil.length === 20 && SLOW_LOG_MAX_PER_WINDOW === 20 && SLOW_LOG_WINDOW_MS === 60_000, `${tekil.length}`);
    check("§7b halka sınırsız beslenir (25 kayıt, tavan 50)", latencySnapshot().slowRequests.length === 25);
    t += SLOW_LOG_WINDOW_MS + 1;
    recordLatency("GET", "/api/hizli", 200, 5); // pencere kapanışı istek-güdümlü
    const ozet = lines.filter((l) => l.includes("yavaş istek bastırıldı"));
    check(
      "§7c ⭐ pencere kapanınca TEK özet satırı: 5 bastırıldı",
      ozet.length === 1 && /^UYARI \[yavas-istek\] 5 yavaş istek bastırıldı \(son 60 sn/.test(ozet[0]!) && lines.length === SLOW_LOG_MAX_PER_WINDOW + 1,
      ozet.join(" ¶ "),
    );
    recordLatency("GET", "/api/sel", 200, 700);
    check("§7d yeni pencerede sayaç sıfırlandı (satır yeniden basılır)", lines.length === SLOW_LOG_MAX_PER_WINDOW + 2);
  } finally {
    console.warn = asil;
    setLatencyClockForTest(null);
    resetLatencyStats();
  }
}

// ─── §6 app.ts kablolaması ──────────────────────────────────────────────────
function section6(): void {
  const src = readFileSync(path.resolve(__dirname, "../src/app.ts"), "utf8");
  const iId = src.indexOf("app.use(requestIdMiddleware)");
  const iMorgan = src.indexOf("app.use(morgan(");
  check("§6a requestIdMiddleware morgan'dan ÖNCE mount", iId !== -1 && iMorgan !== -1 && iId < iMorgan);
  check("§6b üretim biçimi PROD_ACCESS_LOG_FORMAT + jetonlar kayıtlı", src.includes("isProd ? PROD_ACCESS_LOG_FORMAT") && src.includes("registerAccessLogTokens(morgan)"));
  check("§6c app.ts'de çıplak morgan.token kalmadı (tek kaynak access-log.ts)", !src.includes("morgan.token"));
}

async function main(): Promise<void> {
  console.log("=== İstek logu: erişim satırı + yavaş istek künyesi ===\n");
  section1();
  const asilWarn = console.warn;
  console.warn = (...a: unknown[]) => { warnLines.push(a.map(String).join(" ")); };
  const server = http.createServer(buildApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    await sections2to5((server.address() as AddressInfo).port);
  } finally {
    console.warn = asilWarn;
    await new Promise<void>((r) => server.close(() => r()));
  }
  section6();
  section7();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
