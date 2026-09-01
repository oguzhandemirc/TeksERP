// =============================================================================
// TeksERP — İnternete açma sertleştirmesi (HEPSİ ortam değişkeni ARKASINDA)
// =============================================================================
// Bu uygulama LAN varsayımıyla yazıldı — `app.ts`in kendi başlığı "HTTP-only LAN
// sunucusu" diyor: HTTPS yok, ters vekil yok, CORS kısıtsız, Swagger dev'de açık.
// Demo/SaaS kurulumu aynı kodu internete açmak zorunda; fabrika kurulumu ise
// TEK BAYT etkilenmemeli. Bu yüzden buradaki her sertleştirme bir ortam
// değişkenine bağlıdır ve DEĞİŞKEN YOKKEN çözülen yapılandırma bugünkü
// davranışın birebir aynısıdır.
//
// ⚠️ FABRİKA SIFIR-FARK, "makul varsayılan" DEĞİL. Cazip olan şey `NODE_ENV`e
// bakıp üretimde otomatik sıkılaştırmaktır; YANLIŞ olur — fabrika sunucusu da
// `NODE_ENV=production` ile koşuyor ve orada HTTPS yok. HSTS açılsaydı tarayıcı
// LAN adresini kalıcı olarak https'e çevirir, panel açılmaz ve geri dönüşü
// kullanıcı tarafında (HSTS önbelleği) olurdu. Karar bu yüzden ortamın
// TAHMİNİNE değil operatörün BEYANINA bağlandı.
//
// ⚠️ YENİ NPM PAKETİ YOK. `express-rate-limit` izinli listede değil; aşağıdaki
// sliding-window sayaç bağımlılıksız, bellekte sınırlı ve bekçili
// (`scripts/test_web_hardening.ts`).
//
// TEK-PROCESS VARSAYIMI: sayaçlar modül-seviyesi Map'te yaşar — `server.ts`teki
// "TEK-PROCESS INVARIANT" bloğunun aynısı geçerli (login-lockout, presence ve
// feature-flag cache de aynı varsayıma dayanıyor). Yatay ölçeklenirse hız
// sınırı process başına bölünür; o gün taşıma katmanı (Redis) gerekir.
// =============================================================================

import type { Request, RequestHandler, Response, NextFunction } from "express";
import { AppError } from "../utils/app-error";
import "../types/express-augment";

// -----------------------------------------------------------------------------
// Çözülmüş yapılandırma
// -----------------------------------------------------------------------------

/** Hız sınırı kovaları — giriş ile yazma AYRI bütçelerdir (aşağıdaki gerekçe). */
export type RateLimitBucket = "login" | "write";

export type WebHardeningConfig = {
  /**
   * `app.set("trust proxy", …)` değeri. `null` = HİÇ set edilmez (Express
   * varsayılanı `false` — bugünkü davranış).
   */
  trustProxy: boolean | number | string | null;
  /** İzinli CORS origin listesi. `null` = kısıt yok (bugünkü davranış). */
  corsOrigins: string[] | null;
  /** Swagger UI mount edilsin mi. Varsayılan: `NODE_ENV !== "production"`. */
  swaggerEnabled: boolean;
  /** HTTPS arkasında mıyız (HSTS + CSP upgrade-insecure-requests). */
  httpsEnabled: boolean;
  rateLimit: {
    enabled: boolean;
    windowMs: number;
    /** Pencere başına izinli YAZMA isteği (POST/PUT/PATCH/DELETE). */
    writeMax: number;
    /** Pencere başına izinli GİRİŞ denemesi (üç login ucu). */
    loginMax: number;
  };
  /**
   * Giriş kilidi anahtarının kapsamı — bkz. `login-lockout.ts`.
   * `ip` = bugünkü davranış · `ip+identity` = dar (ip+kimlik) + geniş (ip) iki katman.
   */
  loginLockoutScope: "ip" | "ip+identity";
  /**
   * Gerçek istemci IP'sini taşıyan GÜVENİLEN başlık (küçük harf), örn.
   * `cf-connecting-ip`. Boşsa `req.ip` kullanılır (bugünkü davranış).
   *
   * ⚠️ BU BİR GÜVEN BEYANIDIR ve YALNIZ ağ katmanı o başlığı garanti ediyorsa
   * doldurulmalı. İstemcinin gönderdiği bir başlığa körlemesine güvenmek,
   * saldırganın her istekte farklı bir değer yazıp hem giriş kilidini hem hız
   * sınırını tamamen etkisizleştirmesi demektir.
   *
   * Demo kurulumunda meşru: güvenlik duvarı 80/443'ü YALNIZ Cloudflare IP
   * aralıklarına açıyor, yani başlık dışarıdan uydurulamaz.
   */
  clientIpHeader: string | null;
  /**
   * `clientIpHeader` YALNIZ uzak (tünel) isteklerinde mi okunsun?
   *
   * ⚠️ BU AYRIM BİR AÇIĞI KAPATIR (2026-09-01, patron modülü). Uzaktan erişim
   * açıkken TEK process iki dünyaya birden hizmet eder: LAN (`0.0.0.0:PORT`) ve
   * tünel (`127.0.0.1:REMOTE_PORT`). Başlık her isteğe uygulansaydı LAN'daki
   * herhangi biri `CF-Connecting-IP: <rastgele>` yazarak giriş kilidini VE hız
   * sınırını tamamen etkisizleştirirdi — her denemede farklı kova.
   *
   * Değer `REMOTE_PORT`ten TÜRETİLİR: uzaktan erişim kapalıysa (bugünkü demo
   * kurulumu dahil) `false` kalır ve davranış BİREBİR eskisi gibidir — o
   * kurulumlarda tüm trafik zaten ters vekilden geliyor.
   */
  clientIpHeaderRemoteOnly: boolean;
};

