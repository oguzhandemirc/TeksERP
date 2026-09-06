// =============================================================================
// TeksERP — UZAKTAN ERİŞİM KAPISI (Cloudflare Tunnel + Access)
// =============================================================================
// Fabrika sunucusu LAN-only tasarlandı (`web-hardening.ts` başlığı). Patron
// modülü onu internete açıyor ama TEK BİR GELEN PORT AÇMADAN: fabrikada koşan
// `cloudflared` DIŞARI doğru bağlanır ve isteği `127.0.0.1:<REMOTE_PORT>`e
// bırakır. Yani aynı process iki farklı dünyaya hizmet eder ve bu modülün tek
// işi ikisini AYIRMAKTIR.
//
// ⚠️ AYRIM `clientType` İLE YAPILAMAZ — o gövdeden gelir, istemci uydurabilir.
// İnternetten gelen biri `clientType:"electron"` yazıp LAN kurallarına (PIN
// girişi, TOTP muafiyeti) düşerdi. Uzaklık iki BAĞIMSIZ katmandan çözülür:
//
//   1) DİNLEYİCİ PORTU (`markRemote`) — `cloudflared` yalnız 127.0.0.1'deki
//      ikinci dinleyiciye bağlanır; LAN'dan 127.0.0.1'e ulaşılamaz. Uydurulamaz
//      ve PAYLAŞILAN SIR YOKTUR (sızacak/rotasyona girecek bir şey yok).
//   2) CLOUDFLARE ACCESS JWT (`verifyAccessJwt`) — kenar, kimliği doğruladıktan
//      sonra `Cf-Access-Jwt-Assertion` başlığını imzalı olarak ekler.
//
// İkincisi yalnız derinlik savunması değil: Access politikası CF panelinden
// YANLIŞLIKLA kaldırılırsa kimlik duvarı sessizce düşerdi ve bunu hiçbir yerden
// göremezdik. Burada fail-closed olduğu için o durumda uzak erişim DURUR —
// gürültülü arıza, sessiz açıktan iyidir.
//
// FABRİKA SIFIR-FARK: `REMOTE_PORT` yokken bu modülün hiçbir kapısı mount
// edilmez ve `req.isRemote` her istekte `false` kalır. LAN yolu bayt-bayt aynıdır.
// =============================================================================

import type { Request, RequestHandler } from "express";
import { createPublicKey, type KeyObject } from "crypto";
import jwt from "jsonwebtoken";
import { normalizeRequestPath, type WarnFn } from "./web-hardening";
import "../types/express-augment";
import { uyari } from "../lib/logger";

// -----------------------------------------------------------------------------
// Yapılandırma
// -----------------------------------------------------------------------------

export type RemoteAccessConfig = {
  /** İkinci (tünel) dinleyicinin portu. `null` = uzaktan erişim KAPALI. */
  remotePort: number | null;
  /** Cloudflare Access ekip alan adı, örn. `firma.cloudflareaccess.com`. */
  accessTeamDomain: string | null;
  /** Access uygulamasının AUD etiketi (CF panelinden alınır). */
  accessAud: string | null;
  /**
   * Kimlik duvarı BİLEREK kapatıldı mı (`CF_ACCESS_ENABLED=false`).
   *
   * ⚠️ Bu bir AÇIK BEYANDIR, eksik yapılandırmanın sonucu DEĞİL. Ayrım
   * load-bearing: Access alanları unutulduğunda tünel açılmaz (fail-closed),
   * ama operatör "duvarı istemiyorum" diye YAZDIYSA açılır. Yani kimlik
   * duvarını kaybetmenin tek yolu onu kaybetmeyi seçmektir.
   *
   * Kapalıyken geriye kalan koruma: ERP parolası + TOTP (iki faktör),
   * giriş hız sınırı, deneme kilidi, ve tünelde PIN/kart/cihaz/keşif
   * uçlarının 404 olması. Bunlar Access'ten BAĞIMSIZ çalışır.
   */
  accessWallDisabled: boolean;
};

const PORT_MIN = 1;
const PORT_MAX = 65_535;

/**
 * Ortamdan uzak erişim yapılandırmasını çöz.
 *
 * ⚠️ EKSİK YAPILANDIRMA = KAPALI, "yarı açık" DEĞİL. `REMOTE_PORT` verilip
 * Access alanları verilmezse tünel dinleyicisi kimlik duvarı OLMADAN açılırdı;
 * o yüzden üçü birden istenir ve eksikse uzak erişim hiç açılmaz (uyarıyla).
 */
