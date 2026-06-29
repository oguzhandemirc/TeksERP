import { describe, it, expect } from "vitest";
import {
  peripheralFormSchema,
  peripheralFormDefaults,
  buildPeripheralPayload,
} from "./schema";

describe("peripheralFormSchema", () => {
  it("varsayılanlar kod/ad boş → geçersiz", () => {
    expect(peripheralFormSchema.safeParse(peripheralFormDefaults).success).toBe(false);
  });
  it("kod + ad dolu → geçerli", () => {
    const r = peripheralFormSchema.safeParse({ ...peripheralFormDefaults, code: "BT-1", name: "Argox" });
    expect(r.success).toBe(true);
  });
});

describe("buildPeripheralPayload (form → API)", () => {
  const base = { ...peripheralFormDefaults, code: "BT-1", name: "Argox" };

  it("owner=machine → machineId set, deviceId null", () => {
    const p = buildPeripheralPayload({ ...base, owner: "machine", machineId: "m1", deviceId: "d1" });
    expect(p.machineId).toBe("m1");
    expect(p.deviceId).toBeNull();
  });

  it("owner=device → deviceId set, machineId null", () => {
    const p = buildPeripheralPayload({ ...base, owner: "device", machineId: "m1", deviceId: "d1" });
    expect(p.deviceId).toBe("d1");
    expect(p.machineId).toBeNull();
  });

  it("owner=none → ikisi de null", () => {
    const p = buildPeripheralPayload({ ...base, owner: "none", machineId: "m1", deviceId: "d1" });
    expect(p.machineId).toBeNull();
    expect(p.deviceId).toBeNull();
  });

  it("port string → number, boş → null", () => {
    expect(buildPeripheralPayload({ ...base, port: "9100" }).port).toBe(9100);
    expect(buildPeripheralPayload({ ...base, port: "" }).port).toBeNull();
  });

  it("languageOverride boş → null, dolu → korunur", () => {
    expect(buildPeripheralPayload({ ...base, languageOverride: "" }).languageOverride).toBeNull();
    expect(buildPeripheralPayload({ ...base, languageOverride: "ZPL" }).languageOverride).toBe("ZPL");
  });

  it("templateRoutes 3-kind; boş templateId → null", () => {
    const p = buildPeripheralPayload({ ...base, templateFinishedId: "t1" });
    expect(p.templateRoutes).toHaveLength(3);
    const finished = p.templateRoutes.find((r) => r.kind === "ROLL_FINISHED");
    const raw = p.templateRoutes.find((r) => r.kind === "ROLL_RAW");
    expect(finished?.templateId).toBe("t1");
    expect(raw?.templateId).toBeNull();
  });
});
