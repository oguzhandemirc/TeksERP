import { moduleVisible, visibleCards, visibleModules } from "../src/lib/access";
import { canCancel, resultText } from "../src/lib/inbox";

const keys = (p: string[]) => visibleModules(p).map((m) => m.key);

describe("izin görünürlüğü (istemci yalnız gizler)", () => {
  it("izinsiz hesap yalnız pano + profil görür", () => {
    expect(keys(["bulut:oturum"])).toEqual(["pano", "profil"]);
  });
  it("satış şablonu: finans ve hesaplar YOK, gelen kutusu VAR", () => {
    const k = keys(["bulut:oturum", "bulut:ozet:oku", "bulut:siparis:oku", "bulut:sevkiyat:oku", "bulut:uretim:oku", "bulut:stok:oku", "bulut:rapor:oku", "bulut:cari:oku", "bulut:siparis:yaz", "bulut:cari:yaz"]);
    expect(k).toContain("gelen-kutusu");
    expect(k).not.toContain("finans");
    expect(k).not.toContain("hesaplar");
  });
  it("hesaplar yalnız tesis yöneticisine", () => {
    expect(moduleVisible(["bulut:hesap:yonet"], "hesaplar")).toBe(true);
    expect(moduleVisible(["bulut:siparis:oku"], "hesaplar")).toBe(false);
  });
  it("pano kartı gereken izinlerin HEPSİNİ ister", () => {
    expect(visibleCards(["bulut:siparis:oku"]).map((c) => c.projection)).toEqual([]);
    expect(visibleCards(["bulut:ozet:oku", "bulut:siparis:oku"]).map((c) => c.projection)).toEqual(["ozet.siparis"]);
    expect(visibleCards(["bulut:cari-bakiye:oku"]).map((c) => c.projection)).toEqual(["ozet-finans"]);
  });
});

describe("gelen kutusu kuralları", () => {
  it("iptal yalnız BEKLIYOR ve yazar", () => {
    expect(canCancel({ durum: "BEKLIYOR", hesapAdi: "A" }, { ad: "B", admin: false })).toBe(true);
    expect(canCancel({ durum: "ISLENIYOR", hesapAdi: "A" }, { ad: "A", admin: false })).toBe(false);
    expect(canCancel({ durum: "BEKLIYOR", hesapAdi: "A" }, { ad: "B", admin: true })).toBe(false);
    expect(canCancel({ durum: "BEKLIYOR", hesapAdi: "A" }, { ad: "A", admin: true })).toBe(true);
  });
  it("sonuç özeti", () => {
    expect(resultText({ belgeNo: "SP-12" })).toBe("Fabrika no: SP-12");
    expect(resultText({ kod: "CARI_YOK" })).toBe("Kod: CARI_YOK");
    expect(resultText(null)).toBeNull();
  });
});
