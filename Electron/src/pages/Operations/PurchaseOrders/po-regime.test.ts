// =============================================================================
// ALIŞ SİPARİŞİ GÖRÜNÜRLÜĞÜ — BEKÇİ
// =============================================================================
// `yarn-regime.test.ts`in birebir ikizi ve aynı gerekçeyle var: kural bir
// bileşenin içindeki `&&` zinciri olsaydı tersine çevrilmesi HİÇBİR testi
// kırmazdı — üretici fabrikada (ticaret.enabled KAPALI) alış siparişi karosu
// belirir ve "sıfır görünür fark" garantisi sessizce düşerdi.
//
// ⚠️ ÜÇÜNCÜ KONTROL LOAD-BEARING: yüklem `financeEnabled`e BAKMAMALI. Alış
// siparişi 2026-09-02'ye kadar `finance.enabled`'a asılıydı; taşıma sırasında
// eski alanı da okuyan bir "ikisi de açık olsun" yazımı, ön muhasebeyi
// kullanmayan bir ticaret müşterisinde ekranı sessizce kaybettirirdi.
// =============================================================================
import { describe, expect, it } from "vitest";
import { isPurchaseOrdersVisible } from "./po-regime";

describe("rejim", () => {
  it("fabrikada (ticaret modülü kapalı) GÖRÜNMEZ", () => {
    expect(isPurchaseOrdersVisible({ ticaretEnabled: false })).toBe(false);
  });

  it("ticaret modülü açıkken görünür", () => {
    expect(isPurchaseOrdersVisible({ ticaretEnabled: true })).toBe(true);
  });

  it("⭐ yüklem `financeEnabled`e BAKMAZ — alış siparişi ön muhasebeden bağımsızdır", () => {
    // ⚠️ Değişkene alınıyor: doğrudan nesne literali TS'in "fazla alan"
    // denetimine takılır; ölçülen şey yüklemin finans alanına HİÇ bakmadığıdır.
    const financeOff = { ticaretEnabled: true, financeEnabled: false };
    expect(isPurchaseOrdersVisible(financeOff)).toBe(true);
    const financeOn = { ticaretEnabled: false, financeEnabled: true };
    expect(isPurchaseOrdersVisible(financeOn)).toBe(false);
  });

  it("karo bağlamının FAZLA alanları kararı etkilemez (yapısal tip)", () => {
    // tile-config'in geniş bağlamı bu şekli sağlar; yüklem yalnız bayrağa bakar.
    const ctx = { ticaretEnabled: false, iplikEnabled: true, pendingPlannedShipments: 3 };
    expect(isPurchaseOrdersVisible(ctx)).toBe(false);
  });
});
