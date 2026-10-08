// Şifreli yoklama (docs/design/LAN-TLS.md §4): sunucunun sertifika izi native katmanda GÖZLENİR, güven
// kararı verilmez — karar kullanıcının kod karşılaştırması ya da QR'dır. Kimlik yanıtı doğrulanmamış bilgidir.
import { parseIdentityPayload, type ServerIdentity } from '../lib/discovery';
import { normalizeFingerprint, type ObservedServer } from '../lib/lan-tls';
import { lanTlsProbe } from './lanTlsNative';

export interface TlsProbed extends ObservedServer {
  identity: ServerIdentity | null;
  rttMs: number;
}

export type TlsProbeOutcome = { ok: true; server: TlsProbed } | { ok: false; reason: string };

export const NATIVE_MISSING_REASON =
  'Bu tablet sürümü şifreli bağlantıyı desteklemiyor — tablet uygulamasını Google Play\'den güncelleyin.';

export async function probeTlsDetailed(host: string, port: number, timeoutMs: number): Promise<TlsProbeOutcome> {
  const probe = lanTlsProbe();
  if (!probe) return { ok: false, reason: NATIVE_MISSING_REASON };
  const started = Date.now();
  let raw;
  try {
    raw = await probe(host, port, timeoutMs);
  } catch {
    return {
      ok: false,
      reason: `${host}:${port} adresinde şifreli sunucuya ulaşılamadı. IP doğru mu, sunucu açık mı, tablet aynı ağda mı?`,
    };
  }
  const fingerprint = normalizeFingerprint(raw?.fingerprint);
  if (!fingerprint) return { ok: false, reason: 'Sunucunun sertifika kodu okunamadı.' };
  let identity: ServerIdentity | null = null;
  if (raw.status === 200 && typeof raw.body === 'string') {
    try {
      identity = parseIdentityPayload(JSON.parse(raw.body));
    } catch {
      identity = null;
    }
  }
  return {
    ok: true,
    server: { host, port, fingerprint, installationId: identity?.installationId ?? null, identity, rttMs: Date.now() - started },
  };
}

/** Keşif için: ulaşılamayan ya da TeksERP kimliği taşımayan adres `null`. */
export async function probeTlsServer(host: string, port: number, timeoutMs: number): Promise<TlsProbed | null> {
  const r = await probeTlsDetailed(host, port, timeoutMs);
  return r.ok && r.server.identity ? r.server : null;
}
