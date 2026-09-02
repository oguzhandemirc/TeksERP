import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * KİLİT EKRANININ ÇIKIŞ YOLU — sahada yaşanan çıkmazın bekçisi (2026-09-02).
 *
 * ⭐ OLAY: panel yanlış bir backend'e bağlandı, o backend `minVersion: 2.8.1`
 * dedi, panel 1.0.0'dı → kapı kapandı. Kapı kapatılamaz olduğu için adresi
 * değiştirecek ekrana ULAŞILAMIYORDU: oraya gitmek giriş yapmayı, giriş
 * ekranına dönmek kapıyı geçmeyi gerektiriyordu. Tek çıkış `secure.json`u elle
 * silmekti — operatörün yapamayacağı ve uzaktan yönlendirilemeyecek bir şey.
 *
 * ⭐ İDDİA: kilit ekranında adres değiştirme yolu VAR ve yalnız POLİTİKA
 * kilidinde. İndirilmiş güncelleme beklerken adres değiştirmenin anlamı yok.
 */
const src = readFileSync(
  resolve(process.cwd(), "src/components/layout/UpdateGate.tsx"),
  "utf-8",
);
const stripComments = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const kod = stripComments(src);

describe("kilit ekranı — çıkmaz kapısı", () => {
  it("adres diyaloğu kilit ekranından açılabiliyor", () => {
    expect(kod).toContain("ApiEndpointDialog");
    expect(kod).toMatch(/Sunucu adresini değiştir/);
  });

  it("⚠️ yalnız POLİTİKA kilidinde — güncelleme kapısında değil", () => {
    // ⚠️ ÇAPA DAR OLMALI: `paketBekleniyor ?` ifadesi ikonu seçen yerde de
    // geçiyor (AlertTriangle ↔ Download). İlk eşleşmeyi almak yanlış dalı
    // ölçer ve bekçi kendi hatasıyla kırmızı verir — ilk yazımda tam bu oldu.
    // Gövde dalı fragment (`<>`) ile başlar, ikon dalı bir bileşenle.
    const i = kod.indexOf("paketBekleniyor ? (\n          <>");
    const j = kod.indexOf("\n        ) : (", i);
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    const politikaDali = kod.slice(i, j);
    const guncellemeDali = kod.slice(j);
    expect(politikaDali).toContain("ApiEndpointDialog");
    expect(guncellemeDali).not.toContain("ApiEndpointDialog");
  });

  it("web panelinde gizli (adres orada sayfanın origin'i)", () => {
    expect(kod).toContain("IS_ELECTRON");
  });

  it("körlük zemini: dosya gerçekten okundu ve kapı hâlâ var", () => {
    expect(src.length).toBeGreaterThan(3000);
    expect(kod).toContain("isBelowMinimum");
    expect(kod).toContain("useClientPolicy");
  });
});
