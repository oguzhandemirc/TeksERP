import { describe, it, expect } from "vitest";
import { classifyBarcode, BARCODE_FORMATS } from "./barcode-kind";

describe("classifyBarcode — prefix → tür", () => {
  it("T{GGAAYY}{H/F}NNNN → ROLL", () => {
    expect(classifyBarcode("T120726H0001").kind).toBe("ROLL");
    expect(classifyBarcode("T120726F0012").kind).toBe("ROLL");
  });
  it("RK → TRAVELER_CARD", () => {
    expect(classifyBarcode("RK1207260001").kind).toBe("TRAVELER_CARD");
  });
  it("KRT → SWATCH", () => {
    expect(classifyBarcode("KRT1207260042").kind).toBe("SWATCH");
  });
  it("CV → SACK", () => {
    expect(classifyBarcode("CV1207260001").kind).toBe("SACK");
  });
  it("SVK → SHIPMENT (iade girişi 'sevkiyatın tamamı' kapsamı)", () => {
    expect(classifyBarcode("svk2109260003").kind).toBe("SHIPMENT");
    expect(BARCODE_FORMATS.SHIPMENT.test("SVK2109260003")).toBe(true);
  });

  it("FS/FK/KS/KK → DISPATCH_DOC", () => {
    expect(classifyBarcode("FS1207260123").kind).toBe("DISPATCH_DOC");
    expect(classifyBarcode("FK1207260089").kind).toBe("DISPATCH_DOC");
    expect(classifyBarcode("KS1207260045").kind).toBe("DISPATCH_DOC");
    expect(classifyBarcode("KK1207260089").kind).toBe("DISPATCH_DOC");
  });
  it("KRT ≠ KK/KS (SWATCH, DISPATCH_DOC değil)", () => {
    expect(classifyBarcode("KRT1207260001").kind).toBe("SWATCH");
  });
  it("bilinmeyen / serbest kod → UNKNOWN", () => {
    expect(classifyBarcode("RAF-A12").kind).toBe("UNKNOWN");
    expect(classifyBarcode("").kind).toBe("UNKNOWN");
    expect(classifyBarcode("12345").kind).toBe("UNKNOWN");
    expect(classifyBarcode("SIP1207260001").kind).toBe("UNKNOWN"); // sipariş no scan hedefi değil
  });
  it("trim + uppercase normalize eder", () => {
    const c = classifyBarcode("  t120726h0001  ");
    expect(c.kind).toBe("ROLL");
    expect(c.code).toBe("T120726H0001");
  });
});

describe("BARCODE_FORMATS — tam format regex'leri (checksum yok)", () => {
  it("geçerli kodlar eşleşir", () => {
    expect(BARCODE_FORMATS.ROLL.test("T120726H0001")).toBe(true);
    expect(BARCODE_FORMATS.ROLL.test("T120726F0012")).toBe(true);
    expect(BARCODE_FORMATS.TRAVELER_CARD.test("RK1207260001")).toBe(true);
    expect(BARCODE_FORMATS.SWATCH.test("KRT1207260042")).toBe(true);
    expect(BARCODE_FORMATS.SACK.test("CV1207260001")).toBe(true);
  });
  it("bozuk kodlar eşleşmez", () => {
    expect(BARCODE_FORMATS.ROLL.test("TEKS260709HA001")).toBe(false); // eski biçim
    expect(BARCODE_FORMATS.SACK.test("CV-260615-001")).toBe(false); // tireli eski biçim
    expect(BARCODE_FORMATS.TRAVELER_CARD.test("RK120726001")).toBe(false); // 3 hane sıra eksik
  });
});
