import { formatRelativeWait } from "./relativeTime";

describe("formatRelativeWait", () => {
  const now = Date.now();
  it("boş/geçersiz → —", () => {
    expect(formatRelativeWait(null)).toBe("—");
    expect(formatRelativeWait("abc")).toBe("—");
  });
  it("1 dk altı → şimdi", () => {
    expect(formatRelativeWait(new Date(now - 30_000))).toBe("şimdi");
  });
  it("dakika", () => {
    expect(formatRelativeWait(new Date(now - 5 * 60_000))).toBe("5 dk");
  });
  it("saat + dakika", () => {
    expect(formatRelativeWait(new Date(now - (2 * 60 + 15) * 60_000))).toBe("2s 15dk");
  });
  it("tam saat (dakika kalanı yok)", () => {
    expect(formatRelativeWait(new Date(now - 3 * 60 * 60_000))).toBe("3s");
  });
  it("gün", () => {
    expect(formatRelativeWait(new Date(now - 2 * 24 * 60 * 60_000))).toBe("2 gün");
  });
});
