// İÇERİK DENETİMİ (Bölge 7 B7) — birleşik gövde diske taşınmadan ÖNCE: uzantının vaat ettiği tür baytlarda var mı,
// zip ailesi merkez dizini (bağımlılıksız, elle) girdi sayısı · açık boyut · oran · yol kaçışı açısından makul mü.
// GELEN (müşteri → satıcı) yönde kap içindeki yürütülebilir/betik/iç içe arşiv/makro da reddedilir; GİDEN yönde
// ilk kurulum paketi (iç zip + .exe) meşrudur. Tavanlar gerçek yapıtlardan ölçüldü (arşiv 2026-10-13 B7 notu).
import { open, type FileHandle } from "node:fs/promises";
import { VendorError } from "../lib/errors";

export type Direction = "GELEN" | "GIDEN";

/** Ölçüm 2026-10-13: backend paketi 13.389 girdi / oran 3,2 · APK 1.582 · ilk kurulum zip'i 6. Cömert tavanlar. */
export const ZIP_LIMITS = Object.freeze({
  maxEntries: 100_000,
  maxUncompressed: 32 * 1024 ** 3,
  /** Oran yalnız açık toplam bu eşiği geçince ölçülür (küçük, iyi sıkışan günlük zip'i serbest). */
  ratioFloor: 256 * 1024 ** 2,
  maxRatio: 100,
  /** Merkez dizini bellekte okunur; 100k girdi × ~300 bayt üstü kuşkulu. */
  maxCentralDir: 64 * 1024 ** 2,
});

/** GELEN kapta yasak girdi uzantıları: Windows/Unix yürütülebilir + betik + kısayol + iç içe arşiv + makrolu ofis. */
const INCOMING_FORBIDDEN_ENTRY = new Set([
  "exe", "msi", "msp", "dll", "sys", "scr", "com", "cpl", "pif", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse",
  "wsf", "wsh", "hta", "lnk", "url", "reg", "inf", "jar", "apk", "appx", "msix", "sh", "elf", "so", "dylib", "app",
  "zip", "7z", "rar", "iso", "img", "vhd", "vhdx", "cab", "tar", "gz", "tgz", "xz", "bz2",
  "docm", "xlsm", "pptm", "dotm", "xltm", "xlam", "ppam",
]);

const ZIP_FAMILY = new Set(["zip", "docx", "xlsx", "apk"]);
const TEXT_TYPES = new Set(["txt", "log", "csv", "json"]);
const CFB = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const MAGIC: Readonly<Record<string, (h: Buffer) => boolean>> = {
  pdf: (h) => h.subarray(0, 1024).includes("%PDF-"),
  png: (h) => h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpg: (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff,
  jpeg: (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff,
  xls: (h) => h.subarray(0, 8).equals(CFB),
  msi: (h) => h.subarray(0, 8).equals(CFB),
  "7z": (h) => h.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])),
  mp4: (h) => h.subarray(4, 8).toString("latin1") === "ftyp",
  exe: (h) => h[0] === 0x4d && h[1] === 0x5a,
  gz: (h) => h[0] === 0x1f && h[1] === 0x8b,
  tar: (h) => h.subarray(257, 262).toString("latin1") === "ustar",
};
/** Metin türü bu imzalarla başlıyorsa kılık değiştirmiş ikilidir. */
const BINARY_SIGNATURES = [Buffer.from("MZ"), Buffer.from("PK\x03\x04", "latin1"), Buffer.from([0x7f, 0x45, 0x4c, 0x46]), CFB, Buffer.from([0x37, 0x7a, 0xbc, 0xaf])];

function reject(reason: string): never {
  throw new VendorError(415, "DOSYA_TURU_YASAK", `Dosya içeriği kabul edilmedi: ${reason}`);
}

async function readAt(fh: FileHandle, pos: number, len: number): Promise<Buffer> {
  const buf = Buffer.alloc(len);
  const { bytesRead } = await fh.read(buf, 0, len, pos);
  return buf.subarray(0, bytesRead);
}

function vetText(head: Buffer): void {
  if (BINARY_SIGNATURES.some((s) => head.subarray(0, s.length).equals(s))) reject("metin dosyası ikili imza taşıyor");
  const utf16 = (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff);
  if (!utf16 && head.includes(0)) reject("metin dosyasında NUL baytı var");
}

/** Girdi adı yol kaçışı: mutlak yol, sürücü harfi, `..` bileşeni, NUL. Ters bölü de ayraç sayılır. */
export function entryEscapes(name: string): boolean {
  const n = name.replace(/\\/g, "/");
  return n.includes("\0") || n.startsWith("/") || /^[A-Za-z]:/.test(n) || n.split("/").includes("..");
}

function entryExtension(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1).toLowerCase() : "";
}

interface ZipEntry {
  readonly name: string;
  readonly compressed: number;
  readonly uncompressed: number;
}

