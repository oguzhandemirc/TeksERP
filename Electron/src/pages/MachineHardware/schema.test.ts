import { describe, it, expect } from "vitest";
import {
  machineHardwareFormSchema,
  machineHardwareFormDefaults,
  buildMachineHardwarePayload,
} from "./schema";

describe("machineHardwareFormSchema", () => {
  it("varsayılanlar geçerli (makineId hariç boş)", () => {
    // machineId zorunlu — defaults boş, o yüzden defaults TEK BAŞINA geçersiz olmalı.
    const r = machineHardwareFormSchema.safeParse(machineHardwareFormDefaults);
    expect(r.success).toBe(false);
  });
  it("makineId + boş donanım alanları geçerli", () => {
    const r = machineHardwareFormSchema.safeParse({ ...machineHardwareFormDefaults, machineId: "m1" });
    expect(r.success).toBe(true);
  });
  it("dolu donanım alanları geçerli", () => {
    const r = machineHardwareFormSchema.safeParse({
      machineId: "m1",
      printerIp: "192.168.1.50",
      printerMac: "00:23:09:01:15:01",
      kqMac: "00:23:09:01:1D:17",
      mtMac: "",
      mtMac2: "",
      kqPattern: "(\\d+(?:\\.\\d+)?)",
      mtPattern: "y",
      mtPattern2: "",
      notes: "2 farklı kantar",
      isActive: true,
    });
    expect(r.success).toBe(true);
  });
  it("aşırı uzun pattern reddedilir (max 255)", () => {
    const r = machineHardwareFormSchema.safeParse({
      ...machineHardwareFormDefaults,
      machineId: "m1",
      kqPattern: "x".repeat(256),
    });
    expect(r.success).toBe(false);
  });
});

describe("buildMachineHardwarePayload (form → API, ''→null)", () => {
  it("boş alanlar null'a çevrilir", () => {
    const p = buildMachineHardwarePayload({ ...machineHardwareFormDefaults, machineId: "m1" });
    expect(p.machineId).toBe("m1");
    expect(p.printerIp).toBeNull();
    expect(p.kqPattern).toBeNull();
    expect(p.isActive).toBe(true);
  });
  it("dolu alanlar trim'lenip korunur", () => {
    const p = buildMachineHardwarePayload({
      ...machineHardwareFormDefaults,
      machineId: "m1",
      printerIp: "  192.168.1.50  ",
      kqPattern: "(\\d+)",
    });
    expect(p.printerIp).toBe("192.168.1.50");
    expect(p.kqPattern).toBe("(\\d+)");
  });
});
