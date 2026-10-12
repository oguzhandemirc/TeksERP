import { describe, expect, it, vi } from "vitest";
import {
  HEALTH_PROBE_INTERVAL_MS,
  OUTAGE_TEXT_ONGOING,
  OUTAGE_TEXT_SOON,
  REQUEST_HOLD_MAX_MS,
  createRequestHold,
  noticeActive,
  outageStrip,
  outageTarget,
  setOutageTarget,
  shouldHoldRequests,
} from "./sunucu-kesintisi";

// B3 — panel ve tabletin BAYT-EŞİT saf modülü: şerit metinleri, duyuru eşiği, istek bekletme yüklemi ve bekletici.
const T0 = 1_000_000;
const target = (kalanSn: number, suruyor = false) => outageTarget({ planlanan: null, kalanSn, suruyor }, T0);

describe("sunucu-kesintisi — şerit ve yüklemler", () => {
  it("kalanSn yerel saate çevrilir (sunucu saatinden bağımsız); yoksa hedef yok", () => {
    expect(target(300)).toEqual({ atMs: T0 + 300_000, ongoing: false });
    expect(target(-5)?.atMs).toBe(T0);
    expect(outageTarget(null, T0)).toBeNull();
    expect(outageTarget(undefined, T0)).toBeNull();
  });

  it("5 dk kala uyarı: 'Sunucu 5 dk sonra yaklaşık 1 dk güncellenecek — kaydedilmemiş işinizi kaydedin'", () => {
    expect(outageStrip(target(300), T0, false)).toEqual({ kind: "warning", text: "Sunucu 5 dk sonra yaklaşık 1 dk güncellenecek — kaydedilmemiş işinizi kaydedin" });
    expect(outageStrip(target(300), T0 + 150_000, false)?.text).toMatch(/^Sunucu 3 dk sonra/);
  });

  it("5 dk'dan uzak an duyurulmaz (pencere yarın gece) — şerit yok, bekletme yok", () => {
    expect(outageStrip(target(301), T0, false)).toBeNull();
    expect(shouldHoldRequests(target(3600), T0, true)).toBe(false);
  });

  it("son dakika ve sürüyor → 'birazdan'; ulaşılamıyorsa → 'Sunucu güncelleniyor, yeniden bağlanıyor…'", () => {
    expect(outageStrip(target(30), T0, false)?.text).toBe(OUTAGE_TEXT_SOON);
    expect(outageStrip(target(0, true), T0, false)?.text).toBe(OUTAGE_TEXT_SOON);
    expect(outageStrip(target(30), T0, true)).toEqual({ kind: "outage", text: OUTAGE_TEXT_ONGOING });
    expect(OUTAGE_TEXT_ONGOING).toBe("Sunucu güncelleniyor, yeniden bağlanıyor…");
  });

  it("planlanan an 15 dk'dan fazla geçtiyse duyuru bayat — şerit ve bekletme yok", () => {
    expect(noticeActive(target(0), T0 + 15 * 60_000)).toBe(true);
    expect(noticeActive(target(0), T0 + 15 * 60_000 + 1)).toBe(false);
    expect(shouldHoldRequests(target(0), T0 + 16 * 60_000, true)).toBe(false);
  });

  it("bekletme yalnız duyuru etkin VE sunucu yanıtsızken", () => {
    expect(shouldHoldRequests(target(60), T0, true)).toBe(true);
    expect(shouldHoldRequests(target(60), T0, false)).toBe(false);
    expect(shouldHoldRequests(null, T0, true)).toBe(false);
  });
});

describe("sunucu-kesintisi — bekletici", () => {
  const harness = (healthyAfter: number | null) => {
    let now = T0;
    let probes = 0;
    const hold = createRequestHold({
      unreachable: () => true,
      probeHealth: async () => {
        probes++;
        return healthyAfter !== null && probes > healthyAfter;
      },
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    return { hold, probes: () => probes, elapsed: () => now - T0 };
  };

  it("bağlantı gelince bırakır; eşzamanlı istekler TEK sağlık döngüsünü paylaşır; /health bekletilmez", async () => {
    setOutageTarget(target(60));
    const h = harness(2);
    await Promise.all([h.hold("/api/a"), h.hold("/api/b"), h.hold("/health")]);
    expect(h.probes()).toBe(3);
    expect(h.elapsed()).toBe(2 * HEALTH_PROBE_INTERVAL_MS);
  });

  it("üst sınırda (3 dk) bırakır; aynı hedef için bir daha bekletmez", async () => {
    setOutageTarget(target(60));
    const h = harness(null);
    await h.hold("/api/a");
    expect(h.elapsed()).toBeGreaterThanOrEqual(REQUEST_HOLD_MAX_MS);
    expect(h.elapsed()).toBeLessThan(REQUEST_HOLD_MAX_MS + HEALTH_PROBE_INTERVAL_MS);
    const before = h.probes();
    await h.hold("/api/b");
    expect(h.probes()).toBe(before);
  });

  it("duyuru yokken hiç beklemez", async () => {
    setOutageTarget(null);
    const probe = vi.fn(async () => false);
    await createRequestHold({ unreachable: () => true, probeHealth: probe })("/api/a");
    expect(probe).not.toHaveBeenCalled();
  });
});
