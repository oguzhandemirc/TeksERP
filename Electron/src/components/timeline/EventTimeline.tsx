// Olay defteri zaman çizelgesi — İş Emri Hareketleri ve Kartela Hareketleri'nin ORTAK gövdesi:
// grup çipleri, tablo, "daha fazla", altbilgi ve Excel. Sütunlar çağıranın TEK sütun modelinden
// türer (ekrandaki sütunlar = Excel sütunları). Depo hareket dökümünün sözleşmesini izler:
// ⚠️ SATIRLAR SALT-OKUNURDUR · ⚠️ "HATA" ≠ "KAYIT YOK" · ⚠️ KIRPMA SESSİZ DEĞİL.
import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { exportRowsToXlsx, type ExportColumn } from "@/lib/list-export";

export interface TimelinePage<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Süzgeç çipleri — sunucudan, grup seçiminden bağımsız sayılarla. */
  groups: Array<{ key: string; label: string; count: number }>;
}

export type TimelineFetch<T> = (opts: { group: string; cursor?: string; limit: number }) => Promise<TimelinePage<T>>;

/** Kırpma sessiz değil: altbilgi listenin bitip bitmediğini HER ZAMAN söyler. */
export function timelineFooterText(shown: number, hasMore: boolean): string {
  if (shown === 0) return "";
  const head = `${shown} hareket gösteriliyor (en yeniden eskiye).`;
  return hasMore ? `${head} Liste KIRPILDI — devamı için “Daha fazla yükle”.` : `${head} Bu süzgeçte başka hareket yok.`;
}

/** Dışa aktarım listenin TAMAMINI alır — ekranda yüklenmiş sayfalarla sınırlı değil. */
export async function fetchAllTimeline<T>(fetchPage: TimelineFetch<T>, group: string): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 100; i++) {
    const page = await fetchPage({ group, cursor, limit: 200 });
    all.push(...page.data);
    if (!page.hasMore || !page.nextCursor) return all;
    cursor = page.nextCursor;
  }
  // Kırpılmış bir Excel "tam liste" sanılır — sessizce kesmek yerine dur.
  throw new Error("Hareket listesi dışa aktarım sınırını aşıyor (20.000 satır); süzgeçle daraltın.");
}

export function EventTimelineTable<T extends { id: string }>(props: { columns: ExportColumn<T>[]; rows: T[]; testId: string }) {
  return (
    <table className="w-full text-sm" data-testid={props.testId}>
      <thead className="sticky top-0 bg-muted/80 text-[11px] uppercase text-muted-foreground backdrop-blur">
        <tr>
          {props.columns.map((c) => (
            <th key={c.label} className="px-3 py-2 text-left">
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((r) => (
          <tr key={r.id} className="border-t align-top">
            {props.columns.map((c, i) => (
              // Sebep ve kanal ikinci satırda; metin KIRPILMAZ.
              <td key={c.label} className={i === 0 ? "px-3 py-2 whitespace-nowrap text-muted-foreground" : "px-3 py-2 whitespace-pre-line break-words"}>
                {String(c.value(r) ?? "")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Excel — ekranda yüklenmiş sayfalar değil, süzgeçteki listenin TAMAMI. */
export function TimelineExcelButton<T>(props: { columns: ExportColumn<T>[]; fetchAll: () => Promise<T[]>; fileName: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await exportRowsToXlsx(props.columns, await props.fetchAll(), props.fileName);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Hazırlanıyor…" : "Excel"}
    </Button>
  );
}

export interface EventTimelinePanelProps<T> {
  /** Sorgu anahtarı — süzgeçler dahil; grup ayrıca eklenir. */
  queryKey: unknown[];
  /** Değişince grup süzgeci sıfırlanır (başka kayda geçildi). */
  resetKey: string;
  fetchPage: TimelineFetch<T>;
  columns: ExportColumn<T>[];
  testId: string;
  fileName: string;
  emptyText: string;
}

export function EventTimelinePanel<T extends { id: string }>(props: EventTimelinePanelProps<T>) {
  const [group, setGroup] = useState("");
  // Kayıt değişince süzgeç sıfırlanır — önceki süzgeç boş liste gösterip "hareket yok" sanılmasın.
  useEffect(() => setGroup(""), [props.resetKey]);
  const q = useInfiniteQuery({
    queryKey: [...props.queryKey, group],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => props.fetchPage({ group, cursor: pageParam, limit: 50 }),
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
          <p className="p-6 text-center text-sm text-muted-foreground">{group ? "Bu grupta hareket yok." : props.emptyText}</p>
        ) : (
          <EventTimelineTable columns={props.columns} rows={rows} testId={props.testId} />
        )}
      </div>
      {rows.length > 0 && (
        <div className="mt-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{timelineFooterText(rows.length, q.hasNextPage)}</span>
          {q.hasNextPage && (
            <Button variant="outline" size="sm" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              {q.isFetchingNextPage ? "Yükleniyor…" : "Daha fazla yükle"}
            </Button>
          )}
          <TimelineExcelButton columns={props.columns} fetchAll={() => fetchAllTimeline(props.fetchPage, group)} fileName={props.fileName} />
          {q.isError && (
            <span className="font-medium text-destructive">Devamı yüklenemedi — liste eksik olabilir, tekrar deneyin.</span>
          )}
        </div>
      )}
    </>
  );
}
