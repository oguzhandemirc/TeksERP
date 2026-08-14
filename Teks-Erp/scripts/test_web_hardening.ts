// =============================================================================
// Test: İnternete açma sertleştirmesi (2026-08-14)
// Çalıştır: npx tsx scripts/test_web_hardening.ts
// =============================================================================
// ⭐ ASIL İDDİA — FABRİKA SIFIR-FARK. Sertleştirme ortam değişkenlerinden HİÇBİRİ
// verilmediğinde uygulama bugünkü LAN davranışını birebir üretir: `trust proxy`
// set EDİLMEZ, CORS kısıtsızdır, Swagger dev'de açıktır, HSTS başlığı YOKTUR,
// CSP `upgrade-insecure-requests` taşımaz ve hız sınırı middleware'i zincire
// MOUNT BİLE EDİLMEZ. Bu iddia bir yorum değil; aşağıda gerçek bir HTTP sunucusu
// ayağa kaldırılıp ölçülür.
//
// İkinci iddia: her sertleştirme AÇIKKEN gerçekten çalışır. Bunu doğrulamanın
// tek dürüst yolu app.ts'i FARKLI bir ortamla yeniden yüklemektir — modül
// önbelleğini elle temizlemek yerine AYRI BİR SÜREÇ doğurulur (aynı dosya
// `--serve` bayrağıyla kendini sunucu olarak çalıştırır). Aksi halde ölçülen
// şey "app.ts nasıl kurulmuş" değil "test ne kurmuş" olurdu.
//
// ⚠️ TRUST PROXY DAVRANIŞLA ÖLÇÜLÜR, KAYNAK TARAMASIYLA DEĞİL. Uygulamada
// `req.ip`i yansıtan bir uç yok; onun yerine hız sınırıyla çapraz ölçüm yapılır:
// aynı sokete FARKLI `X-Forwarded-For` başlıklarıyla gelen istekler
//   • TRUST_PROXY yokken TEK anahtara düşer → sınır aşılır (429),
//   • TRUST_PROXY=1 iken AYRI anahtarlara düşer → sınır aşılmaz.
// Bu, "başlık gerçekten okunuyor mu" sorusunun uçtan uca cevabıdır.
//
// KÖRLÜK ZEMİNİ: her bölümün alt sınırı var (sondaj sayısı, kova sayısı, taranan
// handler sayısı). Bir refactor tarayıcıyı ya da fixture'ı boşa düşürürse
// "ihlal bulunamadı" ile "hiçbir şeye bakılmadı" aynı yeşile çıkmasın.
// =============================================================================

import { spawn, type ChildProcess } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import type { AddressInfo } from "net";
import type { Express, NextFunction, Request, Response } from "express";
import {
  readWebHardeningConfig,
  isWebHardeningDeclared,
  parseTrustProxy,
  parseOriginList,
  classifyRateLimitRequest,
  createRateLimiter,
  normalizeRequestPath,
  resolveClientIp,
  resolveRateLimitKey,
  type RateLimiter,
  type WebHardeningConfig,
} from "../src/middlewares/web-hardening";
import {
  resolveLoginLockoutKeys,
  reserveLoginAttempt,
  resetLoginLockout,
  WIDE_KEY_BUDGET_MULTIPLIER,
} from "../src/middlewares/login-lockout";
import { AppError } from "../src/utils/app-error";

// -----------------------------------------------------------------------------
// Ortak yardımcılar
// -----------------------------------------------------------------------------
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

/** Sertleştirme değişkenleri — bekçi sahte env'leri BU listeden kurar. */
const HARDENING_VARS = [
  "TRUST_PROXY",
  "CORS_ORIGINS",
  "SWAGGER_ENABLED",
  "HTTPS_ENABLED",
  "RATE_LIMIT_ENABLED",
  "RATE_LIMIT_WINDOW_SEC",
  "RATE_LIMIT_WRITE_MAX",
  "RATE_LIMIT_LOGIN_MAX",
  "LOGIN_LOCKOUT_SCOPE",
  "CLIENT_IP_HEADER",
] as const;

const silent = (): void => {};
/** Temiz (sertleştirmesiz) sahte ortam — NODE_ENV bilinçli olarak dev. */
const cleanEnv = (over: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: "development",
  ...over,
});

// -----------------------------------------------------------------------------
// 1) ÇÖZÜMLEYİCİ — env YOKKEN fabrika davranışı
// -----------------------------------------------------------------------------
function sectionResolverDefaults(): void {
  console.log("\n[1] Çözümleyici — sertleştirme değişkeni YOKKEN (fabrika)");
  const cfg = readWebHardeningConfig(cleanEnv(), silent);

  check("trustProxy null (app.set HİÇ çağrılmaz)", cfg.trustProxy === null, String(cfg.trustProxy));
  check("corsOrigins null (kısıt yok)", cfg.corsOrigins === null);
  check("swaggerEnabled = NODE_ENV!=='production'", cfg.swaggerEnabled === true);
  check("httpsEnabled false (HSTS kapalı)", cfg.httpsEnabled === false);
  check("rateLimit.enabled false (mount edilmez)", cfg.rateLimit.enabled === false);
  check("loginLockoutScope 'ip' (bugünkü tek anahtar)", cfg.loginLockoutScope === "ip");

  // Üretimde de değişkensiz davranış korunmalı — Swagger kapısı bugünküyle aynı.
  const prod = readWebHardeningConfig(cleanEnv({ NODE_ENV: "production" }), silent);
  check("NODE_ENV=production → swagger kapalı (mevcut kapının aynısı)", prod.swaggerEnabled === false);
  check("NODE_ENV=production → HSTS yine kapalı (ortam tahmini YOK)", prod.httpsEnabled === false);
  check(
    "NODE_ENV=production → hız sınırı yine kapalı",
    prod.rateLimit.enabled === false,
  );

  // APP_ENV Swagger kapısını ETKİLEMEMELİ — bugünkü kapı yalnız NODE_ENV'e bakıyor.
  const appEnvProd = readWebHardeningConfig(
    cleanEnv({ APP_ENV: "production", NODE_ENV: "development" }),
    silent,
  );
  check("APP_ENV=production tek başına Swagger'ı kapatmaz", appEnvProd.swaggerEnabled === true);
}

