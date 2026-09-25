// İş emri hareket defterinin İZLENEN plan alanları — TEK KAYNAK. Bu alanlardan
// birini yazan her yol `work_order_events`e FIELD_CHANGED satırı yazar
// (`test_workorder_event_yazar` §3 ölçer). `workOrderNumber` burada YOK: numara
// doğuşta donar, hiçbir uçtan yazılmaz.

export const WORK_ORDER_TRACKED_FIELDS = [
  "targetColorId",
  "width",
  "targetQuantity",
  "targetWeight",
  "foldType",
  "targetItemId",
  "plannedStartDate",
  "plannedEndDate",
  "routeTemplateId",
  "type",
  "isActive",
] as const;

export type WorkOrderTrackedField = (typeof WORK_ORDER_TRACKED_FIELDS)[number];

/** Değerin deftere nasıl yazılacağı: kimlik alanlarının o anki ADI etikete donar. */
export const WORK_ORDER_FIELD_KIND: Record<WorkOrderTrackedField, "color" | "item" | "route" | "number" | "date" | "text" | "type" | "flag"> = {
  targetColorId: "color",
  width: "number",
  targetQuantity: "number",
  targetWeight: "number",
  foldType: "text",
  targetItemId: "item",
  plannedStartDate: "date",
  plannedEndDate: "date",
  routeTemplateId: "route",
  type: "type",
  isActive: "flag",
};
