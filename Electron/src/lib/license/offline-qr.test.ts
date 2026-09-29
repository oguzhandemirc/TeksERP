import { describe, it, expect } from "vitest";
import { joinQrParts } from "./qr-parca";
import { SINGLE_QR_MAX_CHARS, offlineRequestQrValues } from "./offline-qr";

const BASE = "https://lisans.etkiliyazilim.com/q";

/** Çevrimdışı istek QR'ları: sığan tek QR, sığmayan sıralı parçalar — hepsi /q sayfasını açan adres. */
describe("offlineRequestQrValues", () => {
  it("sığan istek eskisi gibi tek QR (eski /q sayfası da açar)", () => {
    const url = `${BASE}#${"a".repeat(800)}`;
    expect(offlineRequestQrValues(url)).toEqual([url]);
  });

  it("⭐ büyük istek (ölçülen ≈ 2,7 KB) sıralı parçalara bölünür; her parça /q adresi, birleşince zarf AYNEN", () => {
    const zarf = "eyJ".repeat(900);
    const values = offlineRequestQrValues(`${BASE}#${zarf}`)!;
    expect(values.length).toBeGreaterThan(1);
    expect(values.length).toBeLessThanOrEqual(4);
    for (const v of values) {
      expect(v.startsWith(`${BASE}#TKLQ1%7C`)).toBe(true);
      expect(v.length).toBeLessThanOrEqual(SINGLE_QR_MAX_CHARS + 120);
    }
    const parts = values.map((v) => decodeURIComponent(v.slice(v.indexOf("#") + 1)));
    expect(joinQrParts([...parts].reverse())).toBe(zarf);
  });

  it("satıcı adresi yok / parçalara da sığmıyor → null (yalnız metni kopyala)", () => {
    expect(offlineRequestQrValues(null)).toBeNull();
    expect(offlineRequestQrValues(`${BASE}#${"a".repeat(7000)}`)).toBeNull();
  });
});
