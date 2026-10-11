// Alarm sorumluları saf katmanı: ızgara (atamalı ama listede olmayan hol/vardiya kaybolmaz), geçmiş/gelecek ayrımı,
// kural gövdesi (türün almadığı alan gövdeye girmez), uyarılı aday.
import { describe, expect, it } from "vitest";
import { buildDutyGrid, personOptions, ruleBodyError, shiftWindowLabel, splitOverrides, tierRulesSummary, toRuleBody } from "./duty-model";
import type { DutyOverride, DutyResponsible, DutyRule } from "./types";

const hallA = { id: "h1", name: "Hol A" };
const hallB = { id: "h2", name: "Hol B" };
const s1 = { id: "s1", code: "V1", name: "Sabah" };
const sOld = { id: "s9", code: "V9", name: "Eski gece" };
const person = (id: string, canViewAlarms = true) => ({ id, name: id.toUpperCase(), canViewAlarms });
const resp = (id: string, station = hallA, shift = s1, tier = 1): DutyResponsible =>
  ({ id, tier, createdAt: "", station, shiftDefinition: shift, user: person(`u-${id}`) });

describe("buildDutyGrid", () => {
  it("hol × vardiya hücresinde kademeler ayrı", () => {
    const g = buildDutyGrid([hallA, hallB], [s1], [resp("r1"), resp("r2", hallA, s1, 2), resp("r3", hallB)]);
    expect(g.rows.map((r) => r.hall.id)).toEqual(["h1", "h2"]);
    expect(g.rows[0]!.cells[0]!.byTier[1].map((r) => r.id)).toEqual(["r1"]);
    expect(g.rows[0]!.cells[0]!.byTier[2].map((r) => r.id)).toEqual(["r2"]);
    expect(g.rows[1]!.cells[0]!.byTier[2]).toEqual([]);
  });

  it("arşivlenmiş vardiyada/listede olmayan holde duran atama gözden kaybolmaz", () => {
    const g = buildDutyGrid([hallA], [s1], [resp("r1", hallB, sOld)]);
    expect(g.shifts.map((s) => s.id)).toEqual(["s1", "s9"]);
    expect(g.rows.map((r) => r.hall.id)).toEqual(["h1", "h2"]);
    expect(g.rows[1]!.cells[1]!.byTier[1].map((r) => r.id)).toEqual(["r1"]);
  });
});

describe("nöbet değişikliği", () => {
  const ov = (id: string, ended: boolean): DutyOverride => ({
    id, tier: 1, note: null, createdAt: "", station: hallA, user: person("u1"),
    shiftInstance: { id: `i-${id}`, factoryDayKey: "2026-10-12T00:00:00.000Z", startsAt: "", endsAt: "", isCancelled: false, ended, shiftDefinition: s1 },
  });
  it("bitmiş vardiya geçmişe (salt-okunur), diğerleri gelecek", () => {
    const { upcoming, past } = splitOverrides([ov("a", false), ov("b", true)]);
    expect(upcoming.map((o) => o.id)).toEqual(["a"]);
    expect(past.map((o) => o.id)).toEqual(["b"]);
  });
  it("pencere etiketi fabrika günü + vardiya adı", () => {
    expect(shiftWindowLabel(ov("a", false).shiftInstance)).toBe("12.10.2026 · Sabah");
  });
});

describe("kademe kuralı", () => {
  it("türün almadığı alan gövdeye girmez (backend DUTY_RULE_INVALID)", () => {
    expect(toRuleBody({ tier: 2, kind: "HALL_SHIFT", userId: "u1", permissionCode: "loom:alarm-ack" })).toEqual({ tier: 2, kind: "HALL_SHIFT", userId: null, permissionCode: null });
    expect(toRuleBody({ tier: 1, kind: "USER", userId: "u1", permissionCode: "x" })).toEqual({ tier: 1, kind: "USER", userId: "u1", permissionCode: null });
    expect(toRuleBody({ tier: 1, kind: "PERMISSION", userId: "u1", permissionCode: "x" })).toEqual({ tier: 1, kind: "PERMISSION", userId: null, permissionCode: "x" });
  });
  it("eksik hedef reddedilir", () => {
    expect(ruleBodyError({ tier: 1, kind: "USER", userId: null, permissionCode: null })).toBe("Kişi seçin.");
    expect(ruleBodyError({ tier: 1, kind: "PERMISSION", userId: null, permissionCode: null })).toBe("Yetki seçin.");
    expect(ruleBodyError({ tier: 1, kind: "HALL_SHIFT", userId: null, permissionCode: null })).toBeNull();
  });
  it("kuralsız kademede örtük kural cümlesi", () => {
    const rules: DutyRule[] = [{ id: "k", tier: 2, kind: "USER", permissionCode: null, createdAt: "", user: person("u1") }];
    expect(tierRulesSummary(rules, 1)).toMatch(/holün vardiya sorumlusuna/);
    expect(tierRulesSummary(rules, 2)).toBeNull();
  });
});

describe("personOptions", () => {
  it("alarmı göremeyen aday seçilebilir ama uyarılı", () => {
    const [a, b] = personOptions([{ id: "a", name: "A", canViewAlarms: true, canEscalate: true }, { id: "b", name: "B", canViewAlarms: false, canEscalate: false }]);
    expect(a).toEqual({ id: "a", label: "A", subLabel: "Üst kademe yetkisi var", warning: null });
    expect(b?.warning).toMatch(/bildirim gitmez/);
  });
});
