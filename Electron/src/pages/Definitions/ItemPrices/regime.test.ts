// =============================================================================
// BEKÇİ — Kalem fiyatı yüzeyinin rejim + izin kapısı
// =============================================================================
// ⭐ ASIL İDDİA: FABRİKADA (ticaret.enabled KAPALI) bu yüzeyin HİÇBİR parçası
// çizilmez — izin taşıyan admin dahil. Kural bir bileşenin içindeki `&&`
// zincirine geri taşınırsa tersine çevrilmesi hiçbir testi kırmaz; bu dosya tam
// olarak onu engellemek için var.
// =============================================================================
import { describe, it, expect } from "vitest";
import {
  canOfferNewPrice,
  itemPricesEditable,
  itemPricesTileVisible,
  itemPricesVisible,
  type ItemPriceAccess,
} from "./regime";

const access = (over: Partial<ItemPriceAccess> = {}): ItemPriceAccess => ({
  ticaretEnabled: true,
  canRead: true,
  canWrite: true,
  ...over,
});

describe("rejim kapısı", () => {
  it("⭐ FABRİKADA (bayrak kapalı) yüzey ÇİZİLMEZ — tam yetkili kullanıcıda bile", () => {
    expect(itemPricesVisible(access({ ticaretEnabled: false }))).toBe(false);
    expect(itemPricesEditable(access({ ticaretEnabled: false }))).toBe(false);
    expect(itemPricesTileVisible({ ticaretEnabled: false })).toBe(false);
  });

  it("ticaret kurulumunda (bayrak açık) yüzey çizilir", () => {
    expect(itemPricesVisible(access())).toBe(true);
    expect(itemPricesTileVisible({ ticaretEnabled: true })).toBe(true);
  });
});

describe("izin kapısı — rejimden AYRI soru", () => {
  it("item:read yoksa yüzey çizilmez", () => {
    expect(itemPricesVisible(access({ canRead: false }))).toBe(false);
  });

  it("⭐ price:write yoksa yalnız YAZMA düşer, okuma durur (salt-okunur gerçek bir hâldir)", () => {
    const a = access({ canWrite: false });
    expect(itemPricesVisible(a)).toBe(true);
    expect(itemPricesEditable(a)).toBe(false);
  });

  it("⭐ yazma yetkisi TEK BAŞINA yetmez — göremediği listeye yazma düğmesi konmaz", () => {
    expect(itemPricesEditable(access({ ticaretEnabled: false, canRead: false }))).toBe(false);
    expect(itemPricesEditable(access({ canRead: false }))).toBe(false);
  });
});

describe("yeni fiyat teklifi — liste güvenilir mi", () => {
  it("⭐ LİSTE YÜKLENMEDEN yeni fiyat teklif EDİLMEZ (sessiz üzerine yazma)", () => {
    // Uyarı ("bu kutuda zaten fiyat var — üzerine yazılır") satır listesinden
    // üretiliyor; liste düşmüşse uyarı kaybolur, backend upsert olduğu için
    // hata da vermez ve eski fiyat EZİLİR. Yani bu, mükerrer kayıttan kötüdür.
    expect(canOfferNewPrice(access(), false)).toBe(false);
    expect(canOfferNewPrice(access(), true)).toBe(true);
  });

  it("izin/rejim kapısını ATLAMAZ — yüklü liste tek başına yetmez", () => {
    expect(canOfferNewPrice(access({ canWrite: false }), true)).toBe(false);
    expect(canOfferNewPrice(access({ ticaretEnabled: false }), true)).toBe(false);
    expect(canOfferNewPrice(access({ canRead: false }), true)).toBe(false);
  });
});

describe("bayrak KİMLİĞİ — ticaret, ön muhasebe DEĞİL", () => {
  it("⭐ ön muhasebe AÇIK ama ticaret KAPALIYKEN yüzey çizilmez", () => {
    // 2026-09-02'ye kadar bu yüzey `finance.enabled`e asılıydı; backend kapısı
    // `requireTicaretEnabled`e taşındı, panel geride kaldı. Bu satır o ayrışmanın
    // geri gelmesini engeller: fatura tutmayan ama alım-satım yapan firma fiyat
    // listesini GÖRMELİ, fatura tutan ama ticaret modülü kapalı olan GÖRMEMELİ.
    const onMuhasebeAcikTicaretKapali = {
      ticaretEnabled: false,
      canRead: true,
      canWrite: true,
      financeEnabled: true,
    };
    expect(itemPricesVisible(onMuhasebeAcikTicaretKapali)).toBe(false);
    // ⚠️ Değişkene alınıyor: nesne literali TS'in "fazla alan" denetimine takılır
    // ve ölçülmek istenen şey tam da yüklemin `financeEnabled`e HİÇ bakmadığıdır.
    const karoMuhasebeAcik = { ticaretEnabled: false, financeEnabled: true };
    expect(itemPricesTileVisible(karoMuhasebeAcik)).toBe(false);
  });

  it("⭐ ticaret AÇIK ama ön muhasebe KAPALIYKEN yüzey ÇİZİLİR", () => {
    const ticaretAcikMuhasebeKapali = {
      ticaretEnabled: true,
      canRead: true,
      canWrite: true,
      financeEnabled: false,
    };
    expect(itemPricesVisible(ticaretAcikMuhasebeKapali)).toBe(true);
    const karoTicaretAcik = { ticaretEnabled: true, financeEnabled: false };
    expect(itemPricesTileVisible(karoTicaretAcik)).toBe(true);
  });
});

describe("karo yüklemi", () => {
  it("⭐ İZİN SORMAZ — karo izni ayrı alanda taşır (tile-config sözleşmesi)", () => {
    // Yükleme yalnız `ticaretEnabled` geçilir; izin alanları hiç istenmez.
    expect(itemPricesTileVisible({ ticaretEnabled: true })).toBe(true);
  });
});
