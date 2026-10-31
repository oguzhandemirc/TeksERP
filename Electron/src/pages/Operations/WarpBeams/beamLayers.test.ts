// =============================================================================
// BEKÇİ — levent ön dolgusu çözgü katmanı başına (Seyitoğlu SY-B2): iki katmanlı işte iki levent önerisi ·
// SHARED_BEAM/CREEL'de levent önerilmez (gerekçe) · katmansız üründe liste boş (bugünkü form)
// NEGATİF SONDA: kip okunmadan her katman "BEAM" sayılınca §SHARED/§CREEL kırmızı
// =============================================================================
import { describe, expect, it } from "vitest";
import { beamCountSuggested, beamSuggestionsForConstruction } from "./beamLayers";

const ground = { id: "g", code: "CZ-70/800", name: "Zemin" };
const layer = (beamMode: string, sortOrder = 0) => ({ role: "LENO", beamMode, sortOrder, warpSpec: { id: `l${sortOrder}`, code: "CZ-DONER20", name: "Döner" } });

describe("beamSuggestionsForConstruction", () => {
  it("⭐ iki katmanlı iş (SEPARATE_BEAM): iki levent önerisi — zemin + döner", () => {
    const s = beamSuggestionsForConstruction({ groundWarp: ground, warpLayers: [layer("SEPARATE_BEAM")] });
    expect(s.map((x) => [x.role, x.warpSpecId, x.kind])).toEqual([["Zemin çözgü", "g", "BEAM"], ["Döner çözgü", "l0", "BEAM"]]);
    expect(beamCountSuggested(s)).toBe(2);
  });
  it("⭐ katmansız üründe liste BOŞ (form bugünkü gibi)", () => {
    expect(beamSuggestionsForConstruction({ groundWarp: ground, warpLayers: [] })).toEqual([]);
    expect(beamSuggestionsForConstruction(null)).toEqual([]);
  });
  it("⭐ SHARED_BEAM: döner için levent önerilmez, zemin leventine sarılır", () => {
    const s = beamSuggestionsForConstruction({ groundWarp: ground, warpLayers: [layer("SHARED_BEAM")] });
    expect(beamCountSuggested(s)).toBe(1);
    expect(s[1]).toMatchObject({ kind: "SHARED", note: expect.stringMatching(/zemin leventine/) });
  });
  it("⭐ CREEL: levent yok (cağlık)", () => {
    const s = beamSuggestionsForConstruction({ groundWarp: ground, warpLayers: [layer("CREEL")] });
    expect(beamCountSuggested(s)).toBe(1);
    expect(s[1]).toMatchObject({ kind: "CREEL", note: expect.stringMatching(/cağlık/) });
  });
  it("katmanlar sortOrder sırasıyla", () => {
    const s = beamSuggestionsForConstruction({ groundWarp: ground, warpLayers: [layer("SEPARATE_BEAM", 2), layer("SEPARATE_BEAM", 1)] });
    expect(s.map((x) => x.warpSpecId)).toEqual(["g", "l1", "l2"]);
  });
  it("işin kendi çözgü kartı ürününkinden farklıysa zemin önerisi işin kartını gösterir", () => {
    const own = { id: "w", code: "CZ-IS", name: "İşin çözgüsü" };
    const s = beamSuggestionsForConstruction({ groundWarp: ground, warpLayers: [layer("SEPARATE_BEAM")] }, own);
    expect(s[0]).toMatchObject({ warpSpecId: "w", role: "Zemin çözgü", kind: "BEAM" });
    expect(s.map((x) => x.warpSpecId)).not.toContain("g");
  });
});
