// =============================================================================
// TEZGAH SALONU — CANLI VERİ SÖZLEŞMESİ
// =============================================================================
// Ekranın okuduğu TEK şekil. Bugün `mock/` üretir; gerçek veriye geçişte yalnız
// `useLoomFloorLive` kancasının kaynağı değişir, bileşenler bu tiplere bağlı kalır.
// Alanların gerçek kaynağı: docs/design/DOKUMA-CANLI-EKRAN.md § Mock → gerçek veri.
// =============================================================================

/** `MachineStopLossClass` aynası (MINOR süre sınıfıdır, sebep değil — burada yok). */
export type LossClass = "UNPLANNED" | "SETUP" | "PLANNED" | "NON_SCHEDULED";

/** Uyarı zincirindeki kişi — mock'ta uydurma adlar. */
export interface Person {
  id: string;
  name: string;
  role: "ATTENDANT" | "OWNER";
}

/** Şu an açık duruş + uyarı zinciri damgaları (epoch ms). */
export interface OpenStop {
  reasonCode: string;
  startedAt: number;
  attendant: Person;
  /** Görevlinin telefonuna/saatine bildirim düştüğü an. */
  notifiedAt: number;
  /** Görevli bildirimi gördü ve tezgaha geldi; null = müdahale yok. */
  respondedAt: number | null;
  /** Hedef süre (+ pay) dolunca patrona iletildiği an. */
  escalatedAt: number | null;
}

/** Vardiya içinde kapanmış duruş. */
export interface StopRecord {
  reasonCode: string;
  startedAt: number;
  endedAt: number;
}

export type LoomEventKind = "RUN" | "STOP" | "NOTIFY" | "RESPOND" | "ESCALATE" | "DOFF";

export interface LoomEvent {
  at: number;
  kind: LoomEventKind;
  reasonCode?: string;
  person?: Person;
}

export interface WeavingJob {
  /** Dokuma işi numarası (`DK` + GGAAYY + NNNN). */
  no: string;
  fabric: string;
  /** Kumaşın görünen rengi — figürdeki dokunan bez bu renkte çizilir. */
  color: string;
  plannedM: number;
  producedM: number;
}

export interface BeamState {
  no: string;
  totalM: number;
  remainingM: number;
}

export interface ShiftCounters {
  picks: number;
  meters: number;
  targetMeters: number;
  /** Çalışılan süre (sn) — kullanılabilirliğin payı. */
  runSec: number;
  /** Planlanmış süre (sn) — NON_SCHEDULED duruşlar düşülmüş. */
  plannedSec: number;
}

/** Fabrika günü başından beri (içinde bulunulan vardiya dahil) — kartın "bugün %"i. */
export interface DayCounters {
  runSec: number;
  plannedSec: number;
}

export type LoomType = "AIR_JET" | "RAPIER";

export interface LiveLoom {
  id: string;
  code: string;
  hall: string;
  loomType: LoomType;
  /** Hedef devir (atkı/dk) — performansın paydası. */
  targetRpm: number;
  /** Anlık devir; duran tezgahta 0. */
  rpm: number;
  /** Ham atkı sıklığı (atkı/cm) — atkıdan metreye. */
  picksPerCm: number;
  openStop: OpenStop | null;
  shift: ShiftCounters;
  today: DayCounters;
  stops: StopRecord[];
  events: LoomEvent[];
  job: WeavingJob | null;
  beam: BeamState | null;
  /** Uydurulmuş değer beyanı — gerçek ölçüm gelince `MACHINE`. */
  source: "SIMULATED";
}

export interface Shift {
  name: string;
  startsAt: number;
  endsAt: number;
}

export interface FloorState {
  shift: Shift;
  halls: string[];
  looms: LiveLoom[];
  /** Son simülasyon adımının anı. */
  updatedAt: number;
  /** Tohumlu üretecin iç durumu — adımı saf tutar. */
  rng: number;
}
