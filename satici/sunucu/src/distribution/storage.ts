// DAĞITIM DEPOSU — dosya gövdeleri diskte (`DOSYA_DIZINI`), derlemeler `DERLEME_DIZINI`de (yalnız okunur).
// Yol her zaman SUNUCU üretir (UUID/sıra); kullanıcının verdiği ad yalnız görünen addır, yola GİRMEZ.
// Tür kararı uzantıdan ve SUNUCUDA verilir (allowlist); istemcinin beyan ettiği MIME yalnız uyuşma denetimidir.
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { VendorError } from "../lib/errors";

/** Uzantı → sunulacak MIME. Tek kaynak: yükleme kapısı ve indirme başlığı buradan. */
export const FILE_TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  txt: "text/plain",
  log: "text/plain",
  csv: "text/csv",
  json: "application/json",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  zip: "application/zip",
  "7z": "application/x-7z-compressed",
  mp4: "video/mp4",
  exe: "application/vnd.microsoft.portable-executable",
  msi: "application/x-msi",
  apk: "application/vnd.android.package-archive",
  tar: "application/x-tar",
  gz: "application/gzip",
};

/** Yön başına izinli uzantılar: müşteri bize çalıştırılabilir dosya YÜKLEYEMEZ. */
export const INCOMING_EXTENSIONS: readonly string[] = ["pdf", "png", "jpg", "jpeg", "txt", "log", "csv", "json", "xlsx", "xls", "docx", "zip", "7z", "mp4"];
export const OUTGOING_EXTENSIONS: readonly string[] = [...INCOMING_EXTENSIONS, "exe", "msi", "apk", "tar", "gz"];
/** İlk kurulum derlemesi (panel/tablet kurulum dosyası, backend paketi, Docker imajı). */
export const BUILD_EXTENSIONS: readonly string[] = ["exe", "msi", "apk", "zip", "tar", "gz"];

const GENERIC_MIMES = new Set(["", "application/octet-stream", "binary/octet-stream"]);
const BUILD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/**
 * Görünen ad + sunucunun MIME kararı. Ad yol parçası taşımaz (son bileşen), denetim karakteri
 * taşımaz; uzantı yönün allowlist'inde olmalı; beyan edilen MIME ya genel ya da eşleşen tür olmalı.
 */
export function vetFile(rawName: string, declaredMime: string | undefined, allowed: readonly string[]): { name: string; mime: string } {
  const base = rawName.split(/[\\/]/).pop() ?? "";
  const name = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!name || name.length > 200 || name === "." || name === "..") throw new VendorError(400, "GOVDE_GECERSIZ", "Dosya adı 1–200 karakter olmalı");
  const ext = extensionOf(name);
  const mime = FILE_TYPES[ext];
  if (!mime || !allowed.includes(ext)) {
    throw new VendorError(415, "DOSYA_TURU_YASAK", `Bu dosya türüne izin yok (.${ext || "?"}); izinli: ${allowed.join(", ")}`);
  }
  const declared = (declaredMime ?? "").trim().toLowerCase();
  if (!GENERIC_MIMES.has(declared) && declared !== mime) {
    throw new VendorError(415, "DOSYA_TURU_YASAK", `Dosya türü uzantıyla uyuşmuyor (${declared} ≠ .${ext})`);
  }
  return { name, mime };
}

export function newBodyKey(): string {
  return `govde/${randomUUID()}`;
}

export function bodyPath(root: string, key: string): string {
  if (!/^govde\/[0-9a-f-]{36}$/.test(key)) throw new Error(`Depo anahtarı biçimsiz: ${key}`);
  return path.join(root, key);
}

export function partDir(root: string, sessionId: string): string {
  return path.join(root, "parca", sessionId);
}

/** Parça dosyası sıra + özetle adlanır: aynı sıraya eşzamanlı gelen FARKLI içerik birbirini ezmez. */
export function partPath(root: string, sessionId: string, index: number, sha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("Parça özeti biçimsiz");
  return path.join(partDir(root, sessionId), `${index}.${sha256}`);
}

/** Derleme adı ASCII + tek bileşen; derleme dizininin DIŞINA çıkamaz. */
export function buildPath(dir: string, name: string): string {
  if (!BUILD_NAME.test(name) || !BUILD_EXTENSIONS.includes(extensionOf(name))) throw new VendorError(400, "GOVDE_GECERSIZ", "Derleme adı biçimsiz ya da türü izinsiz");
  return path.join(dir, name);
}

export interface BuildFile {
  readonly ad: string;
  readonly boyut: number;
  readonly degisti: string;
}

/** Derleme dizinindeki kurulum dosyaları (dizin yoksa boş liste). */
export async function listBuilds(dir: string): Promise<BuildFile[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: BuildFile[] = [];
  for (const ad of names.sort()) {
    if (!BUILD_NAME.test(ad) || !BUILD_EXTENSIONS.includes(extensionOf(ad))) continue;
    const s = await stat(path.join(dir, ad)).catch(() => null);
    if (s?.isFile()) out.push({ ad, boyut: s.size, degisti: s.mtime.toISOString() });
  }
  return out;
}

export async function hashFile(file: string): Promise<{ sha256: string; bytes: number }> {
  const h = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    h.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
  }
  return { sha256: h.digest("hex"), bytes };
}

/** Sayan + özetleyen geçit; tavanı aşan akış 413 ile kesilir (gövde sonuna kadar okunmaz). */
function meter(maxBytes: number, onDone: (sha256: string, bytes: number) => void): Transform {
  const h = createHash("sha256");
  let bytes = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        cb(new VendorError(413, "DOSYA_COK_BUYUK", `Parça beklenen boyutu aşıyor (${maxBytes} bayt)`));
        return;
      }
      h.update(chunk);
      cb(null, chunk);
    },
    flush(cb) {
      onDone(h.digest("hex"), bytes);
      cb();
    },
  });
}

/** Akışı geçici dosyaya yazar, özet/boyut döner; hatada geçici dosya silinir. Hedefe taşımak çağıranın işidir. */
export async function streamToTemp(source: Readable, dir: string, maxBytes: number): Promise<{ tmp: string; sha256: string; bytes: number }> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.gecici-${randomUUID()}`);
  let result = { sha256: "", bytes: 0 };
  try {
    await pipeline(source, meter(maxBytes, (sha256, bytes) => (result = { sha256, bytes })), createWriteStream(tmp, { mode: 0o600, flags: "wx" }));
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  return { tmp, ...result };
}

export async function moveInto(tmp: string, dest: string): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
  await rename(tmp, dest);
}

/** Parçaları sırayla tek gövdeye birleştirir (özet birleşik gövdeden); hedef geçici addadır. */
export async function assembleParts(root: string, sessionId: string, parts: readonly { sira: number; sha256: string }[]): Promise<{ tmp: string; sha256: string; bytes: number }> {
  const dir = path.join(root, "govde");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.gecici-${randomUUID()}`);
  const h = createHash("sha256");
  let bytes = 0;
  const out = createWriteStream(tmp, { mode: 0o600, flags: "wx" });
  try {
    for (const p of [...parts].sort((a, b) => a.sira - b.sira)) {
      for await (const chunk of createReadStream(partPath(root, sessionId, p.sira, p.sha256))) {
        h.update(chunk as Buffer);
        bytes += (chunk as Buffer).length;
        if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
      }
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
  } catch (err) {
    out.destroy();
    await rm(tmp, { force: true });
    throw err;
  }
  return { tmp, sha256: h.digest("hex"), bytes };
}

export async function removeQuietly(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true }).catch(() => undefined);
}
