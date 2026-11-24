// Desen sınıflaması aynası + Yapı sekmesi gövdesi: eski `kind` eşlemesi backend'le aynı, gizli alan gönderilmez.
import { describe, expect, it } from "vitest";
import { resolveWeaveClass, weaveClassLabel } from "./weave-class";
import { structurePayload } from "./tabs/StructureTab";

const base = {
  code: "D1", name: "Desen", familyLabel: "", frameCount: "8", repeatCm: "12,5", repeatWidthCm: "30", hookCount: "2688",
  loomFileName: "X.DOP", lenoSetup: "kurulum", drawingInNote: "düz", notes: "",
};

describe("resolveWeaveClass", () => {
  it("eski kind backend eşlemesiyle aynı türetilir", () => {
    expect(resolveWeaveClass({ kind: "PLAIN" })).toEqual({ shedMechanism: "CAM", weaveStructure: "PLAIN" });
    expect(resolveWeaveClass({ kind: "DOBBY" })).toEqual({ shedMechanism: "DOBBY", weaveStructure: null });
    expect(resolveWeaveClass({ kind: "JACQUARD" })).toEqual({ shedMechanism: "JACQUARD", weaveStructure: null });
    expect(resolveWeaveClass({ kind: "LENO" })).toEqual({ shedMechanism: "DOBBY", weaveStructure: "LENO" });
  });
  it("yeni eksen varsa kind'a bakılmaz", () => {
    expect(resolveWeaveClass({ kind: "DOBBY", shedMechanism: "JACQUARD", weaveStructure: "LENO" })).toEqual({ shedMechanism: "JACQUARD", weaveStructure: "LENO" });
  });
  it("görünür ad", () => {
    expect(weaveClassLabel({ kind: "LENO" })).toBe("Armür · Döner");
    expect(weaveClassLabel({ kind: "JACQUARD" })).toBe("Jakar");
  });
});

describe("structurePayload", () => {
  it("Eksantrik: ızgara/kanca/çerçeve/dosya alanları gönderilmez, kind gönderilmez", () => {
    const b = structurePayload({ ...base, shedMechanism: "CAM", weaveStructure: "TWILL" });
    expect(b).toMatchObject({ shedMechanism: "CAM", weaveStructure: "TWILL", repeatCm: "12.5" });
    for (const k of ["kind", "hookCount", "repeatWidthCm", "frameCount", "loomFileName", "drawingInNote", "lenoSetup", "liftPlan"]) expect(b).not.toHaveProperty(k);
  });
  it("Armür: çerçeve + .DOP + tahar; kanca yok", () => {
    const b = structurePayload({ ...base, shedMechanism: "DOBBY", weaveStructure: "LENO" });
    expect(b).toMatchObject({ frameCount: 8, loomFileName: "X.DOP", drawingInNote: "düz", lenoSetup: "kurulum" });
    expect(b).not.toHaveProperty("hookCount");
  });
  it("Jakar: kanca + rapor en×boy + dosya; çerçeve yok", () => {
    const b = structurePayload({ ...base, shedMechanism: "JACQUARD", weaveStructure: null });
    expect(b).toMatchObject({ hookCount: 2688, repeatWidthCm: "30", repeatCm: "12.5", loomFileName: "X.DOP" });
    expect(b).not.toHaveProperty("frameCount");
    expect(b).not.toHaveProperty("lenoSetup");
  });
});
