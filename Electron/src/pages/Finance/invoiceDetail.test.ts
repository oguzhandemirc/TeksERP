// =============================================================================
// BEKÇİ — fatura DETAYININ kapama okuması (`invoiceDetail.ts`) — 2026-08-14
// =============================================================================
// Detay yüzeyi kapanan tutarı İKİ kaynaktan görür: faturanın denormalize sayacı
// (`paidTotal` → `settlementOf`) ve kapama satırları (`PaymentAllocation`).
// Bu dosya o okumanın üç kuralını kilitler:
//   ① Toplama KURUŞTA — float toplamı 1 kuruşluk HAYALİ fark üretir ve o fark
//      ekrana "defter tutmuyor" uyarısı olarak düşer; yani sağlam bir faturayı
//      bozuk gösterir (`allocationMath`'in var oluş sebebinin bu ekrandaki
//      karşılığı).
//   ② Kaynak XOR'a GÜVENİLMEZ — ikisi de dolu/boş gelirse "BİLİNMİYOR"; sessizce
//      birini seçmek, veri bozulduğu gün ekranı yanlış AMA emin gösterirdi.
//      Tarih etiketi değerle birlikte döner (tahsilatın işlem günü ≠ çekin vadesi).
//   ③ Kapama sorusu OLMAYAN faturada (TASLAK/İPTAL → `settlementOf` null) fark
//      DAİMA 0 — orada bir tutarsızlık ihbar etmek kullanıcıyı olmayan bir soruna
//      bakmaya gönderirdi.
//
// NEGATİF SONDA (2026-08-14, dördü de boz→ölç→geri yükle; `diff` ile birebir
// geri yükleme kanıtlandı):
//   ⓪ ÖNCE ETKİSİZ BİR SONDA DENENDİ ve DERS ÇIKTI: `toKurus` yerine
//      `Math.round(Σ tutar × 100)` yazıldığında test YEŞİL kaldı — sondaki tek
//      yuvarlama float birikimini kurtarıyor. Yani "kuruş aritmetiği" kuralının
//      ölçülebilir hâli SATIR BAŞINA dönüşümdür; sonda yuvarlama zaten doğrudur
//      ve onu bozuk sanıp "düzeltmek" testi süse çevirir.
//   ① `Number(r.amount) * 100` satır başına, YUVARLAMASIZ → "4.35 sınıfı"
//      kontrolü kırmızı (869.9999999999999 ≠ 870).
//   ② Aynı yer `Math.trunc(Number(r.amount) * 100)` (allocationMath'in belgelediği
//      tuzak) → aynı kontrol kırmızı (868 ≠ 870).
//   ③ `allocationSourceOf`'un XOR kapısı (`hasPayment === hasCheque`) kaldırıldı
//      → 2 kontrol kırmızı ('PAYMENT' beklenen 'UNKNOWN').
//   ④ `paidDriftK`'nin `if (!settlement) return 0` kapısı kaldırıldı → 2 kontrol
//      kırmızı (TypeError: null.paidK).
// =============================================================================

import { describe, expect, it } from "vitest";
import { allocationSourceOf, paidDriftK, sumAllocationsK, type AllocationLike } from "./invoiceDetail";
import { settlementOf } from "./service";

const payment = (amount: number | string, direction: "IN" | "OUT" = "IN"): AllocationLike => ({
  amount,
  payment: { docNo: "TH1408260001", direction, paymentDate: "2026-08-10T00:00:00.000Z" },
  cheque: null,
});

const cheque = (amount: number | string, kind: "RECEIVED" | "ISSUED" = "RECEIVED"): AllocationLike => ({
  amount,
  payment: null,
  cheque: { docNo: "CK1408260002", kind, dueDate: "2026-09-12T00:00:00.000Z" },
});

