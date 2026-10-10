// =============================================================================
// VARDİYA TANIMI FORMU — SAF model (durum · doğrulama · güncelleme farkı)
// =============================================================================
// Backend `.strict()` gövde ve `shift_definitions_window_sane` CHECK'inin panel aynası;
// asıl kapı backend'dir. Güncellemede YALNIZ değişen alan gönderilir (kod hiç gönderilmez).
// =============================================================================
import { hhmmToMinute, minuteToHhmm, type ShiftDefinition, type ShiftDefinitionFields } from "./types";

export interface ShiftFormState {
  code: string;
  name: string;
  start: string; // HH:MM
  durationHours: string;
  durationMinutes: string;
  breakMinutes: string;
  weekdays: number[]; // boş = her gün
  sortOrder: string;
}

export function toFormState(d?: ShiftDefinition): ShiftFormState {
  if (!d) return { code: "", name: "", start: "08:00", durationHours: "8", durationMinutes: "0", breakMinutes: "0", weekdays: [], sortOrder: "0" };
  return {
    code: d.code,
    name: d.name,
    start: minuteToHhmm(d.startMinute),
    durationHours: String(Math.floor(d.durationMinutes / 60)),
    durationMinutes: String(d.durationMinutes % 60),
    breakMinutes: String(d.plannedBreakMinutes),
    weekdays: d.activeWeekdays,
    sortOrder: String(d.sortOrder),
  };
}

const int = (s: string): number | null => (/^-?\d+$/.test(s.trim()) ? Number(s.trim()) : null);

export type ShiftFormResult =
  | { ok: true; code: string; fields: ShiftDefinitionFields }
  | { ok: false; errors: Partial<Record<keyof ShiftFormState, string>> };

export function validateShiftForm(s: ShiftFormState, isCreate: boolean): ShiftFormResult {
  const errors: Partial<Record<keyof ShiftFormState, string>> = {};
  const code = s.code.trim().toUpperCase();
  if (isCreate && !/^[A-Z0-9]{1,8}$/.test(code)) errors.code = "Kod 1–8 karakter, yalnız harf (A–Z) ve rakam.";
  const name = s.name.trim();
  if (!name) errors.name = "Vardiya adı zorunlu.";
  else if (name.length > 100) errors.name = "En fazla 100 karakter.";
  const startMinute = hhmmToMinute(s.start);
  if (startMinute === null) errors.start = "Saat SS:DD biçiminde (00:00–23:59).";
  const h = int(s.durationHours);
  const m = int(s.durationMinutes);
  const duration = h !== null && m !== null && h >= 0 && m >= 0 && m <= 59 ? h * 60 + m : null;
  if (duration === null || duration < 1 || duration > 1440) errors.durationHours = "Süre 1 dakika ile 24 saat arasında olmalı.";
  const brk = int(s.breakMinutes);
  if (brk === null || brk < 0 || (duration !== null && brk >= duration)) errors.breakMinutes = "Mola 0 ya da vardiya süresinden kısa olmalı.";
  const sortOrder = int(s.sortOrder);
  if (sortOrder === null || Math.abs(sortOrder) > 9999) errors.sortOrder = "Sıra −9999 ile 9999 arasında bir tam sayı.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const weekdays = [...new Set(s.weekdays)].sort((a, b) => a - b);
  return {
    ok: true,
    code,
    fields: { name, startMinute: startMinute!, durationMinutes: duration!, plannedBreakMinutes: brk!, activeWeekdays: weekdays.length === 7 ? [] : weekdays, sortOrder: sortOrder! },
  };
}

/** Güncellemede yalnız DEĞİŞEN alanlar (boş nesne = değişiklik yok). */
export function changedFields(d: ShiftDefinition, f: ShiftDefinitionFields): Partial<ShiftDefinitionFields> {
  const out: Partial<ShiftDefinitionFields> = {};
  if (f.name !== d.name) out.name = f.name;
  if (f.startMinute !== d.startMinute) out.startMinute = f.startMinute;
  if (f.durationMinutes !== d.durationMinutes) out.durationMinutes = f.durationMinutes;
  if (f.plannedBreakMinutes !== d.plannedBreakMinutes) out.plannedBreakMinutes = f.plannedBreakMinutes;
  if (f.sortOrder !== d.sortOrder) out.sortOrder = f.sortOrder;
  const a = [...d.activeWeekdays].sort((x, y) => x - y).join(",");
  if (f.activeWeekdays.join(",") !== a) out.activeWeekdays = f.activeWeekdays;
  return out;
}

/** Takvimi etkileyen değişiklik mi (önizleme gerekir)? Ad/sıra/mola takvim penceresini değiştirmez. */
export function touchesCalendar(p: Partial<ShiftDefinitionFields>): boolean {
  return p.startMinute !== undefined || p.durationMinutes !== undefined || p.activeWeekdays !== undefined;
}
