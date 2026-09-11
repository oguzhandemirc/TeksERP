// Storno onayı saf yardımcıları — ekran ile sunucu AYNI ileri olaya bakmalı.
// Negatif sonda (2026-09-11, md5 ile geri alındı): `latestEventOfType` createdAt
// karşılaştırması kaldırılıp dizi sırasına bırakılınca 1 test kırmızı.
import { describe, expect, it } from "vitest";
import { latestEventOfType, reversalSummary } from "./reversal";
import type { ChequeEventRow } from "./service";

const ev = (over: Partial<ChequeEventRow>): ChequeEventRow => ({
  id: "e",
  type: "PAY",
  fromStatus: "ISSUED",
  toStatus: "PAID",
  eventDate: "2026-09-10T00:00:00.000Z",
  createdAt: "2026-09-10T08:00:00.000Z",
  notes: null,
  counterCari: null,
  bankAccount: null,
  cashBox: null,
  ...over,
});

const row = { amount: "3000.00", currency: "TRY" as const };

describe("latestEventOfType", () => {
  it("geriye tarihli zincir: kronolojik dizide önce gelse de EN YENİ yazım seçilir", () => {
    // Dizi backend'in eventDate-asc sırasıdır: geriye tarihli ikinci ödeme BAŞTA.
    const events = [
      ev({ id: "pay2-banka", eventDate: "2026-09-05T00:00:00.000Z", createdAt: "2026-09-11T09:00:00.000Z" }),
      ev({ id: "pay1-kasa", eventDate: "2026-09-10T00:00:00.000Z", createdAt: "2026-09-10T08:00:00.000Z" }),
      ev({ id: "cancel", type: "PAY_CANCEL", createdAt: "2026-09-10T08:30:00.000Z" }),
    ];
    expect(latestEventOfType(events, "PAY")?.id).toBe("pay2-banka");
  });

  it("createdAt yoksa (eski backend) dizinin sonuncusu", () => {
    const events = [ev({ id: "a", createdAt: undefined }), ev({ id: "b", createdAt: undefined })];
    expect(latestEventOfType(events, "PAY")?.id).toBe("b");
  });

  it("tip yoksa null", () => {
    expect(latestEventOfType([ev({ type: "ISSUE" })], "PAY")).toBeNull();
  });
});

describe("reversalSummary", () => {
  it("ödeme stornosu parayı hangi hesaba geri koyacağını ve dönüş durumunu söyler", () => {
    const text = reversalSummary("PAY", ev({ cashBox: { id: "k", name: "Merkez Kasa" } }), row);
    expect(text).toContain('"Merkez Kasa" kasasına');
    expect(text).toContain('"Verildi"');
  });

  it("hesabı okunamayan para stornosu null → ekran sunucuya bırakır", () => {
    expect(reversalSummary("PAY", ev({}), row)).toBeNull();
    expect(reversalSummary("COLLECT", ev({ type: "COLLECT", fromStatus: "AT_BANK" }), row)).toBeNull();
  });

  it("ciro edilmiş karşılıksızın stornosu ciro carisini de anar", () => {
    const counterCari = { id: "c", customer: null, subcontractor: { code: "F1", name: "Boyahane A" } };
    const text = reversalSummary("BOUNCE", ev({ type: "BOUNCE", fromStatus: "ENDORSED", counterCari }), row);
    expect(text).toContain('"Boyahane A" carisinin ciro borcu yeniden doğacak');
    expect(text).toContain('"Ciro edildi"');
  });

  it("ciro stornosu karşı carisiz olay için null", () => {
    expect(reversalSummary("ENDORSE", ev({ type: "ENDORSE", fromStatus: "PORTFOLIO" }), row)).toBeNull();
  });

  it("fromStatus'suz olay (doğuş satırı) storno cümlesi üretmez", () => {
    expect(reversalSummary("RETURN", ev({ type: "RETURN", fromStatus: null }), row)).toBeNull();
  });
});
