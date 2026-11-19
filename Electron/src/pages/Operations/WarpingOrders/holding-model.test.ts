// BEKÇİ — deverecide tutulan iplik saf yardımcıları (D6b-2): kg sınırı, aktarma gövdesi, aktarma hücresi, iade + fire girişi.
import { describe, expect, it } from "vitest";
import { buildTransferLines, checkKg, checkReturn, holdsYarn, initialTransferDrafts, remainingAsWaste, transferText, yarnTitle } from "./holding-model";
import type { WarpingYarnHolding } from "./holding-types";

const h = (id: string, holdingKg: string, over: Partial<WarpingYarnHolding> = {}): WarpingYarnHolding => ({
  dispatchItemId: id, dispatchId: "d1", dispatchNo: "FS1", dispatchedAt: "2026-11-18T08:00:00Z", ownWarpingOrderId: "wo-1", own: true,
  yarnItemId: "y1", lotId: "L1", lotNo: "L-501", ownerCustomerId: null, outKg: "30.000", returnedKg: "0.000", transferInKg: "0.000", transferOutKg: "0.000", holdingKg, ...over,
});

describe("holding-model", () => {
  it("checkKg: virgüllü girdi, sıfır, aşım, boş", () => {
    expect(checkKg("12,5", "30.000")).toEqual({ ok: true, qty: 12.5 });
    expect(checkKg("30", "30.000")).toEqual({ ok: true, qty: 30 });
    expect(checkKg("30,001", "30.000")).toEqual({ ok: false, error: "Deverecide tutulan miktarı aşıyor." });
    expect(checkKg("0", "30.000")).toEqual({ ok: false, error: "Miktar sıfırdan büyük olmalı." });
    expect(checkKg("  ", "30.000")).toEqual({ ok: false, error: null });
    expect(checkKg("abc", "30.000")).toEqual({ ok: false, error: "Geçerli bir sayı girin." });
  });

  it("aktarma gövdesi: boş satır atlanır, kalem kimliği + lot gider, aşım satırı adlandırır", () => {
    const drafts = initialTransferDrafts([h("a", "30.000"), h("b", "0.000"), h("c", "7.000", { lotId: null, lotNo: null, dispatchNo: "FS2" })]);
    expect(drafts.map((d) => d.holding.dispatchItemId)).toEqual(["a", "c"]);
    expect(buildTransferLines(drafts)).toEqual({ ok: false, error: "Aktarılacak en az bir satıra kg girin." });
    const ok = buildTransferLines([{ ...drafts[0]!, qtyKg: "3,5" }, drafts[1]!]);
    expect(ok).toEqual({ ok: true, totalKg: 3.5, lines: [{ yarnItemId: "y1", qtyKg: 3.5, lotId: "L1", dispatchItemId: "a" }] });
    const over = buildTransferLines([drafts[0]!, { ...drafts[1]!, qtyKg: "8" }]);
    expect(over).toEqual({ ok: false, error: "FS2 · lotsuz: Deverecide tutulan miktarı aşıyor." });
  });

  it("durum ve aktarma hücresi", () => {
    expect(["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"].filter((s) => holdsYarn(s as never))).toEqual(["IN_PROGRESS", "COMPLETED"]);
    expect(transferText("8.000", "0.000")).toBe("−8,000");
    expect(transferText("0.000", "2.500")).toBe("+2,500");
    expect(transferText("0.000", "0.000")).toBe("—");
  });

  it("iade + fire: boş fire = 0, iade + fire tutmayı aşamaz, kalan hesaplanır", () => {
    expect(checkReturn("280", "", "288.750")).toEqual({ ok: true, qty: 280, waste: 0, keep: 8.75 });
    expect(checkReturn("280", "8,75", "288.750")).toEqual({ ok: true, qty: 280, waste: 8.75, keep: 0 });
    expect(checkReturn("280", "9", "288.750")).toEqual({ ok: false, field: "total", error: "İade + fire (289,000 kg) deverecide tutulanı (288,750 kg) aşıyor." });
    expect(checkReturn("280", "-1", "288.750")).toEqual({ ok: false, field: "waste", error: "Fire negatif olamaz." });
    expect(checkReturn("280", "x", "288.750")).toEqual({ ok: false, field: "waste", error: "Fire için geçerli bir sayı girin." });
    expect(checkReturn("", "1", "288.750")).toEqual({ ok: false, field: null, error: null });
    expect(checkReturn("0", "1", "288.750")).toEqual({ ok: false, field: "qty", error: "Miktar sıfırdan büyük olmalı." });
  });

  it("kalanın hepsini fire yaz: fire = tutma − iade; geçersiz iadede yok", () => {
    expect(remainingAsWaste("280", "288.750")).toBe("8,75");
    expect(remainingAsWaste("288,75", "288.750")).toBe("0");
    expect(remainingAsWaste("", "288.750")).toBeNull();
    expect(remainingAsWaste("300", "288.750")).toBeNull();
  });

  it("başlık: iplik adı birincil, kod ikincil", () => {
    const names = new Map([["y1", { code: "IPL-70", name: "70/800 Polyester" }], ["y2", { code: "IPL-X", name: "" }]]);
    expect(yarnTitle(names, "y1")).toEqual({ primary: "70/800 Polyester", secondary: "IPL-70" });
    expect(yarnTitle(names, "y2")).toEqual({ primary: "IPL-X", secondary: null });
    expect(yarnTitle(names, "y3")).toEqual({ primary: "iplik", secondary: null });
  });
});
