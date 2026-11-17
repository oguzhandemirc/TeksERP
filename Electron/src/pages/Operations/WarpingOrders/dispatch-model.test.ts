// =============================================================================
// BEKÇİ — iplik sevki taslak modeli (D6b): öneriden satır · lot kuralı satır içi · gövde · talimat HTML'i · fire metni
// =============================================================================
//   ① Öneri satıra dolar; önerisi sıfır olan iplik boş miktarla gelir; ikinci lot satırı aynı ipliğin altına eklenir.
//   ② Lot kuralı: WARN → bilgi notu; SINGLE_LOT → engelleyen not; FREE → not yok; taslaktaki diğer lot satırı da sayılır.
//   ③ Gövde: depo/lot zorunlu engelleri düğmeyi kapatır; boş meta null gider; miktarsız satır gövdeye girmez.
//   ④ Talimat HTML'i iç kolon taşımaz (kg/fire/fiyat yok), HTML kaçışlı; irsaliye seçilirse kalemler + toplam basılır.
//   ⑤ Fire metni yüzdeyi kaynağıyla verir; bugünkü değer farklıysa "açılıştaki değer", önizleme yoksa kaynaksız.
// =============================================================================
import { describe, expect, it } from "vitest";
import { addLotLine, buildDispatchBody, initialDispatchLines, lineNotes, overPlanNote } from "./dispatch-model";
import { buildInstructionHtml } from "./instruction-html";
import { percentWasteText } from "./waste-model";
import type { WarpingDispatchPreview, WarpingDispatchRow, WarpingInstruction } from "./yarn-types";
import type { WarpingOrderPreview } from "./types";

function yarn(id: string, suggested: string, lots: WarpingDispatchPreview["yarns"][number]["lots"] = []): WarpingDispatchPreview["yarns"][number] {
  return {
    yarnItemId: id, code: `C-${id}`, name: `İplik ${id}`, letter: id.toUpperCase(), endsCount: 1000, planNetKg: "10.000", planGrossKg: "10.500",
    dispatchedKg: "0.000", returnedKg: "0.000", transferInKg: "0.000", transferOutKg: "0.000", atSubcontractorKg: "0.000", carryOverKg: "0.000",
    suggestedKg: suggested, depoKg: "100.000", shortageKg: "0.000", lots,
  };
}
function preview(over: Partial<WarpingDispatchPreview> = {}): WarpingDispatchPreview {
  return {
    order: { id: "o1", orderNo: "FDV1", status: "OPEN", subcontractorId: "s1" }, lotPolicy: "WARN", lotRequired: false, ownerCustomerId: null,
    stock: { known: true }, yarns: [yarn("a", "10.500", [{ lotId: "L1", lotNo: "L-1", openKg: "5.000" }]), yarn("b", "0.000")], warnings: [], ...over,
  };
}
const wh = { id: "w1", label: "Merkez", balanceKg: 50 };
const meta = { plateNumber: "", driverName: " ", notes: "" };

