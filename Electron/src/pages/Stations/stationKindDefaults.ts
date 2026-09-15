// =============================================================================
// İstasyon formu — GÖREV TÜRÜNE GÖRE ÖNERİLEN YETENEK DÜZENİ (öneri, kilit değil) — 2026-09-16
// =============================================================================
// Kullanıcı isteği: "Görev Türü" seçilince Yetenekler kutuları o türün önerilen düzeniyle ön-işaretli
// gelsin, kullanıcı değiştirebilsin. Tek kaynak bu sabit. Davranış (basit, dirty takibi yok):
//   · YENİ kayıtta tür değişimi = öneriyi UYGULA (kutular öneriye sıfırlanır)
//   · DÜZENLEMEDE = DOKUNMA (tür değişse bile mevcut istasyonun yetenekleri sessizce ezilmez)
// Düzen: RAW_QC hiçbiri · PROCESS_QC kalite · TAMBUR özellik (seed Tambur kolon varsayılanıyla özellik
// uygular) · SUBCONTRACTOR renk + özellik · SHIPPING hiçbiri · WEAVING levent tüketir · OTHER hiçbiri.
// =============================================================================
import { StationKind } from "@/types/enums";
import type { StationFormValues } from "./schema";

export type StationCapabilityValues = Pick<
  StationFormValues,
  "appliesColor" | "appliesProperty" | "appliesQuality" | "producesWarpBeam" | "consumesWarpBeam"
>;

const NONE: StationCapabilityValues = {
  appliesColor: false,
  appliesProperty: false,
  appliesQuality: false,
  producesWarpBeam: false,
  consumesWarpBeam: false,
};

export const STATION_KIND_CAPABILITY_DEFAULTS: Record<StationKind, StationCapabilityValues> = {
  [StationKind.RAW_QC]: NONE,
  [StationKind.PROCESS_QC]: { ...NONE, appliesQuality: true },
  [StationKind.TAMBUR]: { ...NONE, appliesProperty: true },
  [StationKind.SUBCONTRACTOR]: { ...NONE, appliesColor: true, appliesProperty: true },
  [StationKind.SHIPPING]: NONE,
  [StationKind.WEAVING]: { ...NONE, consumesWarpBeam: true },
  [StationKind.OTHER]: NONE,
};

export function suggestedCapabilities(kind: StationKind): StationCapabilityValues {
  return { ...STATION_KIND_CAPABILITY_DEFAULTS[kind] };
}

/** Tür değişince formun yeni değerleri: yeni kayıtta öneri uygulanır, düzenlemede yalnız tür değişir. */
export function valuesAfterKindChange(values: StationFormValues, kind: StationKind, editing: boolean): StationFormValues {
  if (editing) return { ...values, kind };
  return { ...values, kind, ...suggestedCapabilities(kind) };
}
