// D4-B5k: sayaç kalibrasyon kaydı (isteğe bağlı) + `tambur.kalibrasyonKontrolu` ayar satırı.
import { describe, expect, it } from "vitest";
import { SETTINGS_CATEGORIES } from "@/pages/GeneralSettings/settings-config";
import { FLAG_MODULE } from "@/pages/GeneralSettings/flag-modules";
import { factoryDayKey, factoryDayStart } from "@/lib/factory-time";
import { isCalibrationExpired } from "./calibration";
import { buildPeripheralPayload, peripheralFormDefaults, peripheralFormSchema } from "./schema";

const DAY = 86_400_000;

describe("tamburCalibrationCheck ayar satırı", () => {
  const cat = SETTINGS_CATEGORIES.find((c) => (c.enumFlags ?? []).some((f) => f.enumKey === "tamburCalibrationCheck"));
  const flag = cat?.enumFlags?.find((f) => f.enumKey === "tamburCalibrationCheck");
  it("varsayılan KAPALI (backend DEFAULT_TAMBUR_CALIBRATION_CHECK), iki seçenek", () => {
    expect(flag?.defaultValue).toBe("KAPALI");
    expect(flag?.options.map((o) => o.value)).toEqual(["KAPALI", "UYAR"]);
    expect(flag?.group).toBe("Tambur");
    expect(FLAG_MODULE.tamburCalibrationCheck).toBe("productionEnabled");
  });
});

describe("isCalibrationExpired (backend ikizi)", () => {
  const now = new Date();
  const today = factoryDayStart(now);
  it("vadesiz geçmez; dün geçmiş; bugün ve yarın geçerli", () => {
    expect(isCalibrationExpired(null, now)).toBe(false);
    expect(isCalibrationExpired(new Date(today.getTime() - DAY).toISOString(), now)).toBe(true);
    expect(isCalibrationExpired(today.toISOString(), now)).toBe(false);
    expect(isCalibrationExpired(new Date(today.getTime() + DAY).toISOString(), now)).toBe(false);
  });
});

describe("cihaz formu kalibrasyon alanları", () => {
  const base = { ...peripheralFormDefaults, code: "M1", name: "Sayaç", kind: "METER" as const, connectionType: "BLUETOOTH_SPP" as const };
  it("boş bırakılabilir (isteğe bağlı) → null gönderilir", () => {
    const p = buildPeripheralPayload(peripheralFormSchema.parse(base));
    expect([p.calibratedAt, p.calibrationDueAt, p.calibrationNote]).toEqual([null, null, null]);
  });
  it("METER'de gün anahtarı gönderilir; METER olmayan türde temizlenir", () => {
    const v = { ...base, calibratedAt: "2026-01-10", calibrationDueAt: "2027-01-10", calibrationNote: "TSE" };
    expect(buildPeripheralPayload(peripheralFormSchema.parse(v)).calibrationDueAt).toBe("2027-01-10");
    const scale = buildPeripheralPayload(peripheralFormSchema.parse({ ...v, kind: "SCALE" }));
    expect([scale.calibratedAt, scale.calibrationDueAt, scale.calibrationNote]).toEqual([null, null, null]);
  });
  it("geçerlilik sonu < kalibrasyon tarihi form hatası", () => {
    const r = peripheralFormSchema.safeParse({ ...base, calibratedAt: "2026-05-01", calibrationDueAt: "2026-04-01" });
    expect(r.success).toBe(false);
    expect(factoryDayKey(new Date())).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
