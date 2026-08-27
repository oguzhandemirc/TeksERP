import { describe, expect, it } from "vitest";
import { scoreCommandValue, SERVER_ITEM_PREFIX } from "./command-score";

/**
 * Paletin SIRALAMA bekçisi. Ölçülen arıza: puan ikiliyken (1/0) "Müşteri
 * Karnesi" yazan kullanıcıya "Sipariş İptal Karnesi" açılıyordu.
 */
const MUSTERI_KARNESI =
  "Müşteri Karnesi En çok veren, en sık veren ve kaybolmakta olan müşteri (ABC + RFM) Raporlar · Müşteri";
const IPTAL_KARNESI =
  "Sipariş İptal Karnesi Müşteriler neden ve ne kadar geç vazgeçiyor — sebep dağılımı ve maliyet sınıfı Raporlar · Sipariş & Sevkiyat";

describe("komut paleti puanlaması", () => {
  it("tam ad, açıklamadan eşleşen kaydı YENER", () => {
    const exact = scoreCommandValue(MUSTERI_KARNESI, "müşteri karnesi");
    const viaDesc = scoreCommandValue(IPTAL_KARNESI, "müşteri karnesi");
    expect(exact).toBeGreaterThan(viaDesc);
    // İkisi de eşleşmeye devam eder — küme daralmadı, yalnız sıra değişti.
    expect(viaDesc).toBeGreaterThan(0);
  });

  it("eşleşmeyen sorgu 0 döner", () => {
    expect(scoreCommandValue(MUSTERI_KARNESI, "kartela sevk")).toBe(0);
  });

  it("kelime SIRASI önemsiz (sunucu aramasıyla aynı sözleşme)", () => {
    expect(scoreCommandValue(MUSTERI_KARNESI, "karnesi müşteri")).toBeGreaterThan(0);
  });

  it("ASCII yazım Türkçe adı bulur (kursun → Kurşun)", () => {
    expect(scoreCommandValue("Kurşun Sırası Dağıtım Operasyon", "kursun")).toBeGreaterThan(0);
  });

  it("boş sorgu her kaydı geçirir", () => {
    expect(scoreCommandValue(MUSTERI_KARNESI, "")).toBe(1);
  });

  it("sunucu satırları yeniden SÜZÜLMEZ (alias eşleşmesi elenmesin)", () => {
    expect(scoreCommandValue(`${SERVER_ITEM_PREFIX}roll:123`, "alakasiz")).toBe(1);
  });

  it("ada YAKIN geçiş, uzak geçişi yener", () => {
    const yakin = scoreCommandValue("Sipariş Karnesi Dönemde ne kadar iş geldi", "karnesi");
    const uzak = scoreCommandValue("Bambaşka Sayfa açıklama içinde çok sonra karnesi geçiyor", "karnesi");
    expect(yakin).toBeGreaterThan(uzak);
  });
});
