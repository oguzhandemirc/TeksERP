// Sinyal politikası: yeni alarm/kademe BİR KEZ; tekrar çalma yalnız üstlenilmemiş + susturulmamış
// alarmda ve ayarlı aralıkla; ses tercihi kapalıyken ses yok (bildirim sürer); tek turda tek ses.
import { describe, expect, it, vi } from "vitest";
import { alarmSignalOf, freshSignals, notificationTextOf, stripLeadOf } from "./alarm-signal";
import { sessionKeySet } from "./alarm-seen";
import { dispatchAlarmSignals } from "./useLoomAlarmSignals";
import { alarmToneOf, playAlarmTone, resetAlarmAudioForTest } from "./alarm-sound";
import type { LoomAlarmItem } from "./types";

const NOW = Date.parse("2026-10-11T08:00:00Z");
const MIN = 60_000;
const ID = "3f2b8c1e-9a4d-4e2f-8b6a-1c2d3e4f5a6b";

function alarm(over: Partial<LoomAlarmItem> = {}): LoomAlarmItem {
  return {
    id: ID, kind: "STOP_OVERDUE", state: "OPEN", tier: 1,
    machine: { id: "m1", code: "TZ-12", name: "TZ-12", hallId: "h1", hallName: "Hol A" },
    stop: { id: "s1", startedAt: new Date(NOW - 12 * MIN).toISOString(), endedAt: null, reasonCode: "IP", reasonLabel: "İp atlama", lossClass: "UNPLANNED", source: "OPERATOR" },
    targetMinutes: 10, graceMinutes: 0, k1DueAt: new Date(NOW - 2 * MIN).toISOString(), k2DueAt: null,
    ackedBy: null, ackedAt: null, snoozedBy: null, snoozedUntil: null, closedAt: null, totalSec: null, overdueSec: null, cancelReason: null,
    createdAt: new Date(NOW - 2 * MIN).toISOString(),
    ...over,
  };
}

const memSet = () => sessionKeySet("t", null);

describe("alarmSignalOf", () => {
  it("yeni alarm → kademe anahtarı; tekrar aralığı dolunca r1, r2…", () => {
    expect(alarmSignalOf(alarm(), NOW, 10)?.key).toBe(`${ID}:k1`);
    expect(alarmSignalOf(alarm(), NOW + 8 * MIN, 10)?.key).toBe(`${ID}:k1:r1`);
    expect(alarmSignalOf(alarm(), NOW + 18 * MIN, 10)?.key).toBe(`${ID}:k1:r2`);
    expect(alarmSignalOf(alarm(), NOW + 8 * MIN, 30)?.key).toBe(`${ID}:k1`);
  });

  it("2. kademe yeni anahtar; tekrar K2 vadesinden sayılır", () => {
    const a = alarm({ tier: 2, k2DueAt: new Date(NOW).toISOString() });
    expect(alarmSignalOf(a, NOW + 5 * MIN, 10)?.key).toBe(`${ID}:k2`);
    expect(alarmSignalOf(a, NOW + 10 * MIN, 10)?.key).toBe(`${ID}:k2:r1`);
  });

  it("⭐ üstlenilmiş alarm tekrar çalmaz; yalnız 2. kademe bir kez", () => {
    expect(alarmSignalOf(alarm({ state: "ACKED" }), NOW + 60 * MIN, 10)).toBeNull();
    expect(alarmSignalOf(alarm({ state: "ACKED", tier: 2 }), NOW + 60 * MIN, 10)?.key).toBe(`${ID}:k2`);
  });

  it("⭐ susturulmuş alarm tekrar çalmaz (yeni kademe yine çalar)", () => {
    const snoozed = alarm({ snoozedUntil: new Date(NOW + 60 * MIN).toISOString() });
    expect(alarmSignalOf(snoozed, NOW + 30 * MIN, 10)?.key).toBe(`${ID}:k1`);
    expect(alarmSignalOf({ ...snoozed, tier: 2 }, NOW + 30 * MIN, 10)?.key).toBe(`${ID}:k2`);
  });

  it("kapanmış alarm çalmaz", () => {
    expect(alarmSignalOf(alarm({ state: "RESOLVED" }), NOW, 10)).toBeNull();
    expect(alarmSignalOf(alarm({ state: "CANCELLED" }), NOW, 10)).toBeNull();
  });
});

