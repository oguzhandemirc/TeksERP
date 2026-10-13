// Duruş kodu eşleme: gövde (oluşturmada tam anahtar, düzenlemede YALNIZ sebep), sebep süzgeci, karo↔route kapısı.
import { describe, expect, it } from "vitest";
import { definitionTiles } from "@/pages/Definitions/tile-config";
import { ROUTE_MODULE } from "@/lib/route-modules";
import type { ReasonPreset } from "@/pages/ReasonPresets/service";
import { SCOPE_ALL, buildCodeMapPayload, codeMapFormSchema, formDefaults, isMachineStopCodeMapsVisible, selectableReasons } from "./code-map-model";
import type { MachineStopCodeMap } from "./types";

const map: MachineStopCodeMap = {
  id: "x1", collectorType: "TEKS-ESP32-V1", rawStopCode: "E12", machineId: "m1", stopReasonId: "r1", isActive: true,
  machine: { id: "m1", code: "T-01", name: "Tezgah 1" }, stopReason: { id: "r1", code: "IPLIK", label: "İplik kopması", isActive: true },
  createdAt: "", updatedAt: "",
};

const preset = (over: Partial<ReasonPreset>): ReasonPreset => ({
  id: "p", kind: "MACHINE_STOP", code: "C", label: "L", fullText: null, requiresText: false, sortOrder: 0, isActive: true, isSystem: false, stopLossClass: "MACHINE", ...over,
} as ReasonPreset);

describe("buildCodeMapPayload", () => {
  it("oluşturma: tam anahtar; kart tipi geneli → machineId null", () => {
    const v = { collectorType: " TEKS-ESP32-V1 ", rawStopCode: " E12 ", scope: SCOPE_ALL, stopReasonId: "r2" };
    expect(buildCodeMapPayload(v, null)).toEqual({ collectorType: "TEKS-ESP32-V1", rawStopCode: "E12", machineId: null, stopReasonId: "r2" });
    expect(buildCodeMapPayload({ ...v, scope: "m9" }, null)).toMatchObject({ machineId: "m9" });
  });
  it("düzenleme: yalnız sebep gider (anahtar alanı sunucuda 400)", () => {
    const v = { ...formDefaults(map), collectorType: "BASKA", stopReasonId: "r3" };
    expect(buildCodeMapPayload(v, map)).toEqual({ stopReasonId: "r3" });
  });
  it("varsayılanlar: düzenlemede kapsam tezgah, yenide kart tipi geneli", () => {
    expect(formDefaults(map).scope).toBe("m1");
    expect(formDefaults(null).scope).toBe(SCOPE_ALL);
  });
  it("şema: sebep zorunlu, kart tipi biçimi", () => {
    expect(codeMapFormSchema.safeParse({ collectorType: "TEKS", rawStopCode: "E1", scope: SCOPE_ALL, stopReasonId: "" }).success).toBe(false);
    expect(codeMapFormSchema.safeParse({ collectorType: "teks", rawStopCode: "E1", scope: SCOPE_ALL, stopReasonId: "r" }).success).toBe(false);
    expect(codeMapFormSchema.safeParse({ collectorType: "TEKS", rawStopCode: "E1", scope: SCOPE_ALL, stopReasonId: "r" }).success).toBe(true);
  });
});

describe("selectableReasons", () => {
  it("yalnız aktif + kayıp sınıflı MACHINE_STOP", () => {
    const out = selectableReasons([
      preset({ id: "ok" }),
      preset({ id: "pasif", isActive: false }),
      preset({ id: "sinifsiz", stopLossClass: null }),
      preset({ id: "baska", kind: "DEFECT" as ReasonPreset["kind"] }),
    ]);
    expect(out.map((p) => p.id)).toEqual(["ok"]);
  });
});

describe("karo · route · modül", () => {
  it("karo izni loom:spec-manage, tezgah kapalıyken çizilmez, ROUTE_MODULE tezgah", () => {
    const tile = definitionTiles.find((t) => t.key === "machine-stop-codes");
    expect(tile?.permission).toBe("loom:spec-manage");
    expect(tile?.to).toBe("/definitions/machine-stop-codes");
    expect(isMachineStopCodeMapsVisible({ tezgahEnabled: false })).toBe(false);
    expect(ROUTE_MODULE["definitions/machine-stop-codes"]).toBe("tezgahEnabled");
  });
});
