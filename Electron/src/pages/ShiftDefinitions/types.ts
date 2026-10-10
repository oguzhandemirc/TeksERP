// =============================================================================
// VARDİYA TANIMI — tipler ve SAF biçim yardımcıları (backend `shift-definition.service` aynası)
// =============================================================================
// Saat "gece yarısından dakika" olarak taşınır (takvim KURALI, mutlak an değil); ekran
// HH:MM gösterir. Haftagünü 0=Pazar..6=Cumartesi; BOŞ dizi = her gün (şema sözleşmesi).
// =============================================================================

export interface ShiftDefinition {
  id: string;
  code: string;
  name: string;
  startMinute: number;
  durationMinutes: number;
  plannedBreakMinutes: number;
  activeWeekdays: number[];
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ShiftDefinitionFields {
  name: string;
  startMinute: number;
  durationMinutes: number;
  plannedBreakMinutes: number;
  activeWeekdays: number[];
  sortOrder: number;
}

export interface ShiftCalendarSummary {
  created: number;
  rewritten: number;
  sealedSkipped: number;
  unchanged: number;
  startedSkipped?: number;
  retired?: number;
}

export interface ShiftDefinitionWriteResult {
  definition: ShiftDefinition;
  calendar: ShiftCalendarSummary | "disabled" | null;
}

export interface ShiftPreviewWindow {
  id: string | null;
  factoryDay: string;
  startsAt: string;
  endsAt: string;
  to?: { startsAt: string; endsAt: string };
}

export interface ShiftDefinitionPreview {
  create: ShiftPreviewWindow[];
  rewrite: ShiftPreviewWindow[];
  retire: ShiftPreviewWindow[];
  kept: ShiftPreviewWindow[];
}

/** Pazartesi başlı ekran sırası; değer backend'in 0=Pazar kodlaması. */
export const WEEKDAYS: ReadonlyArray<{ value: number; short: string }> = [
  { value: 1, short: "Pzt" },
  { value: 2, short: "Sal" },
  { value: 3, short: "Çar" },
  { value: 4, short: "Per" },
  { value: 5, short: "Cum" },
  { value: 6, short: "Cmt" },
  { value: 0, short: "Paz" },
];

/** 480 → "08:00"; 1440'ı aşan bitiş (gece yarısını geçen vardiya) gün içine katlanır. */
export function minuteToHhmm(m: number): string {
  const d = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(d / 60)).padStart(2, "0")}:${String(d % 60).padStart(2, "0")}`;
}

/** "08:30" → 510; geçersiz → null. */
export function hhmmToMinute(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h <= 23 && mi <= 59 ? h * 60 + mi : null;
}

/** "08:00–16:00", gece yarısını geçen vardiyada "(ertesi gün)". */
export function windowLabel(d: Pick<ShiftDefinition, "startMinute" | "durationMinutes">): string {
  const end = d.startMinute + d.durationMinutes;
  return `${minuteToHhmm(d.startMinute)}–${minuteToHhmm(end)}${end > 1440 ? " (ertesi gün)" : ""}`;
}

/** 510 → "8 sa 30 dk". */
export function durationLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h} sa` : "", m ? `${m} dk` : ""].filter(Boolean).join(" ") || "0 dk";
}

/** Boş dizi ya da yedi gün → "Her gün"; aksi Pazartesi başlı kısa adlar. */
export function weekdaysLabel(days: number[]): string {
  if (days.length === 0 || days.length === 7) return "Her gün";
  return WEEKDAYS.filter((w) => days.includes(w.value)).map((w) => w.short).join(" · ");
}