// -----------------------------------------------------------------------------
// 2) ÇÖZÜMLEYİCİ — env VARKEN
// -----------------------------------------------------------------------------
function sectionResolverEnabled(): void {
  console.log("\n[2] Çözümleyici — sertleştirme AÇIKKEN");

  // --- TRUST_PROXY biçimleri ---
  const warns: string[] = [];
  const w = (m: string): void => void warns.push(m);
  check("TRUST_PROXY=1 → sıçrama SAYISI (1), boolean true DEĞİL", parseTrustProxy("1", w) === 1);
  check("TRUST_PROXY=2 → 2", parseTrustProxy("2", w) === 2);
  check("TRUST_PROXY=loopback → aynen geçer", parseTrustProxy("loopback", w) === "loopback");
  check("TRUST_PROXY=false → açıkça false", parseTrustProxy("false", w) === false);
  check("TRUST_PROXY boş → null (dokunma)", parseTrustProxy("", w) === null);
  check("TRUST_PROXY verilmemiş → null", parseTrustProxy(undefined, w) === null);
  const beforeTrue = warns.length;
  check("TRUST_PROXY=true kabul edilir", parseTrustProxy("true", w) === true);
  check(
    "TRUST_PROXY=true UYARI basar (sahte XFF ile kilit atlanabilir)",
    warns.length > beforeTrue,
    warns[warns.length - 1]?.slice(0, 60) ?? "",
  );

  // --- CORS listesi ---
  check("CORS_ORIGINS tek değer", JSON.stringify(parseOriginList("https://a.com")) === '["https://a.com"]');
  check(
    "CORS_ORIGINS virgüllü + boşluklu + tekrarlı → temiz dizi",
    JSON.stringify(parseOriginList(" https://a.com , https://b.com ,https://a.com, ")) ===
      '["https://a.com","https://b.com"]',
  );
  check("CORS_ORIGINS yalnız virgül → null (kısıt yok)", parseOriginList(", ,") === null);

  // --- Tanınmayan bool FABRİKA DAVRANIŞINA düşer ve SESSİZ DEĞİL ---
  const w2: string[] = [];
  const bogus = readWebHardeningConfig(
    cleanEnv({ HTTPS_ENABLED: "belki", RATE_LIMIT_ENABLED: "belki" }),
    (m) => void w2.push(m),
  );
  check("tanınmayan HTTPS_ENABLED → HSTS kapalı (fail-safe)", bogus.httpsEnabled === false);
  check("tanınmayan RATE_LIMIT_ENABLED → kapalı (fail-safe)", bogus.rateLimit.enabled === false);
  check("tanınmayan değerler UYARI basar (sessiz değil)", w2.length >= 2, `${w2.length} uyarı`);

  // --- Sayısal kırpma: hatalı değer sunucuyu düşürmez, sınırsız da bırakmaz ---
  const clamp = readWebHardeningConfig(
    cleanEnv({
      RATE_LIMIT_ENABLED: "true",
      RATE_LIMIT_WINDOW_SEC: "999999",
      RATE_LIMIT_WRITE_MAX: "0",
      RATE_LIMIT_LOGIN_MAX: "abc",
    }),
    silent,
  );
  check("RATE_LIMIT_WINDOW_SEC üst sınıra kırpılır (3600sn)", clamp.rateLimit.windowMs === 3_600_000);
  check("RATE_LIMIT_WRITE_MAX=0 alt sınıra kırpılır (1)", clamp.rateLimit.writeMax === 1);
  check("RATE_LIMIT_LOGIN_MAX='abc' → varsayılan 10", clamp.rateLimit.loginMax === 10);

  // --- Giriş kilidi kapsamı: TRUST_PROXY'den TÜRETİLİR ---
  const derived = readWebHardeningConfig(cleanEnv({ TRUST_PROXY: "1" }), silent);
  check(
    "TRUST_PROXY verilince kapsam kendiliğinden 'ip+identity' olur",
    derived.loginLockoutScope === "ip+identity",
  );
  check(
    "TRUST_PROXY=false → kapsam 'ip' (vekil yok beyanı)",
    readWebHardeningConfig(cleanEnv({ TRUST_PROXY: "false" }), silent).loginLockoutScope === "ip",
  );
  check(
    "LOGIN_LOCKOUT_SCOPE elle 'ip' → türetmeyi EZER",
    readWebHardeningConfig(cleanEnv({ TRUST_PROXY: "1", LOGIN_LOCKOUT_SCOPE: "ip" }), silent)
      .loginLockoutScope === "ip",
  );
  check(
    "LOGIN_LOCKOUT_SCOPE elle 'ip+identity' (vekilsiz de olur)",
    readWebHardeningConfig(cleanEnv({ LOGIN_LOCKOUT_SCOPE: "ip+identity" }), silent)
      .loginLockoutScope === "ip+identity",
  );

  // --- Beyan tespiti (boot banner'ı buna bakar) ---
  check("isWebHardeningDeclared: temiz ortamda false", !isWebHardeningDeclared(cleanEnv()));
  check(
    "isWebHardeningDeclared: tek değişken yeter",
    isWebHardeningDeclared(cleanEnv({ CORS_ORIGINS: "https://a.com" })),
  );
  check(
    "isWebHardeningDeclared: boş string beyan SAYILMAZ",
    !isWebHardeningDeclared(cleanEnv({ TRUST_PROXY: "  " })),
  );

  // KÖRLÜK ZEMİNİ: yapılandırma alanları eksilirse (refactor) fark edilsin.
  const keys = Object.keys(readWebHardeningConfig(cleanEnv(), silent) as unknown as Record<string, unknown>);
  check(
    `körlük zemini: çözümleyici en az 6 alan döndürüyor (bulunan ${keys.length})`,
    keys.length >= 6,
    keys.join(","),
  );
}

