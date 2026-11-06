// Çok blok tanıtma kapıları (2026-11-06): işlem + müşteri İE no bölüm alanı, tekrar eden bölümde Metre sütunu şartı,
// "Gelen metre" adet satırına atanırsa uyarı. Mobil teachDraft.test.ts ile ayna.
import { describe, expect, it } from "vitest";
import { assignColumn, assignField, initialTeach, meterOnCountRow, setRepeats, suggestBody, teachProblems, toggleWord } from "../tanit/teachDraft";
import type { ScanWord, ScanWords } from "../tanit/types";

const w = (text: string, [x, y]: [number, number], lineNo: number, width = 60): ScanWord => ({
  text, rect: { x, y, width, height: 20 }, photoRect: { x, y, width, height: 20 }, lineNo, confidence: 0.99,
});
const CB: ScanWords = {
  imageWidth: 1000, imageHeight: 1500, rotation: 0,
  words: [
    w("Sipariş", [50, 100], 1), w("No", [120, 100], 1), w("56967", [200, 100], 1),
    w("İşlem", [50, 140], 2), w("KDK", [120, 140], 2), w("APRE", [180, 140], 2),
    w("T.Adet", [600, 60], 3), w("16", [700, 60], 3, 30), w("3.935,00", [800, 60], 3, 90),
    w("Metre", [300, 200], 4),
  ],
};
const X = CB.words;

describe("çok blok tanıtma kapıları", () => {
  it("⭐ işlem + müşteri İE no seçilebilir; tekrar eden bölümde varsayılan olarak bölüm başına gider", () => {
    let s = setRepeats(initialTeach(CB, "Çeki"), true);
    s = assignField(toggleWord(toggleWord(s, 4), 5), X, "islem");
    expect(s.sectionFields).toContain("islem");
    expect(suggestBody({ ...s, sectionStart: "Sipariş No" }, X, "s1").assignments).toEqual([expect.objectContaining({ field: "islem", section: true })]);
  });

  it("⭐ tekrar eden bölüm Metre sütunu ister (\"Şablonu güncelle\" eski tabloyu taşıyorsa istemez)", () => {
    const s = { ...setRepeats(initialTeach(CB, "Çeki"), true), sectionStart: "Sipariş No" };
    const msg = "Tekrar eden bölümde top tablosu gerekli: tablonun Metre sütun başlığını işaretleyin.";
    const withId = assignField(toggleWord(s, 2), X, "siparisNo");
    expect(teachProblems(withId)).toContain(msg);
    expect(teachProblems(assignColumn(toggleWord(withId, 9), X, "m"))).not.toContain(msg);
    expect(teachProblems({ ...withId, keepOld: ["tables"] })).not.toContain(msg);
  });

  it("⭐ \"Gelen metre\" T.Adet satırındaki tam sayıya (adet) atanırsa uyarı; metre değeri serbest", () => {
    const s = initialTeach(CB, "Çeki");
    const adet = assignField(toggleWord(s, 7), X, "toplamMetre");
    expect(meterOnCountRow(adet, X)).toBe(true);
    expect(teachProblems(adet, X).some((p) => p.includes("T.Adet"))).toBe(true);
    expect(meterOnCountRow(assignField(toggleWord(s, 8), X, "toplamMetre"), X)).toBe(false);
  });
});
