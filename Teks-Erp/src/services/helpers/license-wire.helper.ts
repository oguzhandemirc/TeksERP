// Lisans motorunun TEL katmanı: satıcıya imzalı istek, taşıma soyutlaması (test enjeksiyonu),
// hata sözlüğü (TR mesaj + `details.code`), önkoşullar ve ortam künyesi. Servisler bunu paylaşır.
import fs from "node:fs";
import os from "node:os";
import { AppError } from "../../utils/app-error";
import { APP_VERSION } from "../../lib/app-version";
import { EgressError, egressRequest } from "../../lib/http-egress";
import {
  REQUEST_HEADER,
  VendorErrorResponseSchema,
  VersionTextSchema,
  generateNonce,
  isInstallationIdOptional,
  isoToMs,
  signRequest,
  type FingerprintFactor,
  type PollRequest,
  type RequestPurpose,
  type VendorErrorCode,
} from "../../lib/license/protocol";
import { getLicenseCore } from "../../lib/license/native";
import { installHistoryPath, readInstallHistory } from "../../lib/license/install-history";
import { ensureInstallationX25519, getLicenseStore, type InstallationKey, type LicenseStoreSnapshot } from "../../lib/license/store";
import { requestClockSkewMs } from "../../lib/license/request-clock";
import {
  getLicenseConfig,
  getLicenseDbFacts,
  getLicenseSnapshot,
  getMeasuredFingerprint,
  recordVendorClockSkew,
  type LicenseSnapshot,
} from "../../lib/license/runtime";

const VENDOR_TIMEOUT_MS = 20_000;

// ── Satıcı taşıması (test enjeksiyonu için soyut) ───────────────────────────────
export interface VendorHttpRequest {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}
export interface VendorHttpResponse {
  readonly status: number;
  readonly body: string;
}
export type VendorTransport = (req: VendorHttpRequest) => Promise<VendorHttpResponse>;

export const egressTransport: VendorTransport = async (req) => {
  const res = await egressRequest(req.url, { method: req.method, headers: req.headers, body: req.body, timeoutMs: VENDOR_TIMEOUT_MS });
  return { status: res.status, body: res.body.toString("utf8") };
};

export type VendorResult =
  /** `nonce`: yanıtı alınan (son) imzalı isteğin nonce'u — canlı lisans yanıtının istek bağı buna eşleşmeli (6.3c). */
  | { readonly ok: true; readonly json: unknown; readonly nonce: string }
  | { readonly ok: false; readonly status: number; readonly code: string; readonly vendorTimeMs?: number };

// ── Hatalar (TR mesaj + `details.code`) ─────────────────────────────────────────
export function licenseError(status: number, code: string, message: string, extra: Record<string, unknown> = {}): AppError {
  return new AppError(message, status, true, { code, ...extra });
}