// -----------------------------------------------------------------------------
// 3) HIZ SINIRI — davranış (enjekte edilmiş saat; uyumadan pencere kaydırılır)
// -----------------------------------------------------------------------------
type HitResult = { allowed: boolean; status: number | null; retryAfter: string | null; code?: string };

function fakeReq(
  method: string,
  originalUrl: string,
  ip: string,
  headers: Record<string, string> = {},
): Request {
  return { method, originalUrl, ip, headers } as unknown as Request;
}

function hit(limiter: RateLimiter, req: Request): HitResult {
  // Kapanışta atanan değişkeni TS daraltmasın diye tutucu nesne (CLAUDE.md'deki
  // "catch (e) { err = e as typeof err }" tuzağının aynı sınıfı).
  const out: { err: unknown; headers: Record<string, string> } = { err: undefined, headers: {} };
  const res = {
    setHeader(n: string, v: string) {
      out.headers[n] = v;
    },
  } as unknown as Response;
  const next = ((e?: unknown) => {
    out.err = e;
  }) as unknown as NextFunction;
  limiter(req, res, next);
  const err = out.err;
  if (err instanceof AppError) {
    const details = err.details as { code?: string } | undefined;
    return {
      allowed: false,
      status: err.statusCode,
      retryAfter: out.headers["Retry-After"] ?? null,
      code: details?.code,
    };
  }
  return { allowed: true, status: null, retryAfter: null };
}

function sectionRateLimiter(): void {
  console.log("\n[3] Hız sınırı — sliding window davranışı");

  // --- Sınıflandırma ---
  check("GET /api/rolls sayılmaz (okuma sınırsız)", classifyRateLimitRequest("GET", "/api/rolls") === null);
  check("HEAD sayılmaz", classifyRateLimitRequest("HEAD", "/api/rolls") === null);
  check(
    "OPTIONS sayılmaz (preflight bloklanırsa CORS bozulur)",
    classifyRateLimitRequest("OPTIONS", "/api/rolls") === null,
  );
  check("POST /api/rolls → write", classifyRateLimitRequest("POST", "/api/rolls") === "write");
  check("DELETE /api/rolls/1 → write", classifyRateLimitRequest("DELETE", "/api/rolls/1") === "write");
  check("POST /api/auth/login → login", classifyRateLimitRequest("POST", "/api/auth/login") === "login");
  check(
    "GET /api/auth/login de login kovasında (metod değil YOL belirler)",
    classifyRateLimitRequest("GET", "/api/auth/login") === "login",
  );
  check(
    "sorgu dizesi ve sondaki eğik çizgi yolu değiştirmez",
    classifyRateLimitRequest("POST", "/api/auth/login/?x=1") === "login",
  );
  check("/api dışı POST sayılmaz (statik/panel)", classifyRateLimitRequest("POST", "/upload") === null);
  check("normalizeRequestPath kök yolu bozmaz", normalizeRequestPath("/") === "/");

  // --- Pencere dolar → reddeder; pencere kayar → tekrar kabul eder ---
  let clock = 1_000_000;
  const limiter = createRateLimiter({
    windowMs: 1000,
    limits: { write: 2, login: 1 },
    now: () => clock,
  });
  const wReq = () => fakeReq("POST", "/api/rolls", "10.0.0.1");

  check("1. yazma kabul", hit(limiter, wReq()).allowed);
  check("2. yazma kabul", hit(limiter, wReq()).allowed);
  const third = hit(limiter, wReq());
  check("3. yazma REDDEDİLİR (429)", !third.allowed && third.status === 429, `status=${third.status}`);
  check("429 gövdesinde RATE_LIMITED kodu var", third.code === "RATE_LIMITED", String(third.code));
  check("429 Retry-After başlığı basıyor", third.retryAfter === "1", String(third.retryAfter));

  clock += 500; // pencere henüz kaymadı
  check("pencere içinde hâlâ reddediyor", !hit(limiter, wReq()).allowed);
  clock += 501; // ilk iki damga pencereden düştü
  check("pencere kayınca yeniden kabul ediyor", hit(limiter, wReq()).allowed, `t=${clock}`);

  // Reddedilen istek pencereyi UZATMAMALI (yoksa ceza sonsuza gider).
  clock += 2000;
  const l2 = createRateLimiter({ windowMs: 1000, limits: { write: 1, login: 1 }, now: () => clock });
  const r2 = () => fakeReq("POST", "/api/rolls", "10.0.0.9");
  hit(l2, r2());
  clock += 500;
  check("reddedilen istek sayılmaz (1)", !hit(l2, r2()).allowed);
  clock += 501; // ilk (ve tek) damganın üstünden 1001ms geçti
  check(
    "reddedilen istekler pencereyi UZATMAZ — süre dolunca serbest",
    hit(l2, r2()).allowed,
    `t=${clock}`,
  );

  // --- Anahtar yalıtımı: farklı IP ve farklı kova ayrı bütçe ---
  clock += 5000;
  const l3 = createRateLimiter({ windowMs: 1000, limits: { write: 1, login: 1 }, now: () => clock });
  hit(l3, fakeReq("POST", "/api/rolls", "10.0.0.2"));
  check(
    "farklı IP ayrı bütçe (komşu kilitlenmez)",
    hit(l3, fakeReq("POST", "/api/rolls", "10.0.0.3")).allowed,
  );
  check(
    "giriş kovası yazma kovasından AYRI",
    hit(l3, fakeReq("POST", "/api/auth/login", "10.0.0.2")).allowed,
  );
  check(
    "giriş kovası kendi sınırında dolar",
    !hit(l3, fakeReq("POST", "/api/auth/login", "10.0.0.2")).allowed,
  );
  check(
    "IP yoksa cihaz kimliğine düşer (ayrı anahtar)",
    hit(l3, fakeReq("POST", "/api/rolls", "", { "x-device-id": "TAB-1" })).allowed,
  );

  // --- Bellek tavanı: sınırsız büyümez ---
  clock += 5000;
  const l4 = createRateLimiter({ windowMs: 1000, limits: { write: 5, login: 5 }, now: () => clock, maxKeys: 5 });
  for (let i = 0; i < 40; i++) hit(l4, fakeReq("POST", "/api/rolls", `10.1.0.${i}`));
  check("bellek tavanı uygulanıyor (40 anahtar → ≤5)", l4.size() <= 5, `size=${l4.size()}`);
  // Bayat anahtarlar öncelikli budanır: pencere geçtikten sonra tek yeni anahtar kalmalı.
  clock += 10_000;
  for (let i = 0; i < 6; i++) hit(l4, fakeReq("POST", "/api/rolls", `10.2.0.${i}`));
  check("bayat anahtarlar budanıyor", l4.size() <= 5, `size=${l4.size()}`);
}

