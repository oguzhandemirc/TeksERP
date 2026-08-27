import { describe, it, expect } from "vitest";
import {
  MODAL_TAVAN,
  damgalanacakId,
  gosterilecekYayinlar,
  type SurumNotuYayini,
} from "./surum-notlari";

/** Test verisi — gerçek dosyadan bağımsız, senaryolar burada kurulur. */
function y(id: string, panel?: string, tablet?: string, kapsamlar: Array<"panel" | "tablet" | "her-ikisi"> = ["her-ikisi"]): SurumNotuYayini {
  return {
    id,
    baslik: `Yayın ${id}`,
    surumler: { ...(panel ? { panel } : {}), ...(tablet ? { tablet } : {}) },
    maddeler: kapsamlar.map((k) => ({ kapsam: k, tip: "yeni" as const, metin: `${k} maddesi` })),
  };
}

/** En yeni önce sıralı — dosyadaki sözleşmenin aynısı. */
const YAYINLAR: SurumNotuYayini[] = [
  y("2026-09-10", "2.9.0", "3.0.0"),
  y("2026-09-01", "2.8.5", undefined, ["panel"]),
  y("2026-08-28", "2.8.2", "2.9.9"),
  y("2026-08-20", "2.8.0", "2.9.5"),
];

describe("sürüm notları — gösterim kararı", () => {
  it("ilk kurulumda YALNIZ en yeni kayıt gösterilir", () => {
    // İki uç da yanlış: hiç göstermemek özelliği görünmez kılar, hepsini
    // basmak körleştirir.
    const { liste, gizlenen } = gosterilecekYayinlar(YAYINLAR, null, "2.9.0", "panel");
    expect(liste).toHaveLength(1);
    expect(liste[0]!.id).toBe("2026-09-10");
    expect(gizlenen).toBe(0);
  });

  it("sürüm atlayan makine aradaki TÜM yayınları görür", () => {
    // 2026-08-20'yi görmüş, 2.9.0'a atlamış → aradaki üç yayın yeni.
    const { liste } = gosterilecekYayinlar(YAYINLAR, "2026-08-20", "2.9.0", "panel");
    expect(liste.map((v) => v.id)).toEqual(["2026-09-10", "2026-09-01", "2026-08-28"]);
  });

  it("kurulu sürümü AŞAN kayıt gösterilmez — paket geleceğini duyurmaz", () => {
    const { liste } = gosterilecekYayinlar(YAYINLAR, "2026-08-20", "2.8.2", "panel");
    expect(liste.map((v) => v.id)).toEqual(["2026-08-28"]);
  });

  it("geri alma (işaret ileride) → boş, çökme yok", () => {
    const { liste, gizlenen } = gosterilecekYayinlar(YAYINLAR, "2026-12-31", "2.9.0", "panel");
    expect(liste).toHaveLength(0);
    expect(gizlenen).toBe(0);
  });

  it("kayıtlı işaret dosyadan silinmiş olsa bile mantık çalışır", () => {
    // String karşılaştırması indeks aramasından bu yüzden üstün.
    const { liste } = gosterilecekYayinlar(YAYINLAR, "2026-08-25", "2.9.0", "panel");
    expect(liste.map((v) => v.id)).toEqual(["2026-09-10", "2026-09-01", "2026-08-28"]);
  });

  it("bu ürünü ilgilendirmeyen tur sayılmaz", () => {
    // 2026-09-01 yalnız panel turu (tablet sürümü yok) → tablette görünmez.
    const { liste } = gosterilecekYayinlar(YAYINLAR, "2026-08-20", "3.0.0", "tablet");
    expect(liste.map((v) => v.id)).toEqual(["2026-09-10", "2026-08-28"]);
  });

  it("kapsam süzülür: panel, tablet maddesini görmez", () => {
    const karisik = [y("2026-10-01", "3.0.0", "3.0.0", ["panel", "tablet", "her-ikisi"])];
    const { liste } = gosterilecekYayinlar(karisik, "2026-01-01", "3.0.0", "panel");
    expect(liste[0]!.maddeler.map((m) => m.kapsam)).toEqual(["panel", "her-ikisi"]);
  });

  it("süzme sonrası maddesi kalmayan yayın listeye girmez (boş modal çıkmasın)", () => {
    const sadeceTablet = [y("2026-10-01", "3.0.0", "3.0.0", ["tablet"])];
    const { liste } = gosterilecekYayinlar(sadeceTablet, "2026-01-01", "3.0.0", "panel");
    expect(liste).toHaveLength(0);
  });

  it("tavan aşılırsa fazlası 'gizlenen' olarak raporlanır", () => {
    const cok: SurumNotuYayini[] = Array.from({ length: 9 }, (_, i) =>
      y(`2026-09-${String(20 - i).padStart(2, "0")}`, "2.9.0"),
    );
    const { liste, gizlenen } = gosterilecekYayinlar(cok, "2026-01-01", "2.9.0", "panel");
    expect(liste).toHaveLength(MODAL_TAVAN);
    expect(gizlenen).toBe(9 - MODAL_TAVAN);
  });

  it("tarih id'leri sözlüksel olarak kronolojik sıralanır", () => {
    // Aynı gün ikinci yayın ("-2" son eki) ve gün geçişi.
    expect("2026-08-28b" > "2026-08-28").toBe(true);
    expect("2026-08-29" > "2026-08-28b").toBe(true);
    expect("2026-09-01" > "2026-08-31").toBe(true);
  });
});

describe("damgalanacakId", () => {
  it("kurulu sürümü aşmayan en yeni yayını işaret eder", () => {
    expect(damgalanacakId(YAYINLAR, "2.8.2", "panel")).toBe("2026-08-28");
    expect(damgalanacakId(YAYINLAR, "2.9.0", "panel")).toBe("2026-09-10");
  });

  it("sürüm bilinmiyorsa damga atılmaz", () => {
    expect(damgalanacakId(YAYINLAR, null, "panel")).toBeNull();
  });
});
