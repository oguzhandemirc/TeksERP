// Satıcı CLI'larının ve PAKET imza aracının ortak girdisi: argüman ayrıştırma (parola argümandan ASLA) ve parola
// istemi (TTY'de gizli; değilse stdin'in sıradaki satırı). Parola Buffer olarak döner; çağıran sıfırlar.
// Kaynak bu dosya; `Teks-Erp/scripts/lib/cli-girdi.ts` BAYT-EŞİT aynasıdır (test_lisans_paket_anahtari §0).
// `test_` öneki yok → koşucu bunu bekçi saymaz.

export class CliError extends Error {}

export function args(argv: readonly string[]): { command: string; flags: Map<string, string> } {
  const [command = "", ...rest] = argv;
  const flags = new Map<string, string>();
  for (const a of rest) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new CliError(`Tanınmayan argüman: ${a}`);
    if (/parola|password|sifre|secret/.test(m[1]!)) {
      throw new CliError("Parola argümandan ALINMAZ — TTY'de sorulur ya da stdin'den okunur");
    }
    flags.set(m[1]!, m[2] ?? "");
  }
  return { command, flags };
}

// ---------------------------------------------------------------- parola girişi
let stdinLines: Buffer[] | null = null;

async function readAllStdin(): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const all = Buffer.concat(chunks);
  for (const c of chunks) c.fill(0);
  const lines: Buffer[] = [];
  let start = 0;
  for (let i = 0; i <= all.length; i++) {
    if (i === all.length || all[i] === 0x0a) {
      let end = i;
      if (end > start && all[end - 1] === 0x0d) end--;
      if (end > start || i < all.length) lines.push(Buffer.from(all.subarray(start, end)));
      start = i + 1;
    }
  }
  all.fill(0);
  return lines;
}

function readHiddenFromTty(question: string): Promise<Buffer> {
  return new Promise((resolve) => {
    process.stderr.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    const bytes: number[] = [];
    const onData = (chunk: Buffer): void => {
      for (const b of chunk) {
        if (b === 0x03) {
          process.stderr.write("\n");
          process.exit(130);
        } else if (b === 0x0d || b === 0x0a) {
          stdin.off("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          process.stderr.write("\n");
          const out = Buffer.from(bytes);
          bytes.fill(0);
          chunk.fill(0);
          resolve(out);
          return;
        } else if (b === 0x7f || b === 0x08) bytes.pop();
        else bytes.push(b);
      }
      chunk.fill(0);
    };
    stdin.on("data", onData);
  });
}

/** Parola: TTY'de gizli istem, değilse stdin'in sıradaki satırı. NFC'ye çevrilmiş Buffer döner. */
export async function askPassword(question: string): Promise<Buffer> {
  let raw: Buffer;
  if (process.stdin.isTTY) raw = await readHiddenFromTty(question);
  else {
    stdinLines ??= await readAllStdin();
    const next = stdinLines.shift();
    if (!next) throw new CliError(`Parola bekleniyordu (stdin bitti): ${question.trim()}`);
    raw = next;
  }
  const normalized = Buffer.from(raw.toString("utf8").normalize("NFC"), "utf8");
  raw.fill(0);
  return normalized;
}

