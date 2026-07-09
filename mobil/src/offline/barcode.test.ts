import { generateClientUuid } from "./barcode";

describe("generateClientUuid", () => {
  it("geçerli UUID v4 üretir (backend Zod .uuid())", () => {
    expect(generateClientUuid()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
  it("ardışık çağrılar farklı (collision yok)", () => {
    const s = new Set(Array.from({ length: 50 }, () => generateClientUuid()));
    expect(s.size).toBe(50);
  });
});
