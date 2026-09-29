// Bütünlük LİSTE DOSYASI (`butunluk-liste.txt`) ve kapsam yürüyüşü. İmzalı yük (`butunluk.jws`)
// yalnız bu dosyanın boyunu + sha256'sını taşır; liste JWS 32 KB tavanına takılmadan node_modules'u
// ve migration SQL'ini kapsar. Biçim kanonik ve satır tabanlı — TS ile Rust (`integrity.rs`) aynı
// dilbilgisini ayrıştırır, JSON ayrıştırıcı farkı doğmaz. Biçim kararı: docs/design/LISANS-KOD-KORUMA.md.
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

/** Paket kökündeki liste dosyası (imzasız; bütünlüğü imzalı yükteki sha256'dan). */
export const INTEGRITY_LIST_FILE = "butunluk-liste.txt";
export const INTEGRITY_MAX_FILES = 200_000;
export const INTEGRITY_MAX_LIST_BYTES = 64 * 1024 * 1024;
export const INTEGRITY_PATH_MAX = 512;

export interface IntegrityListEntry {
  readonly yol: string;
  readonly sha256: string;
  readonly boyut: number;
}

// Satır: `<sha256 base64url>\t<boyut>\t<yol>\n`. Yol segmenti yazdırılabilir ASCII; `/ \ : * ? " < > |`
// yok (Windows adı olamaz ya da ayraçtır). node_modules'te boşluklu ad var — boşluk serbest.
const LINE = /^([A-Za-z0-9_-]{43})\t(0|[1-9][0-9]{0,15})\t([\x20-\x7E]+)$/;
const LIST_PATH = /^[\x20\x21\x23-\x29\x2B-\x2E\x30-\x39\x3B\x3D\x40-\x5B\x5D-\x7B\x7D\x7E]+(?:\/[\x20\x21\x23-\x29\x2B-\x2E\x30-\x39\x3B\x3D\x40-\x5B\x5D-\x7B\x7D\x7E]+)*$/;

/** Liste yolu: göreli POSIX, `.`/`..` segmenti yok, ≤ 512. */
export function isListPath(p: string): boolean {
  return p.length <= INTEGRITY_PATH_MAX && LIST_PATH.test(p) && p.split("/").every((s) => s !== "." && s !== "..");
}

/** Bayt sırası karşılaştırması (Rust `String` sırası; ASCII'de UTF-16 sırasıyla aynı). */
export function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Kanonik listeyi ayrıştırır: yalnız ASCII + TAB + LF, son satır LF'yle biter, yollar bayt sırasıyla
 * KESİN artan (tekrar yok), satır sayısı imzalı `dosyaSayisi`na eşit. Biçimsizse null.
 */
export function parseIntegrityList(bytes: Buffer, expectedCount: number): IntegrityListEntry[] | null {
  if (bytes.length === 0 || bytes[bytes.length - 1] !== 0x0a) return null;
  for (const c of bytes) if (c !== 0x09 && c !== 0x0a && (c < 0x20 || c > 0x7e)) return null;
  const lines = bytes.toString("latin1").slice(0, -1).split("\n");
  if (lines.length !== expectedCount || lines.length > INTEGRITY_MAX_FILES) return null;
  const out: IntegrityListEntry[] = [];
  let prev: string | null = null;
  for (const line of lines) {
    const m = LINE.exec(line);
    if (!m) return null;
    const boyut = Number(m[2]);
    const yol = m[3];
    if (!Number.isSafeInteger(boyut) || !isListPath(yol)) return null;
    if (prev !== null && byteOrder(prev, yol) >= 0) return null;
    prev = yol;
    out.push({ yol, sha256: m[1], boyut });
  }
  return out;
}

/** Kanonik liste baytları (girdi herhangi sırada; çıktı bayt sırasıyla). Yol biçimsizse fırlatır. */
export function formatIntegrityList(entries: readonly IntegrityListEntry[]): Buffer {
  const sorted = [...entries].sort((a, b) => byteOrder(a.yol, b.yol));
  for (const e of sorted) if (!isListPath(e.yol)) throw new Error(`liste yolu biçimsiz: ${JSON.stringify(e.yol)}`);
  return Buffer.from(sorted.map((e) => `${e.sha256}\t${e.boyut}\t${e.yol}\n`).join(""), "latin1");
}

export interface IntegrityScope {
  readonly dizinler: readonly string[];
  readonly dosyalar: readonly string[];
}

export interface ScopeWalk {
  /** Kapsamda diskte duran her girdi (dosya; sembolik bağ İZLENMEZ, kendisi girdi sayılır). */
  readonly entries: string[];
  /** Okunamayan dizinler (içi görülemedi — fazla dosya gizlenebilir). */
  readonly unreadable: string[];
}

function isNotFound(e: unknown): boolean {
  return e instanceof Error && "code" in e && (e.code === "ENOENT" || e.code === "ENOTDIR");
}

async function walkDir(root: string, rel: string, out: ScopeWalk): Promise<void> {
  let entries;
  try {
    entries = await readdir(path.join(root, ...rel.split("/")), { withFileTypes: true });
  } catch {
    out.unreadable.push(rel);
    return;
  }
  for (const e of entries) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) await walkDir(root, child, out);
    else out.entries.push(child);
  }
}

/** Kapsam dizinlerinin altındaki + kapsam dosyalarından diskte olan her girdi (bayt sırasıyla). */
export async function walkIntegrityScope(root: string, scope: IntegrityScope): Promise<ScopeWalk> {
  const out: ScopeWalk = { entries: [], unreadable: [] };
  for (const rel of [...scope.dizinler, ...scope.dosyalar]) {
    let info;
    try {
      info = await lstat(path.join(root, ...rel.split("/")));
    } catch (e) {
      if (!isNotFound(e)) out.unreadable.push(rel);
      continue;
    }
    if (info.isDirectory() && scope.dizinler.includes(rel)) await walkDir(root, rel, out);
    else if (!info.isDirectory()) out.entries.push(rel);
  }
  const uniq = (list: string[]) => [...new Set(list)].sort(byteOrder);
  return { entries: uniq(out.entries), unreadable: uniq(out.unreadable) };
}
