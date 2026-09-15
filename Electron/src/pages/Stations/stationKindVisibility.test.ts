import { describe, expect, it } from "vitest";
import { StationKind, stationKindLabels } from "@/types/enums";
import { visibleStationKindLabels } from "./stationKindVisibility";

// Negatif sonda (2026-09-14): `FLAG_GATED_STATION_KINDS`ten WEAVING düşürülünce
// "kapalıyken gizli" ayağı kırmızı; süzgeçten `kind !== current` düşürülünce
// "mevcut değer korunur" ayağı kırmızı.
describe("visibleStationKindLabels — WEAVING yalnız dokuma açıkken", () => {
  it("bayrak KAPALI: WEAVING listede yok, öteki türler tam", () => {
    const v = visibleStationKindLabels({ dokumaEnabled: false }, null);
    expect(v.WEAVING).toBeUndefined();
    expect(Object.keys(v).sort()).toEqual(
      Object.keys(stationKindLabels).filter((k) => k !== StationKind.WEAVING).sort(),
    );
  });
  it("bayrak AÇIK: ayna tam, etiket aynadan", () => {
    const v = visibleStationKindLabels({ dokumaEnabled: true }, null);
    expect(v).toEqual(stationKindLabels);
    expect(v.WEAVING).toBe("Dokuma Tezgahı");
  });
  it("⭐ seçenek sırası: öteki türler ayna sırasıyla, \"Diğer\" (OTHER) EN SONDA — bayrak açık ve kapalı", () => {
    for (const dokumaEnabled of [true, false]) {
      const keys = Object.keys(visibleStationKindLabels({ dokumaEnabled }, null));
      expect(keys[keys.length - 1]).toBe(StationKind.OTHER);
      expect(Object.values(visibleStationKindLabels({ dokumaEnabled }, null)).at(-1)).toBe("Diğer");
      const aynaSirasi = Object.keys(stationKindLabels).filter((k) => k !== StationKind.OTHER && (dokumaEnabled || k !== StationKind.WEAVING));
      expect(keys.slice(0, -1)).toEqual(aynaSirasi);
    }
  });
  it("bayrak KAPALI ama düzenlenen istasyon WEAVING: mevcut değer korunur (OTHER'a düşmez)", () => {
    const v = visibleStationKindLabels({ dokumaEnabled: false }, StationKind.WEAVING);
    expect(v.WEAVING).toBe("Dokuma Tezgahı");
  });
});
