// =============================================================================
// STOK SAYIMI GÖRÜNÜRLÜĞÜ — BEKÇİ
// =============================================================================
// Kural bir bileşenin içindeki `&&` zinciri olsaydı tersine çevrilmesi hiçbir
// testi kırmazdı: fabrikada (`finance.enabled` KAPALI) ticaret ekranı belirir ve
// "sıfır görünür fark" garantisi sessizce düşerdi. Bu dosyanın ilk işi o
// sessizliği imkânsız kılmak.
//
// İKİNCİ İŞİ — DİKİŞ MANDALI: karo (`tile-config`) ve komut paleti girişi bu
// pakette YAZILMADI (paylaşılan dosyalar; dikişi ana oturum atıyor). Aşağıdaki
// son blok, dikiş atıldığı GÜN kendiliğinden bağlayıcı olur: karo varsa yüklemi
// AYNI FONKSİYON NESNESİ olmak zorundadır. Kopyalanmış ikinci bir kural (ör.
// `(ctx) => ctx.financeEnabled`) hem palet paritesi bekçisini (`entry.visibleWhen
// === tile.visibleWhen`) hem burayı düşürür.
//
// ⚠️ DİKİŞ ATILIRKEN `tile-visibility.test.ts` içindeki KOŞULLU KARO LİSTESİ de
// aynı değişiklikte genişletilmeli (`"stock-counts"`): o liste açıkça sayılıdır
// ve karo eklenince bekçi anında kırmızı verir. Kırmızıya doğru tepki karoyu
// koşulsuz yapmak DEĞİL, listeye yazmaktır.
// =============================================================================
import { describe, expect, it } from "vitest";
import { commandSections } from "@/components/layout/command-entries";
import { operationsTiles } from "../tile-config";
import { STOCK_COUNTS_PATH, isStockCountVisible, stockCountPath } from "./stockCount-regime";

describe("rejim", () => {
  it("⭐ fabrikada (finance kapalı) GÖRÜNMEZ", () => {
    expect(isStockCountVisible({ financeEnabled: false })).toBe(false);
  });

  it("ticaret kurulumunda görünür", () => {
    expect(isStockCountVisible({ financeEnabled: true })).toBe(true);
  });

  it("karo bağlamının FAZLA alanları kararı etkilemez (yapısal tip)", () => {
    // tile-config'in geniş bağlamı bu şekli sağlar; yüklem YALNIZ bayrağa bakar.
    // Depo sayısı bilerek sınanıyor: "çok depolu fabrika" da bir fabrikadır ve
    // orada bu ekran görünmemeli (Depo Transferi karosunun kuralı BAŞKADIR).
    const factory = { financeEnabled: false, multiWarehouse: true, pendingPlannedShipments: 3 };
    expect(isStockCountVisible(factory)).toBe(false);
  });
});

describe("route yolu", () => {
  it("detay yolu liste yolundan TÜRETİLİR (elle yazılmış ikinci metin yok)", () => {
    expect(STOCK_COUNTS_PATH).toBe("/operations/stock-counts");
    expect(stockCountPath("abc")).toBe("/operations/stock-counts/abc");
  });
});

describe("dikiş mandalı — karo eklendiği gün bağlayıcı olur", () => {
  const tile = operationsTiles.find((t) => t.to === STOCK_COUNTS_PATH);

  it("karo varsa rejim yüklemini AYNEN taşır (kopya kural değil)", () => {
    if (!tile) {
      // Dikiş henüz atılmadı — bu satır o durumu GÖRÜNÜR kılar (sessiz atlama
      // yok). Karo eklendiği an aşağıdaki eşitlik bağlayıcı olur.
      expect(tile).toBeUndefined();
      return;
    }
    expect(tile.visibleWhen).toBe(isStockCountVisible);
  });

  it("karo varsa komut paleti girişi de AYNI yüklemi taşır", () => {
    if (!tile) {
      expect(tile).toBeUndefined();
      return;
    }
    const entry = commandSections
      .find((s) => s.heading === "Operasyon")
      ?.entries.find((e) => e.to === STOCK_COUNTS_PATH);
    expect(entry, "palet girişi yok — hub karosu var ama paletten açılamıyor").toBeDefined();
    expect(entry?.visibleWhen).toBe(isStockCountVisible);
  });
});
