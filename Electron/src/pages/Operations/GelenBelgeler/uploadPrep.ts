// =============================================================================
// Panelden belge yükleme — saf hazırlık: tür, küçültme, özet, base64, aynı dosya (tablet emsali `docScan.ts`)
// =============================================================================
// Büyük görüntü tarayıcıda canvas ile uzun kenar 2600 px'e, JPEG 0,8'e iner (K4; tabletin çekim boyu).
// Küçük dosya DOKUNULMAZ (özeti değişmesin). PDF arşivdir (K6): küçültülmez, okunmaz. Sunucu tavanı 5 MB.
// Görüntü çözücü enjekte edilir — test canvas'sız koşar.
// =============================================================================

export const TARGET_LONG_EDGE_PX = 2600;
export const JPEG_QUALITY = 0.8;
/** Sunucu `DOCUMENT_SCAN_MAX_BYTES` ikizi (DB CHECK `document_scans_size_ck`). */
export const MAX_SCAN_BYTES = 5 * 1024 * 1024;
/** Tek gönderimde sayfa sınırı (tablet ile aynı). */
export const MAX_PAGES = 20;
export const PDF_MIME = "application/pdf";

export type ScanMime = "image/jpeg" | "image/png" | typeof PDF_MIME;

export interface UploadPage {
  name: string;
  mimeType: ScanMime;
  /** Ham bayt base64'ü (önek yok). */
  base64: string;
  sha256: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  resized: boolean;
}

/** Tür beyana değil sihirli bayta bakar — sunucunun `detectCertificateMime` aynası. */
export function detectScanMime(bytes: Uint8Array): ScanMime | null {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46])) return PDF_MIME;
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  return null;
}

/** Uzun kenarı `max`a sığdırır (oran korunur); zaten sığıyorsa `scaled: false`. */
export function fitLongEdge(width: number, height: number, max = TARGET_LONG_EDGE_PX): { width: number; height: number; scaled: boolean } {
  const long = Math.max(width, height);
  if (long <= max) return { width, height, scaled: false };
  const k = max / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)), scaled: true };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Bayt → base64 (parçalı; büyük dosyada `String.fromCharCode(...dev dizi)` yığını taşırır). */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Blob baytları; `arrayBuffer` yoksa (eski motor / jsdom) FileReader. */
export function readBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error ?? new Error("Dosya okunamadı."));
    r.readAsArrayBuffer(blob);
  });
}

export interface ImageCodec {
  /** Görüntünün piksel boyu. */
  size(blob: Blob): Promise<{ width: number; height: number }>;
  /** Verilen boyda JPEG'e yeniden kodlar. */
  toJpeg(blob: Blob, width: number, height: number, quality: number): Promise<Blob>;
}

/** Tarayıcı çözücüsü: `createImageBitmap` + canvas (yeni paket yok). */
export const browserCodec: ImageCodec = {
  async size(blob) {
    const bmp = await createImageBitmap(blob);
    const r = { width: bmp.width, height: bmp.height };
    bmp.close();
    return r;
  },
  async toJpeg(blob, width, height, quality) {
    const bmp = await createImageBitmap(blob);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Tarayıcı görüntüyü küçültemedi (canvas yok).");
      ctx.drawImage(bmp, 0, 0, width, height);
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Görüntü JPEG'e çevrilemedi."))), "image/jpeg", quality),
      );
    } finally {
      bmp.close();
    }
  },
};

export type PrepareOutcome =
  | { kind: "ok"; page: UploadPage }
  | { kind: "too-large"; name: string; sizeBytes: number }
  | { kind: "unsupported"; name: string };

/**
 * Dosyayı gönderilecek sayfaya çevirir. Görüntü yalnız BÜYÜKSE (uzun kenar > 2600 ya da > 5 MB) JPEG 0,8'e
 * yeniden kodlanır; sonuç hâlâ 5 MB üstüyse `too-large` (yükleme yok, sunucu tavanı değişmez).
 */
export async function prepareFile(file: Blob & { name: string }, codec: ImageCodec = browserCodec): Promise<PrepareOutcome> {
  let bytes = await readBytes(file);
  let mime = detectScanMime(bytes);
  if (!mime) return { kind: "unsupported", name: file.name };
  let width: number | null = null;
  let height: number | null = null;
  let resized = false;
  if (mime !== PDF_MIME) {
    const dim = await codec.size(file);
    const fit = fitLongEdge(dim.width, dim.height);
    width = fit.width;
    height = fit.height;
    if (fit.scaled || bytes.length > MAX_SCAN_BYTES) {
      const jpeg = await codec.toJpeg(file, fit.width, fit.height, JPEG_QUALITY);
      bytes = await readBytes(jpeg);
      mime = "image/jpeg";
      resized = true;
    }
  }
  if (bytes.length > MAX_SCAN_BYTES) return { kind: "too-large", name: file.name, sizeBytes: bytes.length };
  return {
    kind: "ok",
    page: { name: file.name, mimeType: mime, base64: bytesToBase64(bytes), sha256: await sha256Hex(bytes), sizeBytes: bytes.length, width, height, resized },
  };
}

/** Listeye ekle: aynı özet bir kez (hem listede olanla hem aynı seçimdeki ikizle); sınır aşılırsa fazlası düşer. */
export function mergePages(current: readonly UploadPage[], incoming: readonly UploadPage[]): { pages: UploadPage[]; duplicates: string[]; dropped: number } {
  const pages = [...current];
  const duplicates: string[] = [];
  let dropped = 0;
  for (const p of incoming) {
    if (pages.some((x) => x.sha256 === p.sha256)) duplicates.push(p.name);
    else if (pages.length >= MAX_PAGES) dropped++;
    else pages.push(p);
  }
  return { pages, duplicates, dropped };
}

/** Seçilen dosyaları hazırlar ve listeye katar; her reddin Türkçe notu döner (yükleme yapılmaz). */
export async function addPickedFiles(current: readonly UploadPage[], files: ReadonlyArray<Blob & { name: string }>, codec: ImageCodec = browserCodec): Promise<{ pages: UploadPage[]; notices: string[] }> {
  const notices: string[] = [];
  const ready: UploadPage[] = [];
  for (const f of files) {
    try {
      const r = await prepareFile(f, codec);
      if (r.kind === "ok") ready.push(r.page);
      else if (r.kind === "too-large") notices.push(`${r.name}: küçültmeden sonra da 5 MB sınırını aşıyor (${formatBytes(r.sizeBytes)}); yüklenmedi.`);
      else notices.push(`${r.name}: yalnız JPEG, PNG ya da PDF yüklenebilir.`);
    } catch (e) {
      notices.push(`${f.name}: ${e instanceof Error ? e.message : "okunamadı"}`);
    }
  }
  const m = mergePages(current, ready);
  for (const d of m.duplicates) notices.push(`${d}: bu dosya zaten listede.`);
  if (m.dropped) notices.push(`Bir gönderimde en çok ${MAX_PAGES} dosya; ${m.dropped} dosya eklenmedi.`);
  return { pages: m.pages, notices };
}

export function hasPdf(pages: readonly UploadPage[]): boolean {
  return pages.some((p) => p.mimeType === PDF_MIME);
}

/** K6 metni — panelin her PDF yüzeyi bunu yazar. */
export const PDF_NOT_READ_TEXT = "PDF otomatik okunmaz — satırları elle ya da Excel'le girin.";

export function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}
