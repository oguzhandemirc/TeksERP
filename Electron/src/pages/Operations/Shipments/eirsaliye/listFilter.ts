// Sevkiyatlar listesi "e-İrsaliye" süzgeci — değerler backend `EIRSALIYE_LIST_FILTER_VALUES`
// kümesiyle BİREBİR (E6); süzme sunucuda (`filter[eIrsaliye]`, liste+cursor+özet tek where).
import type { FilterDef } from "@/components/data-table/FilterBar";
import { eIrsaliyeStatusLabels } from "@/types/enums";

export const EIRSALIYE_LIST_FILTER_VALUES = [
  "EKSIK", "TASLAK", "OLUSTURULDU", "GONDERILDI", "KABUL", "KISMI_KABUL", "REDDEDILDI", "HATA", "SIMULASYON",
] as const;

const LABELS: Record<(typeof EIRSALIYE_LIST_FILTER_VALUES)[number], string> = {
  EKSIK: "Hazırlanmadı (eksik)",
  TASLAK: eIrsaliyeStatusLabels.TASLAK,
  OLUSTURULDU: eIrsaliyeStatusLabels.OLUSTURULDU,
  GONDERILDI: eIrsaliyeStatusLabels.GONDERILDI,
  KABUL: eIrsaliyeStatusLabels.KABUL,
  KISMI_KABUL: eIrsaliyeStatusLabels.KISMI_KABUL,
  REDDEDILDI: eIrsaliyeStatusLabels.REDDEDILDI,
  HATA: eIrsaliyeStatusLabels.HATA,
  SIMULASYON: "Simülasyon kaydı",
};

export const EIRSALIYE_LIST_FILTER: FilterDef = {
  kind: "multi-select",
  key: "eIrsaliye",
  label: "e-İrsaliye",
  options: EIRSALIYE_LIST_FILTER_VALUES.map((value) => ({ value, label: LABELS[value] })),
};
