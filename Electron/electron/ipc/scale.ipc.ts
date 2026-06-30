import { ipcMain } from "electron";
import { createRequire } from "node:module";
import type { ScaleReadOpts, ScaleReadResult } from "@shared/ipc-contract.js";

// Kantar (SCALE) seri okuma. ESM main → CJS native `serialport` createRequire ile
// TEMBEL + try/catch (electron:rebuild yapılmamışsa available:false; çökme yok).
// Mobil HAL `btClassic.transport.readResponse` deseninin seri eşdeğeri:
// pollCommand yaz → terminator'a kadar oku → ham döndür. Sürekli-yayın kantarda
// (komut yok) ilk YARIM satır atılır, sonraki TAM satır okunur.
const req = createRequire(import.meta.url);

interface SerialPortReadInstance {
  on(event: "open", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  on(event: "data", listener: (chunk: Buffer) => void): void;
  write(data: Buffer, cb?: (err?: Error | null) => void): boolean;
  close(cb?: (err?: Error | null) => void): void;
}
interface SerialPortCtor {
  new (opts: { path: string; baudRate: number; autoOpen?: boolean }): SerialPortReadInstance;
}
interface SerialportModule {
  SerialPort: SerialPortCtor;
}

function loadSerial(): { mod?: SerialportModule; error?: string } {
  try {
    return { mod: req("serialport") as SerialportModule };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Yanıt tamamlandı mı? terminator verilmişse onu, yoksa herhangi CR/LF ara. */
function isComplete(buf: string, terminator?: string): boolean {
  if (terminator && terminator.length > 0) return buf.includes(terminator);
  return /[\r\n]/.test(buf);
}

function readScale(opts: ScaleReadOpts): Promise<ScaleReadResult> {
  const { mod, error } = loadSerial();
  if (!mod) return Promise.resolve({ ok: false, available: false, error: error ?? "serialport yüklenemedi" });

  const timeoutMs = opts.timeoutMs ?? 2500;
  // Sürekli-yayın kantar (komut yok): açılışta gelen ilk satır yarım olabilir →
  // bir satır sonunu görene kadar at, sonraki TAM satırı topla.
  const streaming = !opts.pollCommand?.trim();

  return new Promise((resolve) => {
    let settled = false;
    let buf = "";
    let discarding = streaming;
    let sp: SerialPortReadInstance | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const done = (r: ScaleReadResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        sp?.close(() => undefined);
      } catch {
        /* close hatası önemsiz */
      }
      resolve(r);
    };

    try {
      sp = new mod.SerialPort({ path: opts.path, baudRate: opts.baudRate ?? 9600, autoOpen: true });
      sp.on("error", (e) => done({ ok: false, available: true, error: e.message }));
      sp.on("data", (chunk: Buffer) => {
        buf += chunk.toString("latin1");
        if (discarding) {
          const idx = buf.search(/[\r\n]/);
          if (idx < 0) return; // henüz satır sonu yok → biriktirmeye devam
          buf = buf.slice(idx + 1).replace(/^[\r\n]+/, ""); // yarım satırı + CR/LF at
          discarding = false;
        }
        if (isComplete(buf, opts.terminator)) done({ ok: true, available: true, raw: buf, error: null });
      });
      sp.on("open", () => {
        const cmd = opts.pollCommand?.trim();
        if (cmd) {
          // İstek-cevap kantar: komutu yaz (satır sonu yoksa CR/LF ekle).
          const payload = /[\r\n]$/.test(opts.pollCommand ?? "") ? (opts.pollCommand as string) : `${cmd}\r\n`;
          sp!.write(Buffer.from(payload, "latin1"));
        }
      });
      timer = setTimeout(() => {
        // Zaman aşımı: tam satır gelmediyse hata (yarım/boş veriyle yanlış tartı yazma).
        done({ ok: false, available: true, error: "Kantardan geçerli yanıt gelmedi (zaman aşımı)" });
      }, timeoutMs);
    } catch (e) {
      done({ ok: false, available: true, error: (e as Error).message });
    }
  });
}

export function registerScaleIpc(): void {
  ipcMain.handle("scale:read", (_e, opts: ScaleReadOpts): Promise<ScaleReadResult> => {
    if (!opts?.path) return Promise.resolve({ ok: false, available: true, error: "COM yolu (path) boş" });
    return readScale(opts);
  });
}
