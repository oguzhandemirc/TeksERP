import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListSentinel } from "@/components/layout/ListPage";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { RefreshButton } from "@/components/RefreshButton";
import { isUuid, fromSearchParams, toQueryParams, toSearchParams, dayChipLabel, type PrintHistoryFilterState } from "@/lib/print-history-query";
import { printDeviceText, printPrinterText, printUserText } from "@/lib/print-job-format";
import { isEndpointMissing, printHistoryService, type PrintJobRow, type PrintJobSummary } from "@/services/printHistoryService";
import { PrintHistoryFilters, type FilterOption } from "./PrintHistoryFilters";
import { PrintHistoryTable } from "./PrintHistoryTable";
import { PrintJobDetailSheet } from "./PrintJobDetailSheet";

export const PRINT_HISTORY_QUERY_KEY = "print-history";

export function PrintHistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => fromSearchParams(searchParams), [searchParams]);
  const params = useMemo(() => toQueryParams(filters), [filters]);
  const [detailId, setDetailId] = useState<string | null>(null);

  const setFilters = useCallback(
    (next: PrintHistoryFilterState) => setSearchParams(toSearchParams(next), { replace: true }),
    [setSearchParams],
  );

  const query = useInfiniteQuery({
    queryKey: [PRINT_HISTORY_QUERY_KEY, params],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => printHistoryService.list(params, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
    retry: (count, err) => !isEndpointMissing(err) && count < 2,
  });

  const items = useMemo<PrintJobRow[]>(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);
  const summary = query.data?.pages[0]?.ozet ?? null;
  const unsupported = query.isError && isEndpointMissing(query.error);

  const options = useSeenOptions(items, filters);
  const subjectLabel = filters.subjectId ? subjectLabelFor(items, filters.subjectId) : null;

  const handleSelect = useCallback((row: PrintJobRow) => setDetailId(row.id), []);
  const handleQuickFilter = useCallback(
    (patch: Partial<PrintHistoryFilterState>) => setFilters({ ...filters, ...patch }),
    [filters, setFilters],
  );

  const { rootRef, sentinelRef } = useInfiniteScroll({
    hasMore: query.hasNextPage,
    isLoading: query.isFetchingNextPage,
    onLoadMore: () => void query.fetchNextPage(),
  });

  return (
    <PageShell>
      <PageHeader title="Yazdırma Geçmişi" actions={<RefreshButton queryKey={PRINT_HISTORY_QUERY_KEY} />} />
      <PrintHistoryFilters
        value={filters}
        onChange={setFilters}
        userOptions={options.users}
        printerOptions={options.printers}
        deviceOptions={options.devices}
        subjectLabel={subjectLabel}
      />
      {summary && <SummaryStrip summary={summary} prefix={dayChipLabel(filters)} items={items} />}

      <ListBody ref={rootRef}>
        {unsupported ? (
          <EmptyState text="Bu sunucu sürümü yazdırma geçmişini desteklemiyor. Sunucu güncellendiğinde kayıtlar burada görünür." />
        ) : query.isError ? (
          <EmptyState text="Yazdırma geçmişi okunamadı. Bağlantıyı kontrol edip yenileyin." tone="danger" />
        ) : (
          <>
            <PrintHistoryTable
              items={items}
              loading={query.isLoading}
              onSelect={handleSelect}
              onQuickFilter={handleQuickFilter}
            />
            {items.length > 0 && <ListSentinel ref={sentinelRef} />}
          </>
        )}
      </ListBody>
      <ListFooter
        loaded={items.length}
        total={summary?.toplam ?? null}
        hasMore={query.hasNextPage}
        isFetchingMore={query.isFetchingNextPage}
      />

      <PrintJobDetailSheet jobId={detailId} onClose={() => setDetailId(null)} />
    </PageShell>
  );
}

