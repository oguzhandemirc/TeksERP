import { describe, it, expect } from "vitest";
import { formatRollName } from "./roll-name";

const D = "{item} {color} {width}";

describe("formatRollName (saha #20 — top adı şablonu)", () => {
  it("tüm token'ları doldurur", () => {
    expect(formatRollName(D, { item: "PATOS", color: "055-BEYAZ", width: 150 })).toBe(
      "PATOS 055-BEYAZ 150",
    );
  });
  it("renksiz → renk atlanır, boşluk sadeleşir", () => {
    expect(formatRollName(D, { item: "PATOS", color: null, width: 150 })).toBe("PATOS 150");
  });
  it("width null atlanır", () => {
    expect(formatRollName(D, { item: "KRİNKLE", color: "MAVİ", width: null })).toBe("KRİNKLE MAVİ");
  });
  it("özel şablon {width}cm + {quality}", () => {
    expect(
      formatRollName("{item} {color} {width}cm {quality}", {
        item: "POLAR",
        color: "SİYAH",
        width: 180,
        quality: "A",
      }),
    ).toBe("POLAR SİYAH 180cm A");
  });
  it("yalnız item (diğerleri boş)", () => {
    expect(formatRollName(D, { item: "SÜET" })).toBe("SÜET");
  });
});
