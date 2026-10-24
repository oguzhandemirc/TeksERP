import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, Copy, ExternalLink } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFactory } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { printErrorHint } from "@/lib/print-error-hints";
import {
  PRINT_OUTPUT_LABELS,
  PRINT_SOURCE_LABELS,
  PRINT_TONE_CLASS,
  PRINT_TRANSPORT_LABELS,
  isLegacyClientRow,
  printDeviceText,
  printPrinterText,
  printStatusView,
  printSubjectText,
  printUserText,
} from "@/lib/print-job-format";
import { printHistoryService, type PrintJobRow } from "@/services/printHistoryService";

interface Props {
  jobId: string | null;
  onClose: () => void;
}

/** Kayda git: yalnız kendi detay rotası olan tablolar (top/çuval listede açılır → numara kopyalanır). */
export function subjectRoute(job: Pick<PrintJobRow, "subjectTable" | "subjectId">): string | null {
  if (!job.subjectId) return null;
  switch (job.subjectTable) {
    case "work_orders":
      return `/operations/work-orders/${job.subjectId}`;
    case "shipments":
      return `/operations/shipments/${job.subjectId}`;
    case "label_templates":
      return `/definitions/label-templates/${job.subjectId}`;
    case "users":
      return `/access/users/${job.subjectId}`;
    default:
      return null;
  }
}

export function PrintJobDetailSheet({ jobId, onClose }: Props) {
  const query = useQuery({
    queryKey: ["print-job", jobId],
    queryFn: () => printHistoryService.get(jobId!),
    enabled: !!jobId,
    staleTime: 60_000,
  });
  const job = query.data;

  return (
    <Sheet open={!!jobId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Baskı ayrıntısı</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {query.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : query.isError || !job ? (
            <p className="text-sm text-muted-foreground">Basım kaydı bulunamadı ya da okunamadı.</p>
          ) : (
            <DetailBody job={job} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({ job }: { job: PrintJobRow }) {
  const view = printStatusView(job);
  const route = subjectRoute(job);
  const hint = job.status === "HATA" ? printErrorHint(job.errorCode, job.errorMessage) : null;
  const requestId = typeof job.meta?.requestId === "string" ? job.meta.requestId : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={cn("shrink-0", PRINT_TONE_CLASS[view.tone])}>
          {view.label}
        </Badge>
        {view.flag && (
          <Badge variant="outline" className={PRINT_TONE_CLASS.simulated}>
            {view.flag}
          </Badge>
        )}
        {job.isReprint && <Badge variant="secondary">Yeniden basım</Badge>}
        {isLegacyClientRow(job) && <Badge variant="secondary">Eski istemci</Badge>}
      </div>

      {hint && (
        <div className="rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-800 dark:text-red-200">
          <div className="flex items-start gap-2 font-medium">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{hint.neden}</span>
          </div>
          <p className="mt-1 pl-6">{hint.ipucu}</p>
          {job.errorMessage && job.errorMessage !== hint.neden && (
            <p className="mt-1 pl-6 text-xs opacity-80">İleti: {job.errorMessage}</p>
          )}
        </div>
      )}

      <dl className="space-y-2 rounded-md border bg-card/40 p-3 text-sm">
        <Row label="Zaman">{formatFactory(job.createdAt, "dd.MM.yyyy HH:mm:ss")}</Row>
        <Row label="Kim">{printUserText(job)}</Row>
        <Row label="Ne basıldı">
          <span className="flex flex-wrap items-center gap-2">
            {printSubjectText(job)}
            {route && (
              <Link to={route} className="inline-flex items-center gap-1 text-primary hover:underline">
                Kayda git <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </span>
        </Row>
        <Row label="Kopya">{job.copies}</Row>
        <Row label="Nereden">
          {printDeviceText(job)} · {PRINT_SOURCE_LABELS[job.source] ?? job.source}
          {job.appVersion ? ` · sürüm ${job.appVersion}` : ""}
        </Row>
        <Row label="Çıktı">{PRINT_OUTPUT_LABELS[job.outputKind] ?? job.outputKind}</Row>
        <Row label="Yazıcı">{printPrinterText(job)}</Row>
        {job.printerAddress && (
          <Row label="Yazıcı adresi">
            <span className="break-all font-mono text-xs">{job.printerAddress}</span>
          </Row>
        )}
        <Row label="Gönderim yolu">{job.transport ? (PRINT_TRANSPORT_LABELS[job.transport] ?? job.transport) : "—"}</Row>
        {job.language && <Row label="Yazıcı dili">{job.language}</Row>}
        <Row label="Süre">{job.durationMs != null ? `${job.durationMs} ms` : "—"}</Row>
        <Row label="Boyut">{job.bytes != null ? `${job.bytes.toLocaleString("tr-TR")} bayt` : "—"}</Row>
        {job.errorCode && (
          <Row label="Hata kodu">
            <span className="font-mono text-xs">{job.errorCode}</span>
          </Row>
        )}
        {requestId && (
          <Row label="İşlem no">
            <CopyText text={requestId} />
          </Row>
        )}
        <Row label="Kayıt no">
          <CopyText text={job.id} />
        </Row>
      </dl>
    </>
  );
}

function CopyText({ text }: { text: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="truncate font-mono text-xs">{text}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        aria-label="Kopyala"
        onClick={() => void navigator.clipboard?.writeText(text)}
      >
        <Copy className="h-3 w-3" />
      </Button>
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
