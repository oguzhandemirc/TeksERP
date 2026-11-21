// =============================================================================
// Dokuma standart maliyet yöntemi ayarı (SY-D2, 2026-10-31)
// =============================================================================
// Backend: `maliyet.dokumaStandartYontemi` (TEZGAH_SAATI | ATKI_UCRETI, varsayılan TEZGAH_SAATI).
// Panel satırı backend Zod enum'unun ve varsayılanının AYNASIDIR; ayrışırsa panel geçerli değeri
// yazamaz (400). Backend tarafı: `Teks-Erp/scripts/test_maliyet_atki_ucreti.ts`.
// Satır Maliyet kategorisindedir: Muhasebe finans rejimine kapılı, finanssız kurulumda görünmezdi (SY-d).
// =============================================================================
import { describe, it, expect } from "vitest";
import { SETTINGS_CATEGORIES } from "./settings-config";
import { FLAG_MODULE } from "./flag-modules";

const maliyet = SETTINGS_CATEGORIES.find((c) => c.id === "maliyet");
const finance = SETTINGS_CATEGORIES.find((c) => c.id === "finance");
const row = maliyet?.enumFlags?.find((r) => r.enumKey === "costWeavingStandardMethod");

describe("Dokuma standart maliyet yöntemi ayar satırı", () => {
  it("TEZGAH_SAATI varsayılan (bugünkü motor), iki değer", () => {
    expect(row?.defaultValue).toBe("TEZGAH_SAATI");
    expect(row?.options.map((o) => o.value)).toEqual(["TEZGAH_SAATI", "ATKI_UCRETI"]);
  });

  it("finans rejimine kapılı Muhasebe kategorisinde değil", () => {
    expect(finance?.enumFlags?.some((r) => r.enumKey === "costWeavingStandardMethod")).toBe(false);
  });

  it("dokuma modülüne bağlı (dokuma kapalıysa satır gizli)", () => {
    expect(FLAG_MODULE.costWeavingStandardMethod).toBe("dokumaEnabled");
  });
});
