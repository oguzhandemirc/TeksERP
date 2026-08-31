// =============================================================================
// BEKÇİ — ekstre satırından belgeye tıkla-git
// =============================================================================
// ⭐ FATURA ve TAHSİLAT AYRI HEDEFLER: biri detay diyaloğu, diğeri donmuş
//    makbuz. Tek `documentId` alanına indirgemek, türü `sourceType`ten yeniden
//    çıkarmayı gerektirir ve devir/storno satırları da o torbaya düşerdi.
// ⭐ ESKİ BACKEND'DE (id alanları yok) satır TIKLANABİLİR OLMAZ — tıklanır
//    görünüp hiçbir şey yapmayan satır, olmayan bir yolu vaat eder.
// =============================================================================
import { describe, it, expect } from "vitest";
import { statementTargetOf } from "./statementLink";

describe("statementTargetOf", () => {
  it("fatura satırı fatura detayına gider", () => {
    expect(statementTargetOf({ invoiceId: "inv-1", docNo: "FTR-1" })).toEqual({
      kind: "INVOICE",
      id: "inv-1",
    });
  });

  it("tahsilat satırı MAKBUZA gider ve belge numarasını taşır", () => {
    expect(statementTargetOf({ paymentId: "pay-1", docNo: "TAH-1" })).toEqual({
      kind: "PAYMENT",
      id: "pay-1",
      docNo: "TAH-1",
    });
  });

  it("⭐ id yoksa hedef YOK (devir / storno / eski backend)", () => {
    expect(statementTargetOf({ docNo: "DVR-1" })).toBeNull();
    expect(statementTargetOf({ invoiceId: null, paymentId: null })).toBeNull();
    expect(statementTargetOf({})).toBeNull();
  });

  it("belge numarası yoksa makbuz başlığı tire ile açılır ('undefined' değil)", () => {
    expect(statementTargetOf({ paymentId: "pay-2" })).toEqual({
      kind: "PAYMENT",
      id: "pay-2",
      docNo: "—",
    });
  });
});
