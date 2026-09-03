import { describe, it, expect } from "vitest";
import { stationToneForKind, toneFor, STATION_TONE, PRIMARY_TONE } from "./station-colors";

describe("stationToneForKind", () => {
  it("bilinen kind'leri tonlara eşler", () => {
    expect(stationToneForKind("RAW_QC")).toBe("kk1");
    expect(stationToneForKind("PROCESS_QC")).toBe("process");
    expect(stationToneForKind("TAMBUR")).toBe("tambur");
    // ⚠️ "WAREHOUSE" backend enum'unda YOK (ölü daldı) — gerçek değer SHIPPING.
    expect(stationToneForKind("SHIPPING")).toBe("depo");
  });
  it("bilinmeyen kind → process (varsayılan)", () => {
    expect(stationToneForKind("ANYTHING_ELSE")).toBe("process");
  });
});

describe("toneFor", () => {
  it("EXTERNAL → fason tonu", () => {
    expect(toneFor("EXTERNAL")).toBe(STATION_TONE.fason);
    expect(toneFor("EXTERNAL", "RAW_QC")).toBe(STATION_TONE.fason);
  });
  it("INTERNAL + kind → kind tonu", () => {
    expect(toneFor("INTERNAL", "TAMBUR")).toBe(STATION_TONE.tambur);
  });
  it("INTERNAL + kind yok → PRIMARY", () => {
    expect(toneFor("INTERNAL")).toBe(PRIMARY_TONE);
  });
});
