import { describe, expect, it } from "vitest";
import { warpSpecFormDefaults, warpSpecFormSchema, WARP_SPEC_MAX_YARNS } from "./schema";

// SY-C1: kart firesi formu backend aralığıyla aynı (0 ≤ x < 100); boş = parametre varsayılanı.
const base = { ...warpSpecFormDefaults, code: "W1", name: "Çözgü", yarns: [{ yarnItemId: "y1", endsCount: "9600" }] };

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
    const r = warpSpecFormSchema.safeParse({ ...base, yarns: [{ yarnItemId: "y1", endsCount: 9600 }], reedNo: 14.5, endsPerDent: 4, reedWidthCm: 280, takeUpPct: 8, wastePct: 3 });
    expect(r.success).toBe(true);
    if (r.success) expect([r.data.yarns[0]?.endsCount, r.data.takeUpPct, r.data.wastePct, r.data.reedNo]).toEqual(["9600", "8", "3", "14.5"]);
  });
  it("metin girdisi aynen geçer; sayı da olsa aralık kuralı işler", () => {
    expect(warpSpecFormSchema.safeParse({ ...base, takeUpPct: "8" }).success).toBe(true);
    expect(warpSpecFormSchema.safeParse({ ...base, takeUpPct: 100 }).success).toBe(false);
  });
});

// Fason devere D3: iplik satırları sunucu sınırlarının aynası (1..20, tel > 0 tam sayı, aynı iplik iki kez yok).
describe("warpSpecFormSchema — yarns", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ yarnItemId: `y${i}`, endsCount: "100" }));
  it("1 ve 20 satırı kabul eder; 0 ve 21 satırı reddeder", () => {
    expect(warpSpecFormSchema.safeParse({ ...base, yarns: rows(1) }).success).toBe(true);
    expect(warpSpecFormSchema.safeParse({ ...base, yarns: rows(WARP_SPEC_MAX_YARNS) }).success).toBe(true);
    expect(warpSpecFormSchema.safeParse({ ...base, yarns: [] }).success).toBe(false);
    expect(warpSpecFormSchema.safeParse({ ...base, yarns: rows(WARP_SPEC_MAX_YARNS + 1) }).success).toBe(false);
  });
  it("aynı ipliği iki satırda reddeder", () => {
    const r = warpSpecFormSchema.safeParse({ ...base, yarns: [{ yarnItemId: "y1", endsCount: "10" }, { yarnItemId: "y1", endsCount: "20" }] });
    expect(r.success).toBe(false);
  });
  it("ipliksiz satırı, sıfır ve kesirli teli reddeder", () => {
    for (const row of [{ yarnItemId: "", endsCount: "10" }, { yarnItemId: "y1", endsCount: "0" }, { yarnItemId: "y1", endsCount: "1.5" }, { yarnItemId: "y1", endsCount: "" }]) {
      expect(warpSpecFormSchema.safeParse({ ...base, yarns: [row] }).success).toBe(false);
    }
  });
  it("dizilim 160 karakteri aşamaz (DB VarChar(160))", () => {
    expect(warpSpecFormSchema.safeParse({ ...base, sequenceNote: "x".repeat(160) }).success).toBe(true);
    expect(warpSpecFormSchema.safeParse({ ...base, sequenceNote: "x".repeat(161) }).success).toBe(false);
  });
});