// Satıcının HER koduna TR mesaj: yeni kod `VENDOR_ERROR_CODES`e eklenince burası derlenmez (tanınmayan kod
// sessizce "reddetti"ye düşmesin). Protokol doğrulama kodları (`JWS_*`, `ISTEK_*`) genel mesaja düşer.
const VENDOR_MESSAGES = {
  GOVDE_GECERSIZ: "Lisans sunucusu isteğin gövdesini kabul etmedi (sürüm uyumsuzluğu olabilir).",
  PROTOKOL_SURUMU: "Lisans sunucusu bu protokol sürümünü desteklemiyor.",
  ISTEK_GECERSIZ: "Lisans sunucusu imzalı isteği doğrulayamadı (saat farkı ya da anahtar sorunu olabilir).",
  ISTEK_TEKRAR: "Aynı istek ikinci kez gönderildi; biraz sonra tekrar deneyin.",
  ETKINLESTIRME_KODU_GECERSIZ: "Etkinleştirme kodu geçersiz.",
  ETKINLESTIRME_KODU_KULLANILMIS: "Bu etkinleştirme kodu daha önce kullanılmış.",
  TASIMA_ONAYI_BEKLIYOR: "Taşıma onayı bekleniyor; onaylanınca lisans kendiliğinden gelir.",
  TASIMA_KODU_GEREKLI: "Bu kurulum başka bir makinede etkin; taşıma talebi açın ve onaylanınca verilen taşıma koduyla etkinleştirin.",
  KURULUM_BILINMIYOR: "Bu kurulum lisans sunucusunda kayıtlı değil (taşıma talebi gerekebilir).",
  KURULUM_IPTAL: "Bu kurulumun lisansı taşındı ya da iptal edildi.",
  KIRA_VERILMEDI: "Lisans sunucusu bu kuruluma kira vermedi; destek hattıyla görüşün.",
  DR_ANA_BELIRSIZ: "Lisans sunucusu ana sunucuyu kendiliğinden bulamadı (tesiste etkin üretim kurulumu yok ya da birden çok var); ana kurulum kimliğini portaldan ya da ana sunucunun Lisans ekranından alıp alana yazın.",
  KABUL_GEREKLI: "Lisans sunucusu sözleşme kabul kaydını tanımadı (kabul edilen metin sürümü satıcıda henüz yayımlanmamış olabilir); satıcıyla görüşün.",
  HIZ_SINIRI: "Çok sık denendi; biraz sonra tekrar deneyin.",
  TEKRAR_DENEYIN: "Lisans sunucusunda eşzamanlı bir işlem çakıştı; biraz sonra tekrar deneyin.",
  BULUNAMADI: "Lisans sunucusu bu isteği tanımadı (adres yanlış ya da sunucu sürümü eski olabilir; LICENSE_SERVER_URL ayarını kontrol edin).",
  ZAYIF_TANIMA_ONAY_BEKLIYOR: "Bu sunucunun donanımı yeterince tanınamadı; etkinleştirme satıcı onayı bekliyor. Onaylanınca aynı kodla yeniden deneyin.",
  SUNUCU_HATASI: "Lisans sunucusunda bir hata oluştu; biraz sonra tekrar deneyin.",
} as const satisfies Readonly<Record<VendorErrorCode, string>>;

/** Aynı istek sonradan tekrar denenebilir mi (panel "tekrar dene" gösterir; kalıcı red değil). */
const VENDOR_RETRYABLE: ReadonlySet<string> = new Set<VendorErrorCode>(["TEKRAR_DENEYIN", "HIZ_SINIRI", "ISTEK_TEKRAR", "SUNUCU_HATASI"]);

export function vendorFailureToError(r: { status: number; code: string }): AppError {
  if (r.status === 0) {
    return licenseError(502, "LICENSE_VENDOR_UNREACHABLE", "Lisans sunucusuna ulaşılamadı (internet ya da proxy ayarını kontrol edin).", {
      egressCode: r.code,
    });
  }
  const message = (VENDOR_MESSAGES as Readonly<Record<string, string>>)[r.code] ?? "Lisans sunucusu isteği reddetti.";
  return licenseError(409, "LICENSE_VENDOR_REJECTED", message, { vendorCode: r.code, tekrarDenenebilir: VENDOR_RETRYABLE.has(r.code) });
}

// ── Önkoşullar ──────────────────────────────────────────────────────────────────
export interface ReadyContext {
  readonly store: LicenseStoreSnapshot;
  readonly key: InstallationKey;
  /** Lisans kimliği (LICENSE_DIR); etkinleşmemişte null — DB `installationId`si DEĞİL (D14). */
  readonly licenseId: string | null;
}

export function requireStore(): LicenseStoreSnapshot & { key: InstallationKey } {
  const store = getLicenseStore();
  if (!store || store.problem || !store.key) {
    throw licenseError(409, "LICENSE_STORE_UNAVAILABLE", `Lisans deposu kullanılamıyor (${store?.problem ?? "yüklenmedi"}).`);
  }
  return { ...store, key: store.key };
}

