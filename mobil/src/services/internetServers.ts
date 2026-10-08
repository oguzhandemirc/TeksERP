// İnternet kipi sunucuları (docs/design/TABLET-GENEL-CA-BAGLANTI.md): yoklama native sistem doğrulamasıyla, kayıt
// cihazın güvenli deposunda. Kayıt kipi taşır; kip değişimi = kaldır + yeniden ekle (onaylı). Düşüş yok.
import { parseIdentityPayload } from '../lib/discovery';
import {
  INTERNET_SERVERS_KEY,
  SERVER_CHANGED_REASON,
  internetIdentityChanged,
  internetServerFor,
  kipFor,
  parseInternetServers,
  webPkiFailureText,
  withInternetServer,
  type InternetServer,
  type WebPkiFailure,
  type WebPkiObserved,
} from '../lib/internet-tls';
import { storage } from '../utils/storage';
import { setPinnedInstallationId, useBaseUrlStore } from '../store/baseUrlStore';
import { webPkiProbe } from './lanTlsNative';
import { pushNativePinState } from './lanTlsPins';

const VERIFY_TIMEOUT_MS = 6000;
const FAILURES: readonly WebPkiFailure[] = ['clock_behind', 'clock_ahead', 'untrusted', 'name', 'network', 'tls'];

export const INTERNET_NATIVE_MISSING =
  'Bu tablet sürümü internet sertifikalı sunucuya bağlanamaz — tablet uygulamasını Google Play’den güncelleyin.';

export async function getInternetServers(): Promise<InternetServer[]> {
  try {
    return parseInternetServers(await storage.getItem(INTERNET_SERVERS_KEY));
  } catch {
    return [];
  }
}

async function writeInternetServers(list: InternetServer[]): Promise<void> {
  if (list.length === 0) await storage.deleteItem(INTERNET_SERVERS_KEY);
  else await storage.setItem(INTERNET_SERVERS_KEY, JSON.stringify(list));
}

export async function removeInternetServer(host: string): Promise<void> {
  const h = host.trim().toLowerCase();
  await writeInternetServers((await getInternetServers()).filter((s) => s.host !== h));
}

export type InternetProbeOutcome = { ok: true; server: WebPkiObserved } | { ok: false; reason: string };

/** Sistem güven deposu + ad doğrulamasıyla yoklar; hata sınıfını Türkçe metne çevirir. */
export async function probeInternetServer(host: string, port: number, timeoutMs: number): Promise<InternetProbeOutcome> {
  if (kipFor(host) !== 'internet') return { ok: false, reason: 'Bu adres internet sertifikasıyla doğrulanmaz.' };
  const probe = webPkiProbe();
  if (!probe) return { ok: false, reason: INTERNET_NATIVE_MISSING };
  let raw;
  try {
    raw = await probe(host, port, timeoutMs);
  } catch {
    return { ok: false, reason: webPkiFailureText('tls', host) };
  }
  if (raw?.failure) {
    const kind = (FAILURES as readonly string[]).includes(raw.failure) ? (raw.failure as WebPkiFailure) : 'tls';
    return { ok: false, reason: webPkiFailureText(kind, host) };
  }
  let identity = null;
  if (raw?.status === 200 && typeof raw.body === 'string') {
    try {
      identity = parseIdentityPayload(JSON.parse(raw.body));
    } catch {
      identity = null;
    }
  }
  if (!identity?.installationId) {
    return { ok: false, reason: `${host} doğrulandı ama TeksERP sunucusu yanıt vermedi (HTTP ${raw?.status ?? '—'}).` };
  }
  return { ok: true, server: { host, port, installationId: identity.installationId, companyName: identity.companyName || null } };
}

async function readIdentityOverAppChannel(baseUrl: string): Promise<{ installationId: string | null } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), VERIFY_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/api/discovery/identity`, { signal: ctrl.signal });
    if (res.status !== 200) return null;
    return parseIdentityPayload(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Onaylanmış internet kaydını yazar: önce uygulamanın KENDİ ağ istemcisiyle (native katman, sistem doğrulaması)
 * kimlik ucu okunur ve yoklamadaki kurulum kimliğiyle karşılaştırılır; tutmazsa hiçbir şey yazılmaz.
 */
export async function completeInternetPairing(decision: { record: InternetServer; baseUrl: string }): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!webPkiProbe()) return { ok: false, reason: INTERNET_NATIVE_MISSING };
  const identity = await readIdentityOverAppChannel(decision.baseUrl);
  if (!identity) return { ok: false, reason: 'Sunucuya doğrulanmış bağlantıyla ulaşılamadı — bağlanılmadı.' };
  if (identity.installationId !== decision.record.installationId) return { ok: false, reason: 'Bağlanılan sunucu doğrulanan sunucu değil — bağlanılmadı.' };
  await writeInternetServers(withInternetServer(await getInternetServers(), decision.record));
  if (decision.record.installationId) await setPinnedInstallationId(decision.record.installationId);
  await useBaseUrlStore.getState().setCustomUrl(decision.baseUrl);
  await pushNativePinState();
  return { ok: true };
}

/**
 * Geçerli adres internet kipindeyse kurulum kimliğini kayıtla karşılaştırır; değişmişse adres kullanılamaz olur
 * ("sunucu değişti — yeniden ekleyin"). Ulaşılamazsa hüküm yok (çevrimdışı kip devralır).
 */
export async function verifyInternetIdentity(): Promise<void> {
  const { baseUrl, markUnusable } = useBaseUrlStore.getState();
  const rec = internetServerFor(baseUrl, await getInternetServers());
  if (!rec) return;
  const identity = await readIdentityOverAppChannel(baseUrl.replace(/\/api\/?$/i, ''));
  if (useBaseUrlStore.getState().baseUrl !== baseUrl) return;
  if (internetIdentityChanged(rec, identity?.installationId ?? null)) markUnusable(SERVER_CHANGED_REASON);
}