/** Uyarı kanalı — bekçi gürültüsüz koşabilsin diye enjekte edilebilir. */
export type WarnFn = (message: string) => void;

// Sayısal ayarların sınırları. Kırpma bilinçli: hatalı bir değer sunucuyu
// düşürmemeli ama sınırsız da olmamalı (0 = herkesi blokla, 10^9 = koruma yok).
const WINDOW_SEC_DEFAULT = 60;
const WINDOW_SEC_MIN = 1;
const WINDOW_SEC_MAX = 3600;
const WRITE_MAX_DEFAULT = 120;
const LOGIN_MAX_DEFAULT = 10;
const COUNT_MIN = 1;
const COUNT_MAX = 100_000;

/** HSTS ömrü — 180 gün. Bilinçli olarak `preload` YOK: preload listesine girmek
 *  pratikte tek yönlü kapıdır (çıkış aylar sürer) ve demo alan adı için bedeli
 *  kazancından büyüktür. `includeSubDomains` açık — alt alan adından http
 *  servis edilmesi bu kurulumda öngörülmüyor. */
export const HSTS_MAX_AGE_SEC = 15_552_000;

const TRUE_WORDS = new Set(["1", "true", "yes", "on", "evet", "acik", "açık"]);
const FALSE_WORDS = new Set(["0", "false", "no", "off", "hayir", "hayır", "kapali", "kapalı"]);

/**
 * Üç durumlu boolean okuma: `true` / `false` / `null` (= verilmemiş).
 *
 * ⚠️ TANINMAYAN DEĞER `null` DÖNER, `true` DEĞİL — yani fabrika davranışına
 * düşülür. Sebep asimetri: `RATE_LIMIT_ENABLED=maybe` yazan birine korumayı
 * açmak zararsız görünür ama aynı kural `HTTPS_ENABLED=maybe`de HSTS'i açar ve
 * HTTP-only bir kurulumu tarayıcı önbelleğinden kilitler. Sessiz kalmamak için
 * her tanınmayan değer UYARI basar — "yazım hatası yüzünden koruma kapalı"
 * durumunun tek görünür yüzeyi odur.
 */
export function parseBoolEnv(raw: string | undefined, onWarn: WarnFn, name: string): boolean | null {
  if (raw === undefined) return null;
  const v = raw.trim().toLowerCase();
  if (v === "") return null;
  if (TRUE_WORDS.has(v)) return true;
  if (FALSE_WORDS.has(v)) return false;
  onWarn(`[web-hardening] ${name}="${raw}" anlaşılmadı — verilmemiş sayıldı (fabrika davranışı).`);
  return null;
}

