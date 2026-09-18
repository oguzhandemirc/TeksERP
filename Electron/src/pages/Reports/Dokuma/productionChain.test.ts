// BEKÇİ — Üretim Zinciri (saf): sorgu parametreleri ("Tümü" anahtar yok) · şerhler · kovalar (devere yok → levent kovası yok) · çıktı (kolon/satır aynası)
import { describe, expect, it } from "vitest";
import { bucketRows, buildChainExport, CHAIN_STATUS_OPTIONS, chainFilterNotes, chainParams, type ChainReport } from "./productionChain";

const rapor = (devere: boolean): ChainReport => ({
  satirlar: [{ orderLineId: "l1", siparis: { id: "o1", no: "SIP-1", teslimTarihi: null }, musteri: { id: "c1", ad: "Müşteri A" }, kumas: { id: "i1", ad: "Kumaş" }, renk: null, siparisM: 300, sevkM: 50, isEmri: { id: "w1", no: "WO-1", durum: "IN_PROGRESS", adim: "KK1" }, dokuma: { id: "d1", no: "DK-1", durum: "IN_PROGRESS", dokunanM: 200, planM: 500, ilerlemePct: 40, planBitis: null }, ...(devere ? { levent: { id: "b1", no: "LV-1", durum: "PLANNED", kalanM: 0 } } : {}), gecikmeGun: null, durum: "DEVAM" }],
  satirOmitted: 0,
  kovalar: { ...(devere ? { issizLevent: 2 } : {}), siparissizDokuma: 1, disaridanTop: 3 },
  ozet: { satir: 1, gecikmis: 0, bagsiz: devere ? 6 : 4 },
  moduller: { devere },
});

describe("productionChain (saf)", () => {
  it("chainParams: Tümü/kapalı anahtar istekte YOK; seçim düz değer", () => {
    expect(chainParams({ customerId: "a,b" }, "ALL", false)).toEqual({ customerId: "a,b" });
    expect(chainParams({}, "GECIKMIS", true)).toEqual({ durum: "GECIKMIS", gecikmis: "true" });
  });
  it("şerhler yalnız süzgeç açıkken; durum etiketi Türkçe", () => {
    expect(chainFilterNotes("ALL", false)).toEqual([]);
    expect(chainFilterNotes("DEVAM", true)).toEqual(["Durum: Devam eden", "Yalnız gecikmiş satırlar"]);
    expect(CHAIN_STATUS_OPTIONS.map((o) => o.value)).toEqual(["ALL", "BEKLEYEN", "DEVAM", "GECIKMIS", "TAMAMLANAN"]);
  });
  it("⭐ kovalar: devere kapalı → levent kovası HİÇ yok; açık → üç kova, her biri listeye gider", () => {
    expect(bucketRows(rapor(false)).map((b) => b.key)).toEqual(["siparissizDokuma", "disaridanTop"]);
    expect(bucketRows(rapor(true)).map((b) => [b.key, b.sayi, b.yol])).toEqual([["issizLevent", 2, "/operations/warp-beams"], ["siparissizDokuma", 1, "/operations/weaving-orders"], ["disaridanTop", 3, "/operations/rolls"]]);
  });
  it("çıktı: devere kapalı → Levent kolonu yok; satır alanları aynası; bağsız tablo kova sayısı kadar; şerh meta'da", () => {
    const off = buildChainExport(rapor(false), ["Durum: Devam eden"]);
    expect(off.tables[0]!.columns.map((c) => c.header)).not.toContain("Levent");
    expect(off.tables[0]!.rows[0]).toMatchObject({ musteri: "Müşteri A", siparisNo: "SIP-1", isEmri: "WO-1", adim: "KK1", dokuma: "DK-1", ilerlemePct: 40, durum: "Devam eden" });
    expect(off.tables[1]!.rows).toHaveLength(2);
    expect(off.meta?.[0]).toBe("Durum: Devam eden");
    const on = buildChainExport(rapor(true));
    expect(on.tables[0]!.columns.map((c) => c.header)).toContain("Levent");
    expect(on.tables[0]!.rows[0]).toMatchObject({ levent: "LV-1", kalanM: 0 });
    expect(on.tables[1]!.rows).toHaveLength(3);
  });
});
