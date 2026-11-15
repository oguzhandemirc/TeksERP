// Pano kişiselleştirme (saf): düzen temizliği · taşıma · varsayılan · kutu görünümü · yetenek fail-closed.
import { erpYetenek } from "../src/api/yetenek";
import { duzenAnahtari, gizliyiKoru, tasi, temizDuzen, varsayilanDuzen } from "../src/ui/pano/duzen";
import { kutuGorunum, MOBILDE_YOK } from "../src/ui/pano/kutu-gorunum";
import { pct, pctOfCount } from "../src/ui/pano/read";

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

describe("gizli kutu korunur (kapalı modül)", () => {
  const g = new Set(["v"]);
  it("gizli kutu önceki komşusunun arkasına geri konur; komşusu yoksa başa; gizli olmayan düşen düşer", () => {
    expect(gizliyiKoru(["a", "v", "b"], ["a"], g)).toEqual(["a", "v"]);
    expect(gizliyiKoru(["a", "v", "b"], ["b", "a"], g)).toEqual(["b", "a", "v"]);
    expect(gizliyiKoru(["v", "a"], ["a", "c"], g)).toEqual(["v", "a", "c"]);
    expect(gizliyiKoru(["a", "b"], ["b"], g)).toEqual(["b"]);
  });
  it("art arda gizliler sırasını korur; tekrar eklenmez", () => {
    const g2 = new Set(["v", "w"]);
    expect(gizliyiKoru(["a", "v", "w", "b"], ["b", "a"], g2)).toEqual(["b", "a", "v", "w"]);
    expect(gizliyiKoru(["a", "v"], ["a", "v"], g)).toEqual(["a", "v"]);
  });
});

describe("kutu görünümü", () => {
  it("değer ve eğilim fabrikadan; uygulama hesaplamaz", () => {
    const g = kutuGorunum("uretim", { metre: { deger: 4200, degisimYuzde: -5 }, top: { deger: 38 } });
    expect(g?.value).toBe("4.200");
    expect(g?.trend?.direction).toBe("down");
  });
  it("eğilim Türkçe yüzde biçimi: işaret en başta (-%100, +%12,5); önceki dönem 0 iken yüzde yok", () => {
    expect(kutuGorunum("uretim", { metre: { deger: 0, onceki: 30, degisimYuzde: -100 } })?.trend?.text).toBe("-%100 önceki döneme göre");
    expect(kutuGorunum("uretim", { metre: { deger: 45, onceki: 40, degisimYuzde: 12.5 } })?.trend?.text).toBe("+%12,5 önceki döneme göre");
    expect(kutuGorunum("uretim", { metre: { deger: 5, onceki: 0, degisimYuzde: 100 } })?.trend).toBeUndefined();
    expect(kutuGorunum("uretim", { metre: { deger: 5, onceki: 0, degisimYuzde: null } })?.trend).toBeUndefined();
  });
  it("pct işareti yüzde işaretinden önce; pctOfCount paydasız oranda —", () => {
    expect(pct(-12.5)).toBe("-%12,5");
    expect(pct(0)).toBe("%0");
    expect(pct(7, true)).toBe("+%7");
    expect(pct(null)).toBe("—");
    expect(pctOfCount(0, 0)).toBe("—");
    expect(pctOfCount(0, undefined)).toBe("—");
    expect(pctOfCount(80, 5)).toBe("%80");
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
