// =============================================================================
// TEZGAH SALONU — CANLI VERİ SÖZLEŞMESİ
// =============================================================================
// Ekranın okuduğu TEK şekil. Uygulamada `GET /api/loom-floor` (`fromApi`), geliştirme
// önizlemesinde `mock/` üretir; bileşenler yalnız bu tiplere bağlıdır. `null` alan =
// bugün ölçülmüyor (sayaç/levent/devir telemetrisi sonraki fazda) — ekran "—" basar, uydurmaz.
// =============================================================================

/** `MachineStopLossClass` aynası (MINOR süre sınıfıdır, sebep değil — burada yok). */
export type LossClass = "UNPLANNED" | "SETUP" | "PLANNED" | "NON_SCHEDULED";

/** Uyarı zincirindeki kişi — bildirim kanalı gelene dek yalnız önizlemede dolu. */
export interface Person {
  id: string;
  name: string;
  role: "ATTENDANT" | "OWNER";
}

/** Şu an açık duruş + uyarı zinciri damgaları (epoch ms). */
export interface OpenStop {
  /** null = sebep bekleniyor (operatör henüz seçmedi). */
  reasonCode: string | null;
  /** Görünen sebep adı — sunucu kataloğundan; kod ekranda sözlüğe çevrilmez. */
  label: string;
  /** null = sebep bekleniyor (ekran plansız duruş gibi çizer). */
  lossClass: LossClass | null;
  startedAt: number;
  /** Duruşa DONMUŞ hedef süre (dk); null = süre izlenmez. */
  targetMin: number | null;
  /** Duruşa DONMUŞ iletim payı (dk) — hedef aşıldıktan sonra patrona iletime kadar. */
  graceMin: number;
  /** Bildirim kanalı yokken null. */
  attendant: Person | null;
  /** Görevlinin telefonuna/saatine bildirim düştüğü an; bildirim yoksa null. */
  notifiedAt: number | null;
  /** Görevli bildirimi gördü ve tezgaha geldi; null = müdahale yok. */
  respondedAt: number | null;
  /** Hedef süre (+ pay) dolunca patrona iletildiği an. */
  escalatedAt: number | null;
}

/** Vardiya içinde kapanmış duruş. */
export interface StopRecord {
  reasonCode: string | null;
  label: string;
  lossClass: LossClass | null;
  startedAt: number;
  endedAt: number;
}

export type LoomEventKind = "RUN" | "STOP" | "NOTIFY" | "RESPOND" | "ESCALATE" | "DOFF";

export interface LoomEvent {
  at: number;
  kind: LoomEventKind;
  reasonCode?: string | null;
  /** Sebep adı (STOP olayında) — yoksa olay türünün metni basılır. */
  label?: string;
  lossClass?: LossClass | null;
  person?: Person;
}

export interface WeavingJob {
  /** Dokuma işi numarası (`DK` + GGAAYY + NNNN). */
  no: string;
  fabric: string;
  /** Kumaşın görünen rengi — figürdeki dokunan bez bu renkte çizilir. */
  color: string;
  /** null = plan metresi girilmemiş. */
  plannedM: number | null;
  /** null = üretilen metre ölçülmüyor. */
  producedM: number | null;
}

export interface BeamState {
  no: string;
  /** Tezgahtaki yuva (1..); bilinmiyorsa null. */
  slot: number | null;
  /** Çözgü kodu; önizlemede null. */
  warpSpec: string | null;
  /** Oranın paydası (leventin plan uzunluğu); null = oran çizilmez. */
  totalM: number | null;
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

/** Sebebe göre duruş toplamı (detay panelinin çubukları). */
export interface StopTotal {
  reasonCode: string | null;
  label: string;
  lossClass: LossClass | null;
  count: number;
  ms: number;
}

export interface LiveLoom {
  id: string;
  code: string;
  /** Görünen hol adı (istasyon adı). */
  hall: string;
  /** İzleme kapalı tezgah (künyede OFF) — durumu bilinmez, sayılara girmez. */
  monitored: boolean;
  loomType: LoomType | null;
  /** Hedef devir (atkı/dk) — performansın paydası; ölçülmemişse null. */
  targetRpm: number | null;
  /** Anlık devir; duran tezgahta 0, ölçülmüyorsa null. */
  rpm: number | null;
  /** Ham atkı sıklığı (atkı/cm) — atkıdan metreye. */
  picksPerCm: number | null;
  openStop: OpenStop | null;
  /** Vardiya sayaçları (atkı · metre); sayaç telemetrisi yokken null. */
  shift: ShiftCounters | null;
  today: DayCounters;
  stops: StopRecord[];
  /** Günün sebep kırılımı sunucudan geldiyse o (bugün tümü); yoksa `stops`tan hesaplanır. */
  dayBreakdown: StopTotal[] | null;
  events: LoomEvent[];
  job: WeavingJob | null;
  /** Takılı leventler (yuva sırasıyla); levent ölçülmüyorsa ya da takılı yoksa boş. */
  beams: BeamState[];
  /** Veri kaynağı beyanı (`MACHINE` · `OPERATOR` · `SIMULATED` …). */
  source: string;
}

export interface Shift {
  name: string;
  startsAt: number;
  endsAt: number;
}

export interface FloorState {
  /** Vardiya takvimi yoksa null. */
  shift: Shift | null;
  halls: string[];
  looms: LiveLoom[];
  /** Son simülasyon adımının anı. */
  updatedAt: number;
  /** Tohumlu üretecin iç durumu — adımı saf tutar. */
  rng: number;
}