describe("sumAllocationsK — kuruş toplaması (①)", () => {
  it("boş liste → 0", () => {
    expect(sumAllocationsK([])).toBe(0);
  });

  it("string ve number tutarları birlikte toplar (iki uç iki şekil döndürüyor)", () => {
    // `/allocations` uçları Decimal'i STRING yazar, `/cheques` number döner —
    // tek okuma noktası olmasaydı "15" + "10" = "1510" olurdu.
    expect(sumAllocationsK([payment("1500.00"), cheque(250.5)])).toBe(175_050);
  });

  it("float birikimi tam kapanmayı 1 kuruş açık göstermez", () => {
    // 0.1 + 0.2 = 0.30000000000000004; sonda yuvarlamayla 3 satırın toplamı
    // 60 kuruş yerine 59/61 çıkabilir ve fatura "kapanmadı" görünürdü.
    expect(sumAllocationsK([payment(0.1), payment(0.2), payment(0.3)])).toBe(60);
  });

  it("kuruş-duyarlı değerlerde sapma yok (4.35 sınıfı)", () => {
    // 4.35 * 100 = 434.99999999999994 — `Math.trunc` 434 kuruş yazardı.
    expect(sumAllocationsK([payment(4.35), payment(4.35)])).toBe(870);
  });
});

describe("allocationSourceOf — kaynak ve tarih anlamı (②)", () => {
  it("tahsilat satırı: yön etiketi + işlem tarihi", () => {
    const s = allocationSourceOf(payment(100, "IN"));
    expect(s.kind).toBe("PAYMENT");
    expect(s.label).toBe("Tahsilat");
    expect(s.docNo).toBe("TH1408260001");
    expect(s.dateLabel).toBe("işlem");
  });

  it("ödeme satırı (OUT) 'Tahsilat' DEMEZ", () => {
    expect(allocationSourceOf(payment(100, "OUT")).label).toBe("Ödeme");
  });

  it("çek satırı: tarih VADE'dir ve etiketi öyle söyler", () => {
    const s = allocationSourceOf(cheque(100));
    expect(s.kind).toBe("CHEQUE");
    expect(s.label).toBe("Aldığımız çek/senet");
    expect(s.date).toBe("2026-09-12T00:00:00.000Z");
    expect(s.dateLabel).toBe("vade");
  });

  it("verdiğimiz çek ayrı etiketle", () => {
    expect(allocationSourceOf(cheque(100, "ISSUED")).label).toBe("Verdiğimiz çek/senet");
  });

  it("XOR ihlali (ikisi de dolu) → BİLİNMİYOR, uydurma kaynak yok", () => {
    const bozuk: AllocationLike = { ...payment(100), cheque: cheque(100).cheque };
    const s = allocationSourceOf(bozuk);
    expect(s.kind).toBe("UNKNOWN");
    expect(s.docNo).toBeNull();
  });

  it("XOR ihlali (ikisi de boş) → BİLİNMİYOR", () => {
    expect(allocationSourceOf({ amount: 100, payment: null, cheque: null }).kind).toBe("UNKNOWN");
  });
});

describe("paidDriftK — sayaç ↔ defter farkı (③)", () => {
  const confirmed = (paidTotal: number) =>
    settlementOf({ status: "CONFIRMED", grandTotal: 1000, paidTotal, dueDate: null });

  it("sayaç ile satırlar uyuşuyorsa fark 0", () => {
    expect(paidDriftK(confirmed(400), [payment("250.00"), cheque(150)])).toBe(0);
  });

  it("sayaç fazlaysa fark POZİTİF (kapandı der, karşılığı yok)", () => {
    expect(paidDriftK(confirmed(400), [payment("250.00")])).toBe(15_000);
  });

  it("defter fazlaysa fark NEGATİF (satır var, sayaca işlememiş)", () => {
    expect(paidDriftK(confirmed(250), [payment("250.00"), cheque(150)])).toBe(-15_000);
  });

  it("TASLAK faturada fark hesaplanmaz (kapama sorusu yok)", () => {
    const st = settlementOf({ status: "DRAFT", grandTotal: 1000, paidTotal: 0, dueDate: null });
    expect(st).toBeNull();
    expect(paidDriftK(st, [payment("250.00")])).toBe(0);
  });

  it("İPTAL faturada fark hesaplanmaz (kapamalar iptalde çözüldü)", () => {
    const st = settlementOf({ status: "CANCELLED", grandTotal: 1000, paidTotal: 0, dueDate: null });
    expect(paidDriftK(st, [payment("250.00")])).toBe(0);
  });
});
