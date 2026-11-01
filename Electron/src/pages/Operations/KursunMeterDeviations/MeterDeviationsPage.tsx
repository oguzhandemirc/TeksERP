// METRE SAPMALARI (H4) — kurşun çıkış metresinin girişten eşik üstü sapmaları: liste + özet şeridi (aynı where) + ofis onayı.
// İzin `kursun:meter-approve` (okuma ve onay). Süzme sunucuda; cursor ile sonsuz kaydırma.
import { useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListMessage, ListSentinel, ListToolbar } from "@/components/layout/ListPage";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/RefreshButton";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { METER_DEVIATIONS_QUERY_KEY, listMeterDeviations, officeAckMeterReading } from "./service";
import { DeviationFilters } from "./DeviationFilters";
import { DeviationTable } from "./DeviationTable";
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
  const { rootRef, sentinelRef } = useInfiniteScroll({
    hasMore: Boolean(list.hasNextPage),
    isLoading: list.isFetchingNextPage,
    onLoadMore: () => void list.fetchNextPage(),
  });
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
      <ListToolbar>
        <SummaryStrip summary={summary} />
        <DeviationFilters filter={filter} onChange={setFilter} />
      </ListToolbar>
      <ListBody ref={rootRef}>
        {list.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : list.isError && items.length === 0 ? (
          <ListMessage>
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
              <p className="font-medium text-destructive">Liste yüklenemedi.</p>
              <p className="mt-1 text-muted-foreground">Bu bir “sapma yok” cevabı değildir — istek reddedildi ya da sunucuya ulaşılamadı.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void list.refetch()}>
                Tekrar dene
              </Button>
            </div>
          </ListMessage>
        ) : items.length === 0 ? (
          <ListMessage>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Bu süzgece uyan metre sapması yok. Eşik ve onay kipi Sistem › Özellik Anahtarları › Üretim — Saha bölümünde seçilir.
            </div>
          </ListMessage>
        ) : (
          <>
            <DeviationTable rows={items} onAck={setTarget} />
            <ListSentinel ref={sentinelRef} />
          </>
        )}
      </ListBody>
      <ListFooter loaded={items.length} total={summary?.total} hasMore={Boolean(list.hasNextPage)} isFetchingMore={list.isFetchingNextPage} />
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
