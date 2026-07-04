import { describe, expect, it } from "vitest";
import {
  endReasonTooltip,
  formatDurationMinutes,
  placeLabel,
  sessionDurationMinutes,
  type WorkSessionItem,
} from "./types";

describe("sessionDurationMinutes", () => {
  it("açık oturumda now'a göre hesaplar", () => {
    const start = new Date("2026-07-02T08:00:00Z").toISOString();
    const now = new Date("2026-07-02T11:25:00Z").getTime();
    expect(sessionDurationMinutes(start, null, now)).toBe(205);
  });
  it("kapalı oturumda endedAt'e göre hesaplar", () => {
    expect(
      sessionDurationMinutes("2026-07-02T08:00:00Z", "2026-07-02T08:45:00Z"),
    ).toBe(45);
  });
  it("negatif farkı 0'a kırpar (saat kayması)", () => {
    const now = new Date("2026-07-02T07:00:00Z").getTime();
    expect(sessionDurationMinutes("2026-07-02T08:00:00Z", null, now)).toBe(0);
  });
  it("geçersiz tarihte 0 döner", () => {
    expect(sessionDurationMinutes("bozuk", null)).toBe(0);
  });
});

describe("formatDurationMinutes", () => {
  it("saat + dakika biçimler", () => {
    expect(formatDurationMinutes(205)).toBe("3 sa 25 dk");
    expect(formatDurationMinutes(45)).toBe("45 dk");
    expect(formatDurationMinutes(0)).toBe("0 dk");
  });
});

describe("endReasonTooltip", () => {
  const base = { id: "a", userId: "u", deviceId: "d", machineId: "m", stationId: "s",
    startedAt: "x", endedAt: "y", lastActivityAt: "z",
    user: { id: "u", username: "un", fullName: "Ali" },
    device: { id: "d", deviceId: "dd", name: "Tablet-1", kind: "TABLET" },
    machine: { id: "m", code: "MAK-1", name: "Makine 1" },
    station: { id: "s", code: "ST", name: "KK1", kind: "RAW_QC" } } as WorkSessionItem;
  const successor = {
    id: "b", startedAt: "x2", user: { fullName: "Veli" }, device: { name: "Tablet-2" },
    machine: { code: "MAK-1", name: "Makine 1" }, station: { name: "KK1" },
  };
  it("bitiş yoksa boş", () => {
    expect(endReasonTooltip({ ...base, endReason: null })).toBe("");
  });
  it("devralan yoksa yalnız açıklama", () => {
    expect(endReasonTooltip({ ...base, endReason: "TAKEOVER", successor: null })).not.toContain("Devralan");
  });
  it("TAKEOVER + devralan → 'Devralan: cihaz · kullanıcı'", () => {
    const t = endReasonTooltip({ ...base, endReason: "TAKEOVER", successor });
    expect(t).toContain("Devralan: Tablet-2 · Veli");
  });
  it("NEW_LOGIN + ardıl → 'Yeni oturum: …'", () => {
    const t = endReasonTooltip({ ...base, endReason: "NEW_LOGIN", successor });
    expect(t).toContain("Yeni oturum: Tablet-2 · Veli");
  });
});

describe("placeLabel", () => {
  const station = { id: "s", code: "ST", name: "Tambur", kind: "TAMBUR" };
  it("makineli oturumda istasyon — makine", () => {
    expect(placeLabel({ machine: { id: "m", code: "MAK-1", name: "Makine 1" }, station })).toBe(
      "Tambur — Makine 1",
    );
  });
  it("makinesiz (SHIPPING) oturumda yalnız istasyon", () => {
    expect(placeLabel({ machine: null, station })).toBe("Tambur");
  });
});
