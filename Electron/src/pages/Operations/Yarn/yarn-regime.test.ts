// =============================================================================
// İPLİK KG-STOK GÖRÜNÜRLÜĞÜ — BEKÇİ
// =============================================================================
// Kural bir bileşenin içindeki `&&` zinciri olsaydı tersine çevrilmesi hiçbir
// testi kırmazdı: fabrikada (finance.enabled KAPALI) ticaret ekranı belirir ve
// "sıfır görünür fark" garantisi sessizce düşerdi. Bu dosyanın tek işi o
// sessizliği imkânsız kılmak.
//
// ⚠️ Ayrıca hareket türü sözlüğü de burada kilitlenir: işaret TÜRDEN okunur.
// `YARN_KIND_META` ile backend `yarnMovementSign` ayrışırsa ekran hareketi ters
// yönde anlatır — rakam doğru, cümle yalan olur.
//
// ⚠️ Üçüncü kural: BOŞ LİSTE MESAJI. Varsayılan süzgeç (“yalnız bakiyesi
// olanlar”) AÇIK olduğu için boş liste “hiç kayıt yok” demek değildir; o cümle
// kurulursa kullanıcı kaydın sistemde olmadığı sonucuna varıp İKİNCİ KEZ girer.
// =============================================================================
import { describe, expect, it } from "vitest";
import { isYarnStockVisible } from "./yarn-regime";
import { YARN_KINDS, YARN_KIND_META } from "./service";
import { EMPTY_YARN_FILTERS, yarnEmptyStateMessage } from "./YarnFilterBar";

describe("rejim", () => {
  it("fabrikada (finance kapalı) GÖRÜNMEZ", () => {
    expect(isYarnStockVisible({ financeEnabled: false })).toBe(false);
  });

  it("ticaret kurulumunda görünür", () => {
    expect(isYarnStockVisible({ financeEnabled: true })).toBe(true);
  });

  it("karo bağlamının FAZLA alanları kararı etkilemez (yapısal tip)", () => {
    // tile-config'in geniş bağlamı bu şekli sağlar; yüklem yalnız bayrağa bakar.
    const ctx = { financeEnabled: false, multiWarehouse: true, pendingPlannedShipments: 3 };
    expect(isYarnStockVisible(ctx)).toBe(false);
  });
});

describe("hareket türü sözlüğü", () => {
  it("dört tür de tanımlı ve işareti backend ile aynı", () => {
    expect(YARN_KINDS).toEqual(["IN", "OUT", "ADJUST_IN", "ADJUST_OUT"]);
    expect(YARN_KIND_META.IN.sign).toBe(1);
    expect(YARN_KIND_META.ADJUST_IN.sign).toBe(1);
    expect(YARN_KIND_META.OUT.sign).toBe(-1);
    expect(YARN_KIND_META.ADJUST_OUT.sign).toBe(-1);
  });

  it("yalnız ADJUST_* sayım düzeltmesidir (sebep alanı ona göre öne çıkar)", () => {
    expect(YARN_KIND_META.ADJUST_IN.adjustment).toBe(true);
    expect(YARN_KIND_META.ADJUST_OUT.adjustment).toBe(true);
    expect(YARN_KIND_META.IN.adjustment).toBe(false);
    expect(YARN_KIND_META.OUT.adjustment).toBe(false);
  });

  it("her türün etiketi işaretini METİN olarak da taşır (renk tek başına yetmez)", () => {
    for (const k of YARN_KINDS) {
      const m = YARN_KIND_META[k];
      expect(m.label).toContain(m.sign > 0 ? "+" : "−");
      expect(m.hint.length).toBeGreaterThan(10);
    }
  });
});

describe("boş liste mesajı", () => {
  it("VARSAYILAN süzgeçte “hiç kayıt yok” DEMEZ — süzgeci adıyla söyler", () => {
    // Varsayılan `onlyNonZero=true` bir DARALTMADIR: sıfır bakiyeli kalemler
    // gizlidir. "Henüz iplik stok hareketi yok" cümlesi burada YALANDIR.
    const msg = yarnEmptyStateMessage(EMPTY_YARN_FILTERS);
    expect(msg).toContain("Yalnız bakiyesi olanlar");
    expect(msg).not.toContain("Henüz iplik stok hareketi yok");
  });

  it("süzgeç GERÇEKTEN kapalıyken “hiç kayıt yok” diyebilir", () => {
    const msg = yarnEmptyStateMessage({ ...EMPTY_YARN_FILTERS, onlyNonZero: false });
    expect(msg).toContain("Henüz iplik stok hareketi yok");
  });

  it("kutuyu KALDIRMAK “filtreleri temizleyin” tavsiyesi doğurmaz (o, listeyi genişletir)", () => {
    // Kutuyu kaldırmak varsayılandan bir SAPMADIR ama daraltma DEĞİLDİR;
    // "filtreleri temizleyin" demek kullanıcıyı listeyi yeniden daraltmaya
    // gönderirdi. Bu satır `isYarnFilterDirty`e geri dönülürse kırmızı verir.
    const msg = yarnEmptyStateMessage({ ...EMPTY_YARN_FILTERS, onlyNonZero: false });
    expect(msg).not.toContain("Filtreleri temizleyip");
  });

  it("kullanıcı filtresi varken “hiç kayıt yok” DEMEZ (kayıt sonraki filtrede olabilir)", () => {
    const withSearch = yarnEmptyStateMessage({ ...EMPTY_YARN_FILTERS, onlyNonZero: false, search: "pamuk" });
    expect(withSearch).not.toContain("Henüz iplik stok hareketi yok");
    const withItem = yarnEmptyStateMessage({ ...EMPTY_YARN_FILTERS, itemId: "abc" });
    expect(withItem).toContain("Yalnız bakiyesi olanlar");
  });
});