function EmptyState({ text, tone }: { text: string; tone?: "danger" }) {
  return (
    <div
      className={
        tone === "danger"
          ? "flex flex-1 items-center justify-center p-12 text-center text-sm text-red-700 dark:text-red-300"
          : "flex flex-1 items-center justify-center p-12 text-center text-sm text-muted-foreground"
      }
    >
      {text}
    </div>
  );
}

/** Özet şeridi — sayıların HEPSİ sunucudan (`?ozet=1`, listeyle aynı where). */
export function summaryText(summary: PrintJobSummary, prefix: string, worstPrinterLabel: string | null): string {
  const parts = [
    `${prefix} ${summary.toplam} baskı`,
    `${summary.durum.HATA} hata`,
    `${summary.durum.BELIRSIZ} belirsiz`,
    `${summary.pdf} PDF`,
  ];
  if (summary.durum.SIMULE > 0) parts.push(`${summary.durum.SIMULE} simülasyon`);
  if (summary.enCokHata && worstPrinterLabel) parts.push(`en çok hata: ${worstPrinterLabel} (${summary.enCokHata.sayi})`);
  return parts.join(" · ");
}

function SummaryStrip({ summary, prefix, items }: { summary: PrintJobSummary; prefix: string; items: PrintJobRow[] }) {
  const w = summary.enCokHata;
  // Ad yalnız görüntü içindir: kayıtlı yazıcının adı görülen satırdan, yoksa çıplak ad/kimlik.
  const worstLabel = w
    ? (items.find((r) => w.peripheralDeviceId && r.peripheralDeviceId === w.peripheralDeviceId)?.peripheral?.name ??
      w.printerName ??
      (w.peripheralDeviceId ? "kayıtlı yazıcı" : "bilinmeyen yazıcı"))
    : null;
  const hasError = summary.durum.HATA > 0;
  return (
    <div
      className={
        "border-b px-4 py-2 text-sm sm:px-6 " +
        (hasError ? "bg-red-500/5 text-foreground" : "bg-muted/30 text-muted-foreground")
      }
      data-testid="print-summary"
    >
      {summaryText(summary, prefix, worstLabel)}
    </div>
  );
}

function subjectLabelFor(items: PrintJobRow[], subjectId: string): string | null {
  const row = items.find((r) => r.subjectId === subjectId && r.subjectNo);
  return row?.subjectNo ?? null;
}

/**
 * Kişi/yazıcı/cihaz seçenekleri: o ana dek görülen satırlardan birikir (okuyucunun kullanıcı/cihaz
 * listesi izni olmayabilir). Yalnız SEÇENEK üretir; süzme ve sayma yine sunucudadır.
 */
function useSeenOptions(items: PrintJobRow[], filters: PrintHistoryFilterState) {
  const seen = useRef({ users: new Map<string, string>(), printers: new Map<string, string>(), devices: new Map<string, string>() });
  for (const r of items) {
    if (r.userId) seen.current.users.set(r.userId, printUserText(r));
    const printerKey = r.peripheralDeviceId ?? r.printerName;
    if (printerKey && r.outputKind !== "PDF") seen.current.printers.set(printerKey, printPrinterText(r));
    if (r.deviceRefId) seen.current.devices.set(r.deviceRefId, printDeviceText(r));
  }
  const toOptions = (m: Map<string, string>, selected: string | undefined, fallback: string): FilterOption[] => {
    const list = [...m.entries()].map(([value, label]) => ({ value, label }));
    if (selected && !m.has(selected)) list.unshift({ value: selected, label: fallback });
    return list.sort((a, b) => a.label.localeCompare(b.label, "tr"));
  };
  return {
    users: toOptions(seen.current.users, filters.userId, "Seçili kişi"),
    printers: toOptions(seen.current.printers, filters.printer, filters.printer && !isUuid(filters.printer) ? filters.printer : "Seçili yazıcı"),
    devices: toOptions(seen.current.devices, filters.deviceRefId, "Seçili cihaz"),
  };
}
