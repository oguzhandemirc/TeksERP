import { describe, expect, it } from "vitest";
import { changedFields, toFormState, touchesCalendar, validateShiftForm } from "./form-model";
import type { ShiftDefinition } from "./types";

const def: ShiftDefinition = {
  id: "d1", code: "A", name: "Gündüz", startMinute: 480, durationMinutes: 480, plannedBreakMinutes: 30,
  activeWeekdays: [], sortOrder: 0, isActive: true, createdAt: "", updatedAt: "",
};

describe("vardiya formu", () => {
  it("geçerli form gövdeye çevrilir; kod büyük harf, yedi gün = boş dizi", () => {
    const r = validateShiftForm({ ...toFormState(), code: "ek1", name: " Ek ", weekdays: [0, 1, 2, 3, 4, 5, 6] }, true);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.code).toBe("EK1");
      expect(r.fields).toEqual({ name: "Ek", startMinute: 480, durationMinutes: 480, plannedBreakMinutes: 0, activeWeekdays: [], sortOrder: 0 });
    }
  });
  it("mola ≥ süre, geçersiz saat, sıfır süre ve geçersiz kod reddedilir", () => {
    const r = validateShiftForm({ ...toFormState(), code: "a-b", name: "X", start: "25:00", durationHours: "0", durationMinutes: "0", breakMinutes: "10" }, true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["breakMinutes", "code", "durationHours", "start"]);
  });
  it("düzenlemede kod doğrulanmaz (değişmez alan)", () => {
    expect(validateShiftForm(toFormState(def), false).ok).toBe(true);
  });
  it("güncelleme yalnız DEĞİŞEN alanı taşır; mola/ad takvime dokunmaz, saat dokunur", () => {
    const r = validateShiftForm({ ...toFormState(def), breakMinutes: "45" }, false);
    if (!r.ok) throw new Error("geçersiz");
    const p = changedFields(def, r.fields);
    expect(p).toEqual({ plannedBreakMinutes: 45 });
    expect(touchesCalendar(p)).toBe(false);
    const r2 = validateShiftForm({ ...toFormState(def), start: "07:00", weekdays: [1, 2] }, false);
    if (!r2.ok) throw new Error("geçersiz");
    const p2 = changedFields(def, r2.fields);
    expect(p2).toEqual({ startMinute: 420, activeWeekdays: [1, 2] });
    expect(touchesCalendar(p2)).toBe(true);
  });
});
