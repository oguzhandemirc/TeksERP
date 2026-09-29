import { formatAgo, formatDate, formatDateTime, formatMoney, formatNumber, syncIsLate } from "../src/lib/format";
import { formatValue, humanize, recordTitle, scalarEntries } from "../src/lib/present";

describe("TR biçimleri", () => {
  it("sayılar nokta binlik, virgül ondalık", () => {
    expect(formatNumber(1234567.891)).toBe("1.234.567,89");
    expect(formatNumber("1250.5")).toBe("1.250,5");
    expect(formatNumber(12, 0)).toBe("12");
    expect(formatNumber(-3.5)).toBe("-3,5");
    expect(formatNumber("abc")).toBe("—");
    expect(formatMoney("10.5", "USD")).toBe("10,5 $");
  });
  it("tarih fabrika gününde (UTC+3)", () => {
    expect(formatDate("2026-09-29T22:30:00Z")).toBe("30.09.2026");
    expect(formatDateTime("2026-09-29T10:05:00Z")).toBe("29.09.2026 13:05");
    expect(formatDate("2026-09-29")).toBe("29.09.2026");
    expect(formatDate(null)).toBe("—");
  });
  it("göreli süre ve eşitleme gecikmesi", () => {
    const now = Date.parse("2026-09-29T10:00:00Z");
    expect(formatAgo("2026-09-29T09:59:30Z", now)).toBe("az önce");
    expect(formatAgo("2026-09-29T09:48:00Z", now)).toBe("12 dk önce");
    expect(formatAgo("2026-09-29T07:00:00Z", now)).toBe("3 sa önce");
    expect(syncIsLate("2026-09-29T09:45:00Z", now)).toBe(false);
    expect(syncIsLate("2026-09-29T09:00:00Z", now)).toBe(true);
    expect(syncIsLate(null, now)).toBe(true);
  });
});

describe("jenerik sunum", () => {
  it("alan adı okunur başlık olur", () => {
    expect(humanize("toplamMetre")).toBe("Toplam metre");
    expect(humanize("iptalTarihi")).toBe("İptal tarihi");
  });
  it("değerler alana göre biçimlenir; kimlik alanı gizlenir", () => {
    expect(formatValue("cikisTarihi", "2026-09-29T10:05:00Z")).toBe("29.09.2026 13:05");
    expect(formatValue("toplamMetre", "1250.50")).toBe("1.250,5");
    expect(formatValue("aktif", true)).toBe("Evet");
    expect(formatValue("durum", "ISLENDI")).toBe("İşlendi");
    const e = scalarEntries({ id: "x", cariKartId: "y", ad: "A", adet: 3, alt: { a: 1 } });
    expect(e.map((x) => x.key)).toEqual(["ad", "adet"]);
    expect(recordTitle({ sevkNo: "SV-1" })).toBe("SV-1");
    expect(recordTitle(null)).toBe("Kayıt");
  });
});
