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
    // ⚠️ Eskiden burada `case "WAREHOUSE"` vardı — backend `StationKind`'da
    // ÖYLE BİR DEĞER YOK (2026-09-03 drift taraması): dal ÖLÜYDÜ ve sevkiyat
    // istasyonu varsayılan `process` tonuna düşüyordu.
    case "SHIPPING":
      return "depo";
    // Tezgah üretim hattıdır; rota adımı olmadığı için chip'te nadiren çizilir —
    // çizildiğinde process tonu (ham→işlem) doğru komşuluktur.
    case "WEAVING":
      return "process";
    default:
      return "process";
  }
}

// İstasyon tonunun tam sınıf seti — chip/panel/ok gibi rota bileşenlerinde
// kenar/zemin/halka/sayı rozetini tek tonda boyamak için. Tailwind tarayıcısı
// literal sınıf ister; bu yüzden token adı string-birleştirme ile ÜRETİLMEZ,
// her ton tam yazılır.
export interface ToneClasses {
  /** İstasyon tonunda metin (text-station-X). */
  text: string;
  /** Dolu zemin (aktif sayı rozeti) — bg-station-X. */
  solid: string;
  /** Pasif sayı rozeti — yumuşak zemin + tonlu metin. */
  numIdle: string;
  /** Pasif kenar (border-station-X/45). */
  border: string;
  /** Aktif/güçlü kenar (border-station-X). */
  borderStrong: string;
  /** Hover'da kenar koyulaşır. */
  borderHover: string;
  /** Aktif chip/panel yumuşak zemini (bg-station-X/10). */
  bgSoft: string;
  /** Hover'da yumuşak zemin. */
  bgHover: string;
  /** Aktif halka (ring-station-X/50). */
  ring: string;
  /** Panel için ince halka (ring-station-X/20). */
  ringSoft: string;
}

export const STATION_TONE: Record<StationToneKey, ToneClasses> = {
  kk1: {
    text: "text-station-kk1",
    solid: "bg-station-kk1",
    numIdle: "bg-station-kk1/15 text-station-kk1",
    border: "border-station-kk1/45",
    borderStrong: "border-station-kk1",
    borderHover: "hover:border-station-kk1/70",
    bgSoft: "bg-station-kk1/10",
    bgHover: "hover:bg-station-kk1/10",
    ring: "ring-station-kk1/50",
    ringSoft: "ring-station-kk1/20",
  },
  fason: {
    text: "text-station-fason",
    solid: "bg-station-fason",
    numIdle: "bg-station-fason/15 text-station-fason",
    border: "border-station-fason/45",
    borderStrong: "border-station-fason",
    borderHover: "hover:border-station-fason/70",
    bgSoft: "bg-station-fason/10",
    bgHover: "hover:bg-station-fason/10",
    ring: "ring-station-fason/50",
    ringSoft: "ring-station-fason/20",
  },
  process: {
    text: "text-station-process",
    solid: "bg-station-process",
    numIdle: "bg-station-process/15 text-station-process",
    border: "border-station-process/45",
    borderStrong: "border-station-process",
    borderHover: "hover:border-station-process/70",
    bgSoft: "bg-station-process/10",
    bgHover: "hover:bg-station-process/10",
    ring: "ring-station-process/50",
    ringSoft: "ring-station-process/20",
  },
  tambur: {
    text: "text-station-tambur",
    solid: "bg-station-tambur",
    numIdle: "bg-station-tambur/15 text-station-tambur",
    border: "border-station-tambur/45",
    borderStrong: "border-station-tambur",
    borderHover: "hover:border-station-tambur/70",
    bgSoft: "bg-station-tambur/10",
    bgHover: "hover:bg-station-tambur/10",
    ring: "ring-station-tambur/50",
    ringSoft: "ring-station-tambur/20",
  },
  depo: {
    text: "text-station-depo",
    solid: "bg-station-depo",
    numIdle: "bg-station-depo/15 text-station-depo",
    border: "border-station-depo/45",
    borderStrong: "border-station-depo",
    borderHover: "hover:border-station-depo/70",
    bgSoft: "bg-station-depo/10",
    bgHover: "hover:bg-station-depo/10",
    ring: "ring-station-depo/50",
    ringSoft: "ring-station-depo/20",
  },
};

/** İstasyonu olmayan / kind bilinmeyen iç adım için primary tonu. */
export const PRIMARY_TONE: ToneClasses = {
  text: "text-primary",
  solid: "bg-primary",
  numIdle: "bg-primary/15 text-primary",
  border: "border-primary/45",
  borderStrong: "border-primary",
  borderHover: "hover:border-primary/70",
  bgSoft: "bg-primary/10",
  bgHover: "hover:bg-primary/10",
  ring: "ring-primary/50",
  ringSoft: "ring-primary/20",
};

/**
 * Rota adımının tonunu çöz: fason (dış) → turuncu, iç istasyon → kind rengi,
 * kind yoksa primary. Chip + panel + ok aynı tonu paylaşır.
 */
export function toneFor(
  stationType: "INTERNAL" | "EXTERNAL",
  stationKind?: string | null,
): ToneClasses {
  if (stationType === "EXTERNAL") return STATION_TONE.fason;
  if (stationKind) return STATION_TONE[stationToneForKind(stationKind)];
  return PRIMARY_TONE;
}
