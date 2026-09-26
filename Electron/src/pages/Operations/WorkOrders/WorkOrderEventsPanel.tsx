// İş emri hareketleri gövdesi — Sheet ve ayrı ekranın ORTAK bileşeni; gövde olay defterlerinin
// ortak zaman çizelgesidir (`EventTimelinePanel`: grup çipleri, tablo, "daha fazla", altbilgi, Excel).
import { EventTimelinePanel } from "@/components/timeline/EventTimeline";
import { EVENT_COLUMNS, getWorkOrderEvents, type TimelineGroup } from "./events";

export function WorkOrderEventsPanel({ workOrder }: { workOrder: { id: string; workOrderNumber: string } }) {
  return (
    <EventTimelinePanel
      queryKey={["work-orders", "events", workOrder.id]}
      resetKey={workOrder.id}
      fetchPage={(o) => getWorkOrderEvents(workOrder.id, { group: o.group as TimelineGroup | "", cursor: o.cursor, limit: o.limit })}
      columns={EVENT_COLUMNS}
      testId="is-emri-hareketleri"
      fileName={`${workOrder.workOrderNumber}-hareketler`}
      emptyText="Bu iş emrinde henüz kayıtlı hareket yok."
    />
  );
}