/** Depo + anahtar + DB olguları hazır; lisans kimliği henüz yoksa (etkinleşmemiş) `licenseId` null. */
export function requireReady(): ReadyContext {
  const store = requireStore();
  const snap = getLicenseSnapshot();
  if (!snap.imzaHazir) throw licenseError(409, "LICENSE_IDENTITY_NOT_READY", "Kurulum kimliği henüz hazır değil; biraz sonra tekrar deneyin.");
  return { store, key: store.key, licenseId: snap.licenseId };
}

/** Lisans kimliği gerektiren işlem (yoklama, DR, çevrimdışı yoklama) etkinleşmemiş kurulumda 409. */
export function requireLicenseId(ctx: ReadyContext): string {
  if (!ctx.licenseId) throw licenseError(409, "LICENSE_NOT_ACTIVE", "Kurulum etkinleşmemiş; önce etkinleştirme kodunu girin.");
  return ctx.licenseId;
}

export function requireVendorUrl(): string {
  const url = getLicenseConfig().vendorUrl;
  if (!url) throw licenseError(409, "LICENSE_NOT_CONFIGURED", "Lisans sunucusu adresi tanımlı değil (LICENSE_SERVER_URL).");
  return url;
}

// ── Satıcıya imzalı istek ───────────────────────────────────────────────────────
/**
 * İstekte taşınacak kimlik: etkinleştirme HİÇ taşımaz (kurulumu kod belirler), taşıma bilinirse taşır,
 * diğer her amaç lisans kimliği ister (D14; protokol §3 İSTEK).
 */
export function requestIdentityFor(ctx: ReadyContext, purpose: RequestPurpose): string | null {
  if (purpose === "etkinlestir") return null;
  if (isInstallationIdOptional(purpose)) return ctx.licenseId;
  return requireLicenseId(ctx);
}

/**
 * `path`: isteğin gittiği uç (`ENDPOINTS` / `SYNC_PATHS` sabiti, alan karşı tarafın doğruladığıyla AYNI) imzaya girer —
 * imzalı istek başka uca yeniden oynatılamaz (`ISTEK_YOL`); `yol` tanımayan eski doğrulayıcı alanı yok sayar.
 */
export function signedHeaders(
  ctx: ReadyContext,
  purpose: RequestPurpose,
  bodyText: string,
  to: { readonly path: string; readonly nowMs?: number; readonly nonce?: string },
): Record<string, string> {
  const key = { privateKey: ctx.key.privateKey, nowMs: to.nowMs ?? Date.now(), ...(to.nonce === undefined ? {} : { nonce: to.nonce }) };
  const token = signRequest({ installationId: requestIdentityFor(ctx, purpose), purpose, body: bodyText, key, path: to.path });
  return { "content-type": "application/json", accept: "application/json", [REQUEST_HEADER]: token };
}

/**
 * Lisans yanıtının geliş yolu: canlı alışveriş yanıtın cevapladığı isteğin nonce'unu taşır (istek bağı, 6.3c) — nonce'suz
 * canlı kabul derlenmez; taşınmış yanıt (dosya · QR · zarf) bağ denetlenmeden gelir.
 */
export type ResponseArrival = { readonly arrival: "CANLI"; readonly nonce: string } | "TASINMIS";

export function liveArrival(result: { readonly nonce: string }): ResponseArrival {
  return { arrival: "CANLI", nonce: result.nonce };
}

/** Satıcının hata gövdesinden kod + (ISTEK_ZAMAN'da) İMZASIZ satıcı saati. */
export function readVendorError(status: number, bodyText: string): { code: string; vendorTimeMs?: number } {
  let json: unknown = null;
  try {
    json = JSON.parse(bodyText) as unknown;
  } catch {
    json = null;
  }
  const err = VendorErrorResponseSchema.safeParse(json);
  if (!err.success) return { code: `HTTP_${status}` };
  const t = err.data.details.sunucuSaati;
  return t === undefined ? { code: err.data.details.code } : { code: err.data.details.code, vendorTimeMs: isoToMs(t) };
}

