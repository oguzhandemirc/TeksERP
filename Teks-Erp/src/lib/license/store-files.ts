// Lisans deposunun dosya G/Ç ilkeleri: atomik yazım ve "yok ↔ okunamadı" ayrımı. YALNIZ `ENOENT`
// "yok"tur; başka her hata (izin, G/Ç, dosya yerine dizin) OKUNAMADI — yok saymak silmekle eşit
// sayılır: anahtar sessizce yeniden üretilir, belge "hiç yok" sanılırdı.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const MAX_DOC_BYTES = 64 * 1024;

/** Yarım yazım bırakmaz: geçici dosya + fsync + yeniden adlandırma. */
export function writeFileAtomicSync(file: string, data: string | Buffer, mode = 0o600): void {
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  const fd = fs.openSync(tmp, "w", mode);
  try {
    fs.writeSync(fd, typeof data === "string" ? Buffer.from(data, "utf8") : data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  if (process.platform !== "win32") {
    try {
      const dirFd = fs.openSync(path.dirname(file), "r");
      fs.fsyncSync(dirFd);
      fs.closeSync(dirFd);
    } catch {
      /* dizin fsync'i desteklenmiyorsa yeniden adlandırma yine atomiktir */
    }
  }
}

export type FileRead =
  | { readonly kind: "YOK" }
  | { readonly kind: "OKUNAMADI" }
  | { readonly kind: "BOS" }
  | { readonly kind: "BUYUK" }
  | { readonly kind: "METIN"; readonly text: string };

function isMissing(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "ENOENT";
}

export function readFileState(file: string, maxBytes: number): FileRead {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch (err) {
    return isMissing(err) ? { kind: "YOK" } : { kind: "OKUNAMADI" };
  }
  if (!st.isFile()) return { kind: "OKUNAMADI" };
  if (st.size > maxBytes) return { kind: "BUYUK" };
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8").trim();
  } catch (err) {
    return isMissing(err) ? { kind: "YOK" } : { kind: "OKUNAMADI" };
  }
  return text.length > 0 ? { kind: "METIN", text } : { kind: "BOS" };
}

/** Dosya VAR ama okunamadı (izin/G-Ç) — yok sayılmaz. */
const UNREADABLE = Symbol("OKUNAMADI");
type StoredText = string | null | typeof UNREADABLE;

/** Belge metni: boş/aşırı büyük dosya "bozuk"tur (doğrulamada düşer), yok DEĞİL. */
function readDocText(file: string): StoredText {
  const r = readFileState(file, MAX_DOC_BYTES);
  if (r.kind === "YOK") return null;
  if (r.kind === "OKUNAMADI") return UNREADABLE;
  return r.kind === "METIN" ? r.text : "bozuk";
}

/** Okunamayan belge `unreadable` listesine düşer; dönen `null` (doğrulama onu YOK değil OKUNAMADI görür). */
export function readDocField(file: string, unreadable: string[]): string | null {
  const text = readDocText(file);
  if (text === UNREADABLE) {
    unreadable.push(path.basename(file));
    return null;
  }
  return text;
}

/** JSON dosyası: `undefined` yok (ya da okunamadı → listeye) · `null` biçimsiz. */
export function readJsonField(file: string, unreadable: string[]): unknown {
  const text = readDocText(file);
  if (text === UNREADABLE) {
    unreadable.push(path.basename(file));
    return undefined;
  }
  if (text === null) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
