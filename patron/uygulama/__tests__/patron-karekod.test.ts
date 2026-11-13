// Patron karekodu sözleşmesi — uygulama ucu. Vektörler panelle ORTAK dosyadan; biçim modülü panelin ikizi (bayt-eşit).
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { patronAdresiDenetle, patronKarekoduOku, patronKarekoduYap } from "../src/lib/patron-karekod";

const PANEL = resolve(__dirname, "../../../Electron/shared");
interface Vektorler {
  adres: Array<{ girdi: string; adres?: string; neden?: string }>;
  karekod: Array<{ adres: string; metin: string | null }>;
  okuma: Array<{ metin: string; adres?: string; neden?: string }>;
}
// Panel kaynağı yoksa (tek proje kopyası) GÜRÜLTÜLÜ düşer: sessiz atlama sözleşmeyi ölçmeden yeşil verirdi.
const V = JSON.parse(readFileSync(resolve(PANEL, "patron-karekod.vectors.json"), "utf8")) as Vektorler;
const beklenen = (v: { adres?: string; neden?: string }) => (v.adres !== undefined ? { tamam: true, adres: v.adres } : { tamam: false, neden: v.neden });

describe("patron karekodu — ikiz", () => {
  it("panel kaynağı var ve uygulama kopyası BAYT-EŞİT", () => {
    expect(existsSync(resolve(PANEL, "patron-karekod.ts"))).toBe(true);
    expect(readFileSync(resolve(__dirname, "../src/lib/patron-karekod.ts"), "utf8")).toBe(readFileSync(resolve(PANEL, "patron-karekod.ts"), "utf8"));
  });
});

describe("patron karekodu — ortak vektörler", () => {
  it("vektör dosyası dolu", () => {
    expect(V.adres.length).toBeGreaterThan(10);
    expect(V.okuma.length).toBeGreaterThan(10);
  });
  it.each(V.adres)("adres $girdi", (v) => expect(patronAdresiDenetle(v.girdi)).toEqual(beklenen(v)));
  it.each(V.karekod)("karekod $adres", (v) => expect(patronKarekoduYap(v.adres)).toBe(v.metin));
  it.each(V.okuma)("okuma $metin", (v) => expect(patronKarekoduOku(v.metin)).toEqual(beklenen(v)));
});
