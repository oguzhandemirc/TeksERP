// Toplu "PDF Kaydet" ilerlemesi: ana süreç her yazılan belgeden sonra gönderir,
// preload yükü yeniden doğrular (yalnız iki tam sayı geçer).

export const PDF_BATCH_PROGRESS_CHANNEL = "pdf:batch-progress";

export interface PdfBatchProgress {
  /** Yazılan belge sayısı. */
  done: number;
  /** Toplu işteki belge sayısı. */
  total: number;
}

export function parsePdfBatchProgress(payload: unknown): PdfBatchProgress | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { done, total } = payload as Record<string, unknown>;
  if (!Number.isSafeInteger(done) || !Number.isSafeInteger(total)) return null;
  const d = done as number;
  const t = total as number;
  return d >= 0 && t > 0 && d <= t ? { done: d, total: t } : null;
}

export function pdfBatchProgressText(p: PdfBatchProgress): string {
  return `PDF'ler hazırlanıyor… ${p.done}/${p.total}`;
}
