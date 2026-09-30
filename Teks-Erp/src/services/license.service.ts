// Fabrika lisans motoru — API yüzeyi (`/api/license/*`) + başlatma. Motor GÖZLEM kipinde doğar:
// hiçbir istek engellenmez, bant yok (plan §4). Satıcı adresi kapalıysa (`resolveVendorUrl`) ya da kurulum
// etkinleşmemişse dışarı HİÇ istek atılmaz. Kapı (kısıtlı kip) ve modül tavanı AYRI dilim.
import { AppError } from "../utils/app-error";
import { listBackups } from "./backup.service";
import { bilgi, uyari } from "../lib/logger";
import { maskProxyUrl, nodeSupportsProxyEnv, setEgressProxy } from "../lib/http-egress";
import {
  ActivateRequestSchema,
  ActivationCodeSchema,
  DrTakeoverRequestSchema,
  ENDPOINTS,
  msToIso,
  normalizeActivationCode,
  signRequest,
  wrapEnvelope,
} from "../lib/license/protocol";
import { loadLicenseStoreSync, saveProxy } from "../lib/license/store";
import { getLicenseConfig, getLicenseSnapshot, getMeasuredFingerprint, invalidateLicenseSnapshot } from "../lib/license/runtime";
import { adminAction } from "./license-trail.service";
import { activationAcceptance } from "./license-acceptance.service";
import { DATA_EXPORT_PATHS } from "../constants/license-routes";
import { acceptLicenseResponse, buildPollBody, pollLicenseOnce, refreshLicenseFingerprint, runLeaseExchange, sendTransfer, type PollOutcome } from "./license-sync.service";
import { getLicenseDetail, getProxySettings, type LicenseDetail, type LicenseProxySettings } from "./license-view.service";
import {
  buildEnvironment,
  currentFingerprintDigest,
  egressTransport,
  encryptionKeyField,
  licenseError,
  requestIdentityFor,
  requireLicenseId,
  requireReady,
  requireStore,
  requireVendorUrl,
  vendorFailureToError,
  vendorPost,
  type ReadyContext,
  type VendorTransport,
} from "./helpers/license-wire.helper";

export { getLicenseStatus, getLicenseDetail, getProxySettings, getDownloadToken } from "./license-view.service";
export type {
  LicenseStatusSummary,
  LicenseStatusResponse,
  LicenseDetail,
  LicenseDownloadToken,
  LicenseProxySettings,
} from "./license-view.service";

const OFFLINE_ENVELOPE_TTL_MS = 10 * 60 * 1000;

/** `GET /cevrimdisi-istek` ve `GET /aktarma-istegi` yanıtı. */
export interface LicenseOfflineRequest {
  readonly amac: OfflinePurpose;
  /** base64url(JSON {v, istek, govde}) — QR ya da panel bunu taşır. */
  readonly zarf: string;
  /** İmzalı istek bu andan sonra satıcıda RED (±10 dk). */
  readonly gecerlilikSonu: string;
  readonly hedefYol: string;
  readonly hedefUrl: string | null;
  /** Panel `POST hedefUrl` gövdesi olarak AYNEN iletir. */
  readonly istekGovdesi: { readonly v: 1; readonly zarf: string };
  readonly qrAdresi: string | null;
}

export interface LicenseTransferResult {
  readonly talepId: string;
  readonly durum: "BEKLIYOR" | "ONAYLANDI" | "REDDEDILDI";
  readonly lisans: LicenseDetail;
}

export interface LicenseDataExportManifest {
  readonly kademe: string;
  readonly yedekler: ReadonlyArray<{ ad: string; boyutBayt: number; zaman: string; sifreli: boolean; indirmeYolu: string }>;
  readonly yollar: Readonly<Record<"yedekAl" | "yedekListesi" | "yedekIndir" | "varliklar" | "disariAktar", string>>;
}

// ── Başlatma (sunucu dinlemeden ÖNCE, senkron) ──────────────────────────────────
/** Depoyu yükler, proxy'yi uygular. Hata sunucuyu düşürmez: depo sorunu durum ekranında görünür. */
export function initLicenseEngine(): void {
  const store = loadLicenseStoreSync();
  setEgressProxy(store.proxy);
  if (store.problem) {
    uyari("lisans", `lisans deposu kullanılamıyor (${store.problem}): ${store.dir} — motor gözlemde ölçülemedi durumunda kalır`);
  } else if (store.setAsideKeyFile) {
    uyari("lisans", "bozuk kurulum anahtarı kenara alındı ve yenisi üretildi — lisans için taşıma talebi gerekir");
  }
  invalidateLicenseSnapshot();
}

// ── API: etkinleştirme ──────────────────────────────────────────────────────────
/**
 * Etkinleştirme kimlik TAŞIMAZ: kurulumu satıcıda kod belirler, lisans kimliği yanıtla gelir (D14). Gövde bu
 * anahtarın geçerli sözleşme kabul belgesini taşır (Ek-7; satıcı kabulsüz etkinleştirmeyi reddeder).
 */
