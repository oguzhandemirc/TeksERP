import { describe, expect, it } from "vitest";
import { countsText } from "./columns";

const c = (orders: number) => ({ sacks: 3, rolls: 12, orders, returns: 0 });

describe("Sevkiyat listesi İçerik metni — sipariş sayacı yalnız bağ varsa", () => {
  it("çuvallı sevk, siparişsiz: '0 sipariş' yazmaz", () => {
    expect(countsText({ kind: "SHIPMENT", _count: c(0) } as never)).toBe("12 top · 3 çuval");
  });
  it("çuvallı sevk, siparişli: sayaç başta", () => {
    expect(countsText({ kind: "SHIPMENT", _count: c(2) } as never)).toBe("2 sipariş · 12 top · 3 çuval");
  });
  it("doğrudan sevk: siparişsizde yalnız top, siparişlide top · sipariş", () => {
    expect(countsText({ kind: "DIRECT", _count: c(0) } as never)).toBe("12 top");
    expect(countsText({ kind: "DIRECT", _count: c(1) } as never)).toBe("12 top · 1 sipariş");
  });
});
