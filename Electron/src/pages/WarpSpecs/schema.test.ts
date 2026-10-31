import { describe, expect, it } from "vitest";
import { warpSpecFormDefaults, warpSpecFormSchema } from "./schema";

// SY-C1: kart firesi formu backend aralığıyla aynı (0 ≤ x < 100); boş = parametre varsayılanı.
const base = { ...warpSpecFormDefaults, code: "W1", name: "Çözgü", yarnItemId: "y1", endsCount: "9600" };

describe("warpSpecFormSchema — wastePct", () => {
  it("boş ve aralık içi değerleri kabul eder", () => {
    for (const v of ["", "0", "3.5", "99.99"]) expect(warpSpecFormSchema.safeParse({ ...base, wastePct: v }).success).toBe(true);
  });
  it("aralık dışını ve sayı olmayanı reddeder", () => {
    for (const v of ["100", "-1", "abc"]) expect(warpSpecFormSchema.safeParse({ ...base, wastePct: v }).success).toBe(false);
  });
});
