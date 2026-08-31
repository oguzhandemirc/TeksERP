// =============================================================================
// FİYAT/VADE ÖNERİSİ — SAF KATMAN BEKÇİSİ
// =============================================================================
// "Öneri ne zaman yazar" yüklemi üç yüzeyin (fatura satırı · sipariş kalemi ·
// alış siparişi kalemi) ortak sözleşmesidir. Üç durum kilitlenir:
//   boşken → yazar · kullanıcı elle yazmışken → ASLA · kaynak değişince →
//   yalnız alan hâlâ kancanın yazdığı değeri taşıyorsa tazeler.
//
// ⚠️ NEGATİF SONDA (2026-08-14, ölçüldü): `shouldApplySuggestion` içindeki ezme
// koruması (`lastApplied` eşleşme şartı) `return true`'ya indirildiğinde bu
// dosyada 3 test KIRMIZI verdi ("elle yazmışken ASLA" · "üstüne yazmışken" ·
// tarih varyantının kullanıcı-tarihi dalı); dosya cp yedeğinden shasum-birebir
// geri yüklendi. Koruma sessizce kaldırılamaz.
// =============================================================================
import { describe, it, expect } from "vitest";
import {
  computeDueDateSuggestion,
  describeSuggestion,
  isBlankPrice,
  isBlankText,
  isResolvableCurrency,
  priceKindForInvoiceType,
  sameSuggestionValue,
  shouldApplySuggestion,
  shouldClearSuggestion,
} from "./useItemPriceSuggestion";

describe("isBlankPrice — fiyat alanının boşluk tanımı", () => {
  it("boş/0 boştur: '', null, undefined, 0, '0'", () => {
    expect(isBlankPrice("")).toBe(true);
    expect(isBlankPrice("   ")).toBe(true);
    expect(isBlankPrice(null)).toBe(true);
    expect(isBlankPrice(undefined)).toBe(true);
    expect(isBlankPrice(0)).toBe(true);
    expect(isBlankPrice("0")).toBe(true);
  });
  it("dolu değer boş değildir: 100, '12.5'", () => {
    expect(isBlankPrice(100)).toBe(false);
    expect(isBlankPrice("12.5")).toBe(false);
  });
  it("sayıya çevrilemeyen metin kullanıcının yazdığı bir şeydir — boş SAYILMAZ", () => {
    expect(isBlankPrice("abc")).toBe(false);
  });
});

describe("isBlankText — metin/tarih alanının boşluk tanımı", () => {
  it("yalnız gerçekten boş olan boştur (0 metinde boş DEĞİLDİR)", () => {
    expect(isBlankText("")).toBe(true);
    expect(isBlankText("  ")).toBe(true);
    expect(isBlankText(null)).toBe(true);
    expect(isBlankText(undefined)).toBe(true);
    expect(isBlankText("2026-09-13")).toBe(false);
    expect(isBlankText(0)).toBe(false);
  });
});

describe("sameSuggestionValue — alan ↔ yazılan değer eşleşmesi", () => {
  it("string durum ↔ number öneri sayısal eşleşir (sipariş formu fiyatı string tutar)", () => {
    expect(sameSuggestionValue("100", 100)).toBe(true);
    expect(sameSuggestionValue("100.00", 100)).toBe(true);
    expect(sameSuggestionValue(100, 100)).toBe(true);
  });
  it("farklı sayılar eşleşmez", () => {
    expect(sameSuggestionValue("120", 100)).toBe(false);
  });
  it("tarih metinleri birebir karşılaştırılır", () => {
    expect(sameSuggestionValue("2026-09-13", "2026-09-13")).toBe(true);
    expect(sameSuggestionValue("2026-09-13", "2026-09-14")).toBe(false);
  });
  it("boş değer hiçbir şeyle aynı değildir", () => {
    expect(sameSuggestionValue("", "")).toBe(false);
    expect(sameSuggestionValue(null, 0)).toBe(false);
    expect(sameSuggestionValue(0, undefined)).toBe(false);
  });
});

describe("shouldApplySuggestion — öneri ne zaman YAZAR", () => {
  it("BOŞKEN yazar", () => {
    expect(
      shouldApplySuggestion({ current: "", lastApplied: null, resolved: 100 }),
    ).toBe(true);
    expect(
      shouldApplySuggestion({ current: 0, lastApplied: null, resolved: 100 }),
    ).toBe(true);
  });

  it("kullanıcı ELLE yazmışken ASLA yazmaz (ezme koruması — negatif sondanın hedefi)", () => {
    // lastApplied yok → alandaki 150 kullanıcının kendi değeri.
    expect(
      shouldApplySuggestion({ current: 150, lastApplied: null, resolved: 100 }),
    ).toBe(false);
  });

  it("kullanıcı önerimizin ÜSTÜNE yazmışken de yazmaz", () => {
    // 100 yazmıştık, kullanıcı 120 yaptı → kaynak değişse de dokunulmaz.
    expect(
      shouldApplySuggestion({ current: 120, lastApplied: 100, resolved: 90 }),
    ).toBe(false);
  });

  it("KAYNAK DEĞİŞİNCE tazeler: alan hâlâ en son yazdığımız değeri taşıyor", () => {
    expect(
      shouldApplySuggestion({ current: 100, lastApplied: 100, resolved: 90 }),
    ).toBe(true);
    // string durumdaki aynı senaryo (sipariş formu)
    expect(
      shouldApplySuggestion({ current: "100", lastApplied: 100, resolved: 90 }),
    ).toBe(true);
  });

  it("çözüm yoksa yazmaz", () => {
    expect(
      shouldApplySuggestion({ current: "", lastApplied: null, resolved: null }),
    ).toBe(false);
  });

  it("tarih varyantı (isBlankText): boşken yazar, kullanıcının tarihi ezilmez, önerimiz tazelenir", () => {
    expect(
      shouldApplySuggestion({
        current: "",
        lastApplied: null,
        resolved: "2026-09-13",
        isBlank: isBlankText,
      }),
    ).toBe(true);
    expect(
      shouldApplySuggestion({
        current: "2026-10-01", // kullanıcının kendi vadesi
        lastApplied: "2026-09-13",
        resolved: "2026-09-20",
        isBlank: isBlankText,
      }),
    ).toBe(false);
    expect(
      shouldApplySuggestion({
        current: "2026-09-13", // hâlâ bizim yazdığımız
        lastApplied: "2026-09-13",
        resolved: "2026-09-20",
        isBlank: isBlankText,
      }),
    ).toBe(true);
  });
});

