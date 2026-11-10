import { describe, expect, it } from "vitest";
import { DATE_FORMAT_OPTIONS, dateFormatChoice, fmtAfterBindChange, fmtForDateChoice } from "./field-date-format";

describe("etiket tarih alanı biçim seçicisi", () => {
  it("ABD biçimi seçilebilir", () => {
    expect(DATE_FORMAT_OPTIONS.map((o) => o.value)).toEqual(["none", "D.MM.YYYY", "DD.MM.YYYY", "MM/DD/YYYY"]);
    expect(DATE_FORMAT_OPTIONS.find((o) => o.value === "MM/DD/YYYY")?.label).toBe("AA/GG/YYYY (ABD)");
  });
  it("seçim gidiş-dönüş; varsayılan fmt yok", () => {
    expect(fmtForDateChoice("MM/DD/YYYY")).toEqual({ date: "MM/DD/YYYY" });
    expect(fmtForDateChoice("none")).toBeUndefined();
    expect(dateFormatChoice({ date: "MM/DD/YYYY" })).toBe("MM/DD/YYYY");
    expect(dateFormatChoice(undefined)).toBe("none");
  });
  it("alan değişince uyumsuz fmt düşer", () => {
    expect(fmtAfterBindChange({ date: "MM/DD/YYYY" }, "widthCm")).toBeUndefined();
    expect(fmtAfterBindChange({ date: "MM/DD/YYYY" }, "woundAt")).toEqual({ date: "MM/DD/YYYY" });
    expect(fmtAfterBindChange({ to: "in" }, "printedAt")).toBeUndefined();
    expect(fmtAfterBindChange({ to: "in" }, "widthCm")).toEqual({ to: "in" });
  });
});
