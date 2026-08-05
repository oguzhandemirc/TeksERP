import { describe, expect, it } from "vitest";
import {
  headerState,
  isSelected,
  toggleAll,
  toggleOne,
  visibleSelection,
} from "./selection";

describe("toggleOne", () => {
  it("seçili değilse ekler, seçiliyse çıkarır", () => {
    expect(toggleOne([], "a")).toEqual(["a"]);
    expect(toggleOne(["a"], "a")).toEqual([]);
    expect(toggleOne(["a", "b"], "b")).toEqual(["a"]);
  });

  it("girdi dizisini MUTASYONA UĞRATMAZ (React state güvenliği)", () => {
    const sel = ["a"];
    const next = toggleOne(sel, "b");
    expect(sel).toEqual(["a"]);
    expect(next).not.toBe(sel);
  });
});

describe("toggleAll", () => {
  it("hiçbiri seçili değilken hepsini ekler", () => {
    expect(toggleAll([], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("hepsi seçiliyken hepsini bırakır", () => {
    expect(toggleAll(["a", "b"], ["a", "b"])).toEqual([]);
  });

  it("KISMİ seçimde eksikleri TAMAMLAR (bırakmaz)", () => {
    // Kritik davranış: yarım seçiliyken kutuya basmak "hepsini seç" demektir.
    // Tersi (bırakmak) olsaydı, 9/10 seçtikten sonra kutuya basan kullanıcı
    // tüm seçimini kaybederdi.
    expect(toggleAll(["a"], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("KAPSAM DIŞI seçimlere dokunmaz", () => {
    // "x" başka bir sekmenin satırı — bu sekmenin "tümünü seç"i onu silmemeli.
    expect(toggleAll(["x", "a", "b"], ["a", "b"])).toEqual(["x"]);
    expect(toggleAll(["x"], ["a"])).toEqual(["x", "a"]);
  });

  it("boş kapsamda hiçbir şey yapmaz", () => {
    expect(toggleAll(["a"], [])).toEqual(["a"]);
  });
});

describe("headerState", () => {
  it("üç durumu ayırır", () => {
    expect(headerState([], ["a", "b"])).toBe("none");
    expect(headerState(["a"], ["a", "b"])).toBe("some");
    expect(headerState(["a", "b"], ["a", "b"])).toBe("all");
  });

  it("boş listede 'none' (kutu işaretli görünmesin)", () => {
    expect(headerState(["a"], [])).toBe("none");
  });

  it("kapsam dışı seçim 'all' YAPMAZ", () => {
    // Seçimde 2 eleman var ama ikisi de bu sekmede değil → kutu boş olmalı.
    expect(headerState(["x", "y"], ["a"])).toBe("none");
  });
});

describe("visibleSelection", () => {
  it("yalnız GÖRÜNEN satırları döner ve LİSTE sırasını korur", () => {
    // Sıra listeden gelir, seçim sırasından DEĞİL: toplu payload'ın ekrandaki
    // sırayla aynı olması, hata raporunu okunur kılar.
    expect(visibleSelection(["c", "a"], ["a", "b", "c"])).toEqual(["a", "c"]);
  });

  it("ekranda olmayan seçimi ELER", () => {
    // Liste yenilendi ve satır başka sekmeye geçti → o satır üzerinde toplu
    // işlem yapmak sessizce yanlış olurdu.
    expect(visibleSelection(["x"], ["a", "b"])).toEqual([]);
  });
});

describe("isSelected", () => {
  it("üyelik sorar", () => {
    expect(isSelected(["a"], "a")).toBe(true);
    expect(isSelected(["a"], "b")).toBe(false);
  });
});
