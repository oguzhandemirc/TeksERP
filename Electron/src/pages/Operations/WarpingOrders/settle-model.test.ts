// BEKÇİ — kapanış gövde kurucusu (D7b): varsayılandan taslak, hızlı kova, aşım, iade sebebi, depo yalnız iadede.
// NEGATİF SONDA: bkz. arşiv notu "Fason devere D7b".
import { describe, expect, it } from "vitest";
import { buildSettleBody, draftsFromPlan, fillLine, keepOf, pctText } from "./settle-model";
import type { WarpingSettlePlanLine } from "./settle-types";

const line = (over: Partial<WarpingSettlePlanLine> = {}): WarpingSettlePlanLine => ({
  dispatchItemId: "i1", dispatchId: "d1", dispatchNo: "FS1", yarnItemId: "y1", lotId: "L1", lotNo: "L-501", own: true,
  holdingKg: "5.000", returnKg: "0.000", wasteKg: "1.282", keepKg: "3.718", ...over,
});

describe("settle-model", () => {
  it("sunucu varsayılanından taslak; sıfır boş, virgüllü; kalır girdi yardımı", () => {
    const [d] = draftsFromPlan([line()]);
    expect(d).toMatchObject({ returnKg: "", wasteKg: "1,282", warehouse: null });
    expect(keepOf(d!)).toBe(3.718);
  });

  it("hızlı kova bütün tutmayı tek kovaya koyar", () => {
    const [d] = draftsFromPlan([line()]);
    expect(fillLine(d!, "return")).toMatchObject({ returnKg: "5", wasteKg: "" });
    expect(fillLine(d!, "waste")).toMatchObject({ returnKg: "", wasteKg: "5" });
    expect(fillLine(d!, "keep")).toMatchObject({ returnKg: "", wasteKg: "" });
  });

  it("gövde: her kalem gider; iadede sebep zorunlu; depo yalnız iade satırında; gerekçe isteğe bağlı", () => {
    const drafts = [
      { ...draftsFromPlan([line()])[0]!, returnKg: "2", warehouse: { id: "w2", label: "Yan Depo", balanceKg: null } },
      { ...draftsFromPlan([line({ dispatchItemId: "i2", wasteKg: "0.000" })])[0]!, warehouse: { id: "w9", label: "X", balanceKg: null } },
    ];
    expect(buildSettleBody(drafts, { reason: "", returnReasonCode: "" })).toEqual({ ok: false, error: "İade satırı var — iade sebebini seçin." });
    expect(buildSettleBody(drafts, { reason: " ", returnReasonCode: "KALAN" })).toEqual({
      ok: true, hasReturn: true,
      body: { reason: null, returnReasonCode: "KALAN", lines: [{ dispatchItemId: "i1", returnKg: 2, wasteKg: 1.282, warehouseId: "w2" }, { dispatchItemId: "i2", returnKg: 0, wasteKg: 0 }] },
    });
  });

  it("aşım ve geçersiz sayı satırı adlandırır; iadesizse sebep kodu null", () => {
    const [d] = draftsFromPlan([line()]);
    expect(buildSettleBody([{ ...d!, returnKg: "4" }], { reason: "", returnReasonCode: "K" })).toMatchObject({ ok: false, error: expect.stringContaining("FS1 · L-501: iade + fire") });
    expect(buildSettleBody([{ ...d!, wasteKg: "abc" }], { reason: "", returnReasonCode: "" })).toMatchObject({ ok: false, error: expect.stringContaining("geçerli bir sayı") });
    expect(buildSettleBody([d!], { reason: "fazla fire", returnReasonCode: "K" })).toMatchObject({ ok: true, body: { reason: "fazla fire", returnReasonCode: null } });
    expect(pctText("4.88")).toBe("%4,88");
    expect(pctText(null)).toBe("—");
  });
});
