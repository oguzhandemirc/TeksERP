// =============================================================================
// BEKÇİ — İstasyonlar sayfası formun kaydettirdiği HER türü listeler; tek gizleme modül bayrağı (2026-09-16)
// =============================================================================
// Negatif sonda (kırmızı görüldü): `visibleStationKinds` eski sabit `["RAW_QC","PROCESS_QC","TAMBUR",
// "SUBCONTRACTOR"]`e döndürülünce "SHIPPING listede" · "WEAVING açıkken listede" · "form ≡ sayfa" ❌.
import { describe, expect, it } from "vitest";
import { StationKind } from "@/types/enums";
import { stationFormSchema } from "./schema";
import { STATION_FORM_KINDS, isVisibleStationKind, visibleStationKinds } from "./visibleStationKinds";

describe("İstasyonlar sayfası — tür kümesi", () => {
  it("⭐ SHIPPING (sevkiyat) ve OTHER listede — 'ekleyebiliyorsam görürüm'", () => {
    expect(isVisibleStationKind(StationKind.SHIPPING, { dokumaEnabled: false })).toBe(true);
    expect(isVisibleStationKind(StationKind.OTHER, { dokumaEnabled: false })).toBe(true);
  });

  it("⭐ dokuma AÇIK: WEAVING listede (kart çizilir, dışa aktarıma girer)", () => {
    expect(visibleStationKinds({ dokumaEnabled: true })).toContain(StationKind.WEAVING);
  });

  it("dokuma KAPALI: WEAVING çizilmez (kayıt DB'de korunur; form mevcut değeri korur); öteki türler tam", () => {
    const v = visibleStationKinds({ dokumaEnabled: false });
    expect(v).not.toContain(StationKind.WEAVING);
    expect(v.sort()).toEqual(STATION_FORM_KINDS.filter((k) => k !== StationKind.WEAVING).sort());
  });

  it("⭐ tek kaynak: sayfa kümesi (bayraklar açık) ≡ formun zod enum'u ≡ Electron StationKind aynası", () => {
    const form = [...stationFormSchema.shape.kind.options].sort();
    expect([...visibleStationKinds({ dokumaEnabled: true })].sort()).toEqual(form);
    expect(form).toEqual(Object.values(StationKind).sort());
  });
});
