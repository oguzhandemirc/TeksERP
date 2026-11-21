// SAR diyaloğu gövde kapısı + gövde alanı (devere ek-2 r; backend `beamBodyIds`).
import { describe, expect, it } from "vitest";
import { buildWindPayload, windBodiesOk } from "./WindDialog";

const base = { lengthM: "100", kgSource: "WEIGHED" as const, inHouse: true, machineId: "m1", issues: [], returns: [], breakCount: "", clientToken: "t", weavingOrderId: "", count: "2", prefix: "" };

describe("windBodiesOk", () => {
  it("OFF ve fason kökeninde gövde sorulmaz", () => {
    expect(windBodiesOk("OFF", true, 0, 2)).toBe(true);
    expect(windBodiesOk("REQUIRED", false, 0, 2)).toBe(true);
  });
  it("REQUIRED: adet kadar gövde şart", () => {
    expect(windBodiesOk("REQUIRED", true, 0, 2)).toBe(false);
    expect(windBodiesOk("REQUIRED", true, 1, 2)).toBe(false);
    expect(windBodiesOk("REQUIRED", true, 2, 2)).toBe(true);
  });
  it("OPTIONAL: hiç ya da adet kadar", () => {
    expect(windBodiesOk("OPTIONAL", true, 0, 2)).toBe(true);
    expect(windBodiesOk("OPTIONAL", true, 1, 2)).toBe(false);
    expect(windBodiesOk("OPTIONAL", true, 2, 2)).toBe(true);
  });
});

describe("buildWindPayload gövde alanı", () => {
  it("gövde yoksa alan gönderilmez (bugünkü istek)", () => {
    expect("beamBodyIds" in buildWindPayload(base)).toBe(false);
    expect("beamBodyIds" in buildWindPayload({ ...base, beamBodyIds: [] })).toBe(false);
  });
  it("içeride seçilen gövdeler sırayla gider; fasonda gitmez", () => {
    expect(buildWindPayload({ ...base, beamBodyIds: ["b1", "b2"] }).beamBodyIds).toEqual(["b1", "b2"]);
    expect("beamBodyIds" in buildWindPayload({ ...base, inHouse: false, beamBodyIds: ["b1"] })).toBe(false);
  });
});
