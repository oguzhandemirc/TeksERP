// Çözgü talimatı basımı: tel düzeni şeridi (gri ton + harf, inline SVG) + tarak planı satırı; eski backend
// (alan yok) basımı görselsiz eskisi gibi kalır; belge CSS'inde calc()/var() yok.
import { describe, expect, it } from "vitest";
import { buildInstructionHtml } from "./instruction-html";
import { printGray, reedPlanText, warpEndsStripHtml } from "./instruction-visual-html";
import type { WarpingInstruction } from "./yarn-types";

const BASE: WarpingInstruction = {
  orderNo: "FD-1", subcontractor: { code: "D1", name: "Devereci" }, warpSpec: { code: "Ç1", name: "UA6007-Ç" }, extraSpecs: [],
  totalEnds: 3500,
  yarns: [
    { letter: "A", code: "IP1", name: "75 den beyaz", endsCount: 2334, denier: "75" },
    { letter: "B", code: "IP2", name: "150 den krem", endsCount: 1166, denier: "150" },
  ],
  sequenceNote: "2A 1B", reed: { reedNo: "120", reedWidthCm: "300", endsPerDent: 2 },
  beamLines: [{ beamCount: 2, beamLengthM: "750.000" }], beamCount: 2, beamCountOpen: false, targetLengthM: "1500.000",
  expectedReturnAt: null, notes: null,
};
const SEQ = { repeat: [1, 1, 2], repeatCount: 1166, remainder: 2, totalEnds: 3500, matchesYarnEnds: true };

describe("çözgü talimatı görseli", () => {
  it("⭐ açılım varsa şerit SVG'si + harfler + rapor özeti basılır", () => {
    const html = warpEndsStripHtml(SEQ, BASE.yarns);
    expect(html).toContain("<svg");
    expect(html).toContain("Rapor 3 tel × 1166 tekrar + 2 tel = 3500 tel");
    expect(html).toContain("şeritte 3 rapor");
    expect(html).toMatch(/>A<\/text>/);
    expect(html).toMatch(/>B<\/text>/);
    expect(html).toContain("75 den beyaz");
  });

  it("gri tonlar ayırt edilir, koyu zeminde harf beyaz", () => {
    expect(printGray(1).fill).not.toBe(printGray(2).fill);
    expect(printGray(1).ink).toBe("#ffffff");
    expect(printGray(3).ink).toBe("#111111");
  });

  it("açılım yok (eski backend / okunamayan not) → şerit basılmaz", () => {
    expect(warpEndsStripHtml(null, BASE.yarns)).toBe("");
    expect(buildInstructionHtml(BASE)).not.toContain("Tel düzeni");
  });

  it("tarak planı satırı: kenar teli her yana yarısı, diş sayısı", () => {
    expect(reedPlanText(2, 3500, 32)).toBe("Dişe 2 tel · kenar her yanda 16 tel (8 diş) · ≈ 1750 diş");
    expect(reedPlanText(null, 3500, 32)).toBeNull();
  });

  it("⭐ tam belge: şerit + tarak planı + CSS'te calc()/var() yok", () => {
    const html = buildInstructionHtml({ ...BASE, endsSequence: SEQ, selvedgeEnds: 32 });
    expect(html).toContain("Tel düzeni (çözgü raporu");
    expect(html).toContain("<th>Tarak planı</th>");
    expect(html).toContain("Tarak planı (sol kenardan");
    expect(html).not.toMatch(/calc\(|var\(/);
    expect(html).not.toContain("`");
  });

  it("uyuşmayan dizilim uyarısı basılır", () => {
    expect(warpEndsStripHtml({ ...SEQ, matchesYarnEnds: false }, BASE.yarns)).toContain("tutmuyor");
  });
});
