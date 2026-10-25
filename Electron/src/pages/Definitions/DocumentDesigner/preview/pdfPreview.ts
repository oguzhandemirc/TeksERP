import { IS_ELECTRON } from "@/lib/runtime-env";
import { printAsPdf } from "@/lib/web-pdf";

export type PdfPreviewOutcome =
  | { kind: "viewer" }
  | { kind: "fallback"; pages: number | null }
  | { kind: "web" }
  | { kind: "error"; message: string };

/** pdf-lib (zaten bağımlılık) yalnız yedek yolda, tembel parçada yüklenir. */
export async function pdfPageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    return (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
  } catch {
    return null;
  }
}

/**
 * PDF önizleme: Electron'da `pdf:preview` (pdf:save ile aynı çizim kapısı) → görüntüleyici
 * penceresi; açılamazsa yedek (sayfa sayısı + "PDF Kaydet"). Web'de yazdır penceresi.
 */
export async function openPdfPreview(html: string, title: string, docType: string): Promise<PdfPreviewOutcome> {
  if (!IS_ELECTRON) {
    printAsPdf(html, { kind: "TEST", docType });
    return { kind: "web" };
  }
  const res = await window.api.pdf.preview({ html, title });
  if (!res.ok || !res.bytes) return { kind: "error", message: res.error ?? "PDF önizlemesi oluşturulamadı" };
  if (res.viewer) return { kind: "viewer" };
  return { kind: "fallback", pages: await pdfPageCount(res.bytes) };
}
