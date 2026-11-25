import { describe, expect, it } from "vitest";
import { itemWidthOf, prefillWidth, prefillWidthText } from "./item-width-prefill";

describe("itemWidthOf", () => {
  it("Decimal metni sayıya çevirir; boş/sıfır/bozuk null", () => {
    expect(itemWidthOf("280.00")).toBe(280);
    expect(itemWidthOf(150)).toBe(150);
    expect(itemWidthOf(null)).toBeNull();
    expect(itemWidthOf("")).toBeNull();
    expect(itemWidthOf("0")).toBeNull();
    expect(itemWidthOf("abc")).toBeNull();
  });
});

describe("prefillWidth", () => {
  it("boş satır yeni kartın enini alır", () => {
    expect(prefillWidth(null, null, 280)).toBe(280);
    expect(prefillWidth(undefined, null, 280)).toBe(280);
  });
  it("elle yazılmış en ezilmez (eski satır, önceki ön-dolum bilinmiyor)", () => {
    expect(prefillWidth(300, null, 280)).toBe(300);
  });
  it("önceki seçimin ön-doldurduğu en yeni seçimle yenilenir", () => {
    expect(prefillWidth(280, 280, 320)).toBe(320);
  });
  it("ön-dolumdan sonra elle değiştirilen en korunur", () => {
    expect(prefillWidth(290, 280, 320)).toBe(290);
  });
  it("yeni kartın eni yoksa boş satır boş kalır", () => {
    expect(prefillWidth(null, null, null)).toBeNull();
  });
});

describe("prefillWidthText", () => {
  it("boş metin dolar, elle yazılan korunur, okunamayan yazıma dokunulmaz", () => {
    expect(prefillWidthText("", null, 280)).toBe("280");
    expect(prefillWidthText("300", null, 280)).toBe("300");
    expect(prefillWidthText("280", 280, 320)).toBe("320");
    expect(prefillWidthText("299,5", 280, 320)).toBe("299,5");
    expect(prefillWidthText("x", 280, 320)).toBe("x");
  });
});
