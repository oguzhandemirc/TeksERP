import { describe, expect, it } from "vitest";
import { dispatchContentText } from "./columns";

const c = (over: Partial<{ sacks: number; rolls: number; orders: number; returns: number; carts: number; bulks: number }> = {}) => ({
  sacks: 1, rolls: 3, orders: 0, returns: 0, ...over,
});

describe("Sevk Edilenler — İçerik hücresi yük birimi dili", () => {
  it('dökme sevkte "çuval" yazılmaz (prova: "1 çuval · 3 top")', () => {
    expect(dispatchContentText({ kind: "SHIPMENT", _count: c({ bulks: 1 }), manualSackCount: null })).toBe("Dökme · 3 top");
  });
  it("araba ve karışık yük Sevkiyatlar listesiyle aynı dil", () => {
    expect(dispatchContentText({ kind: "SHIPMENT", _count: c({ sacks: 2, carts: 2, rolls: 6 }), manualSackCount: null })).toBe("2 araba · 6 top");
    expect(dispatchContentText({ kind: "SHIPMENT", _count: c({ sacks: 3, bulks: 1, rolls: 9 }), manualSackCount: null })).toBe("2 çuval · Dökme · 9 top");
  });
  it("çuvallı sevk ve eski sunucu (alan yok) bugünkü metin; beyan önce", () => {
    expect(dispatchContentText({ kind: "SHIPMENT", _count: c({ sacks: 4, rolls: 20 }), manualSackCount: null })).toBe("4 çuval · 20 top");
    expect(dispatchContentText({ kind: "SHIPMENT", _count: c({ sacks: 1, rolls: 20 }), manualSackCount: 10 })).toBe("10 çuval (1 kayıt) · 20 top");
  });
  it("doğrudan sevk: top + sipariş", () => {
    expect(dispatchContentText({ kind: "DIRECT", _count: c({ rolls: 5, orders: 2 }), manualSackCount: null })).toBe("5 top · 2 sipariş");
  });
});