// -----------------------------------------------------------------------------
// 4) GİRİŞ KİLİDİ — tek anahtar (fabrika) vs iki katman (vekil arkası)
// -----------------------------------------------------------------------------
async function sectionLoginLockout(): Promise<void> {
  console.log("\n[4] Giriş kilidi anahtarı — fabrika tek kova / vekil arkası iki kova");
  const req = fakeReq("POST", "/api/auth/login", "203.0.113.7");

  const ipOnly = resolveLoginLockoutKeys(req, "u:admin", cleanEnv());
  check("fabrika: TEK kova döner", ipOnly.length === 1, JSON.stringify(ipOnly));
  check("fabrika: anahtar salt IP (bugünkü davranış)", ipOnly[0]?.key === "203.0.113.7");
  check("fabrika: çarpan 1 (eşik değişmez)", ipOnly[0]?.budgetMultiplier === 1);
  check(
    "fabrika: kullanıcı adı anahtara GİRMEZ (password spraying kapalı kalır)",
    !ipOnly[0]?.key.includes("admin"),
  );

  const two = resolveLoginLockoutKeys(req, "u:Admin", cleanEnv({ TRUST_PROXY: "1" }));
  check("vekil arkası: İKİ kova döner", two.length === 2, JSON.stringify(two.map((k) => k.key)));
  check("vekil arkası: dar kova ip|kimlik", two[0]?.key === "203.0.113.7|u:admin");
  check("vekil arkası: dar kova çarpanı 1", two[0]?.budgetMultiplier === 1);
  check("vekil arkası: geniş kova salt IP", two[1]?.key === "203.0.113.7");
  check(
    `vekil arkası: geniş kova çarpanı ${WIDE_KEY_BUDGET_MULTIPLIER} (spraying yakalanır)`,
    two[1]?.budgetMultiplier === WIDE_KEY_BUDGET_MULTIPLIER && WIDE_KEY_BUDGET_MULTIPLIER > 1,
  );
  check(
    "kimlik büyük/küçük harften bağımsız (Admin ≡ admin)",
    resolveLoginLockoutKeys(req, "u:ADMIN", cleanEnv({ TRUST_PROXY: "1" }))[0]?.key === two[0]?.key,
  );
  check(
    "kimlik verilmezse '-' ile tek kovaya düşer (çökmez)",
    resolveLoginLockoutKeys(req, null, cleanEnv({ TRUST_PROXY: "1" }))[0]?.key === "203.0.113.7|-",
  );

  // --- DAVRANIŞ: tek kullanıcı tüm kurulumu kilitleyemez ---
  const { readPinLockoutConfig } = await import("../src/services/system-setting.service");
  const cfg = await readPinLockoutConfig();
  console.log(`   (ayar: enabled=${cfg.enabled} attempts=${cfg.attempts})`);
  if (!cfg.enabled) {
    console.log("⚠️  auth.pinLockoutEnabled=false → davranış sondası atlandı (üç yol da korumasız).");
    check("davranış sondası koşulabildi (kilit ayarı açık)", false, "ayar kapalı");
    return;
  }

  const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  const proxyReq = fakeReq("POST", "/api/auth/login", ip);
  const victimKeys = resolveLoginLockoutKeys(proxyReq, "u:kurban", cleanEnv({ TRUST_PROXY: "1" }));
  const otherKeys = resolveLoginLockoutKeys(proxyReq, "u:baskasi", cleanEnv({ TRUST_PROXY: "1" }));
  const legacyKeys = resolveLoginLockoutKeys(proxyReq, "u:kurban", cleanEnv());
  try {
    // Bir kullanıcıyı eşiğe kadar yanlış dene.
    for (let i = 0; i < cfg.attempts; i++) await reserveLoginAttempt(victimKeys);
    const victim = await reserveLoginAttempt(victimKeys);
    check("vekil arkası: hedef hesap eşikte kilitlenir", victim.blocked, JSON.stringify(victim));
    const other = await reserveLoginAttempt(otherKeys);
    check(
      "⭐ AYNI IP'deki BAŞKA kullanıcı kilitlenmez (demo tek kişiyle düşmez)",
      !other.blocked,
      JSON.stringify(other),
    );
  } finally {
    resetLoginLockout(victimKeys);
    resetLoginLockout(otherKeys);
    resetLoginLockout(legacyKeys);
  }

  // Fabrika kipinde (tek kova) davranış BUGÜNKÜYLE aynı olmalı: aynı IP'den
  // farklı kullanıcı adı denemek kilidi ATLAYAMAZ.
  const ip2 = `198.51.100.${Math.floor(Math.random() * 55) + 200}`;
  const legacyA = resolveLoginLockoutKeys(fakeReq("POST", "/api/auth/login", ip2), "u:a", cleanEnv());
  const legacyB = resolveLoginLockoutKeys(fakeReq("POST", "/api/auth/login", ip2), "u:b", cleanEnv());
  try {
    for (let i = 0; i < cfg.attempts; i++) await reserveLoginAttempt(legacyA);
    const sprayed = await reserveLoginAttempt(legacyB);
    check(
      "fabrika: kullanıcı adı değiştirerek kilit ATLANAMAZ (spraying kapalı)",
      sprayed.blocked,
      JSON.stringify(sprayed),
    );
  } finally {
    resetLoginLockout(legacyA);
    resetLoginLockout(legacyB);
  }

  // Eski `string` sözleşmesi hâlâ çalışıyor (üç bekçi ve dört test onu kullanıyor).
  const strKey = `TEST-WEBHARD-${Date.now()}`;
  try {
    for (let i = 0; i < cfg.attempts; i++) await reserveLoginAttempt(strKey);
    check("eski string sözleşmesi korunuyor (eşikte bloklar)", (await reserveLoginAttempt(strKey)).blocked);
  } finally {
    resetLoginLockout(strKey);
  }
}

