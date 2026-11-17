import { describe, expect, it } from "vitest";
import { openOrderHref } from "./OpenOrderLink";

describe("Çözgü Hesabı → sipariş aç bağlantısı", () => {
  it("kart, devereci ve levent alanlarını sorguya taşır; boşları atlar", () => {
    expect(openOrderHref({ warpSpecId: "ws", subcontractorId: null, beamCount: "3", beamLengthM: " 1200 " })).toBe("/operations/fason-devere?new=1&warpSpecId=ws&beamCount=3&beamLengthM=1200");
    expect(openOrderHref({ warpSpecId: "ws", subcontractorId: "s1", beamCount: "", beamLengthM: "" })).toBe("/operations/fason-devere?new=1&warpSpecId=ws&subcontractorId=s1");
  });
});
