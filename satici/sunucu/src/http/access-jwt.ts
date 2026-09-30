// CLOUDFLARE ACCESS JWT DOĞRULAYICISI — ERİŞİM dinleyicisinin (satıcı portalının genel yolu) kimlik duvarı.
// `Cf-Access-Jwt-Assertion` başlığını herkes yazabilir; anlamı YALNIZ bu doğrulamadan gelir: imza RS256 ve
// anahtar takımın JWKS'inden (adres yapılandırmadaki takım alanından türer — jetondaki jku/jwk/x5u/x5c ASLA
// okunmaz), `aud` Access uygulamasının AUD etiketi, `iss` takım alanı, `exp` zorunlu, `nbf`/`iat` saat payıyla,
// e-posta kimliği zorunlu. Kaynak IP'ye ve istemcinin beyanına güvenilmez.
// Satıcı DIŞ BAĞLANTISIZDIR: JWKS'i ağdan yalnız yan konteyner (`src/jwks-cekici.ts`) çeker ve dosyaya atomik
// yazar; satıcının doğrulayıcısı YALNIZ o dosyayı (salt okunur bağ) okur — ağ çekimi sunucuda bağlanmaz.
// JWKS önbelleği: TTL TAZELİKTİR geçerlilik değil — bayat anahtar döner ve arka planda tazelenir; önbellek HİÇ
// dolmadıysa (dosya yok/bozuk/boş anahtar kümesi) RED (fail-closed); bilinmeyen kid kaynağı tek uçuşla bir kez
// yeniden okur. Zorunlu okumalar arasında soğuma süresi var: uydurma kid istek başına okuma tetikleyemez.
// Eski ama geçerli küme YAŞ TAVANINA dek kabul (varsayılan 7 gün, kaynağın yazım zamanından): tavanı aşan küme RED,
// tavanın yarısında uyarı — durmuş yan konteyner geri çekilmiş bir Cloudflare anahtarını süresiz geçerli tutamasın.
import { createPublicKey, verify as verifySignature, type KeyObject } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { JWKS_AZAMI_YAS_GUN_VARSAYILAN, type VendorConfig } from "../config";

export const ACCESS_HEADER = "cf-access-jwt-assertion";
/** Kabul edilen TEK algoritma: RSA PKCS#1 v1.5 + SHA-256. */
export const ACCESS_ALG = "RS256";
export const JWKS_TTL_MS = 15 * 60_000;
export const JWKS_REFRESH_COOLDOWN_MS = 10_000;
export const JWKS_TIMEOUT_MS = 5_000;
/** Dosya kaynağı yerel ve ucuz: sık tazelenir, bilinmeyen kid'de kısa soğumayla yeniden okunur. */
export const JWKS_FILE_TTL_MS = 60_000;
export const JWKS_FILE_COOLDOWN_MS = 1_000;
const DAY_MS = 86_400_000;
/** Yaş uyarısı en çok saatte bir (dosya saatlerce eskirken günlük boğulmasın). */
const AGE_WARN_INTERVAL_MS = 3_600_000;
const JWKS_MAX_BYTES = 64 * 1024;
const JWKS_MAX_KEYS = 20;
const MIN_RSA_BITS = 2048;
const TOKEN_MAX_CHARS = 8192;
const CLOCK_SKEW_SEC = 30;
const B64URL = /^[A-Za-z0-9_-]+$/;

export interface AccessSettings {
  readonly teamDomain: string;
  readonly aud: string;
  /** Yan konteynerin yazdığı JWKS dosyası (satıcıda salt okunur bağ). */
  readonly jwksFile: string;
}

type AccessConfig = Pick<VendorConfig, "CF_ACCESS_TAKIM_ALANI" | "CF_ACCESS_AUD" | "CF_ACCESS_JWKS_DOSYASI"> & Partial<Pick<VendorConfig, "CF_ACCESS_JWKS_AZAMI_YAS_GUN">>;

/** Access yapılandırması: takım alanı, AUD ve JWKS dosyası BİRLİKTE yoksa ERİŞİM kipi KAPALI (null). */
export function accessSettingsOf(config: AccessConfig): AccessSettings | null {
  const teamDomain = config.CF_ACCESS_TAKIM_ALANI ?? "";
  const aud = config.CF_ACCESS_AUD ?? "";
  const jwksFile = config.CF_ACCESS_JWKS_DOSYASI ?? "";
  return teamDomain && aud && jwksFile ? { teamDomain, aud, jwksFile } : null;
}

