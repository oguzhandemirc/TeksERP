import { describe, it, expect, vi, afterEach } from "vitest";
import { recordNetSample, getNetStats, SLOW_REQUEST_MS } from "./netStats";

const sample = (ms: number, i = 0) => ({
  method: "GET",
  url: `/api/test/${i}`,
  status: 200 as const,
  ms,
  at: Date.now(),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("netStats", () => {
  it("ring buffer 100 ile sınırlı — en eskiler düşer (bellek sızıntısı yok)", () => {
    for (let i = 0; i < 150; i++) recordNetSample(sample(10, i));
    const stats = getNetStats();
    expect(stats.length).toBeLessThanOrEqual(100);
    // En yeni sonda: son eklenen 149 numaralı URL görünmeli.
    expect(stats.at(-1)?.url).toBe("/api/test/149");
  });

  it("eşik üstü istek console.warn basar, altı basmaz", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    recordNetSample(sample(SLOW_REQUEST_MS - 1));
    expect(warn).not.toHaveBeenCalled();
    recordNetSample(sample(SLOW_REQUEST_MS));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0] ?? "")).toContain("YAVAŞ İSTEK");
  });

  it("getNetStats kopya döner — dışarıdan mutasyon iç durumu bozmaz", () => {
    recordNetSample(sample(5));
    const a = getNetStats();
    a.length = 0;
    expect(getNetStats().length).toBeGreaterThan(0);
  });
});
