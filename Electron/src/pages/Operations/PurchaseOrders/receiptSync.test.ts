// =============================================================================
// BEKÇİ — mal kabul yanıtındaki sipariş uyarıları
// =============================================================================
// ⭐ İKİ UYARI DA YUTULMAZ. Backend bunları `message` kuyruğuna ekliyor ama fiş
//    formu, atlanan satır olduğunda kendi toast'ını basıp `message`i kullanmıyor
//    — yani tam da bir şeyler ters giderken sipariş uyarısı ekrandan düşüyordu.
// ⭐ FAZLA KABUL "HATA" TONUYLA BASILMAZ: fiziksel olarak fazla mal gelir,
//    backend bilinçli olarak engellemez ve depocunun düzeltmesi gereken bir şey
//    yoktur. Kırmızı, düzeltilecek bir şey vaat eder.
// ⭐ SİPARİŞSİZ FİŞTE TEK BAYT ÇİZİLMEZ (fabrika/serbest akış bayt-bayt aynı).
// =============================================================================
import { describe, it, expect } from "vitest";
import { receiptSyncNotices, receiptSyncSummary, type ReceiptPurchaseOrderSync } from "./receiptSync";

const base: ReceiptPurchaseOrderSync = {
  id: "po-1",
  orderNo: "AS1408260001",
  status: "PARTIAL",
  changed: true,
  overReceiptLines: [],
  unmatchedItemIds: [],
};

describe("receiptSyncNotices", () => {
  it("⭐ sipariş bağı yoksa hiçbir şey çizilmez", () => {
    expect(receiptSyncNotices(null)).toEqual([]);
    expect(receiptSyncNotices(undefined)).toEqual([]);
    expect(receiptSyncSummary(null)).toBe("");
  });

  it("uyarısız senkron sessizdir (temiz kabulde bant çıkmaz)", () => {
    expect(receiptSyncNotices(base)).toEqual([]);
  });

  it("⭐ FAZLA KABUL bildirilir ama HATA tonuyla DEĞİL", () => {
    const n = receiptSyncNotices({ ...base, overReceiptLines: [1, 3] });
    expect(n).toHaveLength(1);
    expect(n[0]!.tone).toBe("info");
    expect(n[0]!.text).toContain("FAZLA mal geldi");
    // Kalem numaraları somut yazılır — "bir kalemde" demek, depocuyu tüm fişi
    // baştan okumaya zorlardı.
    expect(n[0]!.text).toContain("kalem 1, 3");
    expect(n[0]!.text).toContain("AS1408260001");
  });

  it("⭐ siparişte olmayan ürün UYARI tonuyla ve sebep tahminiyle söylenir", () => {
    const n = receiptSyncNotices({ ...base, unmatchedItemIds: ["a", "b"] });
    expect(n[0]!.tone).toBe("warning");
    expect(n[0]!.text).toContain("2 ürün bu siparişte YOK");
    expect(n[0]!.text).toContain("yanlış sipariş seçilmiş olabilir");
  });

  it("iki uyarı bir arada gelirse İKİSİ de basılır", () => {
    const n = receiptSyncNotices({ ...base, overReceiptLines: [2], unmatchedItemIds: ["a"] });
    expect(n).toHaveLength(2);
    expect(n.map((x) => x.tone)).toEqual(["info", "warning"]);
  });

  it("sipariş bu kabulle tamamlandıysa söylenir", () => {
    const n = receiptSyncNotices({ ...base, status: "CLOSED" });
    expect(n).toHaveLength(1);
    expect(n[0]!.tone).toBe("success");
    expect(n[0]!.text).toContain("tamamlandı");
  });

  it("idempotent tekrarda (changed=false) 'tamamlandı' tekrar duyurulmaz", () => {
    // Aynı fişin ikinci gönderimi mevcut kaydı döner; "sipariş tamamlandı"
    // kutlamasını her tekrarda basmak, olmayan bir olayı duyurmaktır.
    expect(receiptSyncNotices({ ...base, status: "CLOSED", changed: false })).toEqual([]);
  });
});
