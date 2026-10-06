// HTTPS keşif adayı (docs/design/LAN-TLS.md §6): el sıkışmada GÖZLENEN parmak izi bu kurulumun sabitinde olmalı.
// Kimliksiz https yanıtı aday değildir; uyuşmazlıkta aday düşer ve HTTP'ye dönülmez.
import { compareIdentity, type DiscoveredServer, type DiscoverySource } from "../../shared/discovery.js";
import { httpsBaseUrlOf, pinsForInstallation } from "../../shared/lan-tls.js";
import { readTlsPins } from "../security/lan-tls-pin.js";
import { probeIdentity } from "./probe.js";

export interface CandidateCtx {
  host: string;
  via: DiscoverySource;
  pinnedId: string | null;
  timeoutMs: number;
  onBlocked: (host: string, reason: string) => void;
}

export async function verifyHttpsCandidate(ctx: CandidateCtx, port: number): Promise<DiscoveredServer | null> {
  const res = await probeIdentity(httpsBaseUrlOf(ctx.host, port), ctx.timeoutMs, { requireIdentity: true });
  if (!res?.identity || !res.observedFingerprint) return null;
  const mine = pinsForInstallation(readTlsPins(), res.identity.installationId);
  if (!mine.some((p) => p.fingerprint === res.observedFingerprint)) {
    ctx.onBlocked(ctx.host, "sertifika parmak izi sabitlenenle aynı değil");
    return null;
  }
  return {
    baseUrl: httpsBaseUrlOf(ctx.host, port),
    host: ctx.host,
    port,
    via: ctx.via,
    identity: res.identity,
    rttMs: res.rttMs,
    matchesPinned: compareIdentity(ctx.pinnedId, res.identity.installationId),
  };
}
