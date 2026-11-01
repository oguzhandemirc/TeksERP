// HEIC/HEIF (iPhone) yükleme — tür beyana/uzantıya değil `ftyp` ana markasına bakılarak tanınır; dönüşüm okuma
// servisinde (`POST /donustur`, pi-heif), sistem JPEG saklar. FAIL-CLOSED: servis yok/eski/ulaşılamaz → 503
// `HEIC_CONVERT_UNAVAILABLE`, bozuk dosya → 400 `HEIC_CONVERT_FAILED`; hata yolunda hiçbir şey yazılmaz.
import { AppError } from "../../utils/app-error";
import { readerConvert } from "./okuma-istemcisi";
import { getReaderUrl } from "./url";

/** okuma `app/donustur.py` `HEIF_MARKALARI` ikizi — AVIF bilerek yok (servisin çözücüsü kurulu değil). */
const HEIF_BRANDS: ReadonlySet<string> = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

/** ISO-BMFF: bayt 4–8 `ftyp`, 8–12 ana marka. */
export function isHeic(buf: Uint8Array): boolean {
  if (buf.length < 12) return false;
  const ascii = (a: number, b: number) => String.fromCharCode(...buf.subarray(a, b));
  return ascii(4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(8, 12));
}

const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;

function unavailable(reason: string): AppError {
  return new AppError("HEIC fotoğraf şu an JPEG'e çevrilemiyor: okuma servisi kapalı ya da güncel değil. JPEG olarak yükleyin ya da sonra deneyin.", 503, true, {
    code: "HEIC_CONVERT_UNAVAILABLE",
    reason,
  });
}

/** HEIC baytı → JPEG baytı; boy tavanını çağıran (dönüşüm SONRASI) uygular. */
export async function convertHeicToJpeg(content: Buffer): Promise<Buffer> {
  const { url } = getReaderUrl();
  if (!url) throw unavailable("READER_URL_MISSING");
  const r = await readerConvert(url, content);
  if (!r.ok) {
    // 4xx yalnız "dosya çözülemedi/tür değil/çok büyük"tür; 404 eski okuma sürümüdür (uç yok) → servis "yok" sayılır.
    if (r.kind === "HTTP" && r.status === 413) {
      throw new AppError("HEIC fotoğraf çok büyük (5 MB / piksel sınırı).", 413, true, { code: "DOCUMENT_SCAN_TOO_LARGE" });
    }
    if (r.kind === "HTTP" && r.status !== 404) {
      throw AppError.badRequest("HEIC dosyası çözülemedi (bozuk ya da desteklenmeyen HEIF).", { code: "HEIC_CONVERT_FAILED" });
    }
    throw unavailable(r.code);
  }
  if (!JPEG_MAGIC.every((b, i) => r.content[i] === b)) throw unavailable("CONVERT_RESULT_NOT_JPEG");
  return r.content;
}
