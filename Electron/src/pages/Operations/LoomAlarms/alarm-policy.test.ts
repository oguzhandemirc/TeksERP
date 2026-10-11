// Eylem düğmeleri izne ve alarmın hâline göre: görmeye izin eylem izni değildir; başkasının
// üstlenmesini yalnız üst kademe bırakır; kapalı alarmda yalnız not kalır; not yalnız sahibince geri çekilir.
import { describe, expect, it } from "vitest";
import { alarmButtons, canRetractNote } from "./alarm-policy";

const NOW = Date.parse("2026-10-11T08:00:00Z");
const ME = "u-me";
const act = { canAct: true, canReleaseOthers: false };
const open = { state: "OPEN" as const, ackedBy: null, snoozedUntil: null };
const ackedByMe = { state: "ACKED" as const, ackedBy: { id: ME, name: "Ben" }, snoozedUntil: null };
const ackedByOther = { state: "ACKED" as const, ackedBy: { id: "u-x", name: "Ahmet Usta" }, snoozedUntil: null };

describe("alarmButtons", () => {
  it("⭐ eylem izni yok (yalnız görme) → hiçbir düğme", () => {
    const b = alarmButtons(open, { canAct: false, canReleaseOthers: true }, ME, NOW);
    expect(Object.values(b).some(Boolean)).toBe(false);
  });

  it("açık alarm → Üstlen · Sustur · Not; Bırak yok", () => {
    expect(alarmButtons(open, act, ME, NOW)).toEqual({ ack: true, release: false, releaseOther: false, snooze: true, unsnooze: false, note: true });
  });

  it("kendi üstlendiğim → Bırak; Üstlen yok", () => {
    const b = alarmButtons(ackedByMe, act, ME, NOW);
    expect(b.ack).toBe(false);
    expect(b.release).toBe(true);
    expect(b.releaseOther).toBe(false);
  });

  it("⭐ başkasının üstlendiği → yalnız `loom:alarm-escalation` ile bırakılır", () => {
    expect(alarmButtons(ackedByOther, act, ME, NOW).releaseOther).toBe(false);
    expect(alarmButtons(ackedByOther, { ...act, canReleaseOthers: true }, ME, NOW).releaseOther).toBe(true);
    expect(alarmButtons(ackedByOther, { ...act, canReleaseOthers: true }, ME, NOW).release).toBe(false);
  });

  it("susturma sürerken Sustur yerine Susturmayı kaldır; süre geçince geri döner", () => {
    const until = new Date(NOW + 10 * 60_000).toISOString();
    const b = alarmButtons({ ...open, snoozedUntil: until }, act, ME, NOW);
    expect(b.snooze).toBe(false);
    expect(b.unsnooze).toBe(true);
    const later = alarmButtons({ ...open, snoozedUntil: until }, act, ME, NOW + 11 * 60_000);
    expect(later.snooze).toBe(true);
    expect(later.unsnooze).toBe(false);
  });

  it("⭐ kapanmış alarm → yalnız Not (sunucu kapanmışa not kabul eder)", () => {
    for (const state of ["RESOLVED", "CANCELLED"] as const) {
      expect(alarmButtons({ ...ackedByMe, state }, { canAct: true, canReleaseOthers: true }, ME, NOW)).toEqual({
        ack: false, release: false, releaseOther: false, snooze: false, unsnooze: false, note: true,
      });
    }
  });
});

describe("canRetractNote", () => {
  const note = { kind: "NOTE" as const, user: { id: ME, name: "Ben" }, retracted: false };
  it("yalnız sahibi, bir kez, eylem izniyle", () => {
    expect(canRetractNote(note, true, ME)).toBe(true);
    expect(canRetractNote(note, false, ME)).toBe(false);
    expect(canRetractNote(note, true, "u-x")).toBe(false);
    expect(canRetractNote({ ...note, retracted: true }, true, ME)).toBe(false);
    expect(canRetractNote({ ...note, kind: "ACK" as const }, true, ME)).toBe(false);
  });
});
