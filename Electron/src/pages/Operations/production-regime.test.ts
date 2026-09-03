// =============================================================================
// BEKÇİ — ÜRETİM OPERASYON KAROLARI `production.enabled`'a BAĞLI
// =============================================================================
// ⭐ İKİ İDDİA:
//   ① Modül kapalıyken üç karo da çizilmez (backend zaten 403 veriyor).
//   ② Modül AÇIKKEN üçü de çizilir — "sıfır görünür fark"ın karo ayağı:
//      fabrikada `production.enabled` AÇIK, yani bugünkü menü DEĞİŞMEZ.
// Kural bir bileşen içindeki `&&` zincirinde bırakılsaydı tersine çevrilmesi
// hiçbir testi kırmazdı.
// =============================================================================
import { describe, expect, it } from "vitest";
import {
  isKursunPlanningVisible,
  isProductBalanceVisible,
  isWorkOrdersVisible,
} from "./production-regime";
import { operationsTiles } from "./tile-config";

const YUKLEMLER = [
  ["isWorkOrdersVisible", isWorkOrdersVisible],
  ["isProductBalanceVisible", isProductBalanceVisible],
  ["isKursunPlanningVisible", isKursunPlanningVisible],
] as const;

describe("üretim rejimi — saf yüklemler", () => {
  it.each(YUKLEMLER)("%s: modül KAPALIYKEN false", (_ad, fn) => {
    expect(fn({ productionEnabled: false })).toBe(false);
  });

  it.each(YUKLEMLER)("%s: modül AÇIKKEN true (fabrika varsayılanı)", (_ad, fn) => {
    expect(fn({ productionEnabled: true })).toBe(true);
  });

  it("⭐ yüklemler BAŞKA hiçbir alana bakmaz (yapısal tip)", () => {
    // Değişkene alınıyor: doğrudan nesne literali TS'in "fazla alan"
    // denetimine takılır; ölçülen şey kararın yalnız tek bayraktan gelmesidir.
    const ctx = {
      productionEnabled: true,
      financeEnabled: false,
      ticaretEnabled: false,
      depoMultiEnabled: false,
    };
    for (const [, fn] of YUKLEMLER) expect(fn(ctx)).toBe(true);
  });
});

describe("karolara bağlanma (kimlik)", () => {
  const tile = (key: string) => operationsTiles.find((t) => t.key === key);

  it.each([
    ["work-orders", isWorkOrdersVisible],
    ["product-balance", isProductBalanceVisible],
    ["kursun-dagitim", isKursunPlanningVisible],
  ] as const)("%s karosu yüklemi TAŞIR (sarmalayan ok fonksiyonu yok)", (key, fn) => {
    // Kimlik: palet girişi karonun AYNI fonksiyon nesnesini taşımak zorunda
    // (`tile-visibility.test`); sarmalayan bir ok fonksiyonu o bağı koparır.
    expect(tile(key)?.visibleWhen).toBe(fn);
  });

  it("izin kapıları KORUNDU — rejim onların yerine geçmez", () => {
    expect(tile("work-orders")?.permission).toBe("workorder:read");
    expect(tile("product-balance")?.permission).toBe("workorder:read");
    expect(tile("kursun-dagitim")?.permissionAny).toEqual([
      "quality:write",
      "workorder:distribute",
    ]);
  });
});