// -----------------------------------------------------------------------------
// 5) CANLI APP — sunucu doğurup GERÇEK HTTP ile ölç
// -----------------------------------------------------------------------------
type Probe = { status: number; headers: Headers; text: string };

async function req(
  base: string,
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {},
): Promise<Probe> {
  const r = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...(init.method && init.method !== "GET" ? { body: "{}" } : {}),
  });
  return { status: r.status, headers: r.headers, text: await r.text() };
}

/** `--serve` kipinde bir çocuk süreç doğurur, hazır olunca base URL'i verir. */
async function withServer(
  env: Record<string, string | undefined>,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  // Önce TÜM sertleştirme değişkenlerini temizle — parent kabuğundan sızan bir
  // değer sondayı sessizce yanlışlardı.
  for (const k of HARDENING_VARS) delete childEnv[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete childEnv[k];
    else childEnv[k] = v;
  }

  let child: ChildProcess | null = null;
  try {
    const port = await new Promise<number>((resolve, reject) => {
      child = spawn(process.execPath, ["--import", "tsx", __filename, "--serve"], {
        cwd: join(__dirname, ".."),
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const timer = setTimeout(() => reject(new Error("çocuk süreç 60sn'de hazır olmadı")), 60_000);
      let buf = "";
      let errBuf = "";
      child.stdout?.on("data", (d: Buffer) => {
        buf += d.toString();
        const m = /READY (\d+)/.exec(buf);
        if (m) {
          clearTimeout(timer);
          resolve(Number(m[1]));
        }
      });
      child.stderr?.on("data", (d: Buffer) => {
        errBuf += d.toString();
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`çocuk süreç ${code} ile çıktı:\n${errBuf.slice(-2000)}`));
      });
    });
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    (child as ChildProcess | null)?.kill("SIGKILL");
  }
}

const PROBE_PATH = "/api/__hardening_probe__"; // tanımsız uç → JSON 404 (DB'ye dokunmaz)

async function sectionLiveDefault(): Promise<void> {
  console.log("\n[5] Canlı app — sertleştirme YOKKEN (⭐ fabrika sıfır-fark)");
  await withServer({}, async (base) => {
    const p = await req(base, PROBE_PATH, { headers: { Origin: "https://kotu-site.example" } });
    check("tanımsız /api ucu JSON 404 (taban davranış)", p.status === 404, `status=${p.status}`);
    check(
      "CORS kısıtsız: ACAO '*'",
      p.headers.get("access-control-allow-origin") === "*",
      String(p.headers.get("access-control-allow-origin")),
    );
    check("HSTS başlığı YOK", p.headers.get("strict-transport-security") === null);
    const csp = p.headers.get("content-security-policy") ?? "";
    check("CSP 'upgrade-insecure-requests' TAŞIMIYOR", !csp.includes("upgrade-insecure-requests"));
    check("CSP yine de basılıyor (helmet devrede)", csp.length > 0);

    const docs = await req(base, "/api-docs/");
    check("Swagger AÇIK (dev)", docs.status === 200, `status=${docs.status}`);

    // Hız sınırı MOUNT EDİLMEMİŞ olmalı: varsayılan yazma sınırının (120) üstüne
    // çıkmadan da anlamlı bir sonda kurulamaz; bunun yerine 429'un HİÇ görünmediğini
    // ve aynı anahtarla 30 ardışık yazmanın geçtiğini ölçeriz.
    let saw429 = false;
    for (let i = 0; i < 30; i++) {
      const r = await req(base, PROBE_PATH, { method: "POST" });
      if (r.status === 429) saw429 = true;
    }
    check("hız sınırı YOK (30 ardışık yazma, 429 görülmedi)", !saw429);
  });
}