/** Kip KAPALI ise eksik ayarların adları (günlük için; değer basılmaz). */
export function missingAccessSettings(config: AccessConfig): string[] {
  return (["CF_ACCESS_TAKIM_ALANI", "CF_ACCESS_AUD", "CF_ACCESS_JWKS_DOSYASI"] as const).filter((k) => !config[k]);
}

export function jwksUrlOf(teamDomain: string): string {
  return `https://${teamDomain}/cdn-cgi/access/certs`;
}

export function issuerOf(teamDomain: string): string {
  return `https://${teamDomain}`;
}

// ---------------------------------------------------------------- JWKS

/**
 * JWKS gövdesini getirir. `sourceTimeMs`: içeriğin kaynaktaki zamanı (dosyada mtime = yan konteynerin son
 * başarılı yazımı); verilmezse okuma anı. Testte sahtesi verilir.
 */
export type JwksFetch = (source: string, signal: AbortSignal) => Promise<{ readonly status: number; readonly body: string; readonly sourceTimeMs?: number }>;

/** AĞ çekimi — YALNIZ yan konteyner (`jwks-cekici`) kullanır; yönlendirme izlenmez, gövde tavanlıdır. */
export const fetchJwksOverNetwork: JwksFetch = async (url, signal) => {
  const res = await fetch(url, { signal, redirect: "error", headers: { accept: "application/json" } });
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > JWKS_MAX_BYTES) throw new Error(`JWKS gövdesi çok büyük (${declared} bayt)`);
  const body = await res.text();
  return { status: res.status, body };
};

/** DOSYA kaynağı — satıcının tek kaynağı: yok/okunamaz/tavan üstü dosya hata (önbellek hiç dolmadıysa RED). */
export function jwksFromFile(file: string): JwksFetch {
  return async () => {
    const st = await stat(file);
    if (!st.isFile() || st.size > JWKS_MAX_BYTES) throw new Error("JWKS dosyası geçersiz (düz dosya değil ya da çok büyük)");
    return { status: 200, body: await readFile(file, "utf8"), sourceTimeMs: st.mtimeMs };
  };
}

/** JWKS gövdesini anahtar haritasına çevirir; yalnız RSA ≥ 2048 imza anahtarları. Geçerli anahtar yoksa hata. */
export function parseJwks(body: string): Map<string, KeyObject> {
  if (body.length > JWKS_MAX_BYTES) throw new Error("JWKS gövdesi çok büyük");
  const doc = JSON.parse(body) as unknown;
  const list = isRecord(doc) && Array.isArray(doc.keys) ? doc.keys : null;
  if (!list) throw new Error("JWKS biçimsiz (keys dizisi yok)");
  const keys = new Map<string, KeyObject>();
  for (const jwk of list.slice(0, JWKS_MAX_KEYS)) {
    if (!isRecord(jwk) || jwk.kty !== "RSA" || typeof jwk.kid !== "string" || jwk.kid.length === 0 || jwk.kid.length > 200) continue;
    if (jwk.use !== undefined && jwk.use !== "sig") continue;
    if (jwk.alg !== undefined && jwk.alg !== ACCESS_ALG) continue;
    if (typeof jwk.n !== "string" || typeof jwk.e !== "string" || keys.has(jwk.kid)) continue;
    try {
      // Yalnız açık yarının üç alanı: özel anahtar alanı (d, p, q…) taşıyan girdi de açık anahtar olarak okunur.
      const key = createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
      if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < MIN_RSA_BITS) continue;
      keys.set(jwk.kid, key);
    } catch {
      // Tek bozuk anahtar kümeyi düşürmez.
    }
  }
  if (keys.size === 0) throw new Error("JWKS geçerli RS256 anahtarı taşımıyor");
  return keys;
}

/** Doğrulanmış anahtarları yalın JWKS'e çevirir (yalnız kid · kty · n · e · alg · use); geçerli anahtar yoksa hata. */
export function normalizeJwks(body: string): { readonly json: string; readonly count: number } {
  const keys = parseJwks(body);
  const out = [...keys].map(([kid, key]) => {
    const jwk = key.export({ format: "jwk" });
    return { kid, kty: "RSA", n: jwk.n, e: jwk.e, alg: ACCESS_ALG, use: "sig" };
  });
  return { json: `${JSON.stringify({ keys: out })}\n`, count: out.length };
}

