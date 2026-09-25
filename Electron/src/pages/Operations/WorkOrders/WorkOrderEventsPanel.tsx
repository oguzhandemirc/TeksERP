// İş emri hareketleri gövdesi — Sheet ve ayrı ekranın ORTAK bileşeni: grup çipleri,
// tablo, "daha fazla", altbilgi ve Excel. Depo hareket dökümünün sözleşmesini izler:
// ⚠️ SATIRLAR SALT-OKUNURDUR · ⚠️ "HATA" ≠ "KAYIT YOK" · ⚠️ KIRPMA SESSİZ DEĞİL.
import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { eventsFooterText, getWorkOrderEvents, type TimelineGroup } from "./events";
import { EventsExcelButton, WorkOrderEventsTable } from "./WorkOrderEventsTable";

const PAGE_SIZE = 50;

export function WorkOrderEventsPanel({ workOrder }: { workOrder: { id: string; workOrderNumber: string } }) {
  const [group, setGroup] = useState<TimelineGroup | "">("");
  // İş emri değişince süzgeç sıfırlanır — önceki süzgeç boş liste gösterip "hareket yok" sanılmasın.
  useEffect(() => setGroup(""), [workOrder.id]);
  const q = useInfiniteQuery({
    queryKey: ["work-orders", "events", workOrder.id, group],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getWorkOrderEvents(workOrder.id, { group, cursor: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  const groups = q.data?.pages[0]?.groups ?? [];
  return (
    <>
      <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2" role="group" aria-label="Olay grubu">
        <Button size="sm" variant={group === "" ? "default" : "outline"} onClick={() => setGroup("")}>
          Tümü
        </Button>
        {groups.filter((g) => g.count > 0 || g.key === group).map((g) => (
          <Button key={g.key} size="sm" variant={group === g.key ? "default" : "outline"} onClick={() => setGroup(g.key)}>
            {g.label} <span className="ml-1 tabular-nums opacity-70">{g.count}</span>
          </Button>
        ))}
      </div>
      <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-md border">
        {q.isLoading ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Yükleniyor…</p>
        ) : q.isError && rows.length === 0 ? (
          <div className="p-6 text-center text-sm">
            <p className="font-medium text-destructive">Hareketler yüklenemedi.</p>
            <p className="mt-1 text-muted-foreground">
              Bu bir “hareket yok” cevabı DEĞİLDİR — istek sunucuya ulaşamadı ya da reddedildi.
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
              Tekrar dene
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {group ? "Bu grupta hareket yok." : "Bu iş emrinde henüz kayıtlı hareket yok."}
          </p>
        ) : (
          <WorkOrderEventsTable rows={rows} />
        )}
      </div>
      {rows.length > 0 && (
        <div className="mt-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{eventsFooterText(rows.length, q.hasNextPage)}</span>
          {q.hasNextPage && (
            <Button variant="outline" size="sm" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              {q.isFetchingNextPage ? "Yükleniyor…" : "Daha fazla yükle"}
            </Button>
          )}
          <EventsExcelButton workOrderId={workOrder.id} workOrderNumber={workOrder.workOrderNumber} group={group} />
          {q.isError && (
            <span className="font-medium text-destructive">Devamı yüklenemedi — liste eksik olabilir, tekrar deneyin.</span>
          )}
        </div>
      )}
    </>
  );
}
