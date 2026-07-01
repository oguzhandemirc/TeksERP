import { generateClientBarcode, generateClientUuid } from "./barcode";

describe("generateClientBarcode", () => {
  it("TEKSYYYYMMDDXXXXXXXX (8 hex, ayraçsız) formatı", () => {
    expect(generateClientBarcode()).toMatch(/^TEKS\d{8}[0-9A-F]{8}$/);
  });
  it("ardışık çağrılar farklı (collision yok)", () => {
    const s = new Set(Array.from({ length: 50 }, () => generateClientBarcode()));
    expect(s.size).toBe(50);
  });
});

describe("generateClientUuid", () => {
  it("geçerli UUID v4 üretir (backend Zod .uuid())", () => {
    expect(generateClientUuid()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
