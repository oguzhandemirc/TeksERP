// İstasyon belge okutma doğrulaması (2026-11-06) — backend `gelenBelge.stationVerifyThreshold` + okutma izi aynası.

/** Eski backend göndermez → alan çizilmez (yazılamayan ayar gösterilmez). */
export interface StationVerifySettings {
  /** 0–100; 0 = kapalı (doğrulamasız). */
  stationVerifyThreshold?: number;
  defaultStationVerifyThreshold?: number;
}

export interface StationScanComponent {
  key: string;
  label: string;
  weight: number;
  ratio: number;
  matched: boolean;
  detail: string;
}

/** `GET /api/gelen-belge/istasyon-okutma/son` satırı (TELEMETRİ). */
export interface StationScanCheckRow {
  id: string;
  createdAt: string;
  screen: string | null;
  source: string;
  readDocNo: string | null;
  readBatchNo: string | null;
  threshold: number;
  bestScore: number | null;
  candidateCount: number;
  verifiedCount: number;
  decision: "VERIFIED" | "UNSURE" | "NONE" | "OFF" | "SAME_PHOTO" | string;
  components: StationScanComponent[] | null;
  bestWorkOrderNumber: string | null;
  openedWorkOrderNumber: string | null;
  openedHow: "AUTO" | "CHOSEN" | "CONFIRMED" | string | null;
  openedAt: string | null;
}
