// BEKÇİ — deverecide tutulan iplik saf yardımcıları (D6b-2): kg sınırı, aktarma gövdesi, aktarma hücresi.
import { describe, expect, it } from "vitest";
import { buildTransferLines, checkKg, holdsYarn, initialTransferDrafts, transferText } from "./holding-model";
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
});
