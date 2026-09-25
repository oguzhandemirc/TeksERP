// İş emri Hareketler ekranının Türkçe etiketleri — TEK KAYNAK (panel ve tablet
// satırın başlığını sunucudan hazır alır; istemcide ikinci sözlük tutulmaz).

import type { WorkOrderTrackedField } from "./workorder-event-fields";

/** Olay grupları — süzgeç çipleri bu sırayla basılır. */
export const TIMELINE_GROUPS = ["DURUM", "PLAN", "SIPARIS", "PARTI", "FASON", "TAMBUR", "KAPANIS"] as const;
export type TimelineGroup = (typeof TIMELINE_GROUPS)[number];

export const TIMELINE_GROUP_LABEL: Record<TimelineGroup, string> = {
  DURUM: "Durum",
  PLAN: "Plan değişikliği",
  SIPARIS: "Sipariş",
  PARTI: "Parti",
  FASON: "Fason",
  TAMBUR: "Tambur",
  KAPANIS: "Kapanış künyesi",
};

/** `WorkOrderEvent.field` → okunur ad; izlenen her alanın adı ZORUNLU (tip ölçer). */
export const WORK_ORDER_FIELD_LABEL: Record<WorkOrderTrackedField, string> = {
  targetColorId: "Hedef renk",
  width: "En (cm)",
  targetQuantity: "Hedef metre",
  targetWeight: "Hedef kg",
  foldType: "Kat tipi",
  targetItemId: "Hedef kumaş",
  plannedStartDate: "Planlanan başlangıç",
  plannedEndDate: "Planlanan bitiş",
  routeTemplateId: "Rota",
  type: "İş emri tipi",
  isActive: "Arşiv",
};

/** Fason adımı planının alanları (STEP_PLAN_CHANGED; "route" rotanın bütünü). */
export const WORK_ORDER_STEP_FIELD_LABEL: Record<string, string> = {
  route: "Rota",
  notes: "Adım notu",
  requiredCategoryId: "Fason kategorisi",
  plannedSubcontractorId: "Planlanan fasoncu",
  dispatchWithoutColor: "Sevk rengi",
};

/** Toplara uygulanan plan düzeltmesi (ROLL_ATTRIBUTES_APPLIED). */
export const WORK_ORDER_ROLL_ATTRIBUTE_LABEL: Record<string, string> = {
  rollColor: "renk",
  rollWidth: "en",
};

/** Olayı tetikleyen işlem (`WorkOrderEvent.trigger`) → okunur ad. */
export const WORK_ORDER_TRIGGER_LABEL: Record<string, string> = {
  WO_CREATE: "İş emri açılışı",
  WO_SPLIT_CLONE: "Parti ayırma / devir",
  WO_LOCK: "Kilitle / başlat",
  AUTO_START: "İlk adım başladı",
  STEP_ACTIVE: "Adım başladı",
  MANUAL_COMPLETE: "Elle kapatma",
  WO_CANCEL: "İş emri iptali",
  ORDER_CANCEL: "Sipariş iptali",
  WO_SPLIT_SUPERSEDE: "Tüm partiler devredildi",
  WO_ARCHIVE: "Arşive kaldırma",
  TAMBUR_FINALIZE: "Tambur son kesimi",
  TAMBUR_FINALIZE_OPEN_FABRIC: "Tambur açık kumaş kapanışı",
  TAMBUR_UNDO: "Tambur geri alma",
  TAMBUR_MANUAL_ROLL: "Tambur elle top",
  KURSUN_FINISH: "Kurşun bitişi",
  KURSUN_QC_FINISH: "Kurşun / KK2 bitişi",
  KURSUN_QC_REOPEN: "Kurşun adımı yeniden açıldı",
  KURSUN_BYPASS_FINISH: "Kurşun atlama bitişi",
  FASON_RECEIPT: "Fason kabul",
  FASON_CLOSE_REMAINDER: "Fason kalan kapatma",
  FASON_REOPEN_REMAINDER: "Fason kalan yeniden açıldı",
  FASON_DISPATCH_CANCEL: "Fason sevk iptali",
  FASON_DIRECT_SHIP: "Fasondan doğrudan sevk",
  RESCUE_STUCK_ROLL: "Takılı top kurtarma",
  MANUAL_MOVE: "Konum düzeltme",
  REDYE_SAME_COLOR: "Aynı renge redye",
  WO_UPDATE: "Düzenle (tablet / hızlı)",
  WO_REPLACE: "Düzenle",
  COLOR_CHANGE: "Rengi Değiştir",
  WIDTH_CHANGE: "Eni Değiştir",
  FASON_RECEIPT_WIDTH: "Fason kabulünde ölçülen en",
  ORDER_LINK: "Sipariş bağla",
  ORDER_UNLINK: "Sipariş bağını kaldır",
  ORDER_LINE_CANCEL: "Sipariş kalemi iptali",
  ORDER_DELETE: "Sipariş silme",
  STEP_PLAN: "Adım planlama",
  ROLL_ATTRIBUTES: "Toplara uygula",
};

export const WORK_ORDER_CHANNEL_LABEL: Record<string, string> = {
  PANEL: "Panel",
  TABLET: "Tablet",
  SYSTEM: "Sistem",
  BACKFILL: "Sonradan türetildi",
};
