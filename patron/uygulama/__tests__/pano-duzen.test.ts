// Pano kişiselleştirme (saf): düzen temizliği · taşıma · varsayılan · kutu görünümü · yetenek fail-closed.
import { erpYetenek } from "../src/api/yetenek";
import { duzenAnahtari, tasi, temizDuzen, varsayilanDuzen } from "../src/ui/pano/duzen";
import { kutuGorunum, MOBILDE_YOK } from "../src/ui/pano/kutu-gorunum";

describe("pano düzeni", () => {
  const known = new Set(["a", "b", "c"]);
  it("kayıt temizlenir: bilinmeyen, tekrar ve string dışı düşer; bozuk kayıt null", () => {
    expect(temizDuzen(["b", "x", "b", 3, "a"], known)).toEqual(["b", "a"]);
    expect(temizDuzen("a,b", known)).toBeNull();
    expect(temizDuzen(undefined, known)).toBeNull();
    expect(temizDuzen([], known)).toEqual([]);
  });
  it("taşıma sınırda değişmez", () => {
    expect(tasi(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(tasi(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(tasi(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
    expect(tasi(["a", "b"], "z", 1)).toEqual(["a", "b"]);
  });
  it("varsayılan = katalogdaki varsayılan kutular, katalog sırasıyla; anahtar kapsam başına", () => {
    expect(varsayilanDuzen([{ anahtar: "a", baslik: "A", varsayilan: true }, { anahtar: "b", baslik: "B", varsayilan: false }, { anahtar: "c", baslik: "C", varsayilan: true }])).toEqual(["a", "c"]);
    expect(duzenAnahtari("erp|x|u1")).toBe("patron.pano.erp|x|u1");
  });
});

describe("kutu görünümü", () => {
  it("değer ve eğilim fabrikadan; uygulama hesaplamaz", () => {
    const g = kutuGorunum("uretim", { metre: { deger: 4200, degisimYuzde: -5 }, top: { deger: 38 } });
    expect(g?.value).toBe("4.200");
    expect(g?.trend?.direction).toBe("down");
  });
  it("veri yok / tanınmayan kutu null; grafik kutuları mobilde yok", () => {
    expect(kutuGorunum("uretim", null)).toBeNull();
    expect(kutuGorunum("bilinmeyen", {})).toBeNull();
    expect(MOBILDE_YOK.has("egilim")).toBe(true);
  });
  it("yalnız satırlı kutu değer taşımaz", () => {
    expect(kutuGorunum("bekleyen", { onayBekleyenBelge: { toplam: 2 }, sevkeHazir: null })?.value).toBeNull();
  });
});

describe("yetenek pano", () => {
  it("eski fabrika alan vermez → yerel pano (fail-closed)", () => {
    expect(erpYetenek([], [], 1, false, 1, undefined).pano).toBe(false);
    expect(erpYetenek([], [], 1, false, 1, undefined, "1").pano).toBe(false);
    expect(erpYetenek([], [], 1, false, 1, undefined, 1).pano).toBe(true);
  });
});
