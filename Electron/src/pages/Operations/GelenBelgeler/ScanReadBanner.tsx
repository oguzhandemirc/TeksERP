// Tarama okuma durumu bandı: READ_FAILED → kırmızı + neden + "Yeniden okut"; PENDING/READING → "okunuyor";
// PDF (K6) → okuma yok, satırlar elle/Excel. READ sayfa yalnız kendisinden satır çıkmadıysa band çizer.
import { useMutation } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requeueScan } from "./service";
import { errorCode } from "./approveFlow";
import { PDF_MIME, PDF_NOT_READ_TEXT } from "./uploadPrep";
import type { DeliveryNoteLine, DocumentScanInfo } from "./types";

/** Sunucu `READ_MAX_ATTEMPTS` ikizi: bu kadar denemede düşen tarama "servis yanıt vermedi" sınıfındadır. */
const READ_MAX_ATTEMPTS = 3;

export type ScanFailCode = "PDF" | "RETRIES_EXHAUSTED" | "UNREADABLE";

/**
 * Neden kodu künyeden türer (ayrı kolon yok): PDF → okunmaz; 3 deneme → servis hatası (5xx/zaman aşımı);
 * daha az denemede düşen → servis görüntüyü KALICI reddetti (4xx / şema dışı yanıt).
 */
export function scanFailCode(s: Pick<DocumentScanInfo, "mimeType" | "attempts">): ScanFailCode {
  if (s.mimeType === PDF_MIME) return "PDF";
  return s.attempts >= READ_MAX_ATTEMPTS ? "RETRIES_EXHAUSTED" : "UNREADABLE";
}

export const SCAN_FAIL_TEXT: Record<ScanFailCode, string> = {
  PDF: PDF_NOT_READ_TEXT,
  RETRIES_EXHAUSTED: "Okuma servisi üç denemede yanıt veremedi (servis kapalı ya da hata verdi). Servis düzelince yeniden okutun.",
  UNREADABLE: "Okuma servisi bu görüntüyü reddetti. Yeniden okutun ya da satırları elle girin.",
};

/** Sunucu "yeniden oku" reddinin (`details.code`) operatör dili; bilinmeyen kod sunucu mesajına düşer. */
export const REREAD_ERROR_TEXT: Record<string, string> = {
  DOCUMENT_SCAN_ALREADY_READ: "Bu sayfanın satırları zaten taslakta; yeniden okumak satırları ikilerdi. Sayfayı yenileyin.",
  DELIVERY_NOTE_NOT_DRAFT: "Belge artık taslak değil; okunmuş sayfa yalnız taslakta yeniden okunur.",
  DOCUMENT_SCAN_STATE_CHANGED: "Sayfa bu arada başka bir duruma geçti; sayfayı yenileyin.",
};

function rereadErrorText(error: unknown): string {
  const c = errorCode(error);
  if (c && REREAD_ERROR_TEXT[c]) return REREAD_ERROR_TEXT[c];
  const msg = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof msg === "string" ? msg : "Yeniden okuma başlatılamadı.";
}

/**
 * Okunmuş ama kendisinden satır çıkmamış sayfa. `scanId` göndermeyen eski backend'de (undefined) karar
 * verilemez → band yok; satırlar verilmediyse de yok.
 */
export function readWithoutLines(s: DocumentScanInfo, lines: DeliveryNoteLine[] | undefined): boolean {
  if (!lines || s.status !== "READ" || s.mimeType === PDF_MIME) return false;
  if (lines.some((l) => l.scanId === undefined)) return false;
  return !lines.some((l) => l.scanId === s.id);
}

interface Props {
  scans: DocumentScanInfo[];
  canRequeue: boolean;
  onRequeued: () => void;
  /** Taslak satırları — "okundu ama satır çıkmadı" sayfasını bulmak için. */
  lines?: DeliveryNoteLine[];
  /** Taslak düzenlenebilir mi (READ sayfa yalnız taslakta yeniden okunur). */
  editable?: boolean;
}

export function ScanReadBanner({ scans, canRequeue, onRequeued, lines, editable = false }: Props) {
  const requeue = useMutation({ mutationFn: (id: string) => requeueScan(id), onSuccess: onRequeued });
  const label = (s: DocumentScanInfo) => (scans.length > 1 ? `Sayfa ${s.pageNo}${s.regionNo ? `/${s.regionNo}` : ""}: ` : "");
  const rows = scans.filter((s) => s.mimeType === PDF_MIME || s.status !== "READ" || readWithoutLines(s, lines));
  if (!rows.length) return null;
  // Elle girilmiş satır varsa operatör sayfayı elle karşılamış olabilir → yeniden okuma satır ikiler; düğme yok.
  const canReread = canRequeue && editable && !(lines ?? []).some((l) => l.scanId === null);
  return (
    <div className="flex flex-col gap-2" data-testid="scan-read-banner">
      {requeue.isError && (
        <p role="alert" className="text-sm text-destructive" data-testid="scan-reread-error">
          {rereadErrorText(requeue.error)}
        </p>
      )}
      {rows.map((s) => {
        if (s.status === "READ" && s.mimeType !== PDF_MIME) {
          return (
            <div key={s.id} className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" data-testid="scan-read-empty">
              <span className="min-w-0">
                <strong>{label(s)}Sayfa okundu ama bu sayfadan satır çıkmadı.</strong> Yeniden okutun ya da satırları elle girin.
              </span>
              {canReread && (
                <Button size="sm" variant="outline" className="shrink-0" disabled={requeue.isPending} onClick={() => requeue.mutate(s.id)}>
                  <RotateCcw className="mr-1 h-4 w-4" />
                  Yeniden oku
                </Button>
              )}
            </div>
          );
        }
        if (s.mimeType === PDF_MIME) {
          return (
            <p key={s.id} className="rounded border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200" data-testid="scan-pdf-note">
              {label(s)}{PDF_NOT_READ_TEXT}
            </p>
          );
        }
        if (s.status === "READ_FAILED") {
          return (
            <div key={s.id} role="alert" className="flex flex-col gap-2 rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between" data-testid="scan-read-failed">
              <span className="min-w-0">
                <strong>{label(s)}Okunamadı.</strong> {SCAN_FAIL_TEXT[scanFailCode(s)]}
              </span>
              {canRequeue && (
                <Button size="sm" variant="outline" className="shrink-0" disabled={requeue.isPending} onClick={() => requeue.mutate(s.id)}>
                  <RotateCcw className="mr-1 h-4 w-4" />
                  Yeniden okut
                </Button>
              )}
            </div>
          );
        }
        return (
          <p key={s.id} className="rounded border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" data-testid="scan-reading">
            {label(s)}{s.status === "READING" ? "Okunuyor…" : "Okuma sırasında bekliyor…"} Satırlar okuma bitince taslağa düşer.
          </p>
        );
      })}
    </div>
  );
}