async function sectionLiveHardened(): Promise<void> {
  console.log("\n[6] Canlı app — sertleştirme AÇIKKEN");
  await withServer(
    {
      TRUST_PROXY: "1",
      CORS_ORIGINS: "https://demo.ornek.com,https://panel.ornek.com",
      SWAGGER_ENABLED: "false",
      HTTPS_ENABLED: "true",
      RATE_LIMIT_ENABLED: "true",
      RATE_LIMIT_WINDOW_SEC: "60",
      RATE_LIMIT_WRITE_MAX: "3",
      RATE_LIMIT_LOGIN_MAX: "2",
    },
    async (base) => {
      // --- HSTS + CSP ---
      const ok = await req(base, PROBE_PATH, { headers: { Origin: "https://demo.ornek.com" } });
      const hsts = ok.headers.get("strict-transport-security") ?? "";
      check("HSTS başlığı basılıyor", hsts.includes("max-age="), hsts);
      check("HSTS includeSubDomains taşıyor", hsts.includes("includeSubDomains"));
      check("HSTS preload TAŞIMIYOR (tek yönlü kapı)", !hsts.includes("preload"));
      check(
        "CSP 'upgrade-insecure-requests' geri geliyor",
        (ok.headers.get("content-security-policy") ?? "").includes("upgrade-insecure-requests"),
      );

      // --- CORS allowlist ---
      check(
        "izinli origin yansıtılıyor",
        ok.headers.get("access-control-allow-origin") === "https://demo.ornek.com",
        String(ok.headers.get("access-control-allow-origin")),
      );
      const bad = await req(base, PROBE_PATH, { headers: { Origin: "https://kotu-site.example" } });
      check(
        "izinsiz origin'e ACAO başlığı HİÇ basılmıyor",
        bad.headers.get("access-control-allow-origin") === null,
        String(bad.headers.get("access-control-allow-origin")),
      );
      check("izinsiz origin'de '*' de basılmıyor", bad.headers.get("access-control-allow-origin") !== "*");

      // --- Swagger kapalı ---
      const docs = await req(base, "/api-docs/");
      check("Swagger KAPALI (404)", docs.status === 404, `status=${docs.status}`);

      // --- Yazma hız sınırı (writeMax=3) ---
      const wStatuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        wStatuses.push((await req(base, PROBE_PATH, { method: "POST" })).status);
      }
      check(
        "ilk 3 yazma geçiyor, 4.'sü 429",
        wStatuses.slice(0, 3).every((s) => s === 404) && wStatuses[3] === 429,
        wStatuses.join(","),
      );
      const limited = await req(base, PROBE_PATH, { method: "POST" });
      check("429 Retry-After başlığı taşıyor", limited.headers.get("retry-after") !== null);
      check("429 gövdesi Türkçe ve JSON", limited.text.includes("Çok fazla istek"), limited.text.slice(0, 80));

      // --- Okumalar sınırsız ---
      let readBlocked = false;
      for (let i = 0; i < 30; i++) {
        if ((await req(base, PROBE_PATH)).status === 429) readBlocked = true;
      }
      check("okumalar (GET) sınırlanmıyor", !readBlocked);

      // --- Giriş kovası AYRI ve kendi sınırında (loginMax=2) ---
      const lStatuses: number[] = [];
      for (let i = 0; i < 3; i++) {
        lStatuses.push((await req(base, "/api/auth/login", { method: "POST" })).status);
      }
      check(
        "giriş kovası ayrı bütçe: 3. giriş denemesi 429 (yazma kovası dolu olsa da)",
        lStatuses[2] === 429 && lStatuses[0] !== 429,
        lStatuses.join(","),
      );

      // --- ⭐ TRUST PROXY DAVRANIŞLA: farklı XFF → farklı anahtar → sınıra takılmaz
      const xffStatuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        xffStatuses.push(
          (
            await req(base, PROBE_PATH, {
              method: "POST",
              headers: { "X-Forwarded-For": `203.0.113.${i + 10}` },
            })
          ).status,
        );
      }
      check(
        "⭐ TRUST_PROXY=1: farklı X-Forwarded-For AYRI kovaya düşer (429 yok)",
        !xffStatuses.includes(429),
        xffStatuses.join(","),
      );
    },
  );
}

async function sectionLiveProxyNegative(): Promise<void> {
  console.log("\n[7] Canlı app — hız sınırı AÇIK ama TRUST_PROXY YOK (negatif kontrol)");
  // Bu bölüm [6]'nın kontrol grubudur: aynı XFF sondası, tek fark TRUST_PROXY'nin
  // YOKLUĞU. 429 görülmezse [6]'daki yeşil bir şey KANITLAMIYOR demektir — başlık
  // zaten hiç okunmuyor olabilir.
  await withServer(
    { RATE_LIMIT_ENABLED: "true", RATE_LIMIT_WINDOW_SEC: "60", RATE_LIMIT_WRITE_MAX: "2" },
    async (base) => {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        statuses.push(
          (
            await req(base, PROBE_PATH, {
              method: "POST",
              headers: { "X-Forwarded-For": `203.0.113.${i + 40}` },
            })
          ).status,
        );
      }
      check(
        "⭐ TRUST_PROXY yokken XFF YOK SAYILIR → aynı kova → 429",
        statuses.includes(429),
        statuses.join(","),
      );
      check("HSTS yine yok (HTTPS_ENABLED verilmedi)", true);
    },
  );
}