/**
 * Satıcı saati kayıkken (`ISTEK_ZAMAN` + `sunucuSaati`) sapma öğrenilir ve istek BİR KEZ düzeltilmiş
 * zamanla, yeni nonce'la yeniden imzalanır; ikinci `ISTEK_ZAMAN`da durulur. Sapma imzasızdır: yalnız
 * imza damgasına ve `SAAT_KAYIK` bilgisine girer, güvenilir saate/kademeye GİRMEZ (D4).
 */
export function learnVendorClock(code: string, vendorTimeMs: number | undefined, receivedAtMs: number = Date.now()): number | null {
  const skewMs = requestClockSkewMs(code, vendorTimeMs, receivedAtMs);
  if (skewMs === null) return null;
  recordVendorClockSkew(skewMs);
  return skewMs;
}

/** Gövde istek başına kurulur: düzeltilmiş denemede taze ölçüm (ör. `saticiSapmaSn`) gövdeye girer. */
export type VendorBody = unknown | (() => unknown | Promise<unknown>);

export async function vendorPost(path: string, purpose: RequestPurpose, body: VendorBody, transport: VendorTransport): Promise<VendorResult> {
  const ctx = requireReady();
  const base = requireVendorUrl();
  const send = async (nowMs: number): Promise<VendorResult> => {
    const text = JSON.stringify(typeof body === "function" ? await (body as () => unknown)() : body);
    const nonce = generateNonce();
    let res: VendorHttpResponse;
    try {
      res = await transport({ url: `${base}${path}`, method: "POST", headers: signedHeaders(ctx, purpose, text, { path, nowMs, nonce }), body: text });
    } catch (err) {
      return { ok: false, status: 0, code: err instanceof EgressError ? err.code : "EGRESS_NETWORK" };
    }
    if (res.status >= 200 && res.status < 300) {
      let json: unknown = null;
      try {
        json = JSON.parse(res.body) as unknown;
      } catch {
        json = null;
      }
      return { ok: true, json, nonce };
    }
    const e = readVendorError(res.status, res.body);
    return { ok: false, status: res.status, code: e.code, vendorTimeMs: e.vendorTimeMs };
  };
  const first = await send(Date.now());
  if (first.ok) {
    // Düzeltmesiz damga kabul edildi: saat satıcıyla ±10 dk içinde, önceki kayma bilgisi düşer.
    recordVendorClockSkew(null);
    return first;
  }
  const skewMs = learnVendorClock(first.code, first.vendorTimeMs);
  if (skewMs === null) return first;
  return send(Date.now() - skewMs);
}

// ── Ortam ve gövdeler ───────────────────────────────────────────────────────────
export function appVersionForWire(): string {
  return VersionTextSchema.safeParse(APP_VERSION).success ? APP_VERSION : "0.0.0";
}

const OS_TEXT_MAX = 120;

/**
 * İşletim sistemi künyesi: yalnız tür + sürüm. Makine adı ASLA girmez — bazı çekirdek sürüm
 * dizgeleri derleyen makinenin adını taşıyabilir, o yüzden ad (büyük/küçük harf duyarsız) silinir.
 */
export function describeOperatingSystem(info: { readonly type: string; readonly release: string; readonly hostname: string } = {
  type: os.type(),
  release: os.release(),
  hostname: os.hostname(),
}): string {
  let text = `${info.type} ${info.release}`;
  const host = info.hostname.trim();
  if (host.length >= 2) {
    const lower = host.toLowerCase();
    let at = text.toLowerCase().indexOf(lower);
    while (at >= 0) {
      text = `${text.slice(0, at)}${text.slice(at + host.length)}`;
      at = text.toLowerCase().indexOf(lower);
    }
  }
  return text.replace(/\s+/g, " ").trim().slice(0, OS_TEXT_MAX);
}

