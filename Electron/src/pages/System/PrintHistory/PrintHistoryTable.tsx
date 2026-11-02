import { memo } from "react";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFactory, factoryDayKey } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { printErrorHint, type PrintErrorHint } from "@/lib/print-error-hints";
import type { PrintHistoryFilterState } from "@/lib/print-history-query";
import {
  PRINT_TONE_CLASS,
  isLegacyClientRow,
  printDeviceText,
  printPrinterText,
  printStatusView,
  printSubjectText,
  printUserText,
} from "@/lib/print-job-format";
import type { PrintJobRow } from "@/services/printHistoryService";

interface Props {
  items: PrintJobRow[];
  loading: boolean;
  onSelect: (row: PrintJobRow) => void;
  onQuickFilter: (patch: Partial<PrintHistoryFilterState>) => void;
}

export function PrintHistoryTable({ items, loading, onSelect, onQuickFilter }: Props) {
  if (loading && items.length === 0) {
    return (
      <div className="space-y-2 p-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-12 text-center text-sm text-muted-foreground">
        Süzgece uyan baskı kaydı yok.
      </div>
    );
  }
  const today = factoryDayKey();
  return (
    // Dar ekranda tablo üst ListBody içinde yatay kayar (iç kaydırıcı yok → başlık yapışık kalır).
    <div>
      <table className="w-full min-w-[56rem] text-sm">
        <thead>
          <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2 font-medium sm:px-6">Zaman</th>
            <th className="px-3 py-2 font-medium">Kişi</th>
            <th className="px-3 py-2 font-medium">Cihaz</th>
            <th className="px-3 py-2 font-medium">Ne basıldı</th>
            <th className="px-3 py-2 font-medium">Yazıcı</th>
            <th className="px-3 py-2 text-right font-medium">Kopya</th>
            <th className="px-3 py-2 font-medium">Durum</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <PrintRow key={row.id} row={row} today={today} onSelect={onSelect} onQuickFilter={onQuickFilter} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PrintRow = memo(function PrintRow({
  row,
  today,
  onSelect,
  onQuickFilter,
}: {
  row: PrintJobRow;
  today: string;
  onSelect: (row: PrintJobRow) => void;
  onQuickFilter: (patch: Partial<PrintHistoryFilterState>) => void;
}) {
  const view = printStatusView(row);
  const isError = row.status === "HATA";
  const hint = isError ? printErrorHint(row.errorCode, row.errorMessage) : null;
  const sameDay = factoryDayKey(row.createdAt) === today;
  const printerKey = row.outputKind === "PDF" ? null : (row.peripheralDeviceId ?? row.printerName);
  const legacy = isLegacyClientRow(row) && row.outputKind !== "PDF";


  return (
    <>
      <tr
        onClick={() => onSelect(row)}
        data-status={row.status}
        className={cn(
          "cursor-pointer transition-colors hover:bg-accent/40",
          hint ? "bg-red-500/10 hover:bg-red-500/15" : "border-b",
        )}
      >
        <td className="whitespace-nowrap px-4 py-2 font-mono text-xs sm:px-6" title={formatFactory(row.createdAt, "dd.MM.yyyy HH:mm:ss")}>
          {formatFactory(row.createdAt, sameDay ? "HH:mm" : "dd.MM HH:mm")}
        </td>
        <td className="px-3 py-2 text-xs">
          <QuickFilter patch={row.userId ? { userId: row.userId } : null} title="Bu kişinin baskıları" onQuickFilter={onQuickFilter}>
            {printUserText(row)}
          </QuickFilter>
        </td>
        <td className="px-3 py-2 text-xs">
          <QuickFilter patch={row.deviceRefId ? { deviceRefId: row.deviceRefId } : null} title="Bu cihazın baskıları" onQuickFilter={onQuickFilter}>
            {printDeviceText(row)}
          </QuickFilter>
        </td>
        <td className="px-3 py-2">
          <span className="flex items-center gap-1.5">
            <span className="truncate">{printSubjectText(row)}</span>
            {row.isReprint && <Badge variant="secondary" className="shrink-0 text-[10px]">tekrar</Badge>}
          </span>
        </td>
        <td className={cn("px-3 py-2 text-xs", legacy && "italic text-muted-foreground")}>
          <QuickFilter patch={printerKey ? { printer: printerKey } : null} title="Bu yazıcının baskıları" onQuickFilter={onQuickFilter}>
            {printPrinterText(row)}
          </QuickFilter>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{row.copies}</td>
        <td className="whitespace-nowrap px-3 py-2">
          <span className="flex items-center gap-1">
            <Badge variant="outline" className={cn("shrink-0", PRINT_TONE_CLASS[view.tone])}>
              {view.label}
            </Badge>
            {view.flag && (
              <Badge variant="outline" className={cn("shrink-0 text-[10px]", PRINT_TONE_CLASS.simulated)}>
                {view.flag}
              </Badge>
            )}
          </span>
        </td>
      </tr>
      {hint && <ErrorHintRow row={row} hint={hint} onSelect={onSelect} />}
    </>
  );
});

/** Hücre değerine tıklamak o değere süzer (sunucuda) — satır detayını açmaz. */
function QuickFilter({
  patch,
  title,
  onQuickFilter,
  children,
}: {
  patch: Partial<PrintHistoryFilterState> | null;
  title: string;
  onQuickFilter: (patch: Partial<PrintHistoryFilterState>) => void;
  children: React.ReactNode;
}) {
  if (!patch) return <>{children}</>;
  return (
    <button
      type="button"
      className="text-left hover:underline"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onQuickFilter(patch);
      }}
    >
      {children}
    </button>
  );
}

function ErrorHintRow({ row, hint, onSelect }: { row: PrintJobRow; hint: PrintErrorHint; onSelect: (row: PrintJobRow) => void }) {
  return (
    <tr onClick={() => onSelect(row)} className="cursor-pointer border-b bg-red-500/10">
      <td colSpan={7} className="px-4 pb-2 pt-0 text-xs text-red-800 sm:px-6 dark:text-red-200">
        <span className="flex items-start gap-1.5 pl-4">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-medium">{hint.neden}</span> {hint.ipucu}
          </span>
        </span>
      </td>
    </tr>
  );
}