/** EOCD → (zip64) → merkez dizini. Biçim bozuksa reddeder (açılmayan arşivi kabul etmenin anlamı yok). */
export async function readZipDirectory(fh: FileHandle, size: number): Promise<ZipEntry[]> {
  const tailLen = Math.min(size, 65_557);
  const tail = await readAt(fh, size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) reject("zip merkez dizini bulunamadı");
  let count = tail.readUInt16LE(eocd + 10);
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locPos = size - tailLen + eocd - 20;
    const loc = locPos >= 0 ? await readAt(fh, locPos, 20) : Buffer.alloc(0);
    if (loc.length < 20 || loc.readUInt32LE(0) !== 0x07064b50) reject("zip64 konum kaydı bozuk");
    const z = await readAt(fh, Number(loc.readBigUInt64LE(8)), 56);
    if (z.length < 56 || z.readUInt32LE(0) !== 0x06064b50) reject("zip64 dizin sonu bozuk");
    count = Number(z.readBigUInt64LE(32));
    cdSize = Number(z.readBigUInt64LE(40));
    cdOffset = Number(z.readBigUInt64LE(48));
  }
  if (count > ZIP_LIMITS.maxEntries) reject(`arşivde ${count} girdi var (tavan ${ZIP_LIMITS.maxEntries})`);
  if (cdSize > ZIP_LIMITS.maxCentralDir || cdOffset + cdSize > size) reject("zip merkez dizini boyutu geçersiz");
  const cd = await readAt(fh, cdOffset, cdSize);
  const out: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) reject("zip merkez dizini girdisi bozuk");
    let compressed = cd.readUInt32LE(p + 20);
    let uncompressed = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const localOffset = cd.readUInt32LE(p + 42);
    if (p + 46 + nameLen + extraLen + commentLen > cd.length) reject("zip merkez dizini girdisi taşıyor");
    const name = cd.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    // zip64 ek alanı: yalnız 0xFFFFFFFF olan alanlar sırayla burada (açık · sıkışık · konum).
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = cd.readUInt16LE(e);
      const len = cd.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        const qEnd = e + 4 + len;
        if (uncompressed === 0xffffffff && q + 8 <= qEnd) {
          uncompressed = Number(cd.readBigUInt64LE(q));
          q += 8;
        }
        if (compressed === 0xffffffff && q + 8 <= qEnd) compressed = Number(cd.readBigUInt64LE(q));
      }
      e += 4 + len;
    }
    if (localOffset !== 0xffffffff && localOffset >= cdOffset) reject("zip girdisi merkez dizinine taşıyor");
    out.push({ name, compressed, uncompressed });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function vetZipEntries(entries: readonly ZipEntry[], fileSize: number, ext: string, direction: Direction): void {
  let totalOpen = 0;
  let totalPacked = 0;
  for (const en of entries) {
    if (entryEscapes(en.name)) reject("arşiv girdisi klasör dışına yol taşıyor");
    totalOpen += en.uncompressed;
    totalPacked += en.compressed;
    if (direction === "GELEN") {
      const x = entryExtension(en.name);
      if (INCOMING_FORBIDDEN_ENTRY.has(x)) reject(`arşivde izinsiz dosya türü var (.${x}); yürütülebilir, betik ya da iç içe arşiv gönderilemez`);
      if (/(^|\/)vbaProject\.bin$/i.test(en.name.replace(/\\/g, "/"))) reject("belgede makro var");
    }
  }
  // Örtüşen girdiler (tek sıkışık blok çok kez sayılır) ya da yalan boyut: sıkışık toplam dosyayı aşamaz.
  if (totalPacked > fileSize) reject("arşiv girdileri dosya boyutunu aşıyor (örtüşen girdi)");
  if (totalOpen > ZIP_LIMITS.maxUncompressed) reject("arşivin açık boyutu tavanı aşıyor");
  if (totalOpen > ZIP_LIMITS.ratioFloor && totalOpen > ZIP_LIMITS.maxRatio * Math.max(fileSize, 1)) {
    reject(`sıkıştırma oranı tavanı aşıldı (> ${ZIP_LIMITS.maxRatio}×)`);
  }
  if ((ext === "docx" || ext === "xlsx") && !entries.some((en) => en.name === "[Content_Types].xml")) reject("ofis belgesi yapısı yok");
}

/** Birleşik gövdenin içeriği uzantısıyla ve yönüyle uyumlu mu; değilse 415 `DOSYA_TURU_YASAK`. */
export async function vetContent(file: string, ext: string, direction: Direction): Promise<void> {
  const fh = await open(file, "r");
  try {
    const size = (await fh.stat()).size;
    const head = await readAt(fh, 0, 64 * 1024);
    if (TEXT_TYPES.has(ext)) return vetText(head);
    if (ZIP_FAMILY.has(ext)) {
      const sig = head.subarray(0, 4).toString("latin1");
      if (sig !== "PK\x03\x04" && sig !== "PK\x05\x06") reject(`.${ext} zip imzası taşımıyor`);
      return vetZipEntries(await readZipDirectory(fh, size), size, ext, direction);
    }
    const magic = MAGIC[ext];
    if (!magic) reject(`.${ext} için içerik denetimi tanımlı değil`);
    if (!magic(head)) reject(`içerik .${ext} türüne uymuyor`);
  } finally {
    await fh.close();
  }
}
