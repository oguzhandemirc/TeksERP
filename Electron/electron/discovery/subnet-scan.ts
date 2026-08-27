/**
 * Alt ağ taraması — keşfin FİLTRELENEMEYEN ayağı.
 *
 * mDNS zarif olandır ama fabrika access point'leri multicast'i süzebilir
 * (IGMP snooping / client isolation). Bu ayak yalnız düz TCP bağlantısı dener,
 * yani mDNS'in çalışmadığı her ağda çalışır. "Her koşulda bulur" iddiasını
 * ayakta tutan katman budur — kesme.
 *
 * Hedef listesi BURADA ÜRETİLMEZ (`shared/discovery.ts` → `scanTargetsFor`);
 * orada saf olduğu için test edilebilir, burada soket var.
 */
import net from "node:net";

export interface ScanOptions {
  /** Aynı anda kaç bağlantı denensin. */
  concurrency?: number;
  /** Tek bir adres için bekleme (ms). Wi-Fi'de kısa kalırsa YANLIŞ "sunucu yok" üretir. */
  socketTimeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_CONCURRENCY = 64;
const DEFAULT_SOCKET_TIMEOUT_MS = 300;

/** Tek adreste portun AÇIK olup olmadığını söyler. Asla throw etmez. */
function probePort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* yoksay */
      }
      resolve(ok);
    };
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    try {
      socket.connect(port, host);
    } catch {
      done(false);
    }
  });
}

/**
 * Verilen adreslerde `port`u açık olanları döner. Sınırlı eşzamanlılıkla koşar;
 * `signal` ile iptal edilebilir (kullanıcı "Vazgeç" derse ya da başka bir ayak
 * zaten sunucuyu bulduysa boşuna 253 bağlantı denemeyelim).
 */
export async function scanSubnet(
  targets: string[],
  port: number,
  opts: ScanOptions = {},
): Promise<string[]> {
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const timeoutMs = opts.socketTimeoutMs ?? DEFAULT_SOCKET_TIMEOUT_MS;
  const open: string[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    for (;;) {
      if (opts.signal?.aborted) return;
      const i = index++;
      if (i >= targets.length) return;
      const host = targets[i];
      if (host === undefined) return;
      if (await probePort(host, port, timeoutMs)) open.push(host);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return open;
}
