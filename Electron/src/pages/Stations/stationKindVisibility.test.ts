import { describe, expect, it } from "vitest";
import { StationKind, stationKindLabel, stationKindLabels } from "@/types/enums";
import { visibleStationKindLabels } from "./stationKindVisibility";

// Negatif sonda (2026-09-14): `FLAG_GATED_STATION_KINDS`ten WEAVING düşürülünce
// "kapalıyken gizli" ayağı kırmızı; süzgeçten `kind !== current` düşürülünce
// "mevcut değer korunur" ayağı kırmızı. 2026-09-18: WARPING ↔ devereEnabled aynı kalıp (sonda: satır silinince
// "devere kapalı: WARPING yok" kırmızı).
const ALL = { dokumaEnabled: true, devereEnabled: true };
const NONE = { dokumaEnabled: false, devereEnabled: false };
const GATED = [StationKind.WEAVING, StationKind.WARPING] as string[];

describe("visibleStationKindLabels — WEAVING yalnız dokuma, WARPING yalnız devere açıkken", () => {
  it("iki bayrak KAPALI: WEAVING ve WARPING listede yok, öteki türler tam", () => {
    const v = visibleStationKindLabels(NONE, null);
    expect(v.WEAVING).toBeUndefined();
    expect(v.WARPING).toBeUndefined();
    expect(Object.keys(v).sort()).toEqual(Object.keys(stationKindLabels).filter((k) => !GATED.includes(k)).sort());
  });
  it("⭐ bayraklar BAĞIMSIZ: yalnız devere açık → WARPING var, WEAVING yok (ve tersi)", () => {
    const d = visibleStationKindLabels({ dokumaEnabled: false, devereEnabled: true }, null);
    expect(d.WARPING).toBe("Devere (Levent Sarım)");
    expect(d.WEAVING).toBeUndefined();
    const w = visibleStationKindLabels({ dokumaEnabled: true, devereEnabled: false }, null);
    expect(w.WEAVING).toBe("Dokuma Tezgahı");
    expect(w.WARPING).toBeUndefined();
  });
  it("bayraklar AÇIK: ayna tam, etiket aynadan", () => {
    const v = visibleStationKindLabels(ALL, null);
    expect(v).toEqual(stationKindLabels);
    expect(v.WEAVING).toBe("Dokuma Tezgahı");
  });
  it("⭐ seçenek sırası: öteki türler ayna sırasıyla, \"Diğer\" (OTHER) EN SONDA — bayraklar açık ve kapalı", () => {
    for (const flags of [ALL, NONE]) {
      const keys = Object.keys(visibleStationKindLabels(flags, null));
      expect(keys[keys.length - 1]).toBe(StationKind.OTHER);
      expect(Object.values(visibleStationKindLabels(flags, null)).at(-1)).toBe("Diğer");
      const aynaSirasi = Object.keys(stationKindLabels).filter((k) => k !== StationKind.OTHER && (flags.dokumaEnabled || !GATED.includes(k)));
      expect(keys.slice(0, -1)).toEqual(aynaSirasi);
    }
  });
  it("bayrak KAPALI ama düzenlenen istasyon WEAVING/WARPING: mevcut değer korunur (OTHER'a düşmez)", () => {
    expect(visibleStationKindLabels(NONE, StationKind.WEAVING).WEAVING).toBe("Dokuma Tezgahı");
    expect(visibleStationKindLabels(NONE, StationKind.WARPING).WARPING).toBe("Devere (Levent Sarım)");
  });
  it("⭐ eski panel fail-soft: tanınmayan tür etiketi ham adla basılır, undefined çizilmez", () => {
    expect(stationKindLabel("WARPING")).toBe("Devere (Levent Sarım)");
    expect(stationKindLabel("YARIN_GELECEK_TUR")).toBe("YARIN_GELECEK_TUR");
  });
});
