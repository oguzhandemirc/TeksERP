import { describe, it, expect } from "vitest";
import { computeChecksum, verifyBarcode, verifyPrefixedBarcode } from "./barcode";

// Ground-truth değerler backend `Teks-Erp/src/utils/barcode.ts` çalıştırılarak
// üretildi (tsx). Bu test renderer kopyasının backend ile PARİTESİNİ kilitler —
// algoritma birinde değişip diğerinde değişmezse burada kırılır.
const GROUND_TRUTH: Array<[string, string]> = [
  ["RK26049F2K3P", "6"],
  ["SW26045A3Z9B", "1"],
  ["RK2604000001", "7"],
  ["SW2604ABCDEF", "2"],
];

describe("computeChecksum — backend paritesi", () => {
  for (const [input, expected] of GROUND_TRUTH) {
    it(`${input} → ${expected}`, () => {
      expect(computeChecksum(input)).toBe(expected);
    });
  }
  it("tire ve bilinmeyen karakterleri atlar (RK26049F2K3P == RK-2604-9F2K3P)", () => {
    expect(computeChecksum("RK-2604-9F2K3P")).toBe(computeChecksum("RK26049F2K3P"));
  });
});

describe("verifyBarcode (RK) + verifyPrefixedBarcode", () => {
  it("doğru checksum'lı kart kabul edilir", () => {
    expect(verifyBarcode("RK-2604-9F2K3P-6")).toBe(true);
  });
  it("yanlış checksum reddedilir", () => {
    expect(verifyBarcode("RK-2604-9F2K3P-7")).toBe(false);
  });
  it("bozuk format reddedilir", () => {
    expect(verifyBarcode("RK-2604-9F2K3P")).toBe(false);
    expect(verifyBarcode("TEKS-20260615-AB12CD34")).toBe(false);
  });
  it("SW prefix checksum doğrular", () => {
    expect(verifyPrefixedBarcode("SW", "SW-2604-5A3Z9B-1")).toBe(true);
    expect(verifyPrefixedBarcode("SW", "SW-2604-5A3Z9B-9")).toBe(false);
  });
});
