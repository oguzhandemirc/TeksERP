// =============================================================================
// İŞ EMRİ HAREKETLERİ — detay/yan panelden açılan zaman çizelgesi
// =============================================================================
// Kaynak: `GET /api/work-orders/:id/events` — iş emrinin kendi defteri + kendi
// defteri olan olaylar (sipariş bağı, parti, fason, Tambur, kapanış künyesi).
// Depo hareket dökümünün (`WarehouseMovementsSheet`) sözleşmesini izler:
// ⚠️ SATIRLAR SALT-OKUNURDUR — düzeltme yeni olaydır, "Düzelt" tuşu yok.
// ⚠️ "HATA" ile "KAYIT YOK" AYRI EKRANLARDIR — düşen istek "hareket yok" sanılmaz.
// ⚠️ KIRPMA SESSİZ DEĞİL — altbilgi listenin bitip bitmediğini söyler.
// =============================================================================
import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { eventsFooterText, formatEventInstant, getWorkOrderEvents, type TimelineGroup, type TimelineItem } from "./events";

const PAGE_SIZE = 50;

interface Props {
  /** Seçili iş emri — `null` ise panel kapalıdır. */
  workOrder: { id: string; workOrderNumber: string } | null;
  onClose: () => void;
}

export function WorkOrderEventsSheet({ workOrder, onClose }: Props) {
  const [group, setGroup] = useState<TimelineGroup | "">("");
  const woId = workOrder?.id;
  // İş emri değişince süzgeç sıfırlanır — önceki iş emrinin süzgeci boş liste gösterip
  // "hareket yok" izlenimi vermesin.
  useEffect(() => setGroup(""), [woId]);

  const q = useInfiniteQuery({
    queryKey: ["work-orders", "events", woId ?? "", group],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getWorkOrderEvents(woId!, { group, cursor: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(woId),
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  const groups = q.data?.pages[0]?.groups ?? [];

  return (
    <Sheet open={Boolean(workOrder)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-[860px] flex-col sm:max-w-[860px]">
        <SheetHeader>
          <SheetTitle className="pr-8">{workOrder ? `${workOrder.workOrderNumber} — Hareketler` : "…"}</SheetTitle>
        </SheetHeader>
        {workOrder && (
          <>
            <p className="mt-2 text-xs text-muted-foreground">
              Hareketler değiştirilmez: bir düzeltme, yeni bir satır olarak eklenir.
            </p>
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
                <EventsTable rows={rows} />
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
                {q.isError && (
                  <span className="font-medium text-destructive">Devamı yüklenemedi — liste eksik olabilir, tekrar deneyin.</span>
                )}
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function EventsTable({ rows }: { rows: TimelineItem[] }) {
  return (
    <table className="w-full text-sm" data-testid="is-emri-hareketleri">
      <thead className="sticky top-0 bg-muted/80 text-[11px] uppercase text-muted-foreground backdrop-blur">
        <tr>
          <th className="px-3 py-2 text-left">Zaman</th>
          <th className="px-3 py-2 text-left">Olay</th>
          <th className="px-3 py-2 text-left">Ayrıntı</th>
          <th className="px-3 py-2 text-left">Kim · nereden</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t align-top">
            <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatEventInstant(r.at)}</td>
            <td className="px-3 py-2">
              <div className="font-medium">{r.title}</div>
              {r.derived && (
                <Badge variant="outline" className="mt-1 border-dashed text-[10px]" title="Geçmiş kayıtlardan sonradan türetildi">
                  sonradan türetildi
                </Badge>
              )}
            </td>
            <td className="px-3 py-2">
              {r.detail && <div>{r.detail}</div>}
              {/* Sebep KIRPILMAZ — yarısı okunan gerekçe, gerekçe değildir. */}
              {r.reason && <div className="text-[11px] break-words text-muted-foreground">Sebep: {r.reason}</div>}
            </td>
            <td className={cn("px-3 py-2 text-muted-foreground")}>
              <div>{r.actor ?? "—"}</div>
              {(r.channel || r.trigger) && (
                <div className="text-[11px]">{[r.channel, r.trigger].filter(Boolean).join(" · ")}</div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
