import { describe, expect, it } from "vitest";
import { buildInitialDispatch, emptyInitialLine, fillPlanKg, initialTotalKg } from "./initial-dispatch-model";

const yarns = [{ yarnItemId: "x", code: "PES-X", grossKg: "50.125" }, { yarnItemId: "y", code: "PES-Y", grossKg: "40.000" }];
const wh = { id: "w1", label: "Merkez", balanceKg: 100 };

describe("buildInitialDispatch", () => {
  it("hepsi boş → ok + undefined (gövdeye alan girmez)", () => {
    expect(buildInitialDispatch({}, yarns)).toEqual({ ok: true, value: undefined });
    expect(buildInitialDispatch({ x: emptyInitialLine() }, yarns)).toEqual({ ok: true, value: undefined });
  });
  it("dolu satır: kg + depo + lot + yalnız girilen adetler", () => {
    const r = buildInitialDispatch({ x: { ...emptyInitialLine(), warehouse: wh, lot: { id: "l1", label: "L1", balanceKg: null }, qtyKg: "12,5", bobbinCount: "40" } }, yarns);
    expect(r).toEqual({ ok: true, value: { lines: [{ yarnItemId: "x", warehouseId: "w1", lotId: "l1", qtyKg: 12.5, bobbinCount: 40 }] } });
  });
  it("dokunulmuş ama eksik satır: kg yok / depo yok / bozuk adet → hata", () => {
    expect(buildInitialDispatch({ x: { ...emptyInitialLine(), warehouse: wh } }, yarns)).toMatchObject({ ok: false, error: expect.stringContaining("sevk kg girin") });
    expect(buildInitialDispatch({ y: { ...emptyInitialLine(), qtyKg: "5" } }, yarns)).toMatchObject({ ok: false, error: expect.stringContaining("PES-Y: depo seçin") });
    expect(buildInitialDispatch({ x: { ...emptyInitialLine(), warehouse: wh, qtyKg: "5", bobbinCount: "1,5" } }, yarns)).toMatchObject({ ok: false });
  });
  it("planda olmayan iplik satırı yok sayılır", () => {
    expect(buildInitialDispatch({ z: { ...emptyInitialLine(), warehouse: wh, qtyKg: "5" } }, yarns)).toEqual({ ok: true, value: undefined });
  });
});

describe("fillPlanKg / initialTotalKg", () => {
  it("boş kg hücresine plan brütü yazar, doluya dokunmaz; toplam virgüllü girdiyi okur", () => {
    const d = fillPlanKg({ y: { ...emptyInitialLine(), qtyKg: "10" } }, yarns);
    expect(d.x?.qtyKg).toBe("50,125");
    expect(d.y?.qtyKg).toBe("10");
    expect(initialTotalKg(d, ["x", "y"])).toBeCloseTo(60.125);
  });
});
