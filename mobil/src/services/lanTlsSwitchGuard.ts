// Elle adres değişikliğinde şifreli bağlantı kapısı (docs/design/LAN-TLS.md §6): sabitli sunucuya şifresiz
// adresle geçiş engellenir, kullanıcı önce sabiti açıkça kaldırır. Karar saf katmanda (`pinBlockingHttp`).
import { HTTP_TO_PINNED_REASON, pinBlockingHttp, type TlsPin } from '../lib/lan-tls';
import { DEFAULT_PORT, parseUrlParts, useBaseUrlStore } from '../store/baseUrlStore';
import { probeServer } from './discovery.service';
import { getTlsPins } from './lanTlsPins';

export type HttpSwitchBlock = { pin: TlsPin; url: string; reason: string };

/** Hedef adres sabitli sunucuya şifresiz geçişse engel döner; değilse null. Kimlik için hedef yoklanır. */
export async function httpSwitchBlock(targetUrl: string): Promise<HttpSwitchBlock | null> {
  const target = parseUrlParts(targetUrl);
  if (target.scheme !== 'http' || !target.host) return null;
  const pins = await getTlsPins();
  if (pins.length === 0) return null;
  const cur = parseUrlParts(useBaseUrlStore.getState().baseUrl);
  const current = { scheme: cur.scheme, host: cur.host, port: Number(cur.port) };
  const block = (pin: TlsPin | null) => (pin ? { pin, url: targetUrl, reason: HTTP_TO_PINNED_REASON } : null);
  const byHost = pinBlockingHttp(pins, current, { ...target, installationId: null });
  if (byHost) return block(byHost);
  const server = await probeServer(target.host, Number(target.port) || DEFAULT_PORT, null, 4000);
  return block(pinBlockingHttp(pins, current, { ...target, installationId: server?.identity?.installationId ?? null }));
}
