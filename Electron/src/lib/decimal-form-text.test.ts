import { describe, expect, it } from "vitest";
import { z } from "zod";
import { acceptNumberAsText, decimalToFormText, decimalToTrFormText } from "./decimal-form-text";
import { makeItemFormSchema } from "@/pages/Items/schema";

describe("decimalToFormText", () => {
  it("null/undefined → boş, sayı → metin, metin → aynen", () => {
    expect([decimalToFormText(null), decimalToFormText(undefined), decimalToFormText(8), decimalToFormText(0), decimalToFormText("3.5")]).toEqual(["", "", "8", "0", "3.5"]);
  });
  it("sonlu olmayan sayı boş döner", () => {
    expect(decimalToFormText(Number.NaN)).toBe("");
  });
});

describe("decimalToTrFormText", () => {
  it("⭐ girdide Türkçe ondalık: 2.5 / \"2.5\" → \"2,5\"; tam sayı ve boş aynen", () => {
    expect([decimalToTrFormText(2.5), decimalToTrFormText("2.5"), decimalToTrFormText(8), decimalToTrFormText(null)]).toEqual(["2,5", "2,5", "8", ""]);
  });
});

describe("acceptNumberAsText", () => {
  it("sayı ve metni kabul eder, başka tipi reddeder", () => {
    const s = acceptNumberAsText(z.string());
    expect(s.parse(12)).toBe("12");
    expect(s.parse("12")).toBe("12");
    expect(s.safeParse(true).success).toBe(false);
  });
  it("kalem kartı denyesi sayı gelse de geçer", () => {
    const schema = makeItemFormSchema(true);
    const probe = schema.shape.linearDensityDen;
    expect(probe.safeParse(150).success).toBe(true);
    expect(probe.safeParse("150").success).toBe(true);
  });
});
