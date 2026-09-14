// =============================================================================
// TEZGAH DURUŞLARI — panel tipleri (backend `MachineStopDto` / `StopReclassDto` aynası)
// =============================================================================
// Duruş `MachineRun`ın DEFTERİDİR: açılış/kapanış/sebep kararı satıra yazılır,
// sebep DEĞİŞİMİ ayrı deftere (`MachineStopReclass`, from→to, karşı kayıtla geri
// alınır). Geri alma DAMGADIR (`revokedAt`), satır silinmez. Kayıp sınıfı sebepten
// KOPYALANIR ve donar — katalog değişse geçmiş rapor değişmez.
// =============================================================================

export type StopLossClass = "UNPLANNED" | "SETUP" | "PLANNED" | "NON_SCHEDULED" | "MINOR";
export type StopSource = "MACHINE" | "INFERRED" | "OPERATOR" | "SUPERVISOR" | "SIMULATED";

export interface StopShift {
  id: string;
  startsAt: string;
  endsAt: string;
  isCancelled: boolean;
  shiftDefinition: { code: string; name: string };
}

export interface MachineStop {
  id: string;
  machineId: string;
  runId: string | null;
  stopKey: string;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  endSource: string | null;
  beamSlot: number | null;
  reasonCode: string | null;
  lossClass: StopLossClass | null;
  reasonNote: string | null;
  reasonSource: StopSource | null;
  classifiedById: string | null;
  classifiedAt: string | null;
  /** Açılışta sebep verilmedi — sınıflandırma BORCU (kuyruk bu satırlardır). */
  requiresReason: boolean;
  shiftInstanceId: string | null;
  factoryDay: string;
  source: StopSource;
  revokedAt: string | null;
  revokeReason: string | null;
  createdAt: string;
  machine: { code: string; name: string };
  shiftInstance: StopShift | null;
  classifiedBy: { fullName: string } | null;
}

export interface StopReclass {
  id: string;
  fromReasonCode: string | null;
  toReasonCode: string | null;
  fromLossClass: StopLossClass | null;
  toLossClass: StopLossClass | null;
  reason: string | null;
  createdAt: string;
  actedBy: { fullName: string } | null;
}

export const LOSS_CLASS_META: Record<StopLossClass, { label: string; badgeClass: string }> = {
  UNPLANNED: { label: "Plansız", badgeClass: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" },
  SETUP: { label: "Kurulum", badgeClass: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  PLANNED: { label: "Planlı", badgeClass: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" },
  NON_SCHEDULED: { label: "Çalışma dışı", badgeClass: "bg-slate-100 text-slate-900 dark:bg-slate-900 dark:text-slate-200" },
  MINOR: { label: "Mikro", badgeClass: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200" },
};

export const SOURCE_LABEL: Record<StopSource, string> = {
  MACHINE: "Makine",
  INFERRED: "Türetilmiş",
  OPERATOR: "Operatör (tablet)",
  SUPERVISOR: "Vardiya amiri (panel)",
  SIMULATED: "Simüle",
};

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** "1 sa 05 dk" / "12 dk" / "<1 dk"; açık duruşta `now`dan hesaplanır. */
export function formatDuration(sec: number | null, startedAt: string, endedAt: string | null, nowMs: number): string {
  const total = sec ?? Math.floor(((endedAt ? Date.parse(endedAt) : nowMs) - Date.parse(startedAt)) / 1000);
  if (!Number.isFinite(total) || total < 0) return "—";
  const min = Math.floor(total / 60);
  if (min < 1) return "<1 dk";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} sa ${String(m).padStart(2, "0")} dk` : `${m} dk`;
}

/** `datetime-local` girdisi → ISO (yerel saat; sunucu `startedAt`i ajan saati sayar, süre bundan). */
export function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Şimdi → `datetime-local` biçimi (yerel). */
export function nowLocalInput(at: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}T${p(at.getHours())}:${p(at.getMinutes())}`;
}

/** Bugünün fabrika günü anahtarı (`YYYY-MM-DD`, yerel takvim). */
export function todayKey(at: Date = new Date()): string {
  return nowLocalInput(at).slice(0, 10);
}
