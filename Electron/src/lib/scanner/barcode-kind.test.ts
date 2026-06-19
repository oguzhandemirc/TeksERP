import { describe, it, expect } from "vitest";
import { classifyBarcode, BARCODE_FORMATS } from "./barcode-kind";

describe("classifyBarcode — prefix → tür", () => {
  it("TEKS- → ROLL", () => {
    expect(classifyBarcode("TEKS-20260615-AB12CD34").kind).toBe("ROLL");
  });
  it("RK- → TRAVELER_CARD", () => {
    expect(classifyBarcode("RK-2604-9F2K3P-7").kind).toBe("TRAVELER_CARD");
  });
  it("SW- → SWATCH", () => {
    expect(classifyBarcode("SW-2604-5A3Z9B-2").kind).toBe("SWATCH");
  });
  it("CV- → SACK", () => {
    expect(classifyBarcode("CV-260615-001").kind).toBe("SACK");
  });
  it("SD/SR/KD/KR- → DISPATCH_DOC", () => {
    expect(classifyBarcode("SD-2604-000123").kind).toBe("DISPATCH_DOC");
    expect(classifyBarcode("SR-2604-000089").kind).toBe("DISPATCH_DOC");
    expect(classifyBarcode("KD-2604-000045").kind).toBe("DISPATCH_DOC");
    expect(classifyBarcode("KR-2604-000089").kind).toBe("DISPATCH_DOC");
  });
  it("bilinmeyen / serbest kod → UNKNOWN", () => {
    expect(classifyBarcode("RAF-A12").kind).toBe("UNKNOWN");
    expect(classifyBarcode("").kind).toBe("UNKNOWN");
    expect(classifyBarcode("12345").kind).toBe("UNKNOWN");
  });
  it("trim + uppercase normalize eder", () => {
    const c = classifyBarcode("  teks-20260615-ab12cd34  ");
    expect(c.kind).toBe("ROLL");
    expect(c.code).toBe("TEKS-20260615-AB12CD34");
  });
});

describe("BARCODE_FORMATS — tam format regex'leri", () => {
  it("geçerli kodlar eşleşir", () => {
    expect(BARCODE_FORMATS.ROLL.test("TEKS-20260615-AB12CD34")).toBe(true);
    expect(BARCODE_FORMATS.TRAVELER_CARD.test("RK-2604-9F2K3P-7")).toBe(true);
    expect(BARCODE_FORMATS.SWATCH.test("SW-2604-5A3Z9B-2")).toBe(true);
    expect(BARCODE_FORMATS.SACK.test("CV-260615-001")).toBe(true);
  });
  it("bozuk kodlar eşleşmez", () => {
    expect(BARCODE_FORMATS.ROLL.test("TEKS-2026-AB")).toBe(false);
    expect(BARCODE_FORMATS.SACK.test("CV-20260615-001")).toBe(false); // 8 haneli tarih yanlış
    expect(BARCODE_FORMATS.TRAVELER_CARD.test("RK-2604-9F2K3P")).toBe(false); // checksum yok
  });
});
