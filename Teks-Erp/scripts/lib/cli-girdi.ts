// Satıcı CLI'larının ve PAKET imza aracının ortak girdisi: argüman ayrıştırma (parola argümandan ASLA) ve parola
// istemi (TTY'de gizli; değilse stdin'in sıradaki satırı; `--parola-dosyasi=<yol>` verilmişse o dosyanın sıradaki satırı —
// her istenen parola bir satır, stdin ile aynı sıra). Parola Buffer olarak döner; çağıran sıfırlar.
// Kaynak bu dosya; `Teks-Erp/scripts/lib/cli-girdi.ts` BAYT-EŞİT aynasıdır (test_lisans_paket_anahtari §0).
// `test_` öneki yok → koşucu bunu bekçi saymaz.

import { lstatSync, readFileSync } from "node:fs";

export class CliError extends Error {}

/** Parola DOSYASI bayrağı (değeri yol, parola değil): `--parola-dosyasi` · `--<rol>-parola-dosyasi`. */
export const PASSWORD_FILE_FLAG = /^(?:[a-z]+-)*parola-dosyasi$/;
const PASSWORD_FILE_MAX = 4096;

export function args(argv: readonly string[]): { command: string; flags: Map<string, string> } {
  const [command = "", ...rest] = argv;
  const flags = new Map<string, string>();
  for (const a of rest) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new CliError(`Tanınmayan argüman: ${a.split("=")[0]}`);
    if (/parola|password|sifre|secret/.test(m[1]!) && !PASSWORD_FILE_FLAG.test(m[1]!)) {
      throw new CliError("Parola argümandan ALINMAZ — TTY'de sorulur, stdin'den ya da --parola-dosyasi=<yol> dosyasından okunur");
    }
    if (m[1] === "parola-dosyasi") {
      fileLines = readPasswordFile(m[2] ?? "", "--parola-dosyasi");
      continue;
    }
    flags.set(m[1]!, m[2] ?? "");
  }
  return { command, flags };
}

// ---------------------------------------------------------------- parola girişi
let stdinLines: Buffer[] | null = null;
let fileLines: Buffer[] | null = null;

function splitLines(all: Buffer): Buffer[] {
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
  return lines;
}

async function readAllStdin(): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const all = Buffer.concat(chunks);
  for (const c of chunks) c.fill(0);
  const lines = splitLines(all);
  all.fill(0);
  return lines;
}

/**
 * Parola dosyası BİR KEZ okunur: düzenli dosya (bağ/dizin RED), bizim, grup/başkalarına kapalı (0600), ≤ 4 KiB; her satır
 * bir parola. Hata iletisi yolu ve içeriği BASMAZ (yanlışlıkla parola yazılmış bir değer ekrana düşmesin).
 */
export function readPasswordFile(file: string, label: string): Buffer[] {
  let st;
  try {
    st = lstatSync(file);
  } catch {
    throw new CliError(`${label}: dosya okunamadı (yok ya da erişilemez)`);
  }
  if (!st.isFile()) throw new CliError(`${label}: düzenli dosya değil (sembolik bağ ve dizin kabul edilmez)`);
  if (process.platform !== "win32") {
    if ((st.mode & 0o077) !== 0) throw new CliError(`${label}: dosya grup/başkalarına açık (${(st.mode & 0o777).toString(8)}) — chmod 600`);
    if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw new CliError(`${label}: dosya başka kullanıcının`);
  }
  if (st.size === 0 || st.size > PASSWORD_FILE_MAX) throw new CliError(`${label}: dosya boş ya da çok büyük (≤ ${PASSWORD_FILE_MAX} bayt)`);
  const all = readFileSync(file);
  const lines = splitLines(all);
  all.fill(0);
  if (lines.length === 0 || lines.every((l) => l.length === 0)) throw new CliError(`${label}: dosyada parola yok`);
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

/** Parola: `--parola-dosyasi` verilmişse onun sıradaki satırı; yoksa TTY'de gizli istem, değilse stdin'in sıradaki satırı. NFC Buffer. */
export async function askPassword(question: string): Promise<Buffer> {
  let raw: Buffer;
  if (fileLines) {
    const next = fileLines.shift();
    if (!next) throw new CliError(`Parola dosyasında beklenen satır yok: ${question.trim()}`);
    raw = next;
  } else if (process.stdin.isTTY) raw = await readHiddenFromTty(question);
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

