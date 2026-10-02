// Windows hizmet konağının kapanış kanalı: Windows'ta SIGTERM yok. Konak stdin borusuna `kapat`
// satırı yazar ya da boruyu kapatır; konak ölürse boru da kapanır ve yetim backend kalmaz.
import type { Readable } from "node:stream";

/** Konak ↔ backend sözleşmesindeki satır (D2 konağı aynı metni yazar). */
export const SHUTDOWN_COMMAND = "kapat";
/** Satırsız çöp belleği şişirmesin. */
const MAX_BUFFER_CHARS = 4096;

/** `kapat` satırında ya da akış bitince `onShutdown(neden)` BİR KEZ çağrılır; tanınmayan satır yok sayılır. */
export function listenShutdownChannel(stream: Readable, onShutdown: (reason: string) => void): void {
  let buffer = "";
  let fired = false;
  const once = (reason: string): void => {
    if (fired) return;
    fired = true;
    onShutdown(reason);
  };
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    const lines = (buffer + chunk).split(/\r?\n/);
    buffer = (lines.pop() ?? "").slice(-MAX_BUFFER_CHARS);
    if (lines.some((l) => l.trim() === SHUTDOWN_COMMAND)) once("hizmet: kapat");
  });
  stream.on("end", () => once("hizmet: kapanış kanalı kapandı"));
  stream.on("close", () => once("hizmet: kapanış kanalı kapandı"));
  stream.on("error", () => once("hizmet: kapanış kanalı hatası"));
  stream.resume();
}
