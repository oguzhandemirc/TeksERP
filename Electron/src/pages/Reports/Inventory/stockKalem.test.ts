import { describe, expect, it } from "vitest";
import { toSheets } from "../_components/reportExport";
import { buildStockKalemExport, KALEM_SERVER_OUTDATED, kalemErrorText, type StockKalem } from "./stockKalem";

// Excel iki sayfa (Ham, Bitmiş); toplam satırı sunucunun toplamı — ekrandaki alt satırla aynı rakam.
const k: StockKalem = {
  totals: { hamCount: 3, hamQty: 180, bitmisCount: 4, bitmisQty: 147.5 },
  ham: [
    { key: "a", itemId: "a", itemName: "PATOS", count: 2, qty: 150 },
    { key: "b", itemId: "b", itemName: "SATEN", count: 1, qty: 30 },
  ],
  bitmis: [
    { key: "a|280|r|2-KAT", itemId: "a", itemName: "PATOS", width: 280, colorId: "r", colorName: "Kırmızı", foldType: "2-KAT", foldName: "2 Kat", count: 3, qty: 135.5 },
    { key: "b|||", itemId: "b", itemName: "SATEN", width: null, colorId: null, colorName: null, foldType: null, foldName: null, count: 1, qty: 12 },
  ],
};

describe("Stok kalem bazında dışa aktarım", () => {
  const sheets = toSheets(buildStockKalemExport(k));

  it("iki sayfa: Ham ve Bitmiş", () => {
    expect(sheets.map((s) => s.name)).toEqual(["Ham", "Bitmiş"]);
  });

  it("Ham: kumaş başına satır + sunucu toplamı", () => {
    const ham = sheets[0]!;
    expect(ham.columns.map((c) => c.header)).toEqual(["Kumaş", "Top", "Metre"]);
    expect(ham.rows).toEqual([
      { itemName: "PATOS", count: 2, qty: 150 },
      { itemName: "SATEN", count: 1, qty: 30 },
    ]);
    expect(ham.totalRow).toMatchObject({ count: 3, qty: 180 });
  });

  it("Bitmiş: kumaş+en+renk+kat kolonları, boş değer '—', sunucu toplamı", () => {
    const b = sheets[1]!;
    expect(b.columns.map((c) => c.header)).toEqual(["Kumaş", "En", "Renk", "Kat", "Top", "Metre"]);
    expect(b.rows[0]).toEqual({ itemName: "PATOS", width: "280 cm", colorName: "Kırmızı", foldName: "2 Kat", count: 3, qty: 135.5 });
    expect(b.rows[1]).toEqual({ itemName: "SATEN", width: "—", colorName: "—", foldName: "—", count: 1, qty: 12 });
    expect(b.totalRow).toMatchObject({ count: 4, qty: 147.5 });
  });

  it("tavan uyarısı her sayfanın üstüne düşer", () => {
    const s = toSheets(buildStockKalemExport(k, ["Bitmiş kalem kırılımı: kesildi"]));
    expect(JSON.stringify(s[1]!.preamble)).toContain("kesildi");
  });
});

// Panel 1.3.12 eski backend'e (2.11.6) bağlanırsa uç yok → 404; sekme çökmez, güncelleme ister.
describe("Kalem sekmesi hata cümlesi", () => {
  it("404 → sunucu güncellemesi gerekiyor", () => {
    expect(kalemErrorText({ response: { status: 404, data: { message: "Not found" } } })).toBe(KALEM_SERVER_OUTDATED);
  });
  it("diğer 4xx → sunucunun mesajı", () => {
    expect(kalemErrorText({ response: { status: 403, data: { message: "Bu modül kapalı." } } })).toBe("Bu modül kapalı.");
  });
  it("cevapsız (ağ) → ulaşılamıyor; mesajsız 5xx → genel cümle", () => {
    expect(kalemErrorText(new Error("Network Error"))).toBe("Sunucuya ulaşılamıyor.");
    expect(kalemErrorText({ response: { status: 500 } })).toBe("Kalem bazında rapor yüklenemedi.");
  });
});
