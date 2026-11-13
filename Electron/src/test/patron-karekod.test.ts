// Patron karekodu sözleşmesi — panel ucu. Vektörler uygulamayla ORTAK dosyadan; ikiz bayt eşitliğini uygulama testi ölçer.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { patronAdresiDenetle, patronKarekoduOku, patronKarekoduYap } from "@shared/patron-karekod";

interface Vektorler {
  adres: Array<{ girdi: string; adres?: string; neden?: string }>;
  karekod: Array<{ adres: string; metin: string | null }>;
  okuma: Array<{ metin: string; adres?: string; neden?: string }>;
}
const V = JSON.parse(readFileSync(resolve(__dirname, "../../shared/patron-karekod.vectors.json"), "utf8")) as Vektorler;
const beklenen = (v: { adres?: string; neden?: string }) => (v.adres !== undefined ? { tamam: true, adres: v.adres } : { tamam: false, neden: v.neden });

describe("patron karekodu — ortak vektörler", () => {
  it("vektör dosyası dolu (boş dosya sessiz yeşil vermesin)", () => {
    expect(V.adres.length).toBeGreaterThan(10);
    expect(V.okuma.length).toBeGreaterThan(10);
  });
  it.each(V.adres)("adres $girdi", (v) => expect(patronAdresiDenetle(v.girdi)).toEqual(beklenen(v)));
  it.each(V.karekod)("karekod $adres", (v) => expect(patronKarekoduYap(v.adres)).toBe(v.metin));
  it.each(V.okuma)("okuma $metin", (v) => expect(patronKarekoduOku(v.metin)).toEqual(beklenen(v)));
  it("üretilen her karekod geri okunur, adres korunur", () => {
    for (const v of V.adres.filter((x) => x.adres)) {
      const metin = patronKarekoduYap(v.girdi);
      expect(metin).not.toBeNull();
      expect(patronKarekoduOku(metin!)).toEqual({ tamam: true, adres: v.adres });
    }
  });
});
