// =============================================================================
// BEKÇİ — MAL KABUL KAROSU TİCARET MODÜLÜNE BAĞLI
// =============================================================================
// ⭐ ASIL İDDİA: kural bir bileşenin içindeki `&&` zincirinde bırakılsaydı
// tersine çevrilmesi hiçbir testi kırmazdı. Bu dosyanın tek işi o sessizliği
// imkânsız kılmak — ve düzeltilen ayrışmanın (karo kapısız / uç 403) geri
// gelmesini engellemek.
// =============================================================================
import { describe, expect, it } from "vitest";
import { isGoodsReceiptVisible } from "./goodsReceipt-regime";
import { operationsTiles } from "../tile-config";

describe("mal kabul rejimi", () => {
  it("⭐ fabrikada (ticaret modülü kapalı) GÖRÜNMEZ", () => {
    expect(isGoodsReceiptVisible({ ticaretEnabled: false })).toBe(false);
  });

  it("ticaret kurulumunda görünür", () => {
    expect(isGoodsReceiptVisible({ ticaretEnabled: true })).toBe(true);
  });

  it("karo bağlamının FAZLA alanları kararı etkilemez (yapısal tip)", () => {
    // Değişkene alınıyor: doğrudan nesne literali TS'in "fazla alan" denetimine
    // takılır; ölçülen şey yüklemin başka alana HİÇ bakmadığıdır.
    const ctx = { ticaretEnabled: false, financeEnabled: true, depoMultiEnabled: true };
    expect(isGoodsReceiptVisible(ctx)).toBe(false);
  });

  it("⭐ karo yüklemi TAŞIR (sarmalayan ok fonksiyonu değil) ve iznini KORUR", () => {
    const tile = operationsTiles.find((t) => t.key === "goods-receipts");
    // Kimlik testi: palet girişi karonun AYNI fonksiyon nesnesini taşır
    // (`tile-visibility.test`); sarmalayan bir ok fonksiyonu o bağı koparır.
    expect(tile?.visibleWhen).toBe(isGoodsReceiptVisible);
    // Rejim izin kapısının YERİNE geçmez — ikisi de durur.
    expect(tile?.permission).toBe("goods-receipt:read");
  });
});
