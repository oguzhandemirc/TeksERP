// Tarama okuma durumu bandı: READ_FAILED → kırmızı + neden + "Yeniden okut"; PENDING/READING → "okunuyor";
// PDF (K6) → okuma yok, satırlar elle/Excel. READ sayfa yalnız kendisinden satır çıkmadıysa band çizer.
import { useMutation } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requeueScan } from "./service";
import { errorCode } from "./approveFlow";
import { PDF_MIME, PDF_NOT_READ_TEXT } from "./uploadPrep";
import type { DeliveryNoteLine, DocumentScanInfo } from "./types";
import { scanBannerRows } from "./scanBanner";

export { readWithoutLines } from "./scanBanner";

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
  SERVER_OCR_DISABLED: "Bilgisayarda ikinci okuma kapalı; sayfa yeniden okutulamaz. Fotoğrafı yeniden çekin ya da satırları elle girin.",
};

/** Ayar kapalıyken düşen sayfa: cihaz okuyamadı, sunucu devralmadı (künyede ayrım yok; ayar detaydan gelir). */
export const SERVER_OCR_OFF_FAIL_TEXT = "Tablet okuyamadı; bilgisayarda ikinci okuma kapalı. Fotoğrafı yeniden çekin ya da satırları elle girin.";

function rereadErrorText(error: unknown): string {
  const c = errorCode(error);
  if (c && REREAD_ERROR_TEXT[c]) return REREAD_ERROR_TEXT[c];
  const msg = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof msg === "string" ? msg : "Yeniden okuma başlatılamadı.";
}

interface Props {
  scans: DocumentScanInfo[];
  canRequeue: boolean;
  onRequeued: () => void;
  /** Taslak satırları — "okundu ama satır çıkmadı" sayfasını bulmak için. */
  lines?: DeliveryNoteLine[];
  /** Taslak düzenlenebilir mi (READ sayfa yalnız taslakta yeniden okunur). */
  editable?: boolean;
  /** "Bilgisayarda ikinci okuma" kapalı (detay `serverOcrEnabled === false`): Yeniden okut yerine yeniden çek. */
  serverOcrOff?: boolean;
  /** Detayın "Dikkat" kutusu: her sayfa tek satır, kutusuz. */
  compact?: boolean;
}

interface BandRow {
  id: string;
  testId: string;
  tone: "warn" | "info" | "danger" | "muted";
  strong?: string;
  text: string;
  action?: { label: string; onClick: () => void };
}

const BOX_TONE: Record<BandRow["tone"], string> = {
  warn: "rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  info: "rounded border border-sky-300 bg-sky-50 px-3 py-2 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200",
  danger: "rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-destructive",
  muted: "rounded border bg-muted/40 px-3 py-2 text-muted-foreground",
};
const LINE_TONE: Record<BandRow["tone"], string> = {
  warn: "text-amber-900 dark:text-amber-200",
  info: "text-sky-900 dark:text-sky-200",
  danger: "text-destructive",
  muted: "text-muted-foreground",
};

/** `compact`: detayın "Dikkat" kutusunda tek satır (tam metin tooltip'te); kutusuz. */
function BandLine({ row, compact, busy }: { row: BandRow; compact: boolean; busy: boolean }) {
  const full = [row.strong, row.text].filter(Boolean).join(" ");
  return (
    <div
      role={row.tone === "danger" ? "alert" : undefined}
      className={`flex gap-2 text-sm ${compact ? `items-center justify-between ${LINE_TONE[row.tone]}` : `flex-col sm:flex-row sm:items-center sm:justify-between ${BOX_TONE[row.tone]}`}`}
      data-testid={row.testId}
      title={compact ? full : undefined}
    >
      <span className={compact ? "min-w-0 truncate" : "min-w-0"}>
        {row.strong && <strong>{row.strong}</strong>} {row.text}
      </span>
      {row.action && (
        <Button size="sm" variant="outline" className="shrink-0" disabled={busy} onClick={row.action.onClick}>
          <RotateCcw className="mr-1 h-4 w-4" />
          {row.action.label}
        </Button>
      )}
    </div>
  );
}

export function ScanReadBanner({ scans, canRequeue: canRequeueProp, onRequeued, lines, editable = false, serverOcrOff = false, compact = false }: Props) {
  const canRequeue = canRequeueProp && !serverOcrOff;
  const requeue = useMutation({ mutationFn: (id: string) => requeueScan(id), onSuccess: onRequeued });
  const label = (s: DocumentScanInfo) => (scans.length > 1 ? `Sayfa ${s.pageNo}${s.regionNo ? `/${s.regionNo}` : ""}: ` : "");
  const rows = scanBannerRows(scans, lines);
  if (!rows.length) return null;
  // Elle girilmiş satır varsa operatör sayfayı elle karşılamış olabilir → yeniden okuma satır ikiler; düğme yok.
  const canReread = canRequeue && editable && !(lines ?? []).some((l) => l.scanId === null);
  const toRow = (s: DocumentScanInfo): BandRow => {
    const run = () => requeue.mutate(s.id);
    if (s.status === "READ" && s.mimeType !== PDF_MIME) {
      return { id: s.id, testId: "scan-read-empty", tone: "warn", strong: `${label(s)}Sayfa okundu ama bu sayfadan satır çıkmadı.`, text: "Yeniden okutun ya da satırları elle girin.", action: canReread ? { label: "Yeniden oku", onClick: run } : undefined };
    }
    if (s.mimeType === PDF_MIME) return { id: s.id, testId: "scan-pdf-note", tone: "info", text: `${label(s)}${PDF_NOT_READ_TEXT}` };
    if (s.status === "READ_FAILED") {
      return { id: s.id, testId: "scan-read-failed", tone: "danger", strong: `${label(s)}Okunamadı.`, text: serverOcrOff ? SERVER_OCR_OFF_FAIL_TEXT : SCAN_FAIL_TEXT[scanFailCode(s)], action: canRequeue ? { label: "Yeniden okut", onClick: run } : undefined };
    }
    return { id: s.id, testId: "scan-reading", tone: "muted", text: `${label(s)}${s.status === "READING" ? "Okunuyor…" : "Okuma sırasında bekliyor…"} Satırlar okuma bitince taslağa düşer.` };
  };
  return (
    <div className={`flex flex-col ${compact ? "gap-1.5" : "gap-2"}`} data-testid="scan-read-banner">
      {requeue.isError && (
        <p role="alert" className="text-sm text-destructive" data-testid="scan-reread-error">
          {rereadErrorText(requeue.error)}
        </p>
      )}
      {rows.map((s) => (
        <BandLine key={s.id} row={toRow(s)} compact={compact} busy={requeue.isPending} />
      ))}
    </div>
  );
}
