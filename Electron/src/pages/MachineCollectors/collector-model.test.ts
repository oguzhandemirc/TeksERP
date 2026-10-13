// K4 uyarısı (PLAN-makine-durus §5), kart tipi biçimi (backend COLLECTOR_TYPE_RE aynası), karo↔route kapısı.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { definitionTiles } from "@/pages/Definitions/tile-config";
import { ROUTE_MODULE } from "@/lib/route-modules";
import { COLLECTOR_TYPE_RE, collectorFormSchema, isMachineCollectorsVisible, k4Warning } from "./collector-model";

describe("k4Warning", () => {
  it("alarm kapalı → alarm uyarısı; sebepsiz kapalı → sebepsiz uyarısı; ikisi açık → yok", () => {
    expect(k4Warning({ tezgahAlarmEnabled: false, tezgahAlarmUnclassifiedEnabled: true })).toMatch(/Tezgah alarmı kapalı/);
    expect(k4Warning({ tezgahAlarmEnabled: true, tezgahAlarmUnclassifiedEnabled: false })).toMatch(/Sebepsiz duruşta alarm/);
    expect(k4Warning({ tezgahAlarmEnabled: true, tezgahAlarmUnclassifiedEnabled: true })).toBeNull();
  });
  it("ayar okunamadıysa uyarı çizilmez (bilinmeyen ≠ kapalı)", () => {
    expect(k4Warning(undefined)).toBeNull();
    expect(k4Warning({ tezgahAlarmEnabled: true })).toBeNull();
  });
});

describe("kart formu", () => {
  it("kart tipi backend biçimiyle aynı", () => {
    const backend = readFileSync(resolve(__dirname, "../../../../Teks-Erp/src/services/machine-stop-code-map.service.ts"), "utf8");
    expect(backend).toContain(`export const COLLECTOR_TYPE_RE = ${COLLECTOR_TYPE_RE.toString()};`);
    expect(collectorFormSchema.safeParse({ name: "A", collectorType: "teks", machineIds: ["m"] }).success).toBe(false);
    expect(collectorFormSchema.safeParse({ name: "A", collectorType: "TEKS-ESP32-V1", machineIds: [] }).success).toBe(false);
    expect(collectorFormSchema.safeParse({ name: "A", collectorType: "TEKS-ESP32-V1", machineIds: ["m"] }).success).toBe(true);
  });
});

describe("karo · route · modül", () => {
  it("karo izni loom:spec-manage, tezgah kapalıyken çizilmez, ROUTE_MODULE tezgah", () => {
    const tile = definitionTiles.find((t) => t.key === "machine-collectors");
    expect(tile?.permission).toBe("loom:spec-manage");
    expect(tile?.to).toBe("/definitions/machine-collectors");
    expect(isMachineCollectorsVisible({ tezgahEnabled: false })).toBe(false);
    expect(ROUTE_MODULE["definitions/machine-collectors"]).toBe("tezgahEnabled");
  });
});
