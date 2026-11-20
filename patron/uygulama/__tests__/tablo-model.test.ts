// Ortak veri tablosu modeli (D7): tercih normalizasyonu, başlık dokunuş döngüsü, sıralama seçenekleri.
import { basligaDokun, normalizeTercih, siralamaSecenekleri, VARSAYILAN_TERCIH, type TabloSutunu } from "../src/ui/tablo/model";

type R = { no: string; tutar: string; termin: string };
const SUTUNLAR: readonly TabloSutunu<R>[] = [
  { anahtar: "no", etiket: "No", tur: "metin", deger: (r) => r.no, sabit: true },
  { anahtar: "tutar", etiket: "Tutar", tur: "sayi", deger: (r) => r.tutar },
  { anahtar: "termin", etiket: "Termin", tur: "tarih", deger: (r) => r.termin },
];
const SIRALANABILIR = ["no", "termin"];

describe("tablo modeli", () => {
  it("bozuk/bilinmeyen tercih sessizce varsayılana düşer", () => {
    expect(normalizeTercih(null, SUTUNLAR as never, SIRALANABILIR)).toEqual(VARSAYILAN_TERCIH);
    expect(normalizeTercih([1], SUTUNLAR as never, SIRALANABILIR)).toEqual(VARSAYILAN_TERCIH);
    // Sıralanamayan alan düşer (yön de sıfırlanır); sabit + bilinmeyen sütun gizlenemez; tekrarlar tekilleşir.
    expect(normalizeTercih({ sirala: "tutar", yon: "azalan", gizli: ["no", "yok", "tutar", "tutar"] }, SUTUNLAR as never, SIRALANABILIR)).toEqual({ sirala: null, yon: "artan", gizli: ["tutar"] });
    expect(normalizeTercih({ sirala: "termin", yon: "azalan", gizli: [] }, SUTUNLAR as never, SIRALANABILIR)).toEqual({ sirala: "termin", yon: "azalan", gizli: [] });
  });

  it("başlığa dokunuş: artan → azalan → varsayılan; başka alan artandan başlar", () => {
    const a = basligaDokun(VARSAYILAN_TERCIH, "termin");
    expect(a).toMatchObject({ sirala: "termin", yon: "artan" });
    const b = basligaDokun(a, "termin");
    expect(b).toMatchObject({ sirala: "termin", yon: "azalan" });
    expect(basligaDokun(b, "termin")).toMatchObject({ sirala: null, yon: "artan" });
    expect(basligaDokun(b, "no")).toMatchObject({ sirala: "no", yon: "artan" });
  });

  it("sıralama seçenekleri yalnız sunucunun beyan ettiği alanlar (varsayılan ilk)", () => {
    const s = siralamaSecenekleri(SUTUNLAR, SIRALANABILIR);
    expect(s.map((x) => x.key)).toEqual(["", "no:artan", "no:azalan", "termin:artan", "termin:azalan"]);
    expect(s[3]!.label).toBe("Termin (eskiden yeniye)");
  });
});