/**
 * `TRUST_PROXY` değerini Express'in `trust proxy` ayarına çevirir.
 *
 * ⚠️ `true` (= "her XFF başlığına güven") KABUL EDİLİR AMA UYARI BASAR. Ters
 * vekilin kaç sıçrama uzakta olduğunu bilmeyen bir kurulumda `true`, istemcinin
 * kendi yazdığı `X-Forwarded-For` başlığına güvenmek demektir: saldırgan her
 * istekte farklı bir sahte IP yazıp hem giriş kilidini hem hız sınırını
 * TAMAMEN atlar. Doğru değer neredeyse her zaman sıçrama SAYISIDIR (nginx tek
 * katmandaysa `1`).
 */
export function parseTrustProxy(
  raw: string | undefined,
  onWarn: WarnFn,
): boolean | number | string | null {
  if (raw === undefined) return null;
  const v = raw.trim();
  if (v === "") return null;
  const lower = v.toLowerCase();
  if (FALSE_WORDS.has(lower)) return false;
  if (TRUE_WORDS.has(lower) && lower !== "1") {
    onWarn(
      '[web-hardening] TRUST_PROXY="true" — istemcinin yazdığı X-Forwarded-For başlığına ' +
        "koşulsuz güvenilir; giriş kilidi ve hız sınırı sahte IP ile atlanabilir. " +
        "Sıçrama sayısı (örn. 1) ya da 'loopback' tercih edin.",
    );
    return true;
  }
  // Sıçrama sayısı: "1", "2"… ("1" TRUE_WORDS'te de var — sayı yorumu ÖNCELİKLİ
  // ve doğrusu odur: tek vekil arkasında 1 sıçrama demektir, "her şeye güven" değil.)
  if (/^\d+$/.test(v)) return Number(v);
  // "loopback", "uniquelocal", CIDR listesi… — Express'in kendi ayrıştırıcısına bırak.
  return v;
}

/** Virgüllü origin listesi → dizi. Boş liste `null` döner (= kısıt yok). */
export function parseOriginList(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return null;
  // Tekrarları at — cors paketi diziyi olduğu gibi dolaşır, tekrar sessiz gürültüdür.
  return Array.from(new Set(parts));
}