describe("dispatchAlarmSignals", () => {
  const outputs = () => ({ playTone: vi.fn(), notify: vi.fn() });

  it("⭐ aynı alarm/kademe yalnız BİR KEZ: ikinci yoklamada ses de bildirim de yok", () => {
    const seen = memSet();
    const out = outputs();
    expect(dispatchAlarmSignals([alarm()], seen, NOW, { renotifyMinutes: 10, soundOn: true, out })).toHaveLength(1);
    dispatchAlarmSignals([alarm()], seen, NOW + 15_000, { renotifyMinutes: 10, soundOn: true, out });
    dispatchAlarmSignals([alarm()], seen, NOW + 30_000, { renotifyMinutes: 10, soundOn: true, out });
    expect(out.playTone).toHaveBeenCalledTimes(1);
    expect(out.notify).toHaveBeenCalledTimes(1);
    expect(out.notify.mock.calls[0]?.[0]).toMatchObject({ alarmId: ID });
  });

  it("⭐ yeni kademe yeniden çalar (2. kademe tonu)", () => {
    const seen = memSet();
    const out = outputs();
    dispatchAlarmSignals([alarm()], seen, NOW, { renotifyMinutes: 10, soundOn: true, out });
    dispatchAlarmSignals([alarm({ tier: 2, k2DueAt: new Date(NOW + MIN).toISOString() })], seen, NOW + MIN, { renotifyMinutes: 10, soundOn: true, out });
    expect(out.playTone.mock.calls).toEqual([[1], [2]]);
    expect(out.notify).toHaveBeenCalledTimes(2);
  });

  it("tekrar aralığı dolunca bir kez daha çalar", () => {
    const seen = memSet();
    const out = outputs();
    dispatchAlarmSignals([alarm()], seen, NOW, { renotifyMinutes: 10, soundOn: true, out });
    dispatchAlarmSignals([alarm()], seen, NOW + 8 * MIN, { renotifyMinutes: 10, soundOn: true, out });
    dispatchAlarmSignals([alarm()], seen, NOW + 9 * MIN, { renotifyMinutes: 10, soundOn: true, out });
    expect(out.playTone).toHaveBeenCalledTimes(2);
  });

  it("⭐ ses tercihi KAPALIYKEN ses çalmaz, bildirim yine çıkar", () => {
    const out = outputs();
    dispatchAlarmSignals([alarm()], memSet(), NOW, { renotifyMinutes: 10, soundOn: false, out });
    expect(out.playTone).not.toHaveBeenCalled();
    expect(out.notify).toHaveBeenCalledTimes(1);
  });

  it("aynı turda birden çok yeni alarm → tek ses (en üst kademe) + tek bildirim (+N)", () => {
    const out = outputs();
    const b = alarm({ id: "b", tier: 2, k2DueAt: new Date(NOW).toISOString() });
    const fresh = dispatchAlarmSignals([alarm(), b], memSet(), NOW, { renotifyMinutes: 10, soundOn: true, out });
    expect(fresh.map((s) => s.alarm.id)).toEqual(["b", ID]);
    expect(out.playTone.mock.calls).toEqual([[2]]);
    expect(out.notify).toHaveBeenCalledTimes(1);
    expect((out.notify.mock.calls[0]?.[0] as { body: string }).body).toContain("+1 alarm daha");
  });
});

describe("şerit + metin", () => {
  it("şerit: üstlenilmemiş en önceliklisi (üst kademe, sonra en eski); kapatılan gelmez", () => {
    const old = alarm({ id: "old", stop: { ...alarm().stop, startedAt: new Date(NOW - 40 * MIN).toISOString() } });
    const k2 = alarm({ id: "k2", tier: 2 });
    const acked = alarm({ id: "ack", tier: 2, state: "ACKED" });
    const dismissed = memSet();
    expect(stripLeadOf([alarm(), old, acked, k2], dismissed)?.id).toBe("k2");
    dismissed.addAll(["k2:k2"]);
    expect(stripLeadOf([alarm(), old, acked, k2], dismissed)?.id).toBe("old");
    expect(stripLeadOf([acked], dismissed)).toBeNull();
  });

  it("bildirim metni: tezgah · sebep · süre (hedef)", () => {
    const s = freshSignals([alarm()], memSet(), NOW, 10)[0]!;
    expect(notificationTextOf(s, NOW, 0)).toEqual({ title: "Yeni tezgah alarmı: TZ-12 · İp atlama", body: "Hol A · 12 dk duruyor (hedef 10 dk)" });
  });
});

describe("ses (WebAudio sentezi)", () => {
  it("kademe başına farklı ton; sahte bağlamda osilatör sayısı = bip sayısı", () => {
    expect(alarmToneOf(1)).toHaveLength(2);
    expect(alarmToneOf(2)).toHaveLength(3);
    const created: string[] = [];
    const param = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
    class Ctx {
      state = "running";
      currentTime = 0;
      destination = {};
      resume = () => Promise.resolve();
      createOscillator() {
        created.push("osc");
        return { type: "", frequency: param, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      }
      createGain() {
        return { gain: param, connect: vi.fn() };
      }
    }
    resetAlarmAudioForTest();
    expect(playAlarmTone(2, Ctx as unknown as new () => AudioContext)).toBe(true);
    expect(created).toHaveLength(3);
    resetAlarmAudioForTest();
    expect(playAlarmTone(1, null)).toBe(false);
  });
});
