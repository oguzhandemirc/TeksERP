// Bildirim bekçilerinin SAHTE sağlayıcıları — yerel HTTP (127.0.0.1, port 0): Telegram Bot API `sendMessage` ve
// Resend `POST /emails` biçiminde yanıt verir, gelen her isteği (yol · başlıklar · gövde) kaydeder. Gerçek ağ YOK.
// Yanıt sırası programlanabilir (`sonraki`); boşsa başarı. `test_` öneki yok → koşucu bekçi saymaz.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

export interface SahteIstek {
  readonly yol: string;
  readonly basliklar: http.IncomingHttpHeaders;
  readonly ham: string;
  readonly govde: Record<string, unknown>;
}

export interface SahteYanit {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  /** Yanıt vermeden bağlantıyı kopar (ağ hatası). */
  readonly kopar?: boolean;
}

export interface SahteSaglayici {
  readonly kok: string;
  readonly istekler: SahteIstek[];
  /** Sıradaki isteklerin yanıtları (FIFO); boşalınca varsayılan başarı. */
  readonly sonraki: SahteYanit[];
  /** Her yanıttan önce bekleme (ms) — eşzamanlılık bekçisi için. */
  gecikmeMs: number;
  kapat(): Promise<void>;
}

export type SaglayiciTuru = "telegram" | "resend";

function basari(tur: SaglayiciTuru, sira: number): SahteYanit {
  return tur === "telegram" ? { status: 200, body: { ok: true, result: { message_id: 1000 + sira, chat: { id: -1001 } } } } : { status: 200, body: { id: randomUUID() } };
}

export async function sahteSaglayici(tur: SaglayiciTuru): Promise<SahteSaglayici> {
  const istekler: SahteIstek[] = [];
  const sonraki: SahteYanit[] = [];
  const durum = { gecikmeMs: 0 };
  const server = http.createServer((req, res) => {
    const parcalar: Buffer[] = [];
    req.on("data", (c: Buffer) => parcalar.push(c));
    req.on("end", () => {
      const ham = Buffer.concat(parcalar).toString("utf8");
      let govde: Record<string, unknown> = {};
      try {
        govde = JSON.parse(ham) as Record<string, unknown>;
      } catch {
        govde = {};
      }
      istekler.push({ yol: req.url ?? "", basliklar: req.headers, ham, govde });
      const y = sonraki.shift() ?? basari(tur, istekler.length);
      setTimeout(() => {
        if (y.kopar) {
          req.socket.destroy();
          return;
        }
        res.writeHead(y.status, { "Content-Type": "application/json", ...(y.headers ?? {}) });
        res.end(JSON.stringify(y.body ?? {}));
      }, durum.gecikmeMs);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    kok: `http://127.0.0.1:${port}`,
    istekler,
    sonraki,
    get gecikmeMs() {
      return durum.gecikmeMs;
    },
    set gecikmeMs(v: number) {
      durum.gecikmeMs = v;
    },
    kapat: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))),
  };
}
