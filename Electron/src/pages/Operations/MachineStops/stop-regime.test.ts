// =============================================================================
// MAKİNE / TEZGAH DURUŞLARI GÖRÜNÜRLÜĞÜ — BEKÇİ (`weaving-regime.test.ts` kalıbı)
// NEGATİF SONDA (2026-10-30, D4-A3): `isMachineStopsVisible` yalnız `dokumaEnabled`e döndü → burada 2, tile-visibility 1,
// CommandPalette 1 test kırmızı; Teks-Erp `test_screen_catalog §9f` + `test_dokuma_regime_gate §7d` kırmızı. Geri alındı.
// =============================================================================
import { describe, expect, it } from "vitest";
import { isMachineStopsVisible, machineStopsTitle, resolveMachineStopEnabled } from "./stop-regime";
import { isShiftDefinitionsVisible } from "@/pages/ShiftDefinitions/shift-regime";
import { LOSS_CLASS_META, formatDuration, localInputToIso } from "./types";

// D4-A3: rejim = dokuma ∨ (üretim ∧ uretim.makineDurusTakibi) — backend `machineStopRegime` ile aynı anlam.
describe("rejim", () => {
  const regime = (dokumaEnabled: boolean, productionEnabled: boolean, machineStopTrackingEnabled: boolean) =>
    resolveMachineStopEnabled({ dokumaEnabled, productionEnabled, machineStopTrackingEnabled });
  it("⭐ fabrikada (dokuma kapalı, ayar kapalı) GÖRÜNMEZ", () => {
    expect(isMachineStopsVisible({ machineStopEnabled: regime(false, true, false) })).toBe(false);
  });
  it("dokuma modülü açıkken ayardan bağımsız görünür (bugünkü)", () => {
    expect(regime(true, true, false)).toBe(true);
    expect(regime(true, true, true)).toBe(true);
  });
  it("⭐ dokumasız + üretim + ayar açık → görünür", () => {
    expect(regime(false, true, true)).toBe(true);
  });
  it("⭐ üretim kapalıyken ayar açık olsa da görünmez (ön koşul)", () => {
    expect(regime(false, false, true)).toBe(false);
  });
  it("yüklem yalnız bağlamın rejim alanını okur; Vardiya Tanımları aynı alan", () => {
    for (const machineStopEnabled of [true, false]) {
      expect(isMachineStopsVisible({ machineStopEnabled })).toBe(machineStopEnabled);
      expect(isShiftDefinitionsVisible({ machineStopEnabled })).toBe(machineStopEnabled);
    }
  });
  it("⭐ başlık: dokuma açıkken bugünkü 'Tezgah Duruşları', dokumasız 'Makine Duruşları'", () => {
    expect(machineStopsTitle({ dokumaEnabled: true })).toBe("Tezgah Duruşları");
    expect(machineStopsTitle({ dokumaEnabled: false })).toBe("Makine Duruşları");
  });
});

describe("sözlük ve biçim", () => {
  it("beş kayıp sınıfı da etiketli (MINOR bir SÜRE sınıfı, yine de gösterilir)", () => {
    expect(Object.keys(LOSS_CLASS_META).sort()).toEqual(["MINOR", "NON_SCHEDULED", "PLANNED", "SETUP", "UNPLANNED"]);
  });
  it("süre: sunucu saniyesi öncelikli; açık duruşta şimdiye göre; ileri damga —", () => {
    const t0 = Date.parse("2026-09-14T10:00:00.000Z");
    expect(formatDuration(3900, "2026-09-14T10:00:00.000Z", "2026-09-14T11:05:00.000Z", t0)).toBe("1 sa 05 dk");
    expect(formatDuration(null, "2026-09-14T10:00:00.000Z", null, t0 + 12 * 60_000)).toBe("12 dk");
    expect(formatDuration(null, "2026-09-14T10:00:00.000Z", null, t0 - 60_000)).toBe("—");
  });
  it("datetime-local → ISO; boş → null", () => {
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("2026-09-14T10:30")).toMatch(/^2026-09-14T\d{2}:30:00\.000Z$/);
  });
});
