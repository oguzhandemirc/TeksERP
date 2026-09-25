// İş emri hareketleri tablosu + Excel tuşu — Sheet ve ayrı ekranın ORTAK gövdesi.
// Sütunlar `EVENT_COLUMNS`ten türer: ekrandaki sütunlar = Excel sütunları.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { exportRowsToXlsx } from "@/lib/list-export";
import { EVENT_COLUMNS, fetchAllWorkOrderEvents, type TimelineGroup, type TimelineItem } from "./events";

export function WorkOrderEventsTable({ rows }: { rows: TimelineItem[] }) {
  return (
    <table className="w-full text-sm" data-testid="is-emri-hareketleri">
      <thead className="sticky top-0 bg-muted/80 text-[11px] uppercase text-muted-foreground backdrop-blur">
        <tr>
          {EVENT_COLUMNS.map((c) => (
            <th key={c.label} className="px-3 py-2 text-left">
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t align-top">
            {EVENT_COLUMNS.map((c, i) => (
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
export function EventsExcelButton(props: { workOrderId: string; workOrderNumber: string; group: TimelineGroup | "" }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const all = await fetchAllWorkOrderEvents(props.workOrderId, props.group);
          await exportRowsToXlsx(EVENT_COLUMNS, all, `${props.workOrderNumber}-hareketler`);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Hazırlanıyor…" : "Excel"}
    </Button>
  );
}