export function readRemoteAccessConfig(
  env: NodeJS.ProcessEnv = process.env,
  onWarn: WarnFn = (m) => uyari("remote-access", m),
): RemoteAccessConfig {
  const off: RemoteAccessConfig = {
    remotePort: null,
    accessTeamDomain: null,
    accessAud: null,
    accessWallDisabled: false,
  };

  const rawPort = env.REMOTE_PORT?.trim();
  if (!rawPort) return off;

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    onWarn(`[remote-access] REMOTE_PORT="${rawPort}" geçersiz — uzaktan erişim KAPALI.`);
    return off;
  }
  if (env.PORT && Number(env.PORT) === port) {
    onWarn(`[remote-access] REMOTE_PORT, PORT ile aynı (${port}) — uzaktan erişim KAPALI.`);
    return off;
  }

  // ⚠️ AÇIK KAPATMA — yalnız operatör BEYAN ederse. Sadece "false"/"0"/"hayır"
  // gibi net bir olumsuzluk kabul edilir; boş ya da anlaşılmaz değer duvarı
  // KAPATMAZ (yazım hatası yüzünden kimlik duvarı düşmesin).
  const wallRaw = (env.CF_ACCESS_ENABLED ?? "").trim().toLowerCase();
  const wallDisabled = ["false", "0", "no", "off", "hayir", "hayır", "kapali", "kapalı"].includes(
    wallRaw,
  );
  if (wallDisabled) {
    onWarn(
      "[remote-access] ⚠️ CLOUDFLARE ACCESS KİMLİK DUVARI KAPALI (CF_ACCESS_ENABLED=false). " +
        "Uzak girişleri koruyan tek katman ERP parolası + TOTP'dir. " +
        "Giriş hız sınırının (RATE_LIMIT_ENABLED) açık olduğundan emin olun.",
    );
    return { remotePort: port, accessTeamDomain: null, accessAud: null, accessWallDisabled: true };
  }

  // `https://` ön eki yazılmış olabilir; ana makine adına indir.
  const team = env.CF_ACCESS_TEAM_DOMAIN?.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const aud = env.CF_ACCESS_AUD?.trim();
  if (!team || !aud) {
    onWarn(
      "[remote-access] REMOTE_PORT verildi ama CF_ACCESS_TEAM_DOMAIN/CF_ACCESS_AUD eksik — " +
        "uzaktan erişim KAPALI. Kimlik duvarını BİLEREK kullanmıyorsanız " +
        "CF_ACCESS_ENABLED=false yazın (eksik ayar duvarı sessizce düşürmez).",
    );
    return off;
  }

  return {
    remotePort: port,
    accessTeamDomain: team,
    accessAud: aud,
    accessWallDisabled: false,
  };
}

// -----------------------------------------------------------------------------
// 1. katman — dinleyici portu
// -----------------------------------------------------------------------------

/**
 * İstek tünel dinleyicisinden mi geldi?
 *
 * `req.socket.localPort` isteğin KABUL EDİLDİĞİ yerel porttur; istemci bunu
 * seçemez, başlıkla etkileyemez. Soket yoksa (bazı test taşımaları) `false` —
 * fail-closed yönü budur: bilinmeyen bir istek LAN sayılır ve LAN kuralları
 * ZATEN daha dardır (PIN girişi LAN'da meşru, TOTP muafiyeti yalnız LAN'da).
 */
export function isRemoteRequest(req: Request, remotePort: number | null): boolean {
  if (remotePort === null) return false;
  const local = req.socket?.localPort;
  return typeof local === "number" && local === remotePort;
}

/** `req.isRemote`i doldurur. Senkron ve çok ucuz — zincirin EN BAŞINDA koşar. */
export function markRemote(remotePort: number | null): RequestHandler {
  return (req, _res, next) => {
    req.isRemote = isRemoteRequest(req, remotePort);
    next();
  };
}

// -----------------------------------------------------------------------------
// 2. katman — uzakta KAPALI yollar
// -----------------------------------------------------------------------------

/**
 * Uzaktan ERİŞİLEMEYECEK yollar. Her biri LAN'da meşru, internette tehlikeli:
 *
 *  • `login-quick-pin` — `users.quickPin` 6 HANE, DÜZ METİN ve sistem genelinde
 *    `@unique`; yani PIN tek başına kimliği belirler. 10^6'lık bir uzayı
 *    internete açmak, tüm operatör hesaplarını kaba kuvvete açmaktır.
 *  • `login-card` — `cardToken` da düz saklanır (fiziksel kart taşıyıcı sır).
 *  • `mobile-users` — kimliksiz kullanıcı listesi (giriş ekranı seçicisi).
 *  • `/api/devices` — `POST /announce` KİMLİKSİZ PENDING cihaz yaratır ve tavan
 *    200'dür; internete açık olsaydı tablet eşleştirmesi DoS'lanabilirdi.
 *  • `/api/discovery` — kurulum kimliğini sızdırır (sır değil ama gereksiz).
 *  • `/api/mobile` — LAN OTA ikizi; tabletler fabrika ağında, uzakta işi yok.
 *  • `/api-docs` — iç API şeması.
 *
 * ⚠️ 403 DEĞİL **404**: 403 "burada bir şey var ama giremezsin" der ve keşfe
 * davet eder. 404 uzaktan bakan için o uç hiç yokmuş gibidir.
 */
