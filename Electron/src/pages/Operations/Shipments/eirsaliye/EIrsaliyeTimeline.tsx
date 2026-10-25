// Olay zaman çizelgesi (defter "ne oldu") + aynı sevkiyatın önceki kayıtları. Saat fabrika diliminden.
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { eIrsaliyeEventTypeLabels } from "@/types/enums";
import { EIrsaliyeStatusBadge } from "./EIrsaliyeStatusBadge";
import type { EIrsaliyeEvent, EIrsaliyeRecordView } from "./types";

export function EIrsaliyeTimeline({ events, history }: { events: EIrsaliyeEvent[]; history: EIrsaliyeRecordView[] }) {
  return (
    <details className="text-xs" data-testid="eirsaliye-timeline">
      <summary className="cursor-pointer select-none text-muted-foreground">
        Geçmiş ({[events.length > 0 ? `${events.length} olay` : null, history.length > 0 ? `${history.length} önceki kayıt` : null].filter(Boolean).join(" · ")})
      </summary>
      {events.length > 0 && <ol className="mt-1.5 space-y-1 border-l pl-3">
        {events.map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full bg-muted-foreground/60" />
            <span className="tabular-nums text-muted-foreground">{fmtFactoryDateTime(e.createdAt)}</span>{" "}
            <span className="font-medium">{eIrsaliyeEventTypeLabels[e.type] ?? e.type}</span>
            {e.note && <span className="block text-muted-foreground">{e.note}</span>}
          </li>
        ))}
      </ol>}
      {history.length > 0 && (
        <ul className="mt-2 space-y-1">
          {history.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{h.documentNo ?? "numarasız"}</span>
              <EIrsaliyeStatusBadge status={h.status} simulasyon={h.simulasyon} />
              <span className="text-muted-foreground">{fmtFactoryDateTime(h.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
