// =============================================================================
// İstasyonlar sayfasının TÜR KÜMESİ — formun kaydettirdiği HER tür, tek kaynak `schema.ts` (2026-09-16)
// =============================================================================
// Kullanıcı testi bulgusu: sayfa `["RAW_QC","PROCESS_QC","TAMBUR","SUBCONTRACTOR"]` sabitiyle
// süzüyordu; dokuma şemasıyla doğan `WEAVING` listeye girmemişti ⇒ kullanıcı "Dokuma Tezgahı"
// istasyonu kaydediyor, kart çizilmiyor, dışa aktarımda yok, tezgah (makine) eklenemiyor
// ("altıncı enum değeri unutuldu" sınıfı). Kullanıcı sorusu: "sevkiyat ekleyebiliyorsam neden
// göstermiyorum?" ⇒ dışlama listesi de YOK: form hangi türü kaydettiriyorsa sayfa onu listeler ve
// dışa aktarır. Tek gizleme MODÜL BAYRAĞI (`FLAG_GATED_STATION_KINDS`): WEAVING dokuma kapalıyken
// çizilmez — kayıt DB'de korunur, form aynı kaynaktan mevcut değeri korur (`visibleStationKindLabels`).
// =============================================================================
import type { StationKind } from "@/types/enums";
import { stationFormSchema } from "./schema";
import { FLAG_GATED_STATION_KINDS } from "./stationKindVisibility";

/** Formun kaydettirebildiği türler — `schema.ts` zod enum'undan TÜRETİLİR (iki yerde yazılmaz). */
export const STATION_FORM_KINDS: readonly StationKind[] = stationFormSchema.shape.kind.options;

export type StationKindFlags = { dokumaEnabled: boolean };

/** Tür bu sayfada çizilir mi: formda var ∧ (bayrağa bağlı değil ∨ bayrağı açık). */
export function isVisibleStationKind(kind: StationKind, flags: StationKindFlags): boolean {
  if (!STATION_FORM_KINDS.includes(kind)) return false;
  const gate = FLAG_GATED_STATION_KINDS[kind];
  return !gate || flags[gate];
}

/** Sayfanın tür kümesi (liste + dışa aktarım aynı kümeden). */
export function visibleStationKinds(flags: StationKindFlags): StationKind[] {
  return STATION_FORM_KINDS.filter((k) => isVisibleStationKind(k, flags));
}
