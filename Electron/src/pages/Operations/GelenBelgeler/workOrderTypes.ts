// Gelen belgeden iş emri tipleri — `types.ts`ten ayrıldı (max-lines); dış kullanım `./types` üzerinden.
import type { NoteStatus } from "./types";

/** Onay sonrası otomatik iş emri — backend `gelen-belge-oto-is-emri.service.ts` `AutoWorkOrderResult` aynası. */
export interface AutoWorkOrderGroup {
  key: string;
  itemName: string;
  targets: string[];
  rollCount: number;
  outcome: "OPENED" | "SKIPPED" | "FAILED";
  workOrderId?: string;
  workOrderNumber?: string;
  attached?: number;
  reason?: string;
}
export interface AutoWorkOrderResult {
  opened: number;
  manual: number;
  reason: string | null;
  groups: AutoWorkOrderGroup[];
}

/** Belgeden iş emri planı (D4-D2) — backend `gelen-belge-is-emri.service` `WorkOrderPlan` aynası. */
export interface PlanTarget {
  propertyId: string;
  propertyName: string;
  /** Çeşidin bayrağı (BRODE, KURŞUN…) — iş emrinin hedef özelliği (rota kapsaması). */
  flagPropertyId: string;
  valueId: string;
  valueName: string;
  /** ALIAS/PATTERN: sunucu önerisi · MANUAL: panelde seçildi (sunucu üretmez). */
  source: "ALIAS" | "PATTERN" | "MANUAL";
}
export interface PlanRoll {
  rollId: string;
  barcode: string | null;
  lineNo: number;
  senderRollNo: string | null;
  meters: string;
  status: string;
  attachable: boolean;
  liveWorkOrder: { id: string; workOrderNumber: string } | null;
}
export interface PlanGroup {
  key: string;
  patternless: boolean;
  targets: PlanTarget[];
  itemId: string;
  itemName: string;
  processText: string | null;
  rolls: PlanRoll[];
  totalMeters: string;
  attachableCount: number;
}
export interface ChoiceProperty {
  propertyId: string;
  propertyName: string;
  flagPropertyId: string;
  optionCount: number;
}
export interface WorkOrderPlan {
  noteId: string;
  noteNo: string;
  status: NoteStatus;
  owner: { id: string; name: string } | null;
  customerBatch: { key: string; batchNo: string } | null;
  suggestedRouteTemplateId: string | null;
  choiceProperties: ChoiceProperty[];
  groups: PlanGroup[];
}
export interface ProcessValuePage {
  property: { id: string; name: string };
  items: Array<{ id: string; code: string; name: string }>;
  total: number;
  nextCursor: string | null;
}
