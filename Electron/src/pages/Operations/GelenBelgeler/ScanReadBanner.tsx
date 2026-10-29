// Tarama okuma durumu bandı: READ_FAILED → kırmızı + neden + "Yeniden okut"; PENDING/READING → "okunuyor";
// PDF (K6) → okuma yok, satırlar elle/Excel. READ sayfa band çizmez.
import { useMutation } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requeueScan } from "./service";
import { PDF_MIME, PDF_NOT_READ_TEXT } from "./uploadPrep";
import type { DocumentScanInfo } from "./types";

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

interface Props {
  scans: DocumentScanInfo[];
  canRequeue: boolean;
  onRequeued: () => void;
}

export function ScanReadBanner({ scans, canRequeue, onRequeued }: Props) {
  const requeue = useMutation({ mutationFn: (id: string) => requeueScan(id), onSuccess: onRequeued });
  const label = (s: DocumentScanInfo) => (scans.length > 1 ? `Sayfa ${s.pageNo}${s.regionNo ? `/${s.regionNo}` : ""}: ` : "");
  const rows = scans.filter((s) => s.mimeType === PDF_MIME || s.status !== "READ");
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="scan-read-banner">
      {rows.map((s) => {
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
