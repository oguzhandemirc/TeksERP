// =============================================================================
// BEKÇİ — Görev türüne göre önerilen yetenek düzeni: türe göre ön-işaret · düzenlemede korunur (2026-09-16)
// =============================================================================
import { describe, expect, it } from "vitest";
import { StationKind } from "@/types/enums";
import { stationFormDefaults } from "./schema";
import { STATION_KIND_CAPABILITY_DEFAULTS, suggestedCapabilities, valuesAfterKindChange } from "./stationKindDefaults";

describe("İstasyon formu — türe göre önerilen yetenekler", () => {
  it("⭐ türe göre ön-işaret: PROCESS_QC kalite · SUBCONTRACTOR renk+özellik · WEAVING levent tüketir · KK1/sevkiyat/diğer hiçbiri", () => {
    expect(suggestedCapabilities(StationKind.PROCESS_QC)).toMatchObject({ appliesQuality: true, appliesColor: false, appliesProperty: false });
    expect(suggestedCapabilities(StationKind.SUBCONTRACTOR)).toMatchObject({ appliesColor: true, appliesProperty: true, appliesQuality: false });
    expect(suggestedCapabilities(StationKind.WEAVING)).toMatchObject({ consumesWarpBeam: true, producesWarpBeam: false, appliesProperty: false });
    // Devere: levent ÜRETİR (tüketmez) — tezgahın aynası.
    expect(suggestedCapabilities(StationKind.WARPING)).toMatchObject({ producesWarpBeam: true, consumesWarpBeam: false, appliesQuality: false });
    expect(suggestedCapabilities(StationKind.TAMBUR)).toMatchObject({ appliesProperty: true, appliesColor: false });
    for (const k of [StationKind.RAW_QC, StationKind.SHIPPING, StationKind.OTHER]) {
      expect(Object.values(suggestedCapabilities(k)).some(Boolean)).toBe(false);
    }
    expect(Object.keys(STATION_KIND_CAPABILITY_DEFAULTS).sort()).toEqual(Object.values(StationKind).sort());
  });

  it("⭐ YENİ kayıtta tür değişimi öneriyi uygular (kullanıcı sonra değiştirebilir — kilit değil)", () => {
    const v1 = valuesAfterKindChange(stationFormDefaults, StationKind.SUBCONTRACTOR, false);
    expect(v1).toMatchObject({ kind: StationKind.SUBCONTRACTOR, appliesColor: true, appliesProperty: true });
    const override = { ...v1, appliesColor: false }; // kullanıcı kutuyu kaldırdı
    expect(valuesAfterKindChange(override, StationKind.PROCESS_QC, false)).toMatchObject({ appliesQuality: true, appliesColor: false });
  });

  it("⭐ DÜZENLEMEDE tür değişse bile mevcut yetenekler korunur (sessizce ezilmez)", () => {
    const mevcut = { ...stationFormDefaults, kind: StationKind.SUBCONTRACTOR, appliesColor: true, appliesProperty: true, appliesQuality: true };
    const v = valuesAfterKindChange(mevcut, StationKind.OTHER, true);
    expect(v.kind).toBe(StationKind.OTHER);
    expect(v).toMatchObject({ appliesColor: true, appliesProperty: true, appliesQuality: true });
  });

  it("öneri nesnesi kopyadır — çağıran değiştirse sabit bozulmaz", () => {
    const a = suggestedCapabilities(StationKind.WEAVING);
    a.consumesWarpBeam = false;
    expect(suggestedCapabilities(StationKind.WEAVING).consumesWarpBeam).toBe(true);
  });
});
