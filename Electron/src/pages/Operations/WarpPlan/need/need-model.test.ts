import { describe, expect, it } from "vitest";
import { fabricNeedQuery, linkedNeedQuery, needOrderHref, needQueryString, needStatusText, needTabHref } from "./need-model";
import type { WarpNeedRow } from "./need-types";
import { SEED_PARAM_KEYS, seedFromParams } from "../../WarpingOrders/seed-params";

function needRow(over: Partial<WarpNeedRow> = {}): WarpNeedRow {
  return {
    demandKey: "FABRIC", itemId: "i1", itemName: "Tül A", role: "GROUND", beamMode: "GROUND",
    warpSpecId: "ws1", warpSpecCode: "CZ-1", warpSpecName: "Zemin 40 den", takeUpPct: 10, ownBeam: true,
    fabricM: 1000, requiredM: 1111.111,
    supply: { stockM: 200, plannedBeamM: 0, openWarpingM: 300, totalM: 500 },
    committedM: 0, freeM: 500, shortfallM: 611.111,
    suggestion: { beamCount: 2, beamLengthM: 400, totalM: 800 },
    subcontractor: { id: "s1", name: "Devereci A" },
    openWarpingOrders: [],
    ...over,
  };
}

describe("çözgü ihtiyacı — URL ↔ sorgu", () => {
  it("dokuma işi ve sipariş bağı Çözgü Hesabı'nın ihtiyaç sekmesine gider", () => {
    expect(needTabHref({ weavingOrderId: "w1" })).toBe("/operations/cozgu-hesabi?tab=NEED&source=WEAVING_ORDER&weavingOrderId=w1");
    expect(needTabHref({ orderId: "o1" })).toBe("/operations/cozgu-hesabi?tab=NEED&source=ORDER&orderId=o1");
  });
  it("URL kaynağı eksik ya da tanınmazsa null (kumaş girişi)", () => {
    expect(linkedNeedQuery(new URLSearchParams("tab=NEED&source=ORDER&orderId=o1"))).toEqual({ source: "ORDER", orderId: "o1" });
    expect(linkedNeedQuery(new URLSearchParams("tab=NEED&source=WEAVING_ORDER&weavingOrderId=w1"))).toEqual({ source: "WEAVING_ORDER", weavingOrderId: "w1" });
    expect(linkedNeedQuery(new URLSearchParams("tab=NEED&source=ORDER"))).toBeNull();
    expect(linkedNeedQuery(new URLSearchParams("tab=NEED&source=FABRIC&itemId=x"))).toBeNull();
  });
  it("kumaş sorgusu yalnız kumaş + pozitif metreyle; virgül ondalık kabul", () => {
    expect(fabricNeedQuery(null, "1000")).toBeNull();
    expect(fabricNeedQuery("i1", "")).toBeNull();
    expect(fabricNeedQuery("i1", "0")).toBeNull();
    expect(fabricNeedQuery("i1", "-5")).toBeNull();
    expect(fabricNeedQuery("i1", "12a")).toBeNull();
    expect(fabricNeedQuery("i1", " 1250,5 ")).toEqual({ source: "FABRIC", itemId: "i1", fabricM: 1250.5 });
    expect(needQueryString({ source: "FABRIC", itemId: "i1", fabricM: 1000 })).toBe("source=FABRIC&itemId=i1&fabricM=1000");
  });
});

describe("çözgü ihtiyacı — satır ve sipariş aç bağı", () => {
  it("öneri adet × boy, devereci ve sipariş bağıyla formu dolu açar", () => {
    expect(needOrderHref(needRow(), { id: "o1", label: "S-77" })).toBe(
      "/operations/fason-devere?new=1&warpSpecId=ws1&beamCount=2&beamLengthM=400&subcontractorId=s1&salesOrderId=o1&salesOrderLabel=S-77",
    );
    expect(needOrderHref(needRow({ subcontractor: null }), null)).toBe("/operations/fason-devere?new=1&warpSpecId=ws1&beamCount=2&beamLengthM=400");
    expect(needOrderHref(needRow({ suggestion: null, shortfallM: 0 }), null)).toBeNull();
  });
  it("sipariş formu bağın her alanını okur ve kapanınca hepsini siler", () => {
    const href = needOrderHref(needRow(), { id: "o1", label: "S-77 — Müşteri" })!;
    const sp = new URLSearchParams(href.split("?")[1]);
    expect(seedFromParams(sp)).toEqual({
      warpSpecId: "ws1", subcontractorId: "s1",
      beamLines: [{ beamCount: "2", beamLengthM: "400" }],
      salesOrders: [{ id: "o1", label: "S-77 — Müşteri" }],
    });
    for (const k of sp.keys()) expect(SEED_PARAM_KEYS as readonly string[]).toContain(k);
  });
  it("durum cümlesi beam moduna göre", () => {
    expect(needStatusText(needRow())).toBe("2 × 400 m levent devere ver");
    expect(needStatusText(needRow({ suggestion: null, shortfallM: 0 }))).toBe("Eldeki ve yoldaki çözgü yeter");
    expect(needStatusText(needRow({ beamMode: "SHARED_BEAM", ownBeam: false, suggestion: null }))).toMatch(/Zemin leventinde/);
    expect(needStatusText(needRow({ beamMode: "CREEL", ownBeam: false, suggestion: null }))).toMatch(/Cağlık/);
    expect(needStatusText(needRow({ requiredM: null, suggestion: null }))).toMatch(/hesaplanamadı/);
  });
});