describe("dispatch-model", () => {
  it("① öneriden satırlar + ikinci lot satırı", () => {
    const lines = initialDispatchLines(preview());
    expect(lines.map((l) => l.qtyKg)).toEqual(["10,5", ""]);
    const next = addLotLine(lines, "a");
    expect(next.map((l) => l.yarnItemId)).toEqual(["a", "a", "b"]);
    expect(new Set(next.map((l) => l.key)).size).toBe(3);
  });

  it("② lot kuralı WARN / SINGLE_LOT / FREE ve taslak içi karışım", () => {
    const p = preview();
    const line = { ...initialDispatchLines(p)[0]!, warehouse: wh, lot: { id: "L2", label: "L-2", balanceKg: 20 } };
    const warn = lineNotes(line, [line], p.yarns[0]!, p);
    expect(warn).toEqual([{ text: "Karışık lot: bu iplikte L-1 de var.", blocking: false }]);
    const single = lineNotes(line, [line], p.yarns[0]!, { ...p, lotPolicy: "SINGLE_LOT" });
    expect(single[0]?.blocking).toBe(true);
    expect(lineNotes(line, [line], p.yarns[0]!, { ...p, lotPolicy: "FREE" })).toEqual([]);
    const same = { ...line, lot: { id: "L1", label: "L-1", balanceKg: 20 } };
    expect(lineNotes(same, [same], p.yarns[0]!, p)).toEqual([]);
    // Deverecide lot yok; taslakta iki farklı lot → karışık.
    const fresh = preview({ yarns: [yarn("a", "10.000")] });
    const l1 = { ...initialDispatchLines(fresh)[0]!, warehouse: wh, lot: { id: "X", label: "X", balanceKg: null } };
    const l2 = { ...l1, key: "a#1", qtyKg: "2", lot: { id: "Y", label: "Y", balanceKg: null } };
    expect(lineNotes(l1, [l1, l2], fresh.yarns[0]!, fresh)[0]?.text).toContain("Y");
    expect(overPlanNote(fresh.yarns[0]!, [l1, l2])).toContain("2,000");
  });

  it("③ gövde: engeller, null meta, miktarsız satır dışarıda", () => {
    const p = preview({ lotRequired: true });
    const lines = initialDispatchLines(p);
    expect(buildDispatchBody(lines, p, meta)).toEqual({ ok: false, error: "Kırmızı satır notlarını giderin." });
    const ready = [{ ...lines[0]!, warehouse: wh, lot: { id: "L1", label: "L-1", balanceKg: 20 } }, lines[1]!];
    const r = buildDispatchBody(ready, p, meta);
    expect(r).toEqual({ ok: true, body: { lines: [{ yarnItemId: "a", warehouseId: "w1", lotId: "L1", qtyKg: 10.5 }], plateNumber: null, driverName: null, notes: null } });
    expect(buildDispatchBody([{ ...lines[1]! }], p, meta).ok).toBe(false);
  });

  it("④ talimat HTML'i: iç kolon yok, kaçışlı, irsaliye isteğe bağlı", () => {
    const i: WarpingInstruction = {
      orderNo: "FDV1", subcontractor: { code: "S1", name: "Devereci <A>" }, warpSpec: { code: "CZ", name: "Kart" }, extraSpecs: [], totalEnds: 5400,
      yarns: [{ letter: "A", code: "IPL", name: "5X", endsCount: 3000, denier: "150" }], sequenceNote: "A B A", reed: { reedNo: null, reedWidthCm: "330", endsPerDent: null },
      beamLines: [{ beamCount: 2, beamLengthM: "500.000" }], beamCount: 2, targetLengthM: "1000.000", expectedReturnAt: null, notes: null,
    };
    const only = buildInstructionHtml(i);
    expect(only).toContain("ÇÖZGÜ TALİMATI");
    expect(only).toContain("Devereci &lt;A&gt;");
    expect(only).toContain("2 × 500 m");
    expect(only).not.toContain("İPLİK SEVK İRSALİYESİ");
    expect(only).not.toMatch(/\bkg\b|fire|fiyat/i);
    const d = { dispatchId: "d1", dispatchNo: "FS1", dispatchedAt: "2026-11-18T08:00:00Z", totalOutKg: "30.000", items: [{ yarnItemCode: "IPL", yarnItemName: "5X", lotNo: "L-1", warehouseName: "Merkez", outKg: "30.000" }] } as unknown as WarpingDispatchRow;
    const both = buildInstructionHtml(i, d);
    expect(both.indexOf("İPLİK SEVK İRSALİYESİ")).toBeLessThan(both.indexOf("ÇÖZGÜ TALİMATI"));
    expect(both).toContain("30,000");
  });

  it("⑤ fire metni: yüzde + kaynak", () => {
    const o = { yarns: [{ yarnItemId: "a", wastePct: "2.50", letter: "A" }, { yarnItemId: "b", wastePct: "3.00", letter: "B" }] } as never;
    const pv = { yarns: [{ yarnItemId: "a", wastePct: "2.50" }, { yarnItemId: "b", wastePct: "4.00" }], wasteSources: [{ kind: "KART_PCT", value: 2.5 }] } as unknown as WarpingOrderPreview;
    expect(percentWasteText(o, pv)).toBe("A %2,5 (çözgü kartı) · B %3 (açılıştaki değer)");
    const pv2 = { yarns: [{ yarnItemId: "a", wastePct: "2.50" }, { yarnItemId: "b", wastePct: "3.00" }], wasteSources: [{ kind: "IPLIK_PCT", yarnItemId: "b", value: 3 }, { kind: "KART_PCT", value: 2.5 }] } as unknown as WarpingOrderPreview;
    expect(percentWasteText(o, pv2)).toBe("A %2,5 (çözgü kartı) · B %3 (iplik kartı)");
    expect(percentWasteText(o, undefined)).toBe("A %2,5 · B %3");
    expect(percentWasteText({ yarns: [{ yarnItemId: "a", wastePct: "0.00", letter: "A" }] } as never, pv)).toBe("yok");
  });
});