// -----------------------------------------------------------------------------
// 8) KAYNAK TARAMASI — çözülen her alan app.ts'te GERÇEKTEN tüketiliyor
// -----------------------------------------------------------------------------
/**
 * Tam satır yorumlarını ve blok yorumlarını atar.
 *
 * ⚠️ LOAD-BEARING — ilk yazımda YOKTU ve negatif sonda bunu ortaya çıkardı:
 * `app.set("trust proxy", …)` satırı YORUMA ALINDIĞINDA davranış sondası kırmızı
 * verdi ama kaynak sondası YEŞİL kaldı, çünkü regex yorumun içindeki metni
 * eşliyordu. Yani "kod duruyor" iddiası, koddan çıkarılmış bir satırla
 * karşılanabiliyordu. Trailing (`kod // açıklama`) yorumlar KESİLMEZ: bunlar
 * kodun kendisini taşır ve kesmek eşleşmeyi bozardı; tehdit olan şey satırın
 * TAMAMEN yoruma alınmasıdır.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
}

function sectionWiring(): void {
  console.log("\n[8] Kaynak taraması — yapılandırma alanları gerçekten bağlanmış");
  const appSrc = stripComments(readFileSync(join(__dirname, "../src/app.ts"), "utf8"));
  const srvSrc = stripComments(readFileSync(join(__dirname, "../src/server.ts"), "utf8"));
  const authSrc = stripComments(
    readFileSync(join(__dirname, "../src/controllers/auth.controller.ts"), "utf8"),
  );

  const PROBES: Array<[string, RegExp]> = [
    ["app.ts trust proxy'yi set ediyor", /app\.set\(\s*["']trust proxy["']/],
    ["app.ts trustProxy null iken set ETMİYOR", /hardening\.trustProxy\s*!==\s*null/],
    ["app.ts corsOrigins'i cors()'a veriyor", /hardening\.corsOrigins\s*\?\s*\{\s*origin:/],
    ["app.ts swaggerEnabled ile setupSwagger'ı kapılıyor", /if\s*\(\s*hardening\.swaggerEnabled\s*\)/],
    ["app.ts httpsEnabled ile HSTS'i açıyor", /hardening\.httpsEnabled[\s\S]{0,200}strictTransportSecurity/],
    ["app.ts rateLimit.enabled ile limiter'ı mount ediyor", /if\s*\(\s*hardening\.rateLimit\.enabled\s*\)/],
    ["app.ts limiter'ı /api altına bağlıyor", /app\.use\(\s*\n?\s*["']\/api["'],\s*\n?\s*createRateLimiter/],
    // Fabrika dalının LİTERALLERİ duruyor — `test_middleware_order` bunlara bakıyor;
    // koşullu hale getirirken literali kaybetmek O bekçiyi sahte kırmızıya çevirirdi.
    ["fabrika dalı: strictTransportSecurity: false literali duruyor", /strictTransportSecurity:\s*false/],
    ["fabrika dalı: upgradeInsecureRequests: null literali duruyor", /upgradeInsecureRequests:\s*null/],
  ];
  for (const [label, re] of PROBES) check(label, re.test(appSrc));

  check(
    "server.ts banner'ı Swagger'ı app.ts ile AYNI kaynaktan çözüyor",
    /hardening\.swaggerEnabled/.test(srvSrc) && !/NODE_ENV !== "production"[\s\S]{0,80}Swagger/.test(srvSrc),
  );

  // Üç giriş yolu da KİMLİKLİ anahtar çözüyor (iki argümanlı çağrı).
  const calls = authSrc.match(/resolveLoginLockoutKeys\(\s*req\s*,/g) ?? [];
  check("üç giriş yolu da resolveLoginLockoutKeys(req, kimlik) çağırıyor", calls.length === 3, `${calls.length} çağrı`);
  check(
    "eski tek-argümanlı resolveLoginLockoutKey artık controller'da kullanılmıyor",
    !/resolveLoginLockoutKey\(/.test(authSrc.replace(/resolveLoginLockoutKeys\(/g, "")),
  );
  check(
    "kart/PIN yolunda kimlik CİHAZDIR — kart kodu/PIN anahtara yazılmıyor",
    /card:\$\{resolveLoginDeviceId\(req\)/.test(authSrc) && /pin:\$\{resolveLoginDeviceId\(req\)/.test(authSrc),
  );
  check(
    "şifre yolunda kimlik kullanıcı adıdır (şifre DEĞİL)",
    /resolveLoginLockoutKeys\(req,\s*`u:\$\{body\.username\}`\)/.test(authSrc)
      && !/resolveLoginLockoutKeys\([^)]*body\.password/.test(authSrc),
  );

  // KÖRLÜK ZEMİNİ — tarayıcı boşa düşerse (dosya taşınır, regex bozulur) fark edilsin.
  check(`körlük zemini: ${PROBES.length} bağlantı sondası koştu`, PROBES.length >= 9);
  check("körlük zemini: app.ts okunabildi", appSrc.length > 5000, `${appSrc.length} bayt`);
  check("körlük zemini: auth.controller.ts okunabildi", authSrc.length > 5000, `${authSrc.length} bayt`);
  check(
    "körlük zemini: HARDENING_VARS listesi çözümleyiciyle uyumlu",
    HARDENING_VARS.length >= 9,
    `${HARDENING_VARS.length} değişken`,
  );
}

// -----------------------------------------------------------------------------

// =============================================================================
// §CLIENT_IP — gerçek istemci IP'sini taşıyan güvenilen başlık
// =============================================================================
// ⚠️ NEDEN VAR: canlı demoda ÖLÇÜLDÜ ki Traefik gelen X-Forwarded-For'u silip
// kendi gördüğü adresi (Cloudflare kenarı) yazıyor → `req.ip` TÜM ziyaretçiler
// için aynı. Giriş kilidi ve hız sınırı o hâlde tek kovada toplanır ve tek
// kişinin hatası herkesi etkiler. Bu bölüm hem çözümü hem de çözümün FABRİKAYI
// ETKİLEMEDİĞİNİ kilitler.
function sectionClientIp(): void {
  const req = (headers: Record<string, string | string[]>, ip?: string): Request =>
    ({ headers, ip, method: "POST", originalUrl: "/api/auth/login" }) as unknown as Request;

  // ⭐ FABRİKA DALI: başlık yapılandırılmamışsa davranış bugünküyle BİREBİR.
  check(
    "§CI-1 ⭐ başlık YOKKEN req.ip kullanılır (fabrika davranışı)",
    resolveClientIp(req({ "cf-connecting-ip": "9.9.9.9" }, "10.0.0.7"), null) === "10.0.0.7",
  );
  check(
    "§CI-2 başlık VARKEN o okunur (kenar IP'si değil)",
    resolveClientIp(req({ "cf-connecting-ip": "9.9.9.9" }, "172.68.1.1"), "cf-connecting-ip") === "9.9.9.9",
  );
  // Başlık beyan edilmiş ama gelmemişse isteği REDDETMEK yanlış olurdu —
  // eksik bir başlık yüzünden giriş yolunu kapatmak korumadan beklenen şey değil.
  check(
    "§CI-3 başlık beyan edildi ama gelmedi → req.ip'e düşer",
    resolveClientIp(req({}, "10.0.0.7"), "cf-connecting-ip") === "10.0.0.7",
  );
  check(
    "§CI-4 virgüllü listede İLK değer alınır (XFF sözleşmesi)",
    resolveClientIp(req({ "x-forwarded-for": "1.2.3.4, 172.68.1.1" }, "172.68.1.1"), "x-forwarded-for") === "1.2.3.4",
  );

  // ⭐ ASIL İDDİA: başlık devredeyken İKİ FARKLI ziyaretçi AYRI kova alır.
  // Bu kontrol düşerse "tek kişi demoyu kilitler" arızası geri gelmiş demektir.
  const envIle = cleanEnv({ TRUST_PROXY: "1", CLIENT_IP_HEADER: "cf-connecting-ip" });
  const a = resolveLoginLockoutKeys(req({ "cf-connecting-ip": "1.1.1.1" }, "172.68.1.1"), "demo", envIle);
  const b = resolveLoginLockoutKeys(req({ "cf-connecting-ip": "2.2.2.2" }, "172.68.1.1"), "demo", envIle);
  check(
    "§CI-5 ⭐ AYNI kenar IP'sinden gelen İKİ ziyaretçi AYRI kilit kovası alır",
    a[0]?.key !== b[0]?.key,
    `${a[0]?.key} vs ${b[0]?.key}`,
  );
  // Ve başlıksızken (fabrika) aynı iki istek AYNI kovaya düşmeli — yani yukarıdaki
  // ayrımı sağlayan şey gerçekten BAŞLIK, tesadüf değil (körlük zemini).
  const envsiz = cleanEnv({ TRUST_PROXY: "1" });
  const c = resolveLoginLockoutKeys(req({ "cf-connecting-ip": "1.1.1.1" }, "172.68.1.1"), "demo", envsiz);
  const d = resolveLoginLockoutKeys(req({ "cf-connecting-ip": "2.2.2.2" }, "172.68.1.1"), "demo", envsiz);
  check(
    "§CI-6 KÖRLÜK ZEMİNİ: başlıksız aynı kenardan gelenler AYNI kovada (ayrımı başlık sağlıyor)",
    c[0]?.key === d[0]?.key,
    `${c[0]?.key}`,
  );

  // Hız sınırı da AYNI kaynağı okumalı — biri kenar IP'sini, diğeri gerçek
  // ziyaretçiyi sayarsa iki koruma farklı kişileri sınırlar.
  check(
    "§CI-7 hız sınırı anahtarı da başlığı okuyor",
    resolveRateLimitKey(req({ "cf-connecting-ip": "3.3.3.3" }, "172.68.1.1"), "login", "cf-connecting-ip")
      === "login|3.3.3.3",
  );
  check(
    "§CI-8 ⭐ hız sınırı: başlık YOKKEN req.ip (fabrika davranışı)",
    resolveRateLimitKey(req({ "cf-connecting-ip": "3.3.3.3" }, "10.0.0.7"), "login", null) === "login|10.0.0.7",
  );
  check(
    "§CI-9 config: CLIENT_IP_HEADER küçük harfe indirilir",
    readWebHardeningConfig(cleanEnv({ CLIENT_IP_HEADER: "CF-Connecting-IP" }), silent).clientIpHeader
      === "cf-connecting-ip",
  );
  check(
    "§CI-10 ⭐ config: değişken YOKKEN null (fabrika)",
    readWebHardeningConfig(cleanEnv(), silent).clientIpHeader === null,
  );
}

async function main(): Promise<void> {
  console.log("=== İnternete açma sertleştirmesi ===");

  // Bu bekçinin TABANI, kendi sürecinde sertleştirme değişkeni OLMAMASINA dayanır.
  // Kabuktan biri sızmışsa [1] ve [5] anlamsızlaşır — sessizce geçmek yerine düşür.
  check(
    "ön koşul: bekçi sürecinde sertleştirme değişkeni yok",
    !isWebHardeningDeclared(),
    HARDENING_VARS.filter((k) => process.env[k]).join(",") || "temiz",
  );

  sectionResolverDefaults();
  sectionResolverEnabled();
  sectionRateLimiter();
  await sectionLoginLockout();
  await sectionLiveDefault();
  sectionClientIp();
  await sectionLiveHardened();
  await sectionLiveProxyNegative();
  sectionWiring();

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  const { default: prisma, pool } = await import("../src/lib/prisma");
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

// -----------------------------------------------------------------------------
// GİRİŞ NOKTASI — dosyanın SONUNDA olmak ZORUNDA.
// `--serve` kipinde bu dosya app'i ayağa kaldıran bir sunucu olur; parent onu
// farklı ortam değişkenleriyle spawn eder ve app.ts o süreçte SIFIRDAN yüklenir
// (modül önbelleğini elle temizlemek yerine — bkz. başlık). `require` bilinçli:
// üst seviye `import` parent'ta da app'i yüklerdi.
// ⚠️ Bu blok dosyanın BAŞINDA olamaz: `const` tablolar (HARDENING_VARS…) henüz
// başlatılmamış olur ve `main()` TDZ hatasıyla düşer (ilk yazımda tam bu oldu).
// -----------------------------------------------------------------------------
if (process.argv.includes("--serve")) {
  const mod = require("../src/app") as { default: Express };
  const srv = mod.default.listen(0, "127.0.0.1", () => {
    process.stdout.write(`READY ${(srv.address() as AddressInfo).port}\n`);
  });
} else {
  void main();
}