export interface JwksCacheOptions {
  /** Kaynak (ağ adresi ya da dosya yolu) — `fetchJwks`e aynen verilir. */
  readonly source: string;
  /** Zorunlu: sunucuda YALNIZ dosya kaynağı (`jwksFromFile`) bağlanır; varsayılan ağ çekimi YOK. */
  readonly fetchJwks: JwksFetch;
  readonly ttlMs?: number;
  readonly cooldownMs?: number;
  readonly timeoutMs?: number;
  /** Kaynaktaki yazım zamanından bu yana kabul edilen en büyük yaş; aşan küme RED (varsayılan 7 gün). */
  readonly maxSourceAgeMs?: number;
  readonly now?: () => number;
  readonly warn?: (message: string) => void;
}

/** Kümenin yaş durumu: TAZE · UYARI (tavanın yarısı geçti) · ASILDI (RED). */
export type JwksAgeLevel = "TAZE" | "UYARI" | "ASILDI";

export interface JwksState {
  readonly filled: boolean;
  readonly keyCount: number;
  /** Son başarılı okumadan bu yana geçen süre (sn); hiç dolmadıysa null. */
  readonly ageSec: number | null;
  /** Anahtar kümesinin kaynaktaki yaşı (sn; dosyada mtime'dan) — eski ama geçerli küme tavana dek kabul, yaşı görünür. */
  readonly sourceAgeSec: number | null;
  readonly maxSourceAgeSec: number;
  /** Hiç dolmadıysa null. */
  readonly ageLevel: JwksAgeLevel | null;
  readonly lastError: string | null;
}

export class JwksCache {
  private keys: Map<string, KeyObject> | null = null;
  private fetchedAt = 0;
  private sourceTime = 0;
  private lastWarnAt = Number.NEGATIVE_INFINITY;
  private lastAgeWarnAt = Number.NEGATIVE_INFINITY;
  private lastAgeWarnLevel: JwksAgeLevel = "TAZE";
  private lastAttemptAt = Number.NEGATIVE_INFINITY;
  private inFlight: Promise<void> | null = null;
  private lastError: string | null = null;
  private readonly fetchJwks: JwksFetch;
  private readonly ttlMs: number;
  private readonly cooldownMs: number;
  private readonly timeoutMs: number;
  private readonly maxSourceAgeMs: number;
  private readonly now: () => number;
  private readonly warn: (message: string) => void;

  constructor(private readonly options: JwksCacheOptions) {
    this.fetchJwks = options.fetchJwks;
    this.ttlMs = options.ttlMs ?? JWKS_TTL_MS;
    this.cooldownMs = options.cooldownMs ?? JWKS_REFRESH_COOLDOWN_MS;
    this.timeoutMs = options.timeoutMs ?? JWKS_TIMEOUT_MS;
    this.maxSourceAgeMs = options.maxSourceAgeMs ?? JWKS_AZAMI_YAS_GUN_VARSAYILAN * DAY_MS;
    this.now = options.now ?? Date.now;
    this.warn = options.warn ?? ((m) => console.warn(`[satici] erisim: ${m}`));
  }

  /** Açılışta ısıtma: başarısızlık yalnız uyarıdır, istekler kendi çekimini dener. */
  warm(): Promise<void> {
    return this.refresh();
  }

  state(): JwksState {
    return {
      filled: this.keys !== null,
      keyCount: this.keys?.size ?? 0,
      ageSec: this.keys ? Math.max(0, Math.round((this.now() - this.fetchedAt) / 1000)) : null,
      sourceAgeSec: this.keys ? Math.max(0, Math.round((this.now() - this.sourceTime) / 1000)) : null,
      maxSourceAgeSec: Math.round(this.maxSourceAgeMs / 1000),
      ageLevel: this.keys ? this.ageLevel() : null,
      lastError: this.lastError,
    };
  }

  private ageLevel(): JwksAgeLevel {
    const age = this.now() - this.sourceTime;
    return age > this.maxSourceAgeMs ? "ASILDI" : age > this.maxSourceAgeMs / 2 ? "UYARI" : "TAZE";
  }

