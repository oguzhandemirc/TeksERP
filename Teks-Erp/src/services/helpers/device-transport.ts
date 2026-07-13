// =============================================================================
// HAL (backend) — cihaza ulaşım soyutlaması. Şu an NETWORK_TCP (yazıcı + ileride
// ağ-kantar/metre). BT/USB/Serial cihazlar tablette okunur (mobil HAL). Mobil
// `mobil/src/services/hal/*` ile aynı sözleşme.
//
// `sendOverTcp` buradan `printer-transport.ts`'e taşındı (tek kaynak); davranış
// birebir korunur (latin1, nazik end ile kapanış, zaman aşımı).
// =============================================================================

import net from "net";

export const DEFAULT_TCP_PORT = 9100;
export const DEFAULT_TIMEOUT_MS = 5000;

export interface ReadOptions {
  pollCommand?: string;
  terminator?: string;
  timeoutMs?: number;
}

export interface DeviceTransport {
  /** Bağlantıyı doğrula (yazma/okuma yapmaz). */
  test(): Promise<void>;
  /** Ham içerik yaz; yazılan bayt sayısını döner. Buffer → raster grafik baytları
   *  (birebir); string → latin1 kodlanır (native komut). */
  write(content: string | Buffer): Promise<number>;
  /** İstek-cevap oku (ağ-kantar/metre) — ham metin. Yazıcı transport'ta yok. */
  read?(opts?: ReadOptions): Promise<string>;
}

/** Ham native baytları yazıcıya RAW TCP ile yaz. Buffer → raster grafik baytları
 *  (birebir, invert/CRLF-normalize YOK); string → latin1 (native komut). */
export function sendOverTcp(
  content: string | Buffer,
  host: string,
  port: number,
  timeoutMs: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, "latin1");
    const socket = new net.Socket();
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(buf.length);
    };
    socket.setTimeout(timeoutMs);
    socket.once("error", (e) => finish(e instanceof Error ? e : new Error(String(e))));
    socket.once("timeout", () => finish(new Error("Cihaz bağlantısı zaman aşımı")));
    socket.connect(port, host, () => {
      socket.write(buf, () => {
        // Cihazın buffer'ı boşaltması için end ile nazik kapanış.
        socket.end(() => finish());
      });
    });
  });
}

/** Bir host:port için RAW TCP DeviceTransport. */
export function tcpTransport(
  host: string,
  port: number = DEFAULT_TCP_PORT,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): DeviceTransport {
  return {
    test: () =>
      new Promise<void>((resolve, reject) => {
        const socket = new net.Socket();
        let settled = false;
        const finish = (err?: Error) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          if (err) reject(err);
          else resolve();
        };
        socket.setTimeout(timeoutMs);
        socket.once("error", (e) => finish(e instanceof Error ? e : new Error(String(e))));
        socket.once("timeout", () => finish(new Error("Cihaz bağlantısı zaman aşımı")));
        socket.connect(port, host, () => finish());
      }),
    write: (content) => sendOverTcp(content, host, port, timeoutMs),
  };
}
