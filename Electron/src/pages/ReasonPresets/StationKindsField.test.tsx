import { describe, expect, it } from "vitest";
import { stationKindOptions, toggleStationKind } from "./StationKindsField";

describe("StationKindsField yardımcıları", () => {
  it("kapalı modülün türü (dokuma/devere) seçenekte yok; seçili tür her zaman kalır", () => {
    const off = { dokumaEnabled: false, devereEnabled: false };
    const vals = stationKindOptions(off, []).map((o) => o.value);
    expect(vals).toContain("TAMBUR");
    expect(vals).toContain("PROCESS_QC");
    expect(vals).not.toContain("WEAVING");
    expect(stationKindOptions(off, ["WEAVING"]).map((o) => o.value)).toContain("WEAVING");
  });

  it("dokuma açıkken tezgah türü listede", () => {
    expect(stationKindOptions({ dokumaEnabled: true, devereEnabled: false }, []).map((o) => o.value)).toContain("WEAVING");
  });

  it("toggle ekler/çıkarır, enum sırasını korur", () => {
    expect(toggleStationKind(["TAMBUR"], "PROCESS_QC", true)).toEqual(["PROCESS_QC", "TAMBUR"]);
    expect(toggleStationKind(["PROCESS_QC", "TAMBUR"], "TAMBUR", false)).toEqual(["PROCESS_QC"]);
    expect(toggleStationKind([], "TAMBUR", false)).toEqual([]);
  });
});