  private warnAge(level: JwksAgeLevel): void {
    // Kademe değişince hemen, aynı kademede saatte bir.
    const same = level === this.lastAgeWarnLevel;
    this.lastAgeWarnLevel = level;
    if (level === "TAZE" || (same && this.now() - this.lastAgeWarnAt < AGE_WARN_INTERVAL_MS)) return;
    this.lastAgeWarnAt = this.now();
    const hours = Math.round((this.now() - this.sourceTime) / 3_600_000);
    const cap = Math.round(this.maxSourceAgeMs / 3_600_000);
    this.warn(
      level === "ASILDI"
        ? `JWKS ${hours} saattir yenilenmedi — yaş tavanı (${cap} sa) AŞILDI, istekler reddediliyor; yan konteyneri (satici-jwks) denetle`
        : `JWKS ${hours} saattir yenilenmedi (tavan ${cap} sa, yarısı geçti) — yan konteyneri (satici-jwks) denetle`,
    );
  }

  /** kid'in anahtarı; hiç dolmamış/erişilemeyen JWKS → "JWKS", yaş tavanını aşan küme → "ESKI", tazelemeden sonra da bilinmeyen kid → "KID". */
  async keyFor(kid: string): Promise<KeyObject | "JWKS" | "KID" | "ESKI"> {
    if (this.keys === null) {
      if (this.mayFetch()) await this.refresh();
      if (this.keys === null) return "JWKS";
    } else if (this.now() - this.fetchedAt > this.ttlMs && this.mayFetch()) {
      void this.refresh(); // bayat anahtar döner, tazeleme arka planda
    }
    if (this.ageLevel() === "ASILDI" && this.mayFetch()) await this.refresh(); // kaynak bu arada yenilenmiş olabilir
    const level = this.ageLevel();
    this.warnAge(level);
    if (level === "ASILDI") return "ESKI";
    const hit = this.keys.get(kid);
    if (hit) return hit;
    if (this.mayFetch()) await this.refresh();
    return this.keys.get(kid) ?? "KID";
  }

  /** Uçuştaki çekim beklenebilir; yeni çekim yalnız soğuma süresi dolduysa. */
  private mayFetch(): boolean {
    return this.inFlight !== null || this.now() - this.lastAttemptAt >= this.cooldownMs;
  }

  private refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.lastAttemptAt = this.now();
    this.inFlight = this.load()
      .then(
        ({ keys, sourceTimeMs }) => {
          this.keys = keys;
          this.fetchedAt = this.now();
          this.sourceTime = sourceTimeMs ?? this.fetchedAt;
          this.lastError = null;
        },
        (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          // Aynı hata dakikada bir kez günlüğe (dosya yokken her istek okuma dener).
          if (message !== this.lastError || this.now() - this.lastWarnAt >= 60_000) {
            this.lastWarnAt = this.now();
            this.warn(`JWKS alınamadı (${this.keys ? "bayat anahtarlarla sürüyor" : "önbellek BOŞ — istekler reddedilir"}): ${message}`);
          }
          this.lastError = message;
        },
      )
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private async load(): Promise<{ keys: Map<string, KeyObject>; sourceTimeMs: number | undefined }> {
    const r = await this.fetchJwks(this.options.source, AbortSignal.timeout(this.timeoutMs));
    if (r.status !== 200) throw new Error(`JWKS HTTP ${r.status}`);
    return { keys: parseJwks(r.body), sourceTimeMs: r.sourceTimeMs };
  }
}

// ---------------------------------------------------------------- doğrulama

export type AccessRejection = "BASLIK_YOK" | "BICIM" | "ALG" | "KID" | "JWKS" | "JWKS_ESKI" | "IMZA" | "ISS" | "AUD" | "SURE" | "KIMLIK";

export interface AccessIdentity {
  readonly email: string;
  readonly sub: string | null;
}

export type AccessResult = { readonly ok: true; readonly identity: AccessIdentity } | { readonly ok: false; readonly reason: AccessRejection; readonly detail: string };