function buildActivateBody(ctx: ReadyContext, code: string, acceptanceDoc: string): ReturnType<typeof ActivateRequestSchema.parse> {
  return ActivateRequestSchema.parse({
    v: 1,
    kod: code,
    acikAnahtar: ctx.key.x,
    ...encryptionKeyField(),
    parmakIzi: currentFingerprintDigest(),
    ortam: buildEnvironment(),
    kabul: acceptanceDoc,
  });
}

function normalizeCodeOrThrow(raw: string): string {
  const code = normalizeActivationCode(raw);
  if (!ActivationCodeSchema.safeParse(code).success) {
    throw licenseError(400, "LICENSE_CODE_INVALID", "Etkinleştirme kodu biçimi geçersiz (TKS-XXXX-XXXX-XXXX-XXXX).");
  }
  return code;
}

export async function activateLicense(rawCode: string, userId: string | null, transport: VendorTransport = egressTransport): Promise<LicenseDetail> {
  const ctx = requireReady();
  requireVendorUrl();
  const code = normalizeCodeOrThrow(rawCode);
  if (!getMeasuredFingerprint()) await refreshLicenseFingerprint();
  await runLeaseExchange(async () => {
    if (getLicenseSnapshot().lease) {
      throw licenseError(409, "LICENSE_ALREADY_ACTIVE", "Bu kurulumun geçerli bir lisansı var; yeniden etkinleştirme gerekmez.");
    }
    const acceptance = await activationAcceptance(ctx.key.kid);
    const r = await vendorPost(ENDPOINTS.ACTIVATE, "etkinlestir", buildActivateBody(ctx, code, acceptance.belge), transport);
    adminAction(userId, "etkinlestir", { sonuc: r.ok ? "yanit" : r.code, kabulId: acceptance.kabulId });
    if (!r.ok) throw vendorFailureToError(r);
    await acceptLicenseResponse(r.json, "etkinlestirme", userId);
  });
  return getLicenseDetail();
}

/** Yöneticinin "şimdi yokla" düğmesi — işin aynı yolu. */
export async function pollLicenseNow(transport: VendorTransport = egressTransport): Promise<{ outcome: PollOutcome; code?: string }> {
  requireReady();
  return pollLicenseOnce(transport);
}

// ── API: çevrimdışı (QR) / panel aktarma ────────────────────────────────────────
export type OfflinePurpose = "yokla" | "etkinlestir";

export async function buildOfflineRequest(g: { amac: OfflinePurpose; kod?: string | null }): Promise<LicenseOfflineRequest> {
  const ctx = requireReady();
  const nowMs = Date.now();
  let body: unknown;
  if (g.amac === "etkinlestir") {
    if (!g.kod) throw licenseError(400, "LICENSE_CODE_INVALID", "Çevrimdışı etkinleştirme için kod gerekli.");
    const code = normalizeCodeOrThrow(g.kod);
    // QR ve panel aktarması da kabulü zarfın içinde taşır: kabulsüz zarf üretilmez.
    const acceptance = await activationAcceptance(ctx.key.kid);
    if (!getMeasuredFingerprint()) await refreshLicenseFingerprint();
    body = buildActivateBody(ctx, code, acceptance.belge);
  } else {
    if (!getLicenseSnapshot().activated || !ctx.licenseId) {
      throw licenseError(409, "LICENSE_NOT_ACTIVE", "Kurulum etkinleşmemiş; önce etkinleştirme isteği oluşturun.");
    }
    body = await buildPollBody(nowMs);
  }
  const text = JSON.stringify(body);
  const token = signRequest({ installationId: requestIdentityFor(ctx, g.amac), purpose: g.amac, body: text, key: { privateKey: ctx.key.privateKey, nowMs } });
  const zarf = wrapEnvelope(token, text);
  const vendorUrl = getLicenseConfig().vendorUrl;
  return {
    amac: g.amac,
    zarf,
    gecerlilikSonu: msToIso(nowMs + OFFLINE_ENVELOPE_TTL_MS),
    hedefYol: ENDPOINTS.OFFLINE,
    hedefUrl: vendorUrl ? `${vendorUrl}${ENDPOINTS.OFFLINE}` : null,
    istekGovdesi: { v: 1, zarf },
    // QR sayfası: parça (#) sunucu loglarına girmez.
    qrAdresi: vendorUrl ? `${vendorUrl}/q#${zarf}` : null,
  };
}

/** QR'dan dönen yanıt base64url(JSON) metni ya da doğrudan JSON nesnesi olabilir. */
function decodeOfflinePayload(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const text = raw.trim();
  try {
    if (text.startsWith("{")) return JSON.parse(text) as unknown;
    return JSON.parse(Buffer.from(text, "base64url").toString("utf8")) as unknown;
  } catch {
    throw licenseError(400, "LICENSE_RESPONSE_INVALID", "Yanıt metni çözülemedi.");
  }
}

