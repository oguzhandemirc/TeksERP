// Fabrika ağında TLS — panelin şifreli bağlantıya geçiş IPC'si (docs/design/LAN-TLS.md §4, §6).
// Sabitleme ana sürecin KENDİ el sıkışmasıyla yapılır; renderer'ın gönderdiği parmak izi gözlenene eşit olmalı.
import { session } from "electron";
import log from "electron-log";
import { DISCOVERY_DEFAULT_PORT, PINNED_IDENTITY_KEY, baseUrlOf } from "../../shared/discovery.js";
import { checkPinRequest, httpsBaseUrlOf, type TlsPinVia } from "../../shared/lan-tls.js";
import { handleTrusted } from "../security/trusted-ipc.js";
import { addTlsPin, installLanTlsVerifier, readTlsPins, removeTlsPins } from "../security/lan-tls-pin.js";
import { probeIdentity } from "../discovery/probe.js";
import { writeSecureValue } from "./secure-store.ipc.js";

function splitUrl(url: string): { scheme: "http" | "https"; host: string; port: number } | null {
  const m = /^(https?):\/\/([^:/\s]+)(?::(\d+))?/i.exec((url ?? "").trim());
  if (!m || !m[1] || !m[2]) return null;
  return { scheme: m[1].toLowerCase() === "https" ? "https" : "http", host: m[2], port: m[3] ? Number(m[3]) : DISCOVERY_DEFAULT_PORT };
}

export function registerLanTlsIpc(hooks: { onPinned: (installationId: string) => void; onUnpinned: () => void }): void {
  // Şifreli bağlantıya geçiş: sunucunun HTTPS'te sunduğu sertifikayı GÖZLEMLER (güven kararı vermez).
  handleTrusted("discovery:tlsObserve", async (_e, baseUrl: string) => {
    const parts = typeof baseUrl === "string" ? splitUrl(baseUrl) : null;
    if (!parts) return null;
    const plain = parts.scheme === "http" ? await probeIdentity(baseUrlOf(parts.host, parts.port), 5000) : null;
    const tlsPort = parts.scheme === "https" ? parts.port : plain?.tls?.port;
    if (!tlsPort) return { host: parts.host, advert: null, observedFingerprint: null, identity: plain?.identity ?? null };
    const viaTls = await probeIdentity(httpsBaseUrlOf(parts.host, tlsPort), 5000, { requireIdentity: true });
    return {
      host: parts.host,
      advert: plain?.tls ?? (viaTls?.tls ?? null),
      observedFingerprint: viaTls?.observedFingerprint ?? null,
      identity: viaTls?.identity ?? plain?.identity ?? null,
    };
  });

  // Sabitleme: ana süreç el sıkışmayı KENDİ yeniden yapar; renderer'ın gönderdiği parmak izi gözlenene eşit olmalı.
  handleTrusted("discovery:tlsPin", async (_e, req: { baseUrl: string; fingerprint: string; via: TlsPinVia }) => {
    const parts = req && typeof req.baseUrl === "string" ? splitUrl(req.baseUrl) : null;
    if (!parts) return { ok: false as const, reason: "Adres geçersiz" };
    const plain = parts.scheme === "http" ? await probeIdentity(baseUrlOf(parts.host, parts.port), 5000) : null;
    const tlsPort = parts.scheme === "https" ? parts.port : plain?.tls?.port;
    if (!tlsPort) return { ok: false as const, reason: "Sunucu şifreli bağlantı sunmuyor" };
    const viaTls = await probeIdentity(httpsBaseUrlOf(parts.host, tlsPort), 5000, { requireIdentity: true });
    const check = checkPinRequest({
      host: parts.host,
      requested: req.fingerprint,
      observed: viaTls?.observedFingerprint ?? null,
      via: req.via,
    });
    if (!check.ok) return { ok: false as const, reason: check.reason };
    const installationId = viaTls?.identity?.installationId ?? null;
    addTlsPin({
      installationId,
      fingerprint: viaTls!.observedFingerprint!,
      port: tlsPort,
      via: req.via,
      pinnedAt: new Date().toISOString(),
    });
    if (installationId) {
      writeSecureValue(PINNED_IDENTITY_KEY, JSON.stringify({ installationId, pinnedAt: new Date().toISOString() }));
      hooks.onPinned(installationId);
    }
    // Önceki (sabitsiz) doğrulama sonuçları önbellekte kalmasın.
    installLanTlsVerifier(session.defaultSession);
    await session.defaultSession.closeAllConnections();
    log.info(`[lan-tls] sertifika sabitlendi (${req.via}): ${parts.host}:${tlsPort}`);
    return { ok: true as const, baseUrl: httpsBaseUrlOf(parts.host, tlsPort) };
  });

  // Kullanıcının açık kararı: bu kurulumun şifreli bağlantı sabitini kaldır (HTTP'ye dönüş ancak böyle).
  handleTrusted("discovery:tlsUnpin", (_e, installationId: string | null) => {
    removeTlsPins(typeof installationId === "string" && installationId ? installationId : null);
    hooks.onUnpinned();
  });

  handleTrusted("discovery:tlsPins", () => readTlsPins());
}
