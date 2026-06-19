import { describe, it, expect } from "vitest";
import { createScanFramer, sanitizeHidChunk } from "@shared/scan-framer";

describe("createScanFramer", () => {
  it("lf terminator ile tam kodu çıkarır", () => {
    const f = createScanFramer("lf");
    expect(f.push("TEKS-20260615-AB12CD34\n")).toEqual(["TEKS-20260615-AB12CD34"]);
  });

  it("parçalı gelen kodu biriktirip terminator'da çıkarır", () => {
    const f = createScanFramer("lf");
    expect(f.push("TEKS-")).toEqual([]);
    expect(f.push("2026")).toEqual([]);
    expect(f.push("0615-AB12CD34\n")).toEqual(["TEKS-20260615-AB12CD34"]);
  });

  it("crlf terminator ile \\r\\n biten kodu temizler", () => {
    const f = createScanFramer("crlf");
    expect(f.push("CV-260615-001\r\n")).toEqual(["CV-260615-001"]);
  });

  it("cr terminator", () => {
    const f = createScanFramer("cr");
    expect(f.push("ABC123\r")).toEqual(["ABC123"]);
  });

  it("tek chunk'ta birden çok kod", () => {
    const f = createScanFramer("lf");
    expect(f.push("A123\nB456\nC789\n")).toEqual(["A123", "B456", "C789"]);
  });

  it("none → her push'u (satır sonlarıyla bölerek) kod sayar", () => {
    const f = createScanFramer("none");
    expect(f.push("CV-260615-001")).toEqual(["CV-260615-001"]);
  });

  it("flush kalan tamamlanmamış tamponu döndürür", () => {
    const f = createScanFramer("lf");
    f.push("TEKS-1");
    expect(f.flush()).toEqual(["TEKS-1"]);
    expect(f.flush()).toEqual([]);
  });

  it("reset tamponu temizler", () => {
    const f = createScanFramer("lf");
    f.push("PARTIAL");
    f.reset();
    expect(f.flush()).toEqual([]);
  });
});

describe("sanitizeHidChunk", () => {
  it("yazdırılabilir ASCII'yi tutar, kontrol/sıfır byte'ları atar (CR/LF hariç)", () => {
    // 0x00 (report id), 'A'(65) 'B'(66), 0x01 (kontrol), '\n'(10)
    expect(sanitizeHidChunk([0, 65, 66, 1, 10])).toBe("AB\n");
  });
  it("tamamı kontrol byte → boş", () => {
    expect(sanitizeHidChunk([0, 1, 2, 3])).toBe("");
  });
});
