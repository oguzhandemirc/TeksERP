// Satıcı CLI'larının ve PAKET imza aracının ortak girdisi: argüman ayrıştırma (parola argümandan ASLA) ve parola
// kaynağı, öncelik sırasıyla: `--parola-dosyasi=<yol>` (her istenen parola bir satır) > macOS Anahtar Zinciri
// (`tekserp/<ad>`, sorusuz) > TTY'de gizli istem > stdin'in sıradaki satırı. Parola Buffer olarak döner; çağıran sıfırlar.
// Kaynak bu dosya; `Teks-Erp/scripts/lib/cli-girdi.ts` BAYT-EŞİT aynasıdır (test_lisans_paket_anahtari §0).
// `test_` öneki yok → koşucu bunu bekçi saymaz.

import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, sep } from "node:path";

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
    if (m[1] === "kasa") {
      kasaOverride = kasaSecimi(m[2] ?? "");
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

/**
 * Parola: `--parola-dosyasi` verilmişse onun sıradaki satırı; yoksa `kasa` adı (ya da `--kasa=<ad>|yok`) Anahtar
 * Zinciri'nde kayıtlıysa o (istem YOK); yoksa TTY'de gizli istem, değilse stdin'in sıradaki satırı. NFC Buffer.
 */
export async function askPassword(question: string, kasa: KasaAdi | null = null): Promise<Buffer> {
  let raw: Buffer;
  const ad = kasaOverride === undefined ? kasa : kasaOverride;
  if (fileLines) {
    const next = fileLines.shift();
    if (!next) throw new CliError(`Parola dosyasında beklenen satır yok: ${question.trim()}`);
    raw = next;
  } else {
    const fromKasa = ad === null ? null : kasadanOku(ad);
    if (fromKasa) return fromKasa;
    if (ad !== null && kasaKomutu() !== null && !kasaUyarilan.has(ad)) {
      kasaUyarilan.add(ad);
      process.stderr.write(`ℹ ${kasaIpucu(ad)}\n`);
    }
    if (process.stdin.isTTY) raw = await readHiddenFromTty(question);
    else {
      stdinLines ??= await readAllStdin();
      const next = stdinLines.shift();
      if (!next) throw new CliError(`Parola bekleniyordu (stdin bitti): ${question.trim()}${ad !== null && kasaKomutu() !== null ? ` — ${kasaIpucu(ad)}` : ""}`);
      raw = next;
    }
  }
  const normalized = Buffer.from(raw.toString("utf8").normalize("NFC"), "utf8");
  raw.fill(0);
  return normalized;
}


// ---------------------------------------------------------------- parola kasası (macOS Anahtar Zinciri)
// Kaynak `scripts/lib/parola-kasasi.mjs` (katalog, biçim, `security` çağrısı); bu blok onun TEK TS kopyasıdır —
// satıcı imajı repo kökünü görmez. Eşitlik bekçisi `scripts/test_parola_kasasi.mjs`. Değer hiçbir çıktıya basılmaz.
export const KASA_ADLARI = ["kok", "ara", "paket", "istemci", "yedek", "play-yukleme"] as const;
export type KasaAdi = (typeof KASA_ADLARI)[number];
export const KASA_ORTAM = "TEKSERP_PAROLA_KASASI";
export const KASA_KOMUTU = "/usr/bin/security";
export const KASA_HESAP = "tekserp";
export const KASA_ONEK = "tekserp/";
export const KASA_BICIM = "tkp1:";
export const KASA_BULUNAMADI = 44;
export const KAYIT_KOMUTU = "node scripts/parola-kaydet.mjs";

let kasaOverride: KasaAdi | null | undefined;
const kasaUyarilan = new Set<KasaAdi>();

const isKasaAdi = (ad: string): ad is KasaAdi => (KASA_ADLARI as readonly string[]).includes(ad);

/** `--kasa=<ad>|yok`: yok → kasa sorulmaz; ad → bu süreçteki her parola o addan (ör. yedek anahtarı açarken `yedek`). */
export function kasaSecimi(bayrak: string): KasaAdi | null {
  if (bayrak === "yok") return null;
  if (!isKasaAdi(bayrak)) throw new CliError(`--kasa: tanınmayan ad (bilinen: ${KASA_ADLARI.join(", ")}, yok)`);
  return bayrak;
}

/** Üretim kid'inden kasa adı; hazırlık/test kid'i ve tanınmayan aile → null (kasa sorulmaz). */
export function kasaAdiKid(kid: string): KasaAdi | null {
  if (/^kok-\d{4}-\d+$/.test(kid)) return "kok";
  if (/^ara-\d{4}-\d+$/.test(kid)) return "ara";
  if (/^(?:paket-\d{4}(?:-\d+)?|pkt-\d{4}-\d+)$/.test(kid)) return "paket";
  if (/^ist-\d{4}-\d+$/.test(kid)) return "istemci";
  return null;
}

export const kasaIpucu = (ad: KasaAdi): string =>
  `Anahtar Zinciri'nde ${KASA_ONEK}${ad} kayıtlı değil — kendi Terminal'inde kaydet: ${KAYIT_KOMUTU} ${ad}`;

/** Kasaya giden komutun yolu; null = kapalı (macOS dışı ya da `kapali`). `sahte:` yalnız geçici dizindeki bekçi betiği. */
export function kasaKomutu(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): string | null {
  const s = env[KASA_ORTAM] ?? "";
  if (s === "kapali") return null;
  if (s.startsWith("sahte:")) {
    const yol = s.slice("sahte:".length);
    let gercek: string;
    try {
      gercek = realpathSync(yol);
    } catch {
      throw new CliError(`${KASA_ORTAM}=sahte:… betiği bulunamadı`);
    }
    if (!isAbsolute(yol) || !gercek.startsWith(`${realpathSync(tmpdir())}${sep}`)) {
      throw new CliError(`${KASA_ORTAM}=sahte:… yalnız geçici dizindeki bir betik olabilir (bekçi)`);
    }
    return gercek;
  }
  if (s !== "") throw new CliError(`${KASA_ORTAM}: yalnız 'kapali' ya da 'sahte:<geçici dizindeki betik>' olabilir`);
  return platform === "darwin" ? KASA_KOMUTU : null;
}

/** `tkp1:<hex>` → NFC Buffer; biçim tanınmazsa değer basılmadan RED. */
export function kasaCoz(out: Buffer, hizmet: string): Buffer {
  let end = out.length;
  while (end > 0 && (out[end - 1] === 0x0a || out[end - 1] === 0x0d)) end--;
  const text = out.subarray(0, end).toString("latin1");
  const hex = text.startsWith(KASA_BICIM) ? text.slice(KASA_BICIM.length) : "";
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) {
    throw new CliError(`${hizmet}: kayıt biçimi tanınmadı (değer basılmadı) — ${KAYIT_KOMUTU} ${hizmet.slice(KASA_ONEK.length)} ile yeniden kaydet`);
  }
  const raw = Buffer.from(hex, "hex");
  const nfc = Buffer.from(raw.toString("utf8").normalize("NFC"), "utf8");
  raw.fill(0);
  return nfc;
}

/** Kasadan oku: Buffer (çağıran sıfırlar) · null (kapalı ya da kayıt yok); komut başarısızsa değer basılmadan RED. */
export function kasadanOku(ad: KasaAdi, env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const hizmet = `${KASA_ONEK}${ad}`;
  const komut = kasaKomutu(env);
  if (!komut) return null;
  const r = spawnSync(komut, ["find-generic-password", "-s", hizmet, "-a", KASA_HESAP, "-w"], { stdio: ["ignore", "pipe", "pipe"], env, maxBuffer: 64 * 1024, timeout: 30_000 });
  try {
    if (r.error) throw new CliError(`Anahtar Zinciri komutu çalışmadı (${hizmet})`);
    if (r.status === KASA_BULUNAMADI) return null;
    if (r.status !== 0) throw new CliError(`Anahtar Zinciri okunamadı (${hizmet}; security çıkış ${r.status ?? r.signal}) — Anahtar Zinciri kilitliyse Mac oturumunu açıp yeniden dene`);
    return kasaCoz(r.stdout, hizmet);
  } finally {
    r.stdout?.fill(0);
    r.stderr?.fill(0);
  }
}
