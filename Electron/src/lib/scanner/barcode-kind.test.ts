import { describe, it, expect } from "vitest";
import { classifyBarcode, BARCODE_FORMATS } from "./barcode-kind";

describe("classifyBarcode — prefix → tür", () => {
  it("TEKS- → ROLL", () => {
    expect(classifyBarcode("TEKS20260615AB12CD34").kind).toBe("ROLL");
  });
  it("RK → TRAVELER_CARD", () => {
    expect(classifyBarcode("RK26049F2K3P7").kind).toBe("TRAVELER_CARD");
  });
  it("SW- → SWATCH", () => {
    expect(classifyBarcode("SW26045A3Z9B2").kind).toBe("SWATCH");
  });
  it("CV- → SACK", () => {
    expect(classifyBarcode("CV-260615-001").kind).toBe("SACK");
  });
  it("SD/SR/KD/KR- → DISPATCH_DOC", () => {
    expect(classifyBarcode("SD2604000123").kind).toBe("DISPATCH_DOC");
    expect(classifyBarcode("SR2604000089").kind).toBe("DISPATCH_DOC");
    expect(classifyBarcode("KD2604000045").kind).toBe("DISPATCH_DOC");
    expect(classifyBarcode("KR2604000089").kind).toBe("DISPATCH_DOC");
  });
  it("bilinmeyen / serbest kod → UNKNOWN", () => {
    expect(classifyBarcode("RAF-A12").kind).toBe("UNKNOWN");
    expect(classifyBarcode("").kind).toBe("UNKNOWN");
    expect(classifyBarcode("12345").kind).toBe("UNKNOWN");
  });
  it("trim + uppercase normalize eder", () => {
    const c = classifyBarcode("  teks20260615ab12cd34  ");
    expect(c.kind).toBe("ROLL");
    expect(c.code).toBe("TEKS20260615AB12CD34");
  });
});

describe("BARCODE_FORMATS — tam format regex'leri", () => {
  it("geçerli kodlar eşleşir", () => {
    expect(BARCODE_FORMATS.ROLL.test("TEKS20260615AB12CD34")).toBe(true); // eski biçim
    expect(BARCODE_FORMATS.ROLL.test("TEKS260709HA001")).toBe(true); // yeni kısa (ham)
    expect(BARCODE_FORMATS.ROLL.test("TEKS260709FB012")).toBe(true); // yeni kısa (final)
    expect(BARCODE_FORMATS.TRAVELER_CARD.test("RK26049F2K3P7")).toBe(true);
    expect(BARCODE_FORMATS.SWATCH.test("SW26045A3Z9B2")).toBe(true);
    expect(BARCODE_FORMATS.SACK.test("CV-260615-001")).toBe(true);
  });
  it("bozuk kodlar eşleşmez", () => {
    expect(BARCODE_FORMATS.ROLL.test("TEKS-2026-AB")).toBe(false);
    expect(BARCODE_FORMATS.SACK.test("CV-20260615-001")).toBe(false); // 8 haneli tarih yanlış
    expect(BARCODE_FORMATS.TRAVELER_CARD.test("RK26049F2K3P")).toBe(false); // checksum yok
  });
});
