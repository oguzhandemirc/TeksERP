// "Yeniden bağlandı" sütunu: tarih + yol etiketi; olay yoksa boş (eski backend alanı hiç göndermez).
import { describe, expect, it } from "vitest";
import { reboundText } from "./deviceColumns";
import type { DeviceListItem } from "./types";

const d = (over: Partial<DeviceListItem>) => ({ lastReboundAt: null, lastReboundPath: null, ...over }) as DeviceListItem;

describe("reboundText", () => {
  it("olay yok / alan yok → boş", () => {
    expect(reboundText(d({}))).toBe("");
    expect(reboundText({} as DeviceListItem)).toBe("");
  });
  it("otomatik tanıma → tarih · kendiliğinden", () => {
    expect(reboundText(d({ lastReboundAt: "2026-11-12T06:40:00.000Z", lastReboundPath: "OTOMATIK" }))).toMatch(/^\d{2}\.\d{2}\.2026 \d{2}:\d{2} · kendiliğinden$/);
  });
  it("yönetici onaylı yollar ayrı etiket", () => {
    expect(reboundText(d({ lastReboundAt: "2026-11-12T06:40:00.000Z", lastReboundPath: "PANEL" }))).toMatch(/panelden onayla$/);
    expect(reboundText(d({ lastReboundAt: "2026-11-12T06:40:00.000Z", lastReboundPath: "YERINDE" }))).toMatch(/yerinde onayla$/);
  });
});