const REMOTE_DENIED_EXACT: ReadonlySet<string> = new Set([
  "/api/auth/login-card",
  "/api/auth/login-quick-pin",
  "/api/auth/mobile-users",
]);

const REMOTE_DENIED_PREFIX: readonly string[] = [
  "/api/devices",
  "/api/discovery",
  "/api/mobile",
  "/api-docs",
];

export function isRemoteDeniedPath(originalUrl: string): boolean {
  const path = normalizeRequestPath(originalUrl);
  if (REMOTE_DENIED_EXACT.has(path)) return true;
  return REMOTE_DENIED_PREFIX.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Uzak istekte kapalı yolları 404'e düşürür. LAN'da tam no-op. */
export const remoteDenylist: RequestHandler = (req, res, next) => {
  if (!req.isRemote || !isRemoteDeniedPath(req.originalUrl)) return next();
  res.status(404).json({ success: false, message: "Kaynak bulunamadı" });
};

// -----------------------------------------------------------------------------
// 3. katman — Cloudflare Access JWT
// -----------------------------------------------------------------------------

type Jwk = { kid?: string; kty?: string } & Record<string, unknown>;

/**
 * JWKS önbelleği.
 *
 * ⚠️ TTL'İN İŞİ TAZELİKTİR, GEÇERLİLİK DEĞİL (2026-08-26 `ReasonPreset` dersinin
 * birebir aynısı). Süre dolduğunda `null` dönüp fail-closed'a düşmek, CF'e giden
 * tek bir yavaş isteğin patronu kapıda bırakması demekti. Bunun yerine BAYAT
 * anahtarlar da döndürülür ve arka planda tazeleme TETİKLENİR.
 *
 * Bayatlık ≠ boşluk: önbellek HİÇ dolmadıysa fail-closed KALIR. Bu güvenli,
 * çünkü JWKS'e ulaşılamıyorsa internet de yoktur; internet yoksa tünel de
 * ayakta değildir, yani gerçek bir uzak istek zaten gelemez.
 */
const JWKS_TTL_MS = 15 * 60 * 1000;
let jwksKeys: Map<string, KeyObject> | null = null;
let jwksFetchedAt = 0;
let jwksInFlight: Promise<void> | null = null;

function jwksUrl(teamDomain: string): string {
  return `https://${teamDomain}/cdn-cgi/access/certs`;
}

async function fetchJwks(teamDomain: string): Promise<void> {
  const res = await fetch(jwksUrl(teamDomain), { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`JWKS HTTP ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const next = new Map<string, KeyObject>();
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid || jwk.kty !== "RSA") continue;
    try {
      // Node 22 JWK'yi doğrudan okur — jwks-rsa gibi bir paket GEREKMEZ.
      next.set(jwk.kid, createPublicKey({ key: jwk as never, format: "jwk" }));
    } catch {
      // Tek bozuk anahtar tüm seti düşürmesin.
    }
  }
  if (next.size === 0) throw new Error("JWKS boş");
  jwksKeys = next;
  jwksFetchedAt = Date.now();
}

/** Tek-uçuş tazeleme — YALNIZ arka plana ait; okuyucular beklemez. */
function refreshJwksInBackground(teamDomain: string): void {
  if (jwksInFlight) return;
  jwksInFlight = fetchJwks(teamDomain)
    .catch((err: unknown) => {
      uyari("remote-access", `JWKS tazelenemedi: ${err instanceof Error ? err.message : String(err)}`,
      );
    })
    .finally(() => {
      jwksInFlight = null;
    });
}

async function getSigningKey(teamDomain: string, kid: string): Promise<KeyObject | null> {
  // Hiç dolmadıysa BEKLE (fail-closed'ın tek meşru bekleme noktası).
  if (jwksKeys === null) {
    if (!jwksInFlight) refreshJwksInBackground(teamDomain);
    await jwksInFlight;
  }
  if (jwksKeys === null) return null;

  if (Date.now() - jwksFetchedAt > JWKS_TTL_MS) refreshJwksInBackground(teamDomain);

  const hit = jwksKeys.get(kid);
  if (hit) return hit;

  // Bilinmeyen kid = CF anahtar döndürmüş olabilir. Bir kez SENKRON tazele.
  refreshJwksInBackground(teamDomain);
  await jwksInFlight;
  return jwksKeys?.get(kid) ?? null;
}

/** Testler için: önbelleği tamamen boşalt (fail-closed durumuna döner). */
export function resetAccessJwksCacheForTest(): void {
  jwksKeys = null;
  jwksFetchedAt = 0;
  jwksInFlight = null;
}

/** Testler için: önbelleği BAYATLAT (dolu kalır — "bayat da dönmeli" sondası). */
export function expireAccessJwksCacheForTest(): void {
  jwksFetchedAt = 0;
}

const ACCESS_HEADER = "cf-access-jwt-assertion";

/**
 * Access reddi yükü — kod **`details.code`** ALTINDA.
 *
 * ⚠️ 2026-09-04'te ÖLÇÜLDÜ ve düzeltildi: kod yalnız GÖVDE KÖKÜNDE (`code`)
 * yazılıyordu, oysa istemcinin kod okuduğu TEK yer `body.details.code`
 * (`apiClient` — `AppError` sözleşmesi, `error.middleware` onu `details` altında
 * serileştirir). Yani panel bu 403'ü hiçbir zaman tanıyamıyor ve genel dala
 * düşüp **"Bu işlem için yetkiniz bulunmuyor"** basıyordu — kullanıcının
 * yetkisiyle ilgisi olmayan, süresi dolmuş bir Cloudflare Access oturumu için
 * TAMAMEN YANLIŞ bir teşhis (doğru eylem sayfayı yenilemek, yöneticiden yetki
 * istemek değil). Bu middleware `AppError` yolunu bilerek kullanmıyor (hata
 * zincirine çıkmadan, kimlik duvarı olarak burada bitiriyor) — o yüzden
 * sözleşmeyi ELLE kurmak zorunda.
 *
 * Kök `code` alanı GERİYE UYUM için KALIR: sahadaki eski panel sürümleri onu
 * okumuyor ama silmek, okuyan bir istemci varsa sessizce kırardı.
 */
function accessDenied(res: Parameters<RequestHandler>[1], code: string, message: string): void {
  res.status(403).json({ success: false, message, code, details: { code } });
}

/**
 * Uzak isteklerde Cloudflare Access JWT'sini doğrular. **Fail-closed.**
 *
 * Yalnız `/api/*` altında koşar: statik SPA dosyaları (JS/CSS) zaten kamuya
 * açıktır ve her birinde JWKS araması yapmak bedava değildir. Asıl kapı
 * Cloudflare'in kendisidir; bu, o kapının hâlâ orada olduğunun kanıtıdır.
 */
export function verifyAccessJwt(cfg: RemoteAccessConfig): RequestHandler {
  const { accessTeamDomain, accessAud, accessWallDisabled } = cfg;
  return (req, res, next) => {
    // Duvar bilerek kapatıldıysa doğrulama yapılmaz. Diğer uzak kuralları
    // (PIN/kart 404, TOTP zorunluluğu, HSTS) DEĞİŞMEZ — onlar Access'ten
    // bağımsızdır ve kapanmaz.
    if (accessWallDisabled) return next();
    if (!req.isRemote || !accessTeamDomain || !accessAud) return next();

    const raw = req.headers[ACCESS_HEADER];
    const token = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!token) {
      accessDenied(
        res,
        "ACCESS_ASSERTION_MISSING",
        "Uzaktan erişim oturumu doğrulanamadı. Sayfayı yenileyip Cloudflare girişini tekrarlayın.",
      );
      return;
    }

    void (async () => {
      try {
        const decoded = jwt.decode(token, { complete: true });
        const kid = decoded?.header?.kid;
        if (!kid) throw new Error("kid yok");

        const key = await getSigningKey(accessTeamDomain, kid);
        if (!key) throw new Error("imza anahtarı çözülemedi");

        const claims = jwt.verify(token, key, {
          algorithms: ["RS256"],
          audience: accessAud,
          issuer: `https://${accessTeamDomain}`,
        }) as { email?: string; sub?: string };

        req.accessIdentity = { email: claims.email ?? null, sub: claims.sub ?? null };
        next();
      } catch (err) {
        uyari("remote-access", `Access JWT reddedildi: ${err instanceof Error ? err.message : String(err)}`,
        );
        accessDenied(
          res,
          "ACCESS_ASSERTION_INVALID",
          "Uzaktan erişim oturumu doğrulanamadı. Sayfayı yenileyip Cloudflare girişini tekrarlayın.",
        );
      }
    })();
  };
}
