// Mock üreticinin deterministikliği: aynı tohum + an → aynı salon; adım saf.
import { describe, expect, it } from "vitest";
import { escalationTierOf, summarizeFloor, todayAvailabilityPct } from "../metrics";
import { reasonOf } from "../stopReasons";
import type { FloorState } from "../types";
import { OPENING_SCENARIOS } from "./catalog";
import { createFloor, shiftOf } from "./createFloor";
import { stepFloor } from "./stepFloor";

// 2026-10-09 11:30 İstanbul (UTC+3) — 1. vardiyanın ortası.
const NOW = Date.UTC(2026, 9, 9, 8, 30);
const SEED = 20261009;

function runSteps(floor: FloorState, from: number, steps: number, stepMs = 2_000): FloorState {
  let f = floor;
  for (let i = 1; i <= steps; i += 1) f = stepFloor(f, from + i * stepMs);
  return f;
}

describe("createFloor — tohumlu başlangıç", () => {
  it("aynı tohum ve an aynı salonu üretir", () => {
    expect(createFloor(SEED, NOW)).toEqual(createFloor(SEED, NOW));
  });

  it("farklı tohum farklı salon üretir", () => {
    expect(createFloor(SEED + 1, NOW)).not.toEqual(createFloor(SEED, NOW));
  });

  it("36 tezgah, üç hol, hepsi SIMULATED beyanlı", () => {
    const f = createFloor(SEED, NOW);
    expect(f.looms).toHaveLength(36);
    expect(f.halls).toEqual(["Hol A", "Hol B", "Hol C"]);
    expect(f.looms.every((t) => t.source === "SIMULATED")).toBe(true);
  });

  it("açılış senaryoları kadar duran tezgah var ve her görünür kademe en az bir kez çıkar", () => {
    const f = createFloor(SEED, NOW);
    const stopped = f.looms.filter((t) => t.openStop !== null);
    expect(stopped).toHaveLength(OPENING_SCENARIOS.length);
    const tiers = new Set(stopped.map((t) => escalationTierOf(t.openStop!, NOW)));
    // Pay 0: hedef dolar dolmaz iletilir — OVERDUE yalnız iki adım arası anlıktır.
    expect([...tiers].sort()).toEqual(["ESCALATED", "UNTRACKED", "WITHIN"]);
  });

  it("iletilen duruşun damgası hedef dolduğu ana yazılır (pay 0)", () => {
    const f = createFloor(SEED, NOW);
    for (const t of f.looms) {
      const s = t.openStop;
      if (!s || s.escalatedAt === null) continue;
      expect(s.escalatedAt).toBe(s.startedAt + reasonOf(s.reasonCode!).targetMin! * 60_000);
    }
  });

  it("bugün sayaçları vardiyayı kapsar: günün önceki vardiyaları da sayılır", () => {
    const f = createFloor(SEED, NOW);
    for (const t of f.looms) {
      expect(t.today.plannedSec).toBeGreaterThan(t.shift!.plannedSec);
      expect(t.today.runSec).toBeGreaterThanOrEqual(t.shift!.runSec);
      expect(t.today.runSec).toBeLessThanOrEqual(t.today.plannedSec);
      const pct = todayAvailabilityPct(t)!;
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
  });

  it("şu an % = çalışan tezgah / toplam (vardiya ya da gün süresinden bağımsız)", () => {
    const f = createFloor(SEED, NOW);
    const s = summarizeFloor(f.looms, NOW);
    expect(s.runningNowPct).toBe(Math.round(((36 - OPENING_SCENARIOS.length) / 36) * 100));
    expect(summarizeFloor([], NOW).runningNowPct).toBeNull();
  });

  it("günün ilk vardiyasında bugün = vardiya", () => {
    const night = Date.UTC(2026, 9, 8, 23, 0); // 02:00 İstanbul, 3. vardiya (günün ilki)
    for (const t of createFloor(SEED, night).looms) expect(t.today).toEqual({ runSec: t.shift!.runSec, plannedSec: t.shift!.plannedSec });
  });

  it("vardiya fabrika gününden üçe bölünür", () => {
    const s = shiftOf(NOW);
    expect(s.name).toBe("1. vardiya");
    expect(s.endsAt - s.startsAt).toBe(8 * 3_600_000);
    expect(NOW).toBeGreaterThanOrEqual(s.startsAt);
    expect(NOW).toBeLessThan(s.endsAt);
  });
});

describe("stepFloor — saf simülasyon adımı", () => {
  it("aynı girdi aynı çıktıyı verir ve girdiyi değiştirmez", () => {
    const f = createFloor(SEED, NOW);
    const snapshot = structuredClone(f);
    expect(runSteps(f, NOW, 30)).toEqual(runSteps(f, NOW, 30));
    expect(f).toEqual(snapshot);
  });

  it("geçmişe giden an durumu aynen döndürür", () => {
    const f = createFloor(SEED, NOW);
    expect(stepFloor(f, NOW - 1_000)).toBe(f);
    expect(stepFloor(f, NOW)).toBe(f);
  });

  it("çalışan tezgahlar üretir; vardiya metresi geri gitmez", () => {
    const f = createFloor(SEED, NOW);
    const g = runSteps(f, NOW, 10);
    const before = f.looms.reduce((a, t) => a + t.shift!.meters, 0);
    const after = g.looms.reduce((a, t) => a + t.shift!.meters, 0);
    expect(after).toBeGreaterThan(before);
    expect(g.updatedAt).toBe(NOW + 20_000);
    for (const [i, t] of g.looms.entries()) expect(t.today.plannedSec).toBeGreaterThanOrEqual(f.looms[i]!.today.plannedSec);
  });

  it("hedefi dolan duruş adımda patrona iletilir ve olay defterine düşer", () => {
    const f = createFloor(SEED, NOW);
    const fresh = f.looms.find((t) => t.openStop?.reasonCode === "ATKI_KOPUSU" && t.openStop.escalatedAt === null)!;
    // 2,5 dk'lık atkı kopuşu (hedef 5 dk): 3 dk sonra iletilmiş olmalı — ya da o arada kapanmış.
    const g = runSteps(f, NOW, 90);
    const later = g.looms.find((t) => t.id === fresh.id)!;
    if (later.openStop && later.openStop.startedAt === fresh.openStop!.startedAt) {
      expect(later.openStop.escalatedAt).toBe(fresh.openStop!.startedAt + 5 * 60_000);
      expect(later.events.some((e) => e.kind === "ESCALATE")).toBe(true);
    } else {
      expect(later.stops.some((s) => s.startedAt === fresh.openStop!.startedAt)).toBe(true);
    }
  });
});
