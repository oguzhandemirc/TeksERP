// SON HAREKETLER — `/api/rolls/:id/history` (movement + operation + fason + doğum + kesim birleşik, eski→yeni sıralı).
// Kart en yeni 5 olayı gösterir, "Tümünü göster" geri kalanı açar. Yeni defter okuyucusu YOK; izin `roll:history`.
import { useState } from "react";
import { History } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { safeFormat } from "@/lib/format";
import type { RollHistoryPayload } from "../service";
import { widthChangeLine } from "../widthChange";

export const RECENT_EVENT_COUNT = 5;
type HistoryEvent = RollHistoryPayload["events"][number];

/** details serbest sözlük: yalnız METİN/SAYI değerleri (nesne basılırsa "[object Object]" çıkar). */
function detailBits(ev: HistoryEvent): string | null {
  const bits = Object.entries(ev.details ?? {})
    .filter(([, v]) => (typeof v === "string" && v.trim()) || typeof v === "number")
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${String(v)}`);
  return bits.length ? bits.join(" · ") : null;
}

function EventItem({ ev }: { ev: HistoryEvent }) {
  const width = widthChangeLine(ev);
  const bits = detailBits(ev);
  return (
    <li className="relative" data-testid="roll-recent-event">
      <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background" aria-hidden />
      <div className="text-sm font-medium leading-tight">{ev.title}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">
        {[ev.stationName, ev.operatorName].filter(Boolean).join(" · ") || "—"} · {safeFormat(ev.at, "dd.MM.yyyy HH:mm")}
      </div>
      {width && <div className="mt-0.5 text-xs font-medium text-amber-700 dark:text-amber-400" data-testid="roll-history-width-change">{width}</div>}
      {bits && <div className="mt-0.5 text-[11px] text-muted-foreground/80">{bits}</div>}
    </li>
  );
}

interface Props {
  events: HistoryEvent[] | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function RollRecentEvents({ events, isLoading, isError }: Props) {
  const [all, setAll] = useState(false);
  // Olay yoksa bölüm çizilmez (doğum olayı her topta var; boş liste = eski/eksik veri).
  if (!isLoading && !isError && (events?.length ?? 0) === 0) return null;
  const newestFirst = [...(events ?? [])].reverse();
  const shown = all ? newestFirst : newestFirst.slice(0, RECENT_EVENT_COUNT);
  const rest = newestFirst.length - shown.length;
  return (
    <Card data-testid="roll-card-events">
      <CardContent className="p-3">
        <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <History className="h-3.5 w-3.5" /> Son hareketler
        </div>
        {isLoading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : isError ? (
          <p className="text-xs text-destructive">Geçmiş yüklenemedi.</p>
        ) : (
          <>
            <ol className="relative ml-1 space-y-3 border-l border-border pl-4">
              {shown.map((ev, i) => <EventItem key={`${ev.kind}-${ev.at}-${i}`} ev={ev} />)}
            </ol>
            {rest > 0 && (
              <button type="button" className="mt-2 text-xs text-primary hover:underline" onClick={() => setAll(true)} data-testid="roll-events-show-all">
                Tümünü göster (+{rest})
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
