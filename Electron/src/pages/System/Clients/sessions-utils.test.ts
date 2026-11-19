import { describe, expect, it } from "vitest";
import { sessionDeviceTitle, sessionTypeLabel, versionStrip } from "./sessions-utils";
import type { OpenSession } from "./sessions-service";

function s(p: Partial<OpenSession>): OpenSession {
  return {
    id: Math.random().toString(36),
    deviceType: "MOBILE",
    deviceName: null,
    deviceKind: null,
    deviceIdPrefix: null,
    clientVersion: null,
    expectedVersion: null,
    lastSeenAt: null,
    createdAt: "2026-11-19T10:00:00.000Z",
    expiresAt: "2026-11-20T10:00:00.000Z",
    isCurrent: false,
    user: { id: "u", username: "ali", fullName: "Ali", isSystemAccount: false },
    ...p,
  };
}

describe("açık oturumlar yardımcıları", () => {
  it("tür adı; tanınmayan tür olduğu gibi", () => {
    expect(sessionTypeLabel("MOBILE")).toBe("Tablet");
    expect(sessionTypeLabel("PATRON")).toBe("Patron telefonu");
    expect(sessionTypeLabel("YENI")).toBe("YENI");
  });

  it("cihaz başlığı: ad > tanımsız önek > tire", () => {
    expect(sessionDeviceTitle({ deviceName: "Salon 1", deviceIdPrefix: "abcd1234", deviceType: "MOBILE" })).toBe("Salon 1");
    expect(sessionDeviceTitle({ deviceName: null, deviceIdPrefix: "abcd1234", deviceType: "MOBILE" })).toBe("Tanımsız (abcd1234)");
    expect(sessionDeviceTitle({ deviceName: null, deviceIdPrefix: null, deviceType: "ELECTRON" })).toBe("—");
  });

  it("sürüm şeridi: tür + sürüm sayımı, tür sırası sabit, yeni sürüm önce, ölçülemeyen sonda", () => {
    const strip = versionStrip([
      s({ deviceType: "MOBILE", clientVersion: "1.0.9", expectedVersion: "1.0.10" }),
      s({ deviceType: "MOBILE", clientVersion: "1.0.10", expectedVersion: "1.0.10" }),
      s({ deviceType: "MOBILE", clientVersion: "1.0.9", expectedVersion: "1.0.10" }),
      s({ deviceType: "MOBILE", clientVersion: null }),
      s({ deviceType: "ELECTRON", clientVersion: "2.0.0", expectedVersion: "1.9.0" }),
    ]);
    expect(strip.map((i) => [i.deviceType, i.version, i.count, i.outdated])).toEqual([
      ["ELECTRON", "2.0.0", 1, false],
      ["MOBILE", "1.0.10", 1, false],
      ["MOBILE", "1.0.9", 2, true],
      ["MOBILE", null, 1, false],
    ]);
  });

  it("boş liste boş şerit", () => {
    expect(versionStrip([])).toEqual([]);
  });
});
