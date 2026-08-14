// =============================================================================
// BEKÇİ — fatura KAPAMA türetimi (`settlementOf`) — H1, 2026-08-14
// =============================================================================
// AÇIK/KISMİ/KAPALI bir KOLON değildir: backend `payment-allocation.service`
// başlığı gereği `paidTotal` ↔ `grandTotal` karşılaştırmasından TÜRETİLİR.
// Bu dosya o türetimin üç kuralını kilitler:
//   ① Statü kapısı — DRAFT/CANCELLED'da kapama sorusu YOKTUR (`null`):
//      taslağa "Açık" rozeti basmak var olmayan bir alacağı ima eder; iptalde
//      kapamalar zaten çözülür (releaseAllocationsForInvoiceTx).
//   ② Kuruş aritmetiği — float karşılaştırma "1 kuruş açık kaldı" diye tam
//      kapalı faturayı KISMİ gösterirdi (allocationMath'in var oluş sebebi).
//   ③ Gecikme rozeti yalnız AÇIK tutar varken — tam kapalı faturaya "vadesi
//      geçti" basmak çözülmüş bir sorunu ihbar eder; vadesiz faturada gecikme
//      tanımsızdır (isOverdue(null) === false).
//
// NEGATİF SONDA (2026-08-14, üçü de tek komut zincirinde boz→ölç→geri yükle,
// shasum ile birebirlik kanıtlandı):
//   ① `settlementOf`'un statü kapısı (`if status !== "CONFIRMED" return null`)
//      kaldırıldı → 2 kontrol kırmızı (exit 1).
//   ② `overdue` hesabından `openK > 0` düşürüldü → "tam kapalı + vadesi geçmiş
//      fatura rozet almaz" kontrolü kırmızı (exit 1).
//   ③ `toKurus(paidTotal)` → `Math.trunc(paidTotal * 100)` çevrildi → float
//      tuzağı kontrolü kırmızı (exit 1). ⚠️ Sonda dersi: ilk fixture değeri
//      110.15 float'ta TEMİZ çıkıyor (110.15*100 === 11015) ve sonda YEŞİL
//      kalıyordu — değer trunc-duyarlı seçildi (4.35*100 = 434.999…94, ölçüldü).
// =============================================================================

import { describe, expect, it } from "vitest";
import { settlementOf } from "./service";

/** Dün (yerel gün sınırına göre kesin geçmiş vade). */
const PAST = new Date(Date.now() - 2 * 86_400_000).toISOString();
/** Yarından sonra (kesin gelecek). */
const FUTURE = new Date(Date.now() + 2 * 86_400_000).toISOString();

const base = { status: "CONFIRMED" as const, grandTotal: 1000, paidTotal: 0, dueDate: null as string | null };

describe("settlementOf — statü kapısı (①)", () => {
  it("DRAFT → null (kapama sorusu yok; vade geçmiş olsa bile)", () => {
    expect(settlementOf({ ...base, status: "DRAFT", dueDate: PAST })).toBeNull();
  });
  it("CANCELLED → null (kapamalar iptalde çözüldü)", () => {
    expect(settlementOf({ ...base, status: "CANCELLED", dueDate: PAST })).toBeNull();
  });
  it("CONFIRMED → türetim döner", () => {
    expect(settlementOf(base)).not.toBeNull();
  });
});

describe("settlementOf — AÇIK/KISMİ/KAPALI türetimi", () => {
  it("hiç ödeme yok → ACIK, açık tutar = tamamı", () => {
    const s = settlementOf(base);
    expect(s?.state).toBe("ACIK");
    expect(s?.paidK).toBe(0);
    expect(s?.openK).toBe(100_000);
  });
  it("kısmi ödeme → KISMI", () => {
    const s = settlementOf({ ...base, paidTotal: 250.5 });
    expect(s?.state).toBe("KISMI");
    expect(s?.paidK).toBe(25_050);
    expect(s?.openK).toBe(74_950);
  });
  it("tam ödeme → KAPALI, açık 0", () => {
    const s = settlementOf({ ...base, paidTotal: 1000 });
    expect(s?.state).toBe("KAPALI");
    expect(s?.openK).toBe(0);
  });
  it("float tuzağı (②): 4.35×100 sınıfı değerlerde tam ödeme KAPALI kalır", () => {
    // 4.35 * 100 = 434.99999999999994 — `Math.trunc` onu 434 kuruşa indirir ve
    // tam kapalı fatura "1 kuruş açık" diye KISMİ görünürdü. `toKurus`'un
    // Math.round'u bu yüzden var (ÖLÇÜLDÜ: 110.15 gibi çoğu değer float'ta
    // temizdir ve tuzağı GÖSTERMEZ — sonda değeri trunc-duyarlı seçilmeli).
    const s = settlementOf({ ...base, grandTotal: 4.35, paidTotal: 4.35 });
    expect(s?.state).toBe("KAPALI");
    expect(s?.openK).toBe(0);
    expect(s?.overdue).toBe(false);
  });
});

describe("settlementOf — gecikme rozeti (③)", () => {
  it("vadesi geçmiş + açık → overdue true", () => {
    expect(settlementOf({ ...base, dueDate: PAST })?.overdue).toBe(true);
  });
  it("vadesi geçmiş + KISMİ açık → overdue true", () => {
    expect(settlementOf({ ...base, paidTotal: 400, dueDate: PAST })?.overdue).toBe(true);
  });
  it("vadesi geçmiş ama TAM KAPALI → overdue false (çözülmüş sorun ihbar edilmez)", () => {
    expect(settlementOf({ ...base, paidTotal: 1000, dueDate: PAST })?.overdue).toBe(false);
  });
  it("vadesi gelmemiş → overdue false", () => {
    expect(settlementOf({ ...base, dueDate: FUTURE })?.overdue).toBe(false);
  });
  it("vadesiz (dueDate null) → overdue false (uydurma vade yok)", () => {
    expect(settlementOf(base)?.overdue).toBe(false);
  });
});
