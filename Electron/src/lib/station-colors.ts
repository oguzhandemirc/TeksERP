// Üretim akışı istasyon renk anahtarları → Tailwind token sınıfları.
// index.css `--station-*` token'larıyla eşleşir; tüm uygulamada istasyonu
// renkten okumak için tek kaynak. Akış: KK1 → Fason → Kurşun/KK2 → Tambur → Depo.

export const STATION_TEXT = {
  kk1: "text-station-kk1",
  fason: "text-station-fason",
  process: "text-station-process",
  tambur: "text-station-tambur",
  depo: "text-station-depo",
} as const;

export type StationToneKey = keyof typeof STATION_TEXT;

/** Backend StationKind enum → renk anahtarı. */
export function stationToneForKind(kind: string): StationToneKey {
  switch (kind) {
    case "RAW_QC":
      return "kk1";
    case "PROCESS_QC":
      return "process";
    case "TAMBUR":
      return "tambur";
    case "WAREHOUSE":
      return "depo";
    default:
      return "process";
  }
}
