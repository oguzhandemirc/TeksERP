import { describe, expect, it } from "vitest";
import { IMPORT_STATUS_LABEL, importOutcomeTitle, importStatusBadgeText } from "./import-outcome";

// Sunum provası: PARTIAL sonuç "İşlem YARIDA kesildi" diyordu; satırlar atlanıp gerisi yazılmıştı.
describe("içe aktarım sonuç dili", () => {
  it("PARTIAL: kaç kayıt yazıldı, kaç satır atlandı", () => {
    expect(importOutcomeTitle({ status: "PARTIAL", created: 7, updated: 3, failed: 2 })).toBe("Kısmen tamamlandı: 10 kayıt yazıldı, 2 satır atlandı.");
    expect(IMPORT_STATUS_LABEL.PARTIAL).toBe("Kısmen tamamlandı");
    expect(importStatusBadgeText({ status: "PARTIAL", created: 1, updated: 0, failed: 1 })).toBe("Kısmen tamamlandı");
  });
  it("PARTIAL + yazma durdu: satır no söylenir", () => {
    expect(importOutcomeTitle({ status: "PARTIAL", created: 4, updated: 0, failed: 0, stoppedAtRowNo: 12 })).toBe("Kısmen tamamlandı: 4 kayıt yazıldı, yazma 12. satırda durdu.");
    expect(importStatusBadgeText({ status: "PARTIAL", created: 4, updated: 0, failed: 0, stoppedAtRowNo: 12 })).toBe("Kısmen tamamlandı (satır 12'de durdu)");
  });
  it("FAILED ve APPLIED ayrı kalır", () => {
    expect(importOutcomeTitle({ status: "FAILED", created: 0, updated: 0, failed: 5 })).toBe("Hiçbir kayıt yazılamadı.");
    expect(IMPORT_STATUS_LABEL.FAILED).toBe("Başarısız");
    expect(importOutcomeTitle({ status: "APPLIED", created: 1, updated: 0, failed: 0 })).toBe("İçe aktarım tamamlandı.");
  });
});