function readCount(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  onWarn: WarnFn,
  name: string,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) {
    onWarn(`[web-hardening] ${name}="${raw}" sayı değil — varsayılan ${fallback} kullanıldı.`);
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * Ortam değişkenlerinden sertleştirme yapılandırmasını çözer. SAF: yalnız
 * verilen `env` kaydını okur (bekçi sahte env geçirebilsin diye parametre —
 * `process.env`i mutasyona uğratıp geri almak, paralel testte sızdıran bir desendir).
 */
export function readWebHardeningConfig(
  env: NodeJS.ProcessEnv = process.env,
  onWarn: WarnFn = (m) => console.warn(m),
): WebHardeningConfig {
  const trustProxy = parseTrustProxy(env.TRUST_PROXY, onWarn);

  // ⚠️ Swagger varsayılanı YALNIZ `NODE_ENV`e bakar — `APP_ENV`e DEĞİL. Sebep
  // birebir uyum: bugünkü kapı `config/swagger.ts` içindeki
  // `if (process.env.NODE_ENV === "production") return;` satırıdır. `APP_ENV`i
  // de hesaba katmak, `APP_ENV=production` + `NODE_ENV=development` koşan bir
  // kurulumda Swagger'ı sessizce kapatırdı — sertleştirme değil, davranış farkı.
  const swaggerEnabled = parseBoolEnv(env.SWAGGER_ENABLED, onWarn, "SWAGGER_ENABLED")
    ?? env.NODE_ENV !== "production";

  const rateLimitEnabled = parseBoolEnv(env.RATE_LIMIT_ENABLED, onWarn, "RATE_LIMIT_ENABLED") ?? false;
  const windowSec = readCount(
    env.RATE_LIMIT_WINDOW_SEC, WINDOW_SEC_DEFAULT, WINDOW_SEC_MIN, WINDOW_SEC_MAX, onWarn,
    "RATE_LIMIT_WINDOW_SEC",
  );

  // Giriş kilidi kapsamı: açıkça verilebilir, verilmezse TRUST_PROXY'den TÜRETİLİR.
  //
  // ⚠️ TÜREME BİLİNÇLİ — ikinci bir "unutulabilir adım" yaratmamak için. Kilidi
  // anlamsızlaştıran tek şey ters vekildir; `TRUST_PROXY` verildiği an kurulum
  // tanım gereği bir vekil arkasındadır. Ayrı bir değişkene bağlansaydı, onu
  // ayarlamayı unutan kurulum tam da korumanın gerektiği yerde eski davranışta
  // kalırdı (izin kataloğu / rol şablonu vakalarının aynısı: "elle yapılacak
  // adım" fiilen unutulur).
  const scopeRaw = env.LOGIN_LOCKOUT_SCOPE?.trim().toLowerCase();
  let loginLockoutScope: WebHardeningConfig["loginLockoutScope"];
  if (scopeRaw === "ip" || scopeRaw === "ip+identity") {
    loginLockoutScope = scopeRaw;
  } else {
    if (scopeRaw) {
      onWarn(
        `[web-hardening] LOGIN_LOCKOUT_SCOPE="${env.LOGIN_LOCKOUT_SCOPE}" tanınmadı — ` +
          "TRUST_PROXY'den türetildi ('ip' | 'ip+identity').",
      );
    }
    loginLockoutScope = trustProxy === null || trustProxy === false ? "ip" : "ip+identity";
  }

  return {
    trustProxy,
    corsOrigins: parseOriginList(env.CORS_ORIGINS),
    swaggerEnabled,
    httpsEnabled: parseBoolEnv(env.HTTPS_ENABLED, onWarn, "HTTPS_ENABLED") ?? false,
    rateLimit: {
      enabled: rateLimitEnabled,
      windowMs: windowSec * 1000,
      writeMax: readCount(
        env.RATE_LIMIT_WRITE_MAX, WRITE_MAX_DEFAULT, COUNT_MIN, COUNT_MAX, onWarn,
        "RATE_LIMIT_WRITE_MAX",
      ),
      loginMax: readCount(
        env.RATE_LIMIT_LOGIN_MAX, LOGIN_MAX_DEFAULT, COUNT_MIN, COUNT_MAX, onWarn,
        "RATE_LIMIT_LOGIN_MAX",
      ),
    },
    loginLockoutScope,
    // Başlık adı küçük harfe indirilir: Node gelen başlıkları küçük harfle
    // saklar, "CF-Connecting-IP" yazan bir .env sessizce eşleşmezdi.
    clientIpHeader: (env.CLIENT_IP_HEADER ?? "").trim().toLowerCase() || null,
    // Karışık mod (LAN + tünel aynı process'te) yalnız REMOTE_PORT verildiğinde
    // doğar; başlık güveni de yalnız orada daraltılır.
    clientIpHeaderRemoteOnly: Boolean((env.REMOTE_PORT ?? "").trim()),
  };
}

/** Sertleştirme değişkenlerinden en az biri verilmiş mi (boot banner'ı için). */
export function isWebHardeningDeclared(env: NodeJS.ProcessEnv = process.env): boolean {
  return [
    "TRUST_PROXY",
    "CLIENT_IP_HEADER",
    "CORS_ORIGINS",
    "SWAGGER_ENABLED",
    "HTTPS_ENABLED",
    "RATE_LIMIT_ENABLED",
    "LOGIN_LOCKOUT_SCOPE",
  ].some((k) => (env[k] ?? "").trim() !== "");
}

// -----------------------------------------------------------------------------
// Hız sınırı — bağımlılıksız sliding window
// -----------------------------------------------------------------------------

/** Giriş uçları — kova ataması METODA değil YOLA bakar (üçü de POST). */
const LOGIN_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/login-card",
  "/api/auth/login-quick-pin",
]);

/** Sayılmayan metodlar. OPTIONS bilinçli: preflight'ı bloklamak CORS'u bozar
 *  ve tarayıcı bunu "sunucu kapalı" gibi gösterir (teşhisi zor bir arıza). */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** `originalUrl` → sorgu dizesi ve sondaki eğik çizgi atılmış, küçük harfli yol. */