export async function acceptOfflineResponse(raw: unknown, source: "cevrimdisi" | "aktarma", userId: string | null): Promise<LicenseDetail> {
  try {
    const r = await runLeaseExchange(() => acceptLicenseResponse(decodeOfflinePayload(raw), source, userId));
    adminAction(userId, source === "aktarma" ? "aktarma-yaniti" : "cevrimdisi-yanit", { sonuc: r.yeniKira ? "kabul" : "ayni-kira" });
  } catch (err) {
    adminAction(userId, source === "aktarma" ? "aktarma-yaniti" : "cevrimdisi-yanit", {
      sonuc: err instanceof AppError ? String(err.details?.code ?? "RED") : "RED",
    });
    throw err;
  }
  return getLicenseDetail();
}

// ── API: taşıma + DR ────────────────────────────────────────────────────────────
export async function requestTransfer(gerekce: string | null, userId: string | null, transport: VendorTransport = egressTransport): Promise<LicenseTransferResult> {
  if (!getMeasuredFingerprint()) await refreshLicenseFingerprint();
  const r = await runLeaseExchange(() => sendTransfer(gerekce, transport));
  adminAction(userId, "tasima-talebi", { talepId: r.talepId, sonuc: r.durum });
  return { talepId: r.talepId, durum: r.durum, lisans: getLicenseDetail() };
}

export async function drTakeover(anaKurulumId: string | undefined, gerekce: string, userId: string | null, transport: VendorTransport = egressTransport): Promise<LicenseDetail> {
  // DR sunucusu kendi (DR sınıfı) lisans kimliğiyle imzalar: önce kendi kodu ile etkinleşmiş olmalı.
  requireLicenseId(requireReady());
  requireVendorUrl();
  const body = DrTakeoverRequestSchema.parse({ v: 1, ...(anaKurulumId ? { anaKurulumId } : {}), gerekce });
  await runLeaseExchange(async () => {
    const r = await vendorPost(ENDPOINTS.DR_TAKEOVER, "dr-devral", body, transport);
    adminAction(userId, "dr-devral", { anaKurulumId: anaKurulumId ?? null, sonuc: r.ok ? "yanit" : r.code });
    if (!r.ok) throw vendorFailureToError(r);
    await acceptLicenseResponse(r.json, "dr-devral", userId);
  });
  return getLicenseDetail();
}

// ── API: veri dışarı (K5 "verilerimi al" — yedek + dışa aktarma yolları) ─────────
export async function getDataExportManifest(userId: string | null): Promise<LicenseDataExportManifest> {
  const snap = getLicenseSnapshot();
  const listing = await listBackups();
  adminAction(userId, "veri-disari");
  return {
    kademe: snap.state.uygulananKademe,
    yedekler: listing.files.slice(0, 10).map((f) => ({
      ad: f.name,
      boyutBayt: f.sizeBytes,
      zaman: f.time,
      sifreli: f.encrypted,
      indirmeYolu: `/api/admin/backups/${encodeURIComponent(f.name)}/download`,
    })),
    // Kapının DURDURULMUŞ listesi aynı sabitten doğar: bildirilen yol kapıda kapalı olamaz.
    yollar: DATA_EXPORT_PATHS,
  };
}

// ── API: proxy ──────────────────────────────────────────────────────────────────
const PROXY_BYPASS_PATTERN = /^[A-Za-z0-9.*,:\-_[\]\s]*$/;

export function updateProxySettings(input: { adres: string | null; atla: string | null }, userId: string | null): LicenseProxySettings {
  requireStore();
  const adres = input.adres?.trim() || null;
  const atla = input.atla?.trim() || null;
  if (adres) {
    let u: URL;
    try {
      u = new URL(adres);
    } catch {
      throw licenseError(400, "LICENSE_PROXY_INVALID", "Proxy adresi geçersiz (örnek: http://proxy.firma.local:8080).");
    }
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname || (u.pathname !== "/" && u.pathname !== "")) {
      throw licenseError(400, "LICENSE_PROXY_INVALID", "Proxy adresi http(s)://sunucu:port biçiminde olmalı.");
    }
    if (!nodeSupportsProxyEnv()) {
      throw licenseError(409, "LICENSE_PROXY_UNSUPPORTED", `Bu sunucunun Node sürümü (${process.version}) proxy desteklemiyor; Node 22.21+ / 24.5+ gerekir.`);
    }
  }
  if (atla && !PROXY_BYPASS_PATTERN.test(atla)) {
    throw licenseError(400, "LICENSE_PROXY_INVALID", "Atlanacak adres listesi yalnız ana makine adları ve virgül içerebilir.");
  }
  const saved = saveProxy({ adres, atla });
  setEgressProxy(saved);
  // Kimlik bilgisi (kullanıcı:parola) audit'e GİRMEZ — yalnız maskeli ana makine.
  adminAction(userId, "proxy", { adres: maskProxyUrl(adres), atla });
  bilgi("lisans", `proxy ayarı ${adres ? `güncellendi (${maskProxyUrl(adres)})` : "kaldırıldı"}`);
  return getProxySettings();
}

