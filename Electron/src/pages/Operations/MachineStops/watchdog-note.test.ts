// Tezgah Duruşları — watchdog kapanışının satır notu (D4): geçici kapanış, düzeltme bekleyen (mühür) ve
// düzeltilmiş kapanış ayrı söylenir; insan/sinyal kapanışında ve eski sunucuda (alan yok) not YOK.
import { describe, expect, it } from "vitest";
import { watchdogCloseNote } from "./types";

const iso = "2026-10-13T06:00:00.000Z";

describe("watchdogCloseNote", () => {
  it("⭐ WATCHDOG kapanışı, düzeltilmemiş → 'geçici kapanış'", () => {
    expect(watchdogCloseNote({ endSource: "WATCHDOG", provisionalEndedAt: iso, endCorrectedAt: null, lateEndedAt: null })?.label).toBe("geçici kapanış");
  });
  it("⭐ mühür yüzünden bekleyen gerçek bitiş → 'düzeltme bekliyor', ipucunda mühür", () => {
    const n = watchdogCloseNote({ endSource: "WATCHDOG", provisionalEndedAt: iso, endCorrectedAt: null, lateEndedAt: iso });
    expect(n?.label).toBe("geçici kapanış · düzeltme bekliyor");
    expect(n?.hint).toMatch(/mühürlü/);
  });
  it("⭐ düzeltilmiş (endSource artık SIGNAL, endCorrectedAt dolu) → 'kart bitişiyle düzeltildi'", () => {
    expect(watchdogCloseNote({ endSource: "SIGNAL", provisionalEndedAt: iso, endCorrectedAt: iso, lateEndedAt: null })?.label).toBe("kart bitişiyle düzeltildi");
  });
  it("insan/sinyal kapanışı ve eski sunucu (alanlar yok) → not yok", () => {
    expect(watchdogCloseNote({ endSource: "OPERATOR", provisionalEndedAt: null, endCorrectedAt: null, lateEndedAt: null })).toBeNull();
    expect(watchdogCloseNote({ endSource: "SIGNAL" })).toBeNull();
    expect(watchdogCloseNote({ endSource: null })).toBeNull();
  });
});
