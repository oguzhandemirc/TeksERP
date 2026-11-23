// METRE SAPMALARI (H4) — kurşun çıkış metresinin girişten eşik üstü sapmaları: liste + özet şeridi (aynı where) + ofis onayı.
// İzin `kursun:meter-approve` (okuma ve onay). Süzme sunucuda; cursor ile sonsuz kaydırma.
import { useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageShell } from "@/components/layout/PageShell";
import { ListFooter, ListToolbar } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { METER_DEVIATIONS_QUERY_KEY, listMeterDeviations, officeAckMeterReading } from "./service";
import { DeviationFilters } from "./DeviationFilters";
import { deviationColumns } from "./deviationColumns";
import { SummaryStrip } from "./SummaryStrip";
import { OfficeAckDialog } from "./OfficeAckDialog";
import type { DeviationFilter, MeterDeviationRow } from "./types";

export const METER_DEVIATIONS_PATH = "/operations/kursun-sapmalar";
export const EMPTY_DEVIATION_FILTER: DeviationFilter = { status: null, machineId: null, customerId: null, from: "", to: "" };

export function MeterDeviationsPage() {
  const [filter, setFilter] = useState<DeviationFilter>(EMPTY_DEVIATION_FILTER);
  const [target, setTarget] = useState<MeterDeviationRow | null>(null);
  const qc = useQueryClient();
  const list = useInfiniteQuery({
    queryKey: [METER_DEVIATIONS_QUERY_KEY, filter],
    queryFn: ({ pageParam }) => listMeterDeviations(filter, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.pagination.nextCursor,
  });
  const items = list.data?.pages.flatMap((p) => p.data) ?? [];
  const summary = list.data?.pages[0]?.summary ?? null;
  const columns = useMemo(() => deviationColumns(setTarget), []);
  const table = useLocalTable({ tableKey: "kursun:meter-deviations", data: items, columns, getRowId: (r) => r.readingId });
  const ack = useMutation({
    mutationFn: (v: { readingId: string; reasonText: string | null }) => officeAckMeterReading(v.readingId, v.reasonText),
    onSuccess: () => {
      toast.success("Metre sapması onaylandı");
      setTarget(null);
    },
    // Hata toast'ı apiClient'ta (409 "zaten onaylanmış" dahil); her iki durumda liste tazelenir.
    onSettled: () => void qc.invalidateQueries({ queryKey: [METER_DEVIATIONS_QUERY_KEY] }),
  });

  return (
    <PageShell>
      <PageHeader
        title="Metre Sapmaları"
        description="Kurşun çıkış metresinin girişten eşik üstü farkları. İmza bekleyen sapma adımı kapatmaz; imzasız sapma yalnız işarettir."
        actions={<RefreshButton queryKey={METER_DEVIATIONS_QUERY_KEY} />}
      />
      <ListToolbar className="flex-row flex-wrap items-center">
        <DeviationFilters filter={filter} onChange={setFilter} />
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Metre sapmaları" />
        </div>
      </ListToolbar>
      {/* "HATA" ile "KAYIT YOK" ayrı ekranlar (DataTable.isError); yüklü satır varken hata satırı tabloyu silmez. */}
      <DataTable
        table={table}
        exportName="Metre sapmaları"
        isLoading={list.isLoading}
        isError={list.isError && items.length === 0}
        onRetry={() => void list.refetch()}
        errorText="Bu bir “sapma yok” cevabı değildir — istek reddedildi ya da sunucuya ulaşılamadı."
        emptyText="Bu filtreye uyan metre sapması yok."
        emptyDescription="Eşik ve onay kipi Sistem › Özellik Anahtarları › Üretim — Saha bölümünde seçilir."
        loadMore={{ hasMore: Boolean(list.hasNextPage), isFetchingMore: list.isFetchingNextPage, onLoadMore: () => void list.fetchNextPage() }}
      />
      <ListFooter loaded={items.length} total={summary?.total} hasMore={Boolean(list.hasNextPage)} isFetchingMore={list.isFetchingNextPage} summary={<SummaryStrip summary={summary} />} />
      {target && (
        <OfficeAckDialog
          target={target}
          isPending={ack.isPending}
          onClose={() => setTarget(null)}
          onConfirm={(reasonText) => ack.mutate({ readingId: target.readingId, reasonText })}
        />
      )}
    </PageShell>
  );
}
