// İş emri hareketleri tablosu + Excel tuşu — ortak zaman çizelgesi gövdesinin (`EventTimeline`)
// iş emri sütun modeliyle kullanımı. Sütunlar `EVENT_COLUMNS`ten türer: ekrandaki sütunlar = Excel sütunları.
import { EventTimelineTable, TimelineExcelButton } from "@/components/timeline/EventTimeline";
import { EVENT_COLUMNS, fetchAllWorkOrderEvents, type TimelineGroup, type TimelineItem } from "./events";

export function WorkOrderEventsTable({ rows }: { rows: TimelineItem[] }) {
  return <EventTimelineTable columns={EVENT_COLUMNS} rows={rows} testId="is-emri-hareketleri" />;
}

/** Excel — ekranda yüklenmiş sayfalar değil, süzgeçteki listenin TAMAMI. */
export function EventsExcelButton(props: { workOrderId: string; workOrderNumber: string; group: TimelineGroup | "" }) {
  return (
    <TimelineExcelButton
      columns={EVENT_COLUMNS}
      fetchAll={() => fetchAllWorkOrderEvents(props.workOrderId, props.group)}
      fileName={`${props.workOrderNumber}-hareketler`}
    />
  );
}
