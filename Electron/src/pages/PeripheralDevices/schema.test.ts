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
  it("kod + ad dolu → geçerli (yazıcıda dil de gerekli)", () => {
    const r = peripheralFormSchema.safeParse({
      ...peripheralFormDefaults, code: "BT-1", name: "Argox", languageOverride: "PPLA",
    });
    expect(r.success).toBe(true);
  });
  it("LABEL_PRINTER + boş dil → geçersiz (dil cihazda zorunlu)", () => {
    const r = peripheralFormSchema.safeParse({
      ...peripheralFormDefaults, code: "BT-1", name: "Argox", kind: "LABEL_PRINTER", languageOverride: "",
    });
    expect(r.success).toBe(false);
  });
  it("SCALE + boş dil → geçerli (dil yalnız yazıcıda aranır)", () => {
    const r = peripheralFormSchema.safeParse({
      ...peripheralFormDefaults, code: "KANTAR-1", name: "Kantar", kind: "SCALE", languageOverride: "",
    });
    expect(r.success).toBe(true);
  });
  it("medya sınır dışı (eni 5mm) → geçersiz", () => {
    const r = peripheralFormSchema.safeParse({
      ...peripheralFormDefaults, code: "BT-1", name: "Argox", languageOverride: "PPLA", labelWidthMm: "5",
    });
    expect(r.success).toBe(false);
  });
  it("medya geçerli aralıkta (100mm/203dpi) → geçerli", () => {
    const r = peripheralFormSchema.safeParse({
      ...peripheralFormDefaults, code: "BT-1", name: "Argox", languageOverride: "PPLA",
      labelWidthMm: "100", labelHeightMm: "50", labelDpi: "203", labelGapMm: "2",
    });
    expect(r.success).toBe(true);
  });
});

describe("buildPeripheralPayload (form → API)", () => {
  const base = { ...peripheralFormDefaults, code: "BT-1", name: "Argox", languageOverride: "PPLA" };

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

  it("owner=station → yalnız stationId dolu (makinesiz istasyon — SHIPPING kantarı)", () => {
    const p = buildPeripheralPayload({
      ...base, owner: "station", machineId: "m1", stationId: "s1", deviceId: "d1",
    });
    expect(p.stationId).toBe("s1");
    expect(p.machineId).toBeNull();
    expect(p.deviceId).toBeNull();
  });

  it("owner=machine/none → stationId null (tam-biri)", () => {
    expect(buildPeripheralPayload({ ...base, owner: "machine", machineId: "m1", stationId: "s1" }).stationId).toBeNull();
    expect(buildPeripheralPayload({ ...base, owner: "none", stationId: "s1" }).stationId).toBeNull();
  });

  it("rasterMode: LABEL_PRINTER'da korunur; yazıcı-dışı türde false", () => {
    expect(buildPeripheralPayload({ ...base, kind: "LABEL_PRINTER", rasterMode: true }).rasterMode).toBe(true);
    expect(buildPeripheralPayload({ ...base, kind: "LABEL_PRINTER", rasterMode: false }).rasterMode).toBe(false);
    // Yazıcı-dışı (kantar/metre) → raster anlamsız, temizlenir.
    expect(buildPeripheralPayload({ ...base, kind: "SCALE", rasterMode: true }).rasterMode).toBe(false);
  });

  it("schema station owner'ı kabul eder", () => {
    const r = peripheralFormSchema.safeParse({ ...base, owner: "station", stationId: "s1" });
    expect(r.success).toBe(true);
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

  it("formatProfileId payload'dan çıkarıldı (DEPRECATED)", () => {
    const p = buildPeripheralPayload({ ...base }) as Record<string, unknown>;
    expect("formatProfileId" in p).toBe(false);
  });

  it("yazıcı medyası: dolu → number, boş → null", () => {
    const p = buildPeripheralPayload({
      ...base, labelWidthMm: "100", labelHeightMm: "50", labelDpi: "203", labelGapMm: "2.5",
    });
    expect(p.labelWidthMm).toBe(100);
    expect(p.labelHeightMm).toBe(50);
    expect(p.labelDpi).toBe(203);
    expect(p.labelGapMm).toBe(2.5);

    const e = buildPeripheralPayload({ ...base });
    expect(e.labelWidthMm).toBeNull();
    expect(e.labelDpi).toBeNull();
  });

  it("SCALE türünde medya temizlenir (yalnız yazıcıda anlamlı)", () => {
    const p = buildPeripheralPayload({
      ...base, kind: "SCALE", labelWidthMm: "100", labelHeightMm: "50",
    });
    expect(p.labelWidthMm).toBeNull();
    expect(p.labelHeightMm).toBeNull();
  });

  it("giriş cihazı protokol alanları: dolu → çevrilir, boş → null/false", () => {
    const p = buildPeripheralPayload({
      ...base, decimals: "2", scale: "0.01", timeoutMs: "3000",
      role: "2-KAT", pollCommand: "R", simulate: true,
    });
    expect(p.decimals).toBe(2);
    expect(p.scale).toBe(0.01);
    expect(p.timeoutMs).toBe(3000);
    expect(p.role).toBe("2-KAT");
    expect(p.pollCommand).toBe("R");
    expect(p.simulate).toBe(true);

    const e = buildPeripheralPayload({ ...base });
    expect(e.decimals).toBeNull();
    expect(e.scale).toBeNull();
    expect(e.role).toBeNull();
    expect(e.simulate).toBe(false);
  });
});
