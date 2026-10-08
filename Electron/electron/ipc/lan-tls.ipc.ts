// Fabrika ağında TLS — panelin şifreli bağlantıya geçiş IPC'si (docs/design/LAN-TLS.md §4, §6).
// Sabitleme ana sürecin KENDİ el sıkışmasıyla yapılır; renderer'ın gönderdiği parmak izi gözlenene eşit olmalı.
import { session } from "electron";
import log from "electron-log";
import { DISCOVERY_DEFAULT_PORT, PINNED_IDENTITY_KEY, baseUrlOf } from "../../shared/discovery.js";
import { LAN_TLS_DEFAULT_PORT, checkPinRequest, httpsBaseUrlOf, isLoopbackHost, serverUrlParts, type TlsPinVia } from "../../shared/lan-tls.js";
import { isInternetHost } from "../../shared/internet-tls.js";
import type { TlsObservation, TlsPinResult } from "../../shared/ipc-contract.js";
import { handleTrusted } from "../security/trusted-ipc.js";
import { addTlsPin, installLanTlsVerifier, readTlsPins, removeTlsPins } from "../security/lan-tls-pin.js";
import { probeIdentity } from "../discovery/probe.js";
import { writeSecureValue } from "./secure-store.ipc.js";

function splitUrl(url: string): { scheme: "http" | "https"; host: string; port: number } | null {
  return serverUrlParts(url, DISCOVERY_DEFAULT_PORT);
}

type PinHooks = { onPinned: (installationId: string) => void; onUnpinned: () => void };

/**
 * Şifreli kanalın portu: https adresinde yazılan port; http adresinde sunucunun ilanı, ilan yoksa (ağda http
 * kapalı — `required`) varsayılan TLS portu. Döngü dışında http'ye istek atılmaz: yalnız kimlik yoklaması.
 */
async function tlsTarget(parts: { scheme: "http" | "https"; host: string; port: number }) {
  const plain = parts.scheme === "http" ? await probeIdentity(baseUrlOf(parts.host, parts.port), 5000) : null;
  const tlsPort = parts.scheme === "https" ? parts.port : (plain?.tls?.port ?? (isLoopbackHost(parts.host) ? null : LAN_TLS_DEFAULT_PORT));
  return { plain, tlsPort };
}

/** Sunucunun HTTPS'te sunduğu sertifikayı GÖZLEMLER (güven kararı vermez). */
export async function observeTls(baseUrl: string): Promise<TlsObservation | null> {
  const parts = typeof baseUrl === "string" ? splitUrl(baseUrl) : null;
  if (!parts) return null;
  const { plain, tlsPort } = await tlsTarget(parts);
  if (!tlsPort) return { host: parts.host, advert: null, observedFingerprint: null, identity: plain?.identity ?? null };
  const viaTls = await probeIdentity(httpsBaseUrlOf(parts.host, tlsPort), 5000, { requireIdentity: true });
  return {
    host: parts.host,
    advert: plain?.tls ?? (viaTls?.tls ?? null),
    observedFingerprint: viaTls?.observedFingerprint ?? null,
    identity: viaTls?.identity ?? plain?.identity ?? null,
  };
}

/** Sabitleme: ana süreç el sıkışmayı KENDİ yeniden yapar; istenen parmak izi gözlenene eşit olmalı. */
export async function pinViaHandshake(
  req: { baseUrl: string; fingerprint: string; via: TlsPinVia },
  hooks: Pick<PinHooks, "onPinned">,
): Promise<TlsPinResult> {
  const parts = req && typeof req.baseUrl === "string" ? splitUrl(req.baseUrl) : null;
  if (!parts) return { ok: false, reason: "Adres geçersiz" };
  const { plain, tlsPort } = await tlsTarget(parts);
  if (!tlsPort) return { ok: false, reason: "Sunucu şifreli bağlantı sunmuyor" };
  const viaTls = await probeIdentity(httpsBaseUrlOf(parts.host, tlsPort), 5000, { requireIdentity: true });
  const check = checkPinRequest({
    host: parts.host,
    requested: req.fingerprint,
    observed: viaTls?.observedFingerprint ?? null,
    advertised: (plain?.tls ?? viaTls?.tls)?.fingerprint ?? null,
    internet: isInternetHost(parts.host),
    via: req.via,
  });
  if (!check.ok) return { ok: false, reason: check.reason };
  const installationId = viaTls?.identity?.installationId ?? null;
  addTlsPin({ installationId, fingerprint: viaTls!.observedFingerprint!, port: tlsPort, via: req.via, pinnedAt: new Date().toISOString() });
  if (installationId) {
    writeSecureValue(PINNED_IDENTITY_KEY, JSON.stringify({ installationId, pinnedAt: new Date().toISOString() }));
    hooks.onPinned(installationId);
  }
  // Önceki (sabitsiz) doğrulama sonuçları önbellekte kalmasın.
  installLanTlsVerifier(session.defaultSession);
  await session.defaultSession.closeAllConnections();
  log.info(`[lan-tls] sertifika sabitlendi (${req.via}): ${parts.host}:${tlsPort}`);
  return { ok: true, baseUrl: httpsBaseUrlOf(parts.host, tlsPort) };
}

/**
 * Sunucu makinesinin kendisi (döngü adresi): kimseye sormadan tanır — ilan ile el sıkışma aynıysa sabitler.
 * Döngü dışı adreste HİÇBİR ZAMAN çağrılmaz; `checkPinRequest` de ayrıca reddeder.
 */
export async function autoPinLoopback(baseUrl: string, hooks: Pick<PinHooks, "onPinned">): Promise<TlsPinResult | null> {
  const parts = splitUrl(baseUrl);
  if (!parts || !isLoopbackHost(parts.host)) return null;
  const obs = await observeTls(baseUrl);
  if (!obs?.observedFingerprint || !obs.advert || obs.advert.fingerprint !== obs.observedFingerprint) return null;
  return pinViaHandshake({ baseUrl, fingerprint: obs.observedFingerprint, via: "loopback" }, hooks);
}

export function registerLanTlsIpc(hooks: PinHooks): void {
  handleTrusted("discovery:tlsObserve", (_e, baseUrl: string) => observeTls(baseUrl));
  handleTrusted("discovery:tlsPin", (_e, req: { baseUrl: string; fingerprint: string; via: TlsPinVia }) => pinViaHandshake(req, hooks));

  // Kullanıcının açık kararı: bu kurulumun şifreli bağlantı sabitini kaldır (yeniden bağlanmak kod karşılaştırma ister).
  handleTrusted("discovery:tlsUnpin", (_e, installationId: string | null) => {
    removeTlsPins(typeof installationId === "string" && installationId ? installationId : null);
    hooks.onUnpinned();
  });

  handleTrusted("discovery:tlsPins", () => readTlsPins());
}
