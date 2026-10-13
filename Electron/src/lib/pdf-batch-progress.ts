import { toast } from "sonner";
import type { PdfApi } from "@shared/ipc-contract";
import { pdfBatchProgressText } from "@shared/pdf-progress";

/**
 * Toplu "PDF Kaydet" süresince "n/N" yükleme bildirimi gösterir (ana süreç her yazılan
 * belgeden sonra olay yollar). Eski preload'da olay yoksa yalnız başlangıç metni kalır.
 */
export async function withPdfBatchProgress<T>(pdfApi: PdfApi, total: number, run: () => Promise<T>): Promise<T> {
  const id = `pdf-batch-${Date.now()}`;
  toast.loading(pdfBatchProgressText({ done: 0, total }), { id });
  const off = pdfApi.onBatchProgress?.((p) => toast.loading(pdfBatchProgressText(p), { id }));
  try {
    return await run();
  } finally {
    off?.();
    toast.dismiss(id);
  }
}
