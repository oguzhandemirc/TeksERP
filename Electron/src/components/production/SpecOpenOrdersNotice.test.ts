import { describe, it, expect } from "vitest";
import { specOpenOrdersDetail, specOpenOrdersTitle } from "./SpecOpenOrdersNotice";

describe("kartı kullanan açık iş emri uyarısı (SY-d)", () => {
  it("yalnız dokuma iş emri", () => {
    const d = { weavingOrders: 2, warpingOrders: 0, total: 2, numbers: ["DIE-1", "DIE-2"] };
    expect(specOpenOrdersTitle(d)).toBe("Bu kartı 2 açık dokuma iş emri kullanıyor");
    expect(specOpenOrdersDetail(d)).toMatch(/^DIE-1, DIE-2\. /);
  });

  it("dokuma + çözgü emri, listede olmayanlar 've N diğer'", () => {
    const d = { weavingOrders: 11, warpingOrders: 1, total: 12, numbers: Array.from({ length: 10 }, (_, i) => `D${i}`) };
    expect(specOpenOrdersTitle(d)).toBe("Bu kartı 11 açık dokuma iş emri ve 1 açık çözgü emri kullanıyor");
    expect(specOpenOrdersDetail(d)).toContain("D9 ve 2 diğer.");
  });
});
