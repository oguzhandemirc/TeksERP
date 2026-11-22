// Bitiş tartısında gövde darası önerisi (devere S3; sunucu `resolveWeighTareTx`).
import { describe, expect, it } from "vitest";
import { exhaustBodyTare, tareHint } from "./AdjustExhaustDialogs";

describe("exhaustBodyTare", () => {
  it("ayar açık + gövde darası → öneri", () => {
    expect(exhaustBodyTare({ beamBody: { id: "b", bodyNo: "LG-1", tareKg: 95 } }, true)).toBe(95);
  });
  it("ayar kapalı / gövdesiz / darasız / eski sunucu → öneri yok", () => {
    expect(exhaustBodyTare({ beamBody: { id: "b", bodyNo: "LG-1", tareKg: 95 } }, false)).toBeNull();
    expect(exhaustBodyTare({ beamBody: null }, true)).toBeNull();
    expect(exhaustBodyTare({ beamBody: { id: "b", bodyNo: "LG-1", tareKg: null } }, true)).toBeNull();
    expect(exhaustBodyTare({}, true)).toBeNull();
  });
  it("ipucu metni öneriye göre", () => {
    expect(tareHint(95.5)).toBe("Boş bırakılırsa gövde darası 95,5 kg kullanılır (gövde kartından).");
    expect(tareHint(null)).toMatch(/Dara bilinmiyorsa/);
  });
});
