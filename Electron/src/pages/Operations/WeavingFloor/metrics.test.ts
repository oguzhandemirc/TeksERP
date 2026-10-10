// Sayaç biçimi ve uyarı kademesi — sınırlar.
import { describe, expect, it } from "vitest";
import {
  escalationDueAt,
  escalationTierOf,
  formatShortDuration,
  formatTimer,
  isPastTarget,
  shouldEscalate,
  targetProgress,
} from "./metrics";
import { ESCALATION_SETTINGS, reasonOf } from "./stopReasons";
import type { OpenStop } from "./types";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 9, 8, 0);

function stop(reasonCode: string, over: Partial<OpenStop> = {}): OpenStop {
  const r = reasonOf(reasonCode);
  return {
    reasonCode,
    label: r.label,
    lossClass: r.lossClass,
    targetMin: r.targetMin,
    graceMin: ESCALATION_SETTINGS.graceMin,
    startedAt: T0,
    attendant: { id: "g", name: "Görevli", role: "ATTENDANT" },
    notifiedAt: T0 + 5_000,
    respondedAt: null,
    escalatedAt: null,
    ...over,
  };
}

describe("formatTimer — kart/detay sayacı", () => {
  it.each([
    [0, "00:00"],
    [59_000, "00:59"],
    [59_999, "00:59"],
    [9 * MIN + 32_000, "09:32"],
    [59 * MIN + 59_000, "59:59"],
    [60 * MIN, "1 sa 00 dk"],
    [95 * MIN, "1 sa 35 dk"],
    [10 * 60 * MIN + 5 * MIN, "10 sa 05 dk"],
  ])("%i ms → %s", (ms, text) => {
    expect(formatTimer(ms)).toBe(text);
  });

  it("negatif ve sayı olmayan girdi 00:00'a düşer", () => {
    expect(formatTimer(-5_000)).toBe("00:00");
    expect(formatTimer(Number.NaN)).toBe("00:00");
    expect(formatTimer(Number.POSITIVE_INFINITY)).toBe("00:00");
  });
});

describe("formatShortDuration — liste süresi", () => {
  it.each([
    [0, "<1 dk"],
    [59_000, "<1 dk"],
    [MIN, "1 dk"],
    [45 * MIN, "45 dk"],
    [65 * MIN, "1 sa 05 dk"],
    [-1, "<1 dk"],
  ])("%i ms → %s", (ms, text) => {
    expect(formatShortDuration(ms)).toBe(text);
  });
});

describe("escalationTierOf — kademe", () => {
  it("plan dışı duruşta süre izlenmez", () => {
    expect(escalationTierOf(stop("SIPARIS_YOK"), T0 + 600 * MIN)).toBe("UNTRACKED");
    expect(targetProgress(stop("SIPARIS_YOK"), T0 + 600 * MIN)).toBe(0);
    expect(escalationDueAt(stop("SIPARIS_YOK"))).toBeNull();
  });

  it("hedefin bir milisaniye altı hedef içinde, tam hedefte aşıldı", () => {
    const s = stop("ATKI_KOPUSU"); // hedef 5 dk
    expect(escalationTierOf(s, T0 + 5 * MIN - 1)).toBe("WITHIN");
    expect(escalationTierOf(s, T0 + 5 * MIN)).toBe("OVERDUE");
    expect(isPastTarget("OVERDUE")).toBe(true);
    expect(isPastTarget("WITHIN")).toBe(false);
  });

  it("iletim damgası gelecekteyse henüz iletilmiş sayılmaz", () => {
    const s = stop("ATKI_KOPUSU", { escalatedAt: T0 + 5 * MIN });
    expect(escalationTierOf(s, T0 + 5 * MIN - 1)).toBe("WITHIN");
    expect(escalationTierOf(s, T0 + 5 * MIN)).toBe("ESCALATED");
  });

  it("hedef halkası 0..1 arasında kalır", () => {
    const s = stop("COZGU_KOPUSU"); // hedef 10 dk
    expect(targetProgress(s, T0 - MIN)).toBe(0);
    expect(targetProgress(s, T0 + 5 * MIN)).toBeCloseTo(0.5);
    expect(targetProgress(s, T0 + 60 * MIN)).toBe(1);
  });
});

describe("shouldEscalate — patrona iletim (hedef + pay)", () => {
  it("varsayılan pay 0: hedef dolar dolmaz patrona", () => {
    expect(ESCALATION_SETTINGS.graceMin).toBe(0);
    const s = stop("ATKI_KOPUSU");
    expect(shouldEscalate(s, T0 + 5 * MIN - 1)).toBe(false);
    expect(shouldEscalate(s, T0 + 5 * MIN)).toBe(true);
  });

  it("pay ayarlanırsa iletim hedef + paya kayar", () => {
    const s = stop("ATKI_KOPUSU");
    expect(escalationDueAt(s, 2)).toBe(T0 + 7 * MIN);
    expect(shouldEscalate(s, T0 + 6 * MIN, 2)).toBe(false);
    expect(escalationTierOf(s, T0 + 6 * MIN)).toBe("OVERDUE");
    expect(shouldEscalate(s, T0 + 7 * MIN, 2)).toBe(true);
  });

  it("⭐ hedef ve pay DURUŞA DONMUŞ değerden okunur, katalogdan değil", () => {
    const s = stop("ATKI_KOPUSU", { targetMin: 20, graceMin: 3 }); // katalogda 5 dk
    expect(escalationTierOf(s, T0 + 10 * MIN)).toBe("WITHIN");
    expect(escalationTierOf(s, T0 + 20 * MIN)).toBe("OVERDUE");
    expect(escalationDueAt(s)).toBe(T0 + 23 * MIN);
    expect(escalationTierOf(stop("ATKI_KOPUSU", { targetMin: null }), T0 + 600 * MIN)).toBe("UNTRACKED");
  });

  it("zaten iletilmiş ya da izlenmeyen duruş yeniden iletilmez", () => {
    expect(shouldEscalate(stop("ATKI_KOPUSU", { escalatedAt: T0 + 5 * MIN }), T0 + 60 * MIN)).toBe(false);
    expect(shouldEscalate(stop("TEZGAH_KAPALI"), T0 + 600 * MIN)).toBe(false);
  });
});
