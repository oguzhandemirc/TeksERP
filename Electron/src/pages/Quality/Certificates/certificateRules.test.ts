import { describe, expect, it } from "vitest";
import { expiryBadge, fileSizeText, isCertificateFilterDirty, EMPTY_CERTIFICATE_FILTERS } from "./certificateRules";

const row = (daysLeft: number, extra: Partial<Parameters<typeof expiryBadge>[0]> = {}) => ({ active: true, daysLeft, revokedAt: null, renewedBy: null, ...extra });

describe("expiryBadge", () => {
  it("geçmiş ve bugün → kırmızı 'Süresi doldu'", () => {
    expect(expiryBadge(row(-3), 30)).toEqual({ tone: "expired", text: "Süresi doldu · 3 gün önce" });
    expect(expiryBadge(row(0), 30).tone).toBe("expired");
  });
  it("eşik içi sarı, eşik dışı nötr (eşik dahil)", () => {
    expect(expiryBadge(row(30), 30).tone).toBe("soon");
    expect(expiryBadge(row(31), 30).tone).toBe("ok");
  });
  it("iptal/yenilenmiş → süre değil durum söylenir", () => {
    expect(expiryBadge(row(-5, { active: false, revokedAt: "2026-10-01T00:00:00Z" }), 30).text).toBe("İptal edildi");
    expect(expiryBadge(row(5, { active: false, renewedBy: { id: "x", certificateNo: "N", expiresOn: "2027-01-01" } }), 30).text).toBe("Yenilendi");
  });
});

describe("yardımcılar", () => {
  it("varsayılan süzgeç temiz sayılır", () => {
    expect(isCertificateFilterDirty(EMPTY_CERTIFICATE_FILTERS)).toBe(false);
    expect(isCertificateFilterDirty({ ...EMPTY_CERTIFICATE_FILTERS, status: "expiring" })).toBe(true);
  });
  it("dosya boyutu Türkçe biçim", () => {
    expect(fileSizeText(512)).toBe("512 B");
    expect(fileSizeText(1536 * 1024)).toBe("1,5 MB");
  });
});
