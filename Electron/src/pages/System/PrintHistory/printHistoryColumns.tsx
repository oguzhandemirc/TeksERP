// Yazdırma geçmişi — ortak DataTable sütunları. Kişi/cihaz/yazıcı değerine tık o değere SUNUCUDA süzer (satırı açmaz).
import { useMemo, useRef, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { useLocalTable } from "@/hooks/useLocalTable";
import { formatFactory, factoryDayKey } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
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

type QuickFilterFn = (patch: Partial<PrintHistoryFilterState>) => void;

/** Hücre değerine tıklamak o değere süzer (sunucuda) — satır detayını açmaz. */
function QuickFilter({ patch, title, onQuickFilter, children }: { patch: Partial<PrintHistoryFilterState> | null; title: string; onQuickFilter: { current: QuickFilterFn }; children: ReactNode }) {
  if (!patch) return <>{children}</>;
  return (
    <button
      type="button"
      className="max-w-full truncate text-left hover:underline"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onQuickFilter.current(patch);
      }}
    >
      {children}
    </button>
  );
}

const printerKey = (r: PrintJobRow) => (r.outputKind === "PDF" ? null : (r.peripheralDeviceId ?? r.printerName));
const statusText = (r: PrintJobRow) => {
  const v = printStatusView(r);
  return v.flag ? `${v.label} · ${v.flag}` : v.label;
};

function printHistoryColumns(today: string, onQuickFilter: { current: QuickFilterFn }): ColumnDef<PrintJobRow>[] {
  return [
    {
      id: "createdAt",
      header: "Zaman",
      size: 110,
      meta: { label: "Zaman", exportValue: (r) => formatFactory(r.createdAt, "dd.MM.yyyy HH:mm:ss") },
      cell: ({ row: { original: r } }) => (
        <span className="font-mono text-xs" title={formatFactory(r.createdAt, "dd.MM.yyyy HH:mm:ss")}>
          {formatFactory(r.createdAt, factoryDayKey(r.createdAt) === today ? "HH:mm" : "dd.MM HH:mm")}
        </span>
      ),
    },
    {
      id: "user",
      header: "Kişi",
      meta: { label: "Kişi", exportValue: printUserText },
      cell: ({ row: { original: r } }) => (
        <span className="text-xs">
          <QuickFilter patch={r.userId ? { userId: r.userId } : null} title="Bu kişinin baskıları" onQuickFilter={onQuickFilter}>{printUserText(r)}</QuickFilter>
        </span>
      ),
    },
    {
      id: "device",
      header: "Cihaz",
      meta: { label: "Cihaz", exportValue: printDeviceText },
      cell: ({ row: { original: r } }) => (
        <span className="text-xs">
          <QuickFilter patch={r.deviceRefId ? { deviceRefId: r.deviceRefId } : null} title="Bu cihazın baskıları" onQuickFilter={onQuickFilter}>{printDeviceText(r)}</QuickFilter>
        </span>
      ),
    },
    {
      id: "subject",
      header: "Ne basıldı",
      size: 280,
      meta: { label: "Ne basıldı", exportValue: (r) => `${printSubjectText(r)}${r.isReprint ? " (tekrar)" : ""}` },
      cell: ({ row: { original: r } }) => (
        <span className="flex items-center gap-1.5">
          <span className="truncate">{printSubjectText(r)}</span>
          {r.isReprint && <Badge variant="secondary" className="shrink-0 text-[10px]">tekrar</Badge>}
        </span>
      ),
    },
    {
      id: "printer",
      header: "Yazıcı",
      meta: { label: "Yazıcı", exportValue: printPrinterText },
      cell: ({ row: { original: r } }) => {
        const key = printerKey(r);
        return (
          <span className={cn("text-xs", isLegacyClientRow(r) && r.outputKind !== "PDF" && "italic text-muted-foreground")}>
            <QuickFilter patch={key ? { printer: key } : null} title="Bu yazıcının baskıları" onQuickFilter={onQuickFilter}>{printPrinterText(r)}</QuickFilter>
          </span>
        );
      },
    },
    { id: "copies", header: "Kopya", accessorKey: "copies", meta: { label: "Kopya", align: "right", summable: true } },
    {
      id: "status",
      header: "Durum",
      meta: { label: "Durum", exportValue: statusText },
      cell: ({ row: { original: r } }) => {
        const view = printStatusView(r);
        return (
          <span className="flex items-center gap-1">
            <Badge variant="outline" className={cn("shrink-0", PRINT_TONE_CLASS[view.tone])}>{view.label}</Badge>
            {view.flag && <Badge variant="outline" className={cn("shrink-0 text-[10px]", PRINT_TONE_CLASS.simulated)}>{view.flag}</Badge>}
          </span>
        );
      },
    },
  ];
}

/** Liste tablosu — süzgeç geri çağrısı ref'te (sütunlar gün değişmedikçe bir kez kurulur). */
export function usePrintHistoryTable(items: PrintJobRow[], onQuickFilter: QuickFilterFn) {
  const ref = useRef(onQuickFilter);
  ref.current = onQuickFilter;
  const today = factoryDayKey();
  const columns = useMemo(() => printHistoryColumns(today, ref), [today]);
  return useLocalTable({ tableKey: "print-history:list", data: items, columns });
}
