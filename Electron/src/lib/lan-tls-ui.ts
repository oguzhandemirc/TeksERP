/**
 * Fabrika ağında TLS — panel arayüzünün saf kararları (docs/design/LAN-TLS.md §4, §6).
 * Güven kararı burada VERİLMEZ: sabitleme ana süreçte el sıkışmayla doğrulanır; bu modül yalnız
 * kullanıcıya hangi adımın gösterileceğini seçer.
 */
import { DISCOVERY_DEFAULT_PORT } from "@shared/discovery";
import type { DiscoveryApi, TlsObservation } from "@shared/ipc-contract";
import { HTTP_TO_PINNED_REASON, buildTlsQr, isLoopbackHost, panelTransportFor, pinBlockingHttp, type TlsPin } from "@shared/lan-tls";
import { isInternetHost } from "@shared/internet-tls";
import { splitApiBaseUrl } from "@/lib/api-config";

export type TlsSwitchPlan =
  | { kind: "unavailable"; reason: string }
  | { kind: "mismatch"; reason: string }
  | { kind: "loopback"; fingerprint: string }
  | { kind: "confirm"; fingerprint: string };

/**
 * Gözlemden sonraki adım. Döngü adresinde kullanıcı onayı gerekmez (paket makineden çıkmaz);
 * başka her adreste parmak izi GÖZLE karşılaştırılıp onaylanır. İlan ile el sıkışma ayrışırsa
 * araya biri girmiş olabilir — sabitleme teklif edilmez.
 */
export function planTlsSwitch(obs: TlsObservation | null): TlsSwitchPlan {
  if (!obs) return { kind: "unavailable", reason: "Adres geçersiz." };
  if (!obs.observedFingerprint) {
    return {
      kind: "unavailable",
      reason: obs.advert
        ? "Sunucu şifreli bağlantı ilan ediyor ama şifreli kanala bağlanılamadı."
        : "Sunucu şifreli bağlantı sunmuyor (sunucuda LAN_TLS_MODE kapalı).",
    };
  }
  if (obs.advert && obs.advert.fingerprint !== obs.observedFingerprint) {
    return {
      kind: "mismatch",
      reason: "Sunucunun ilan ettiği kod ile şifreli kanalda sunulan sertifika farklı. Ağda araya giren biri olabilir — sabitlemeyin, sistem yöneticisine haber verin.",
    };
  }
  return isLoopbackHost(obs.host)
    ? { kind: "loopback", fingerprint: obs.observedFingerprint }
    : { kind: "confirm", fingerprint: obs.observedFingerprint };
}

/** Bu adres şifreli ve sabitli mi: https + aynı porttaki sabit. */
export function activePinFor(pins: readonly TlsPin[], url: string): TlsPin | null {
  const parts = splitApiBaseUrl(url);
  if (parts.protocol !== "https" || !parts.host) return null;
  const port = Number(parts.port);
  return pins.find((p) => p.port === port) ?? null;
}

/**
 * Sabit kaldırılınca dönülecek HTTP adresi — yalnız döngü adresinde (paket makineden çıkmaz): aynı sunucunun son
 * kullanılan http adresi, yoksa varsayılan port. Ağ adresinde şifresize dönüş YOK (null): yeniden eşleşme gerekir.
 */
export function httpFallbackUrl(httpsUrl: string, recent: readonly string[]): string | null {
  const host = splitApiBaseUrl(httpsUrl).host;
  if (!isLoopbackHost(host)) return null;
  const prior = recent.find((u) => {
    const p = splitApiBaseUrl(u);
    return p.protocol === "http" && p.host === host;
  });
  return prior ?? `http://${host}:${DISCOVERY_DEFAULT_PORT}`;
}

/**
 * Tablet QR'ına girecek sunucu adresleri: panelin bağlı olduğu adres; panel sunucunun kendisindeyse (döngü)
 * bu makinenin LAN adresleri (kendi kendine atanmış ve CGNAT/Tailscale hariç). Güven adreste değil izdedir —
 * tablet izi tutmayan adrese bağlanmaz, yanlış adres yalnız bir zaman aşımına mal olur.
 */
export function tabletQrHosts(activeUrl: string, localHosts: readonly string[]): string[] {
  const host = splitApiBaseUrl(activeUrl).host;
  if (!host) return [];
  if (!isLoopbackHost(host)) return host.includes(":") ? [] : [host];
  return localHosts.filter((h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) && !h.startsWith("169.254.") && !/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h));
}

/**
 * Tablet QR'ı yalnız panelin kendisi şifreli ve sabitliyken gösterilir (QR'ın güveni panelin sabitinden gelir).
 * Adres verilirse v2 (adresli), verilmezse v1 — v1'i adres alanını bilmeyen eski tablet de okur.
 */
export function tabletTlsQr(pins: readonly TlsPin[], activeUrl: string, hosts: readonly string[] = []): string | null {
  const pin = activePinFor(pins, activeUrl);
  if (!pin) return null;
  return buildTlsQr(pin.installationId, { port: pin.port, fingerprint: pin.fingerprint }, hosts);
}

export type HttpSwitchBlock = { pin: TlsPin; url: string; reason: string };

/**
 * Elle kaydedilen şifresiz adres sabitli sunucuya mı gidiyor (aynı makine ya da aynı kurulum kimliği):
 * öyleyse engel döner — kullanıcı önce sabiti "Şifreli bağlantıyı kaldır" ile açıkça kaldırır.
 */
export async function httpSwitchBlock(
  api: Pick<DiscoveryApi, "tlsPins" | "probe"> | undefined,
  targetUrl: string,
  activeUrl: string,
): Promise<HttpSwitchBlock | null> {
  const target = splitApiBaseUrl(targetUrl);
  if (!api?.tlsPins || target.protocol !== "http" || !target.host) return null;
  const pins = await api.tlsPins();
  if (pins.length === 0) return null;
  const cur = splitApiBaseUrl(activeUrl);
  const current = { scheme: cur.protocol, host: cur.host, port: Number(cur.port) };
  const block = (pin: TlsPin | null) => (pin ? { pin, url: targetUrl, reason: HTTP_TO_PINNED_REASON } : null);
  const byHost = pinBlockingHttp(pins, current, { scheme: target.protocol, host: target.host, installationId: null });
  if (byHost) return block(byHost);
  const server = await api.probe(targetUrl).catch(() => null);
  const installationId = server?.identity?.installationId ?? null;
  return block(pinBlockingHttp(pins, current, { scheme: target.protocol, host: target.host, installationId }));
}

/**
 * Panel yalnız şifreli: kaydedilecek/denenecek adres kabul edilmiyorsa Türkçe sebep (ağ adresinde http:// ya da
 * eşleşmemiş https). Karar `panelTransportFor`da; ana süreçteki ağ kapısı aynı kuralı ayrıca uygular.
 */
export async function addressRefusal(api: Pick<DiscoveryApi, "tlsPins"> | undefined, url: string): Promise<string | null> {
  const pins = api?.tlsPins ? await api.tlsPins().catch(() => [] as TlsPin[]) : [];
  const t = panelTransportFor(pins, url, isInternetHost);
  return t.kind === "refused" ? t.reason : null;
}