export function normalizeRequestPath(originalUrl: string): string {
  const q = originalUrl.indexOf("?");
  let p = (q === -1 ? originalUrl : originalUrl.slice(0, q)).toLowerCase();
  while (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/**
 * İsteğin hangi kovaya düştüğü — `null` = hız sınırı UYGULANMAZ.
 *
 * ⚠️ OKUMALAR BİLİNÇLİ OLARAK SINIRSIZ. Fabrikada tabletler 5 sn'de bir
 * `/health` + açık kart listelerini yokluyor ve panel liste ekranları tek
 * açılışta onlarca GET atıyor; okumalara global bir sınır koymak, korumak
 * istediğimiz şeyi (hesap denemesi ve yazma sel'i) hiç etkilemeden sahayı
 * durdururdu. Okuma tarafı gerekirse ayrı ve çok daha geniş bir kovayla eklenir.
 */
export function classifyRateLimitRequest(method: string, originalUrl: string): RateLimitBucket | null {
  const path = normalizeRequestPath(originalUrl);
  if (LOGIN_PATHS.has(path)) return "login";
  if (READ_METHODS.has(method.toUpperCase())) return null;
  return path === "/api" || path.startsWith("/api/") ? "write" : null;
}

/**
 * Hız sınırı anahtarı. `req.ip` KASITEN birinci sırada: `trust proxy` doğru
 * ayarlandığında bu gerçek istemci IP'sidir, ayarlanmadığında soket IP'sidir —
 * iki durumda da elimizdeki en iyi kaynak. Cihaz kimliği yalnız IP yokken
 * (soketsiz taşıma) devreye girer; başlık olduğu için tek başına güvenilmez.
 */
/**
 * İSTEMCİ IP'Sİ — tek çözüm noktası (giriş kilidi ve hız sınırı ORTAK kullanır).
 *
 * ⚠️ NEDEN `req.ip` YETMEDİ (2026-08-14, canlı demoda ÖLÇÜLDÜ): Traefik gelen
 * `X-Forwarded-For` başlığını güvenilmeyen kaynaktan geldiği için SİLİYOR ve
 * kendi gördüğü adresi (Cloudflare kenarı) yazıyor. Cloudflare'in taşıdığı
 * gerçek ziyaretçi IP'si orada kayboluyor; `TRUST_PROXY` 1 ve 2 ile ayrı ayrı
 * denendi, ikisi de kenar IP'si döndü. Yani hiçbir Express ayarı bunu
 * kurtaramaz — çözüm, ağın koruduğu ayrı bir başlığı okumaktır.
 *
 * Başlık YAPILANDIRILMAMIŞSA davranış bugünküyle BİREBİR aynı (`req.ip`).
 * Başlık VAR ama boş/bozuk gelirse yine `req.ip`'e düşülür: eksik bir başlık
 * yüzünden isteği reddetmek, korumadan beklenen şey değil.
 */
export function resolveClientIp(
  req: Request,
  header: string | null,
  /** Bkz. `WebHardeningConfig.clientIpHeaderRemoteOnly`. */
  remoteOnly = false,
): string | null {
  // ⚠️ Karışık modda başlık yalnız TÜNELDEN gelen isteklerde okunur; LAN'dan
  // gelen bir istek onu uydurabileceği için orada `req.ip`e düşülür.
  if (header && (!remoteOnly || req.isRemote === true)) {
    const raw = req.headers[header];
    const v = Array.isArray(raw) ? raw[0] : raw;
    // Virgüllü liste gelirse İLK değer istemcidir (XFF sözleşmesi).
    const first = typeof v === "string" ? v.split(",")[0]?.trim() : "";
    if (first) return first.slice(0, 64);
  }
  return typeof req.ip === "string" && req.ip.trim() ? req.ip.trim() : null;
}

export function resolveRateLimitKey(
  req: Request,
  bucket: RateLimitBucket,
  clientIpHeader: string | null = null,
  clientIpHeaderRemoteOnly = false,
): string {
  const ip = resolveClientIp(req, clientIpHeader, clientIpHeaderRemoteOnly);
  if (ip) return `${bucket}|${ip}`;
  const h = req.headers["x-device-id"];
  const v = Array.isArray(h) ? h[0] : h;
  if (typeof v === "string" && v.trim()) return `${bucket}|dev:${v.trim().slice(0, 64)}`;
  return `${bucket}|unknown`;
}

export type RateLimiterOptions = {
  windowMs: number;
  limits: Record<RateLimitBucket, number>;
  /** Saat kaynağı — bekçi pencereyi uyumadan kaydırabilsin diye enjekte edilir. */
  now?: () => number;
  /** Bellek tavanı: bu sayının üstünde bayat anahtarlar budanır. */
  maxKeys?: number;
  /**
   * Gerçek istemci IP'sini taşıyan güvenilen başlık. Verilmezse `req.ip`.
   * ⚠️ Giriş kilidiyle AYNI kaynaktan beslenmeli: biri kenar IP'sini, diğeri
   * gerçek istemciyi sayarsa iki koruma farklı kişileri sınırlar.
   */
  clientIpHeader?: string | null;
  /** Bkz. `WebHardeningConfig.clientIpHeaderRemoteOnly`. */
  clientIpHeaderRemoteOnly?: boolean;
};

export type RateLimiter = RequestHandler & {
  /** Testler ve elle teşhis için: sayaçları sıfırla. */
  reset(): void;
  /** İzlenen anahtar sayısı (bellek tavanı bekçisi buna bakar). */
  size(): number;
};

const DEFAULT_MAX_KEYS = 20_000;

/**
 * Bağımlılıksız SLIDING WINDOW hız sınırı.
 *
 * ⚠️ Neden sliding window ve neden sabit pencere DEĞİL: sabit pencerede sınır
 * pencere sınırında ikiye katlanır (59. saniyede N, 61. saniyede N daha) — tam
 * olarak engellemek istediğimiz ani sel oradan geçer. Anahtar başına damga
 * dizisi tutmanın maliyeti sınırlıdır: dizi uzunluğu tanım gereği `limit`i
 * AŞAMAZ, çünkü sınıra ulaşıldığında yeni damga EKLENMEZ.
 *
 * ⚠️ REDDEDİLEN İSTEK SAYILMAZ. Sayılsaydı sürekli deneyen bir istemci pencereyi
 * hiç boşaltamaz ve ceza süresiz uzardı; bu bir kilit değil, bir HIZ sınırı —
 * kalıcı ceza `login-lockout` katmanının işi.
 */
export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? DEFAULT_MAX_KEYS;
  /** anahtar → pencere içindeki isteklerin zaman damgaları (artan sırada). */
  const hits = new Map<string, number[]>();

  function sweep(t: number): void {
    if (hits.size <= maxKeys) return;
    // Önce tamamen bayatlamış anahtarları at (aktif bir sınırlamayı bozmaz).
    for (const [k, arr] of hits) {
      const last = arr[arr.length - 1];
      if (last === undefined || last <= t - opts.windowMs) hits.delete(k);
    }
    // Hâlâ tavanın üstündeysek en eski eklenenlerden buda. Bedel bilinçli:
    // budanan anahtar bütçesini sıfırlar. Alternatif (sınırsız Map) bir saldırgana
    // rastgele anahtarlarla belleği tüketme imkânı verirdi — o daha kötü.
    if (hits.size > maxKeys) {
      for (const k of hits.keys()) {
        hits.delete(k);
        if (hits.size <= maxKeys) break;
      }
    }
  }

  // İsimli fonksiyon: Express layer adı olarak görünür (bekçi zinciri buradan tanır).
  function apiRateLimiter(req: Request, res: Response, next: NextFunction): void {
    const bucket = classifyRateLimitRequest(req.method, req.originalUrl);
    if (!bucket) return next();

    const limit = opts.limits[bucket];
    const key = resolveRateLimitKey(
      req, bucket, opts.clientIpHeader ?? null, opts.clientIpHeaderRemoteOnly ?? false,
    );
    const t = now();
    const windowStart = t - opts.windowMs;

    const arr = hits.get(key) ?? [];
    // Pencereden düşenleri at. Damgalar artan sırada olduğu için baştan kesmek yeterli.
    let drop = 0;
    while (drop < arr.length && (arr[drop] as number) <= windowStart) drop++;
    const live = drop > 0 ? arr.slice(drop) : arr;

    if (live.length >= limit) {
      const oldest = live[0] as number;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + opts.windowMs - t) / 1000));
      hits.set(key, live);
      // Retry-After standart başlıktır; istemcinin ne zaman tekrar deneyeceğini
      // gövdeyi ayrıştırmadan bilmesini sağlar (mobil kuyruk bunu okuyabilir).
      if (typeof res.setHeader === "function") res.setHeader("Retry-After", String(retryAfterSec));
      next(
        AppError.tooManyRequests(
          `Çok fazla istek gönderildi. ${retryAfterSec} saniye sonra tekrar deneyin.`,
          { code: "RATE_LIMITED", bucket, retryAfterSec },
        ),
      );
      return;
    }

    live.push(t);
    hits.set(key, live);
    sweep(t);
    next();
  }

  return Object.assign(apiRateLimiter, {
    reset: () => hits.clear(),
    size: () => hits.size,
  });
}
