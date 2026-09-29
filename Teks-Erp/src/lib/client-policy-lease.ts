// İstemci sürüm politikasının YAYIN tarafı kiradan: `currentVersion` kanalın güncel sürümüdür
// (satıcının imzalı kirası `kanal.guncelSurumler`); `minVersion` kodda kalır (kırılma kararı deploy'la
// değişir, yayınla değil). Kira yoksa ya da alanı taşımıyorsa bugünkü koddaki değer döner.
import { CLIENT_VERSION_POLICIES, type ClientVersionPolicy } from "../config/client-version-policy";
import { getLicenseSnapshot } from "./license/runtime";

/** İstemci türü → kiradaki `guncelSurumler` anahtarı. `web` backend paketiyle gider: kira ekseni yok. */
const LEASE_VERSION_KEY: Readonly<Record<string, "panel" | "tablet">> = { electron: "panel", mobil: "tablet" };

function leaseChannelVersions(): { panel?: string; tablet?: string } | null {
  try {
    return getLicenseSnapshot().lease?.document.kanal.guncelSurumler ?? null;
  } catch {
    // Lisans çalışma zamanı kurulmamış (ör. test/araç süreci): politika koddan okunur.
    return null;
  }
}

export function effectiveClientPolicy(kind: string): ClientVersionPolicy | undefined {
  const base = CLIENT_VERSION_POLICIES[kind];
  if (!base) return undefined;
  const key = LEASE_VERSION_KEY[kind];
  const fromLease = key ? leaseChannelVersions()?.[key] : undefined;
  return fromLease ? { ...base, currentVersion: fromLease } : base;
}

export function effectiveClientPolicies(): Record<string, ClientVersionPolicy> {
  const out: Record<string, ClientVersionPolicy> = {};
  for (const kind of Object.keys(CLIENT_VERSION_POLICIES)) {
    const policy = effectiveClientPolicy(kind);
    if (policy) out[kind] = policy;
  }
  return out;
}
