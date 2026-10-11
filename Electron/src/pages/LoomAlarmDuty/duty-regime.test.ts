// Alarm Sorumluları karosu: tezgah izleme kapalıyken çizilmez; kapı `loom:spec-manage`; modül kapısı ROUTE_MODULE.
import { describe, expect, it } from "vitest";
import { definitionTiles } from "@/pages/Definitions/tile-config";
import { ROUTE_MODULE } from "@/lib/route-modules";
import { isLoomAlarmsVisible } from "@/pages/Operations/LoomAlarms/alarm-regime";
import { isLoomAlarmDutyVisible } from "./duty-regime";

describe("Alarm Sorumluları — görünürlük", () => {
  it("tezgah izleme kapalıyken false, açıkken true", () => {
    expect(isLoomAlarmDutyVisible({ tezgahEnabled: false })).toBe(false);
    expect(isLoomAlarmDutyVisible({ tezgahEnabled: true })).toBe(true);
    for (const tezgahEnabled of [false, true]) expect(isLoomAlarmDutyVisible({ tezgahEnabled })).toBe(isLoomAlarmsVisible({ tezgahEnabled }));
  });

  it("karo yükleme ve izne bağlı; route modülü tezgah", () => {
    const tile = definitionTiles.find((t) => t.key === "loom-alarm-duty");
    expect(tile?.visibleWhen).toBe(isLoomAlarmDutyVisible);
    expect(tile?.permission).toBe("loom:spec-manage");
    expect(tile?.to).toBe("/definitions/loom-alarm-duty");
    expect(ROUTE_MODULE["definitions/loom-alarm-duty"]).toBe("tezgahEnabled");
  });
});
