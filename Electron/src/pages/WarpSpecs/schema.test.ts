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

// Sunum provası: API Decimal'i SAYI döndürür; düzenle→Kaydet "expected string, received number" ile sessiz kalıyordu.
describe("warpSpecFormSchema — sayı ve metin girdisi", () => {
  it("API'den gelen sayı değerlerini kabul eder ve metne çevirir", () => {
    const r = warpSpecFormSchema.safeParse({ ...base, endsCount: 9600, reedNo: 14.5, endsPerDent: 4, reedWidthCm: 280, takeUpPct: 8, wastePct: 3 });
    expect(r.success).toBe(true);
    if (r.success) expect([r.data.endsCount, r.data.takeUpPct, r.data.wastePct, r.data.reedNo]).toEqual(["9600", "8", "3", "14.5"]);
  });
  it("metin girdisi aynen geçer; sayı da olsa aralık kuralı işler", () => {
    expect(warpSpecFormSchema.safeParse({ ...base, takeUpPct: "8" }).success).toBe(true);
    expect(warpSpecFormSchema.safeParse({ ...base, takeUpPct: 100 }).success).toBe(false);
  });
});