export function buildEnvironment(): {
  platform: "win32" | "linux" | "darwin";
  mimari: "x64" | "arm64";
  isletimSistemi: string;
  nodeSurum: string;
  uygulamaSurum: string;
  derlemeTarihi: string | null;
  konteyner: boolean;
  installationId?: string;
} {
  const platform = process.platform === "win32" || process.platform === "darwin" ? process.platform : "linux";
  // DB kimliği YALNIZ bilgidir (döküm/DR kopyası taşır); satıcıda kimlik değil ipucu.
  const dbId = getLicenseDbFacts().installationId;
  return {
    platform,
    mimari: process.arch === "arm64" ? "arm64" : "x64",
    isletimSistemi: describeOperatingSystem(),
    nodeSurum: /^v\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(process.version) ? process.version : "v0.0.0",
    uygulamaSurum: appVersionForWire(),
    // İmzalı derleme künyesi Faz 2'de; imzasız tarih bakım kararına girmez.
    derlemeTarihi: null,
    konteyner: fs.existsSync("/.dockerenv") || fs.existsSync("/run/.containerenv"),
    ...(dbId ? { installationId: dbId } : {}),
  };
}

export function currentFingerprintDigest(): { f1: string | null; f2: string | null; f3: string | null; f4: string | null; f5: string | null } {
  return getMeasuredFingerprint()?.digest ?? { f1: null, f2: null, f3: null, f4: null, f5: null };
}

/**
 * Kayıp etkenler (K8): kiranın kabul ettiği kümede değeri olup ölçümde — ≤ 24 sa önbellek dahil — olmayanlar; DR
 * sınıfında f5 hariç. Karar lisans çekirdeğinden (kural `standart`); kira ya da ölçüm yoksa boş.
 */
export function currentLostFactors(): FingerprintFactor[] {
  const snap = getLicenseSnapshot();
  const fp = getMeasuredFingerprint();
  const accepted = snap.lease?.document.parmakIzi;
  if (!accepted || !fp) return [];
  const excludeF5 = snap.entitlement?.document.sinif === "DR";
  return [...getLicenseCore().compareFingerprints(accepted, fp.digest, { rule: "standart", excludeF5 }).lost];
}


export function invalidResponse(message: string, protocolCode?: string): AppError {
  return licenseError(400, "LICENSE_RESPONSE_INVALID", message, protocolCode ? { protocolCode } : {});
}

/** Kurulumun X25519 açık yarısı (Faz 2d) — eski kurulumda burada doğar; üretilemezse alan gönderilmez. */
export function encryptionKeyField(): { sifrelemeAnahtari?: string } {
  const pair = ensureInstallationX25519();
  return pair ? { sifrelemeAnahtari: pair.publicX } : {};
}

/** Kurulum kaydı alanı (3d-2) — kayıt yoksa alan hiç gitmez (eski satıcı KATI şemayla reddeder). */
export function installRecordsField(): { kurulumKayitlari?: ReturnType<typeof readInstallHistory> } {
  const dir = getLicenseStore()?.dir;
  if (!dir) return {};
  const records = readInstallHistory(installHistoryPath(dir));
  return records.length > 0 ? { kurulumKayitlari: records } : {};
}

/**
 * Lisans v2 G12 raporu (satıcı bununla yerel müdahale şüphesini görür; KARAR değil, yalnız uyarı): durum kaydı sırası,
 * belirsizlik birikimi ve kayıp parmak izi etkenleri. Birikim ve kayıp yalnız doluysa gider. KATI gövde ⇒ satıcı önce.
 */
export function pollV2Fields(snap: LicenseSnapshot): Pick<PollRequest, "durumKaydi" | "belirsizlik" | "parmakIziKayip"> {
  const birikenMs = Math.round(snap.state.belirsizlik.birikenMs);
  const kayip = currentLostFactors();
  return {
    durumKaydi: { sira: snap.view.record?.sira ?? null, gecerli: snap.view.fileValid },
    ...(birikenMs > 0 ? { belirsizlik: { birikenMs, ilk: snap.view.record?.belirsizlik?.ilk ?? null } } : {}),
    ...(kayip.length > 0 ? { parmakIziKayip: kayip } : {}),
  };
}