const reject = (reason: AccessRejection, detail: string): AccessResult => ({ ok: false, reason, detail });

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as unknown;
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export class AccessVerifier {
  readonly issuer: string;

  constructor(
    readonly settings: AccessSettings,
    readonly jwks: JwksCache,
    private readonly now: () => number = Date.now,
  ) {
    this.issuer = issuerOf(settings.teamDomain);
  }

  /** Başlık değeri (Node'da yinelenen başlık virgülle birleşir → biçimsiz). */
  async verify(header: string | string[] | undefined): Promise<AccessResult> {
    if (header === undefined || header === "") return reject("BASLIK_YOK", "Cf-Access-Jwt-Assertion yok");
    if (typeof header !== "string" || header.length > TOKEN_MAX_CHARS) return reject("BICIM", "başlık biçimsiz");
    const parts = header.split(".");
    if (parts.length !== 3 || !parts.every((p) => B64URL.test(p))) return reject("BICIM", "üç base64url parçası değil");
    const [h64, p64, s64] = parts as [string, string, string];

    const head = decodeJson(h64);
    if (!head) return reject("BICIM", "başlık JSON değil");
    // Saldırganın yazdığı değer günlüğe yalnız kısa ve düz biçimdeyse girer (satır uydurma yok).
    if (head.alg !== ACCESS_ALG) return reject("ALG", `alg ${typeof head.alg === "string" && /^[A-Za-z0-9]{1,16}$/.test(head.alg) ? head.alg : "?"}`);
    if (head.crit !== undefined) return reject("ALG", "crit desteklenmiyor");
    if (typeof head.kid !== "string" || head.kid.length === 0 || head.kid.length > 200) return reject("KID", "kid yok");

    const key = await this.jwks.keyFor(head.kid);
    if (key === "JWKS") return reject("JWKS", "anahtar kümesi yok (hiç çekilemedi)");
    if (key === "ESKI") return reject("JWKS_ESKI", "anahtar kümesi yaş tavanını aştı (yan konteyner yenilemiyor)");
    if (key === "KID") return reject("KID", "bilinmeyen kid");
    const signature = Buffer.from(s64, "base64url");
    const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
    let valid = false;
    try {
      valid = signature.length === Math.ceil(bits / 8) && verifySignature("sha256", Buffer.from(`${h64}.${p64}`, "ascii"), key, signature);
    } catch {
      valid = false;
    }
    if (!valid) return reject("IMZA", "imza doğrulanmadı");

    // İmza doğrulandı: talepler ancak şimdi okunur.
    const claims = decodeJson(p64);
    if (!claims) return reject("BICIM", "yük JSON değil");
    if (claims.iss !== this.issuer) return reject("ISS", "iss takım alanı değil");
    const aud = claims.aud;
    const audOk = typeof aud === "string" ? aud === this.settings.aud : Array.isArray(aud) && aud.length <= 10 && aud.every((a) => typeof a === "string") && aud.includes(this.settings.aud);
    if (!audOk) return reject("AUD", "aud bu uygulamanın değil");
    const nowSec = Math.floor(this.now() / 1000);
    if (!isNumber(claims.exp)) return reject("SURE", "exp yok");
    if (nowSec >= claims.exp + CLOCK_SKEW_SEC) return reject("SURE", "süresi dolmuş");
    if (claims.nbf !== undefined && (!isNumber(claims.nbf) || nowSec + CLOCK_SKEW_SEC < claims.nbf)) return reject("SURE", "henüz geçerli değil (nbf)");
    if (claims.iat !== undefined && (!isNumber(claims.iat) || claims.iat > nowSec + CLOCK_SKEW_SEC)) return reject("SURE", "iat gelecekte");
    const email = claims.email;
    if (typeof email !== "string" || email.length === 0 || email.length > 320 || !email.includes("@")) return reject("KIMLIK", "e-posta kimliği yok");
    return { ok: true, identity: { email, sub: typeof claims.sub === "string" ? claims.sub : null } };
  }
}

/** Yapılandırmadan doğrulayıcı (kapalıysa null). Kaynak YALNIZ yan konteynerin yazdığı dosya — satıcı ağa çıkmaz. */
export function createAccessVerifier(config: AccessConfig): AccessVerifier | null {
  const settings = accessSettingsOf(config);
  if (!settings) return null;
  const cache = new JwksCache({
    source: settings.jwksFile,
    fetchJwks: jwksFromFile(settings.jwksFile),
    ttlMs: JWKS_FILE_TTL_MS,
    cooldownMs: JWKS_FILE_COOLDOWN_MS,
    maxSourceAgeMs: (config.CF_ACCESS_JWKS_AZAMI_YAS_GUN ?? JWKS_AZAMI_YAS_GUN_VARSAYILAN) * DAY_MS,
  });
  return new AccessVerifier(settings, cache);
}
