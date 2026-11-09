// Sınıflama listesinin istasyon türü kesişimi: toplu seçimde yalnız HEPSİNE uyan sebepler kalır (sunucu her satırı
// ayrı denetler → listede görünen sebep hiçbir satırda STOP_REASON_OUT_OF_SCOPE almaz); pasif satır listelenmez.
import { describe, expect, it } from "vitest";
import type { ReasonPreset } from "@/pages/ReasonPresets/service";
import { distinctStationKinds, intersectScopedPresets } from "./useScopedStopReasons";

const p = (code: string, isActive = true) => ({ code, label: code, isActive }) as ReasonPreset;

describe("intersectScopedPresets", () => {
  it("tek tür: sunucunun süzdüğü aktif liste aynen, sırası korunur", () => {
    expect(intersectScopedPresets([[p("B"), p("A"), p("X", false)]]).map((r) => r.code)).toEqual(["B", "A"]);
  });
  it("⭐ farklı türler: yalnız her listede bulunan sebepler (kesişim), ilk listenin sırasıyla", () => {
    const weaving = [p("COZGU"), p("MEKANIK"), p("MOLA")];
    const tambur = [p("MOLA"), p("BICAK"), p("MEKANIK")];
    expect(intersectScopedPresets([weaving, tambur]).map((r) => r.code)).toEqual(["MEKANIK", "MOLA"]);
  });
  it("liste yoksa boş", () => {
    expect(intersectScopedPresets([])).toEqual([]);
  });
});

describe("distinctStationKinds", () => {
  it("tekrarsız, boşsuz, sıralı (sorgu anahtarı kararlı)", () => {
    expect(distinctStationKinds(["TAMBUR", "WEAVING", "TAMBUR", null, undefined])).toEqual(["TAMBUR", "WEAVING"]);
  });
});