describe("shouldClearSuggestion — bayat öneri temizliği", () => {
  it("alan hâlâ bizim yazdığımız değerse temizlenir", () => {
    expect(shouldClearSuggestion({ current: 100, lastApplied: 100 })).toBe(true);
    expect(shouldClearSuggestion({ current: "100", lastApplied: 100 })).toBe(true);
  });
  it("kullanıcının değeri ASLA temizlenmez", () => {
    expect(shouldClearSuggestion({ current: 150, lastApplied: 100 })).toBe(false);
    expect(shouldClearSuggestion({ current: 150, lastApplied: null })).toBe(false);
  });
});

describe("priceKindForInvoiceType — fatura türü → fiyat türü", () => {
  it("satış ve satış iadesi SALE; alış ve alış iadesi PURCHASE", () => {
    expect(priceKindForInvoiceType("SALES")).toBe("SALE");
    expect(priceKindForInvoiceType("SALES_RETURN")).toBe("SALE");
    expect(priceKindForInvoiceType("PURCHASE")).toBe("PURCHASE");
    expect(priceKindForInvoiceType("PURCHASE_RETURN")).toBe("PURCHASE");
  });
});

describe("isResolvableCurrency — enum dışı para biriminde istek atılmaz", () => {
  it("beş enum değeri geçer", () => {
    for (const c of ["TRY", "USD", "EUR", "GBP", "RUB"]) {
      expect(isResolvableCurrency(c)).toBe(true);
    }
  });
  it("serbest metin / boş geçmez (sipariş formu 'TL' yazabilir → 400 yerine sessiz kapı)", () => {
    expect(isResolvableCurrency("TL")).toBe(false);
    expect(isResolvableCurrency("")).toBe(false);
    expect(isResolvableCurrency(null)).toBe(false);
    expect(isResolvableCurrency(undefined)).toBe(false);
  });
});

describe("computeDueDateSuggestion — vade türetimi", () => {
  it("issueDate + termDays", () => {
    expect(computeDueDateSuggestion("2026-08-14", 30)).toBe("2026-09-13");
  });
  it("0 gün meşrudur: vade = fatura günü (peşin)", () => {
    expect(computeDueDateSuggestion("2026-08-14", 0)).toBe("2026-08-14");
  });
  it("ay/yıl taşması normalleşir", () => {
    expect(computeDueDateSuggestion("2026-12-25", 10)).toBe("2027-01-04");
  });
  it("termDays yoksa UYDURMA VADE YOK → null (aging'in vadesiz kovası dürüst kalır)", () => {
    expect(computeDueDateSuggestion("2026-08-14", null)).toBe(null);
    expect(computeDueDateSuggestion("2026-08-14", undefined)).toBe(null);
  });
  it("negatif / tam olmayan gün ve bozuk tarih → null", () => {
    expect(computeDueDateSuggestion("2026-08-14", -1)).toBe(null);
    expect(computeDueDateSuggestion("2026-08-14", 1.5)).toBe(null);
    expect(computeDueDateSuggestion("14.08.2026", 30)).toBe(null);
    expect(computeDueDateSuggestion("", 30)).toBe(null);
  });
});

describe("describeSuggestion — yardımcı metin dürüstlüğü", () => {
  it("çözüm yokken backend cümlesi aynen geçer (0 TL DENMEZ)", () => {
    const msg = describeSuggestion({
      price: null,
      source: null,
      message: "Tanımlı fiyat yok — fiyatı elle girin.",
      current: "",
    });
    expect(msg).toBe("Tanımlı fiyat yok — fiyatı elle girin.");
    expect(msg).not.toContain("0");
  });
  it("değer gerçekten alandayken backend'in 'uygulandı' cümlesi basılır", () => {
    expect(
      describeSuggestion({
        price: 100,
        source: "CUSTOMER",
        message: "Müşteriye özel fiyat uygulandı.",
        current: 100,
      }),
    ).toBe("Müşteriye özel fiyat uygulandı.");
  });
  it("kullanıcı kendi fiyatını korumuşsa 'uygulandı' DENMEZ — bilgi cümlesi basılır", () => {
    const msg = describeSuggestion({
      price: 100,
      source: "DEFAULT",
      message: "Kart varsayılanı uygulandı.",
      current: 150,
    });
    expect(msg).toContain("elle girilen değer korundu");
    expect(msg).toContain("kart varsayılanı");
    expect(msg).not.toBe("Kart varsayılanı uygulandı.");
  });
  it("istek hiç atılmamışsa (mesaj yok) hiçbir şey basılmaz", () => {
    expect(
      describeSuggestion({ price: null, source: null, message: null, current: "" }),
    ).toBe(null);
  });
});
