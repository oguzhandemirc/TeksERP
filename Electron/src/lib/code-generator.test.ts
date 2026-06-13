import { describe, it, expect } from "vitest";
import { generateCode, CODE_PREFIXES } from "./code-generator";

describe("generateCode", () => {
  it("PREFIX-YYMMDD-XXXX formatı üretir", () => {
    const code = generateCode("MUS");
    expect(code).toMatch(/^MUS-\d{6}-\d{4}$/);
  });
  it("ardışık çağrılar (genelde) farklı kod üretir", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateCode("ROT")));
    // 4-haneli random → 20 denemede çakışma olasılığı çok düşük; en az birkaç farklı.
    expect(codes.size).toBeGreaterThan(1);
  });
  it("CODE_PREFIXES bilinen anahtarları taşır", () => {
    expect(CODE_PREFIXES.COLOR).toBe("RNK");
    expect(CODE_PREFIXES.MACHINE).toBe("MAK");
    expect(CODE_PREFIXES.CUSTOMER).toBe("MUS");
  });
});
