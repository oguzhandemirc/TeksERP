// Görev türünün LİSTEDEKİ sade adı — formdaki teknik etiket (`stationKindLabels`) değişmez; liste ve
// panel kullanıcının diliyle konuşur ("Ara istasyon (işlem/kontrol)" → "Üretim adımı").
import { stationKindLabel } from "@/types/enums";

const PLAIN_KIND_LABELS: Record<string, string> = {
  RAW_QC: "Giriş kontrolü (KK1)",
  PROCESS_QC: "Üretim adımı",
  TAMBUR: "Tambur",
  SUBCONTRACTOR: "Fason işlem",
  SHIPPING: "Sevkiyat ve tartı",
  OTHER: "Diğer",
  WEAVING: "Dokuma",
  WARPING: "Levent sarım (devere)",
};

export function plainStationKindLabel(kind: string): string {
  return PLAIN_KIND_LABELS[kind] ?? stationKindLabel(kind);
}
