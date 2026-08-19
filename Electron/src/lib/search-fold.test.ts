import { describe, it, expect } from "vitest";
import {
  foldSearchText,
  foldSearchTerm,
  foldSearchTokens,
  foldedIncludes,
} from "./search-fold";

describe("arama katlaması", () => {
  it("Türkçe ↔ ASCII: canakkale ≡ çanakkale", () => {
    expect(foldSearchText("ÇANAKKALE")).toBe("canakkale");
    expect(foldSearchText("canakkale")).toBe("canakkale");
    expect(foldedIncludes("ÇANAKKALE TEKSTİL", "canakkale")).toBe(true);
    expect(foldedIncludes("Canakkale Tekstil", "çanakkale")).toBe(true);
  });

  it("İ TUZAĞI: düz toLowerCase burada bozulur", () => {
    // "ŞAHİN".toLowerCase() → "şahi̇n" (i + U+0307 birleştirici nokta) ve
    // "sahin" ile EŞLEŞMEZ. Görünüşte aynı, bayt olarak farklı.
    expect("ŞAHİN".toLowerCase().includes("sahin")).toBe(false); // hatanın kanıtı
    expect(foldedIncludes("ŞAHİN TEKSTİL", "sahin")).toBe(true); // düzeltilmiş
  });

  it("ı ve i aynı harfe iner (ikisi de aranabilir)", () => {
    expect(foldSearchText("IŞIK")).toBe("isik");
    expect(foldedIncludes("IŞIK", "isik")).toBe(true);
    expect(foldedIncludes("Işık", "ISIK")).toBe(true);
  });

  it("tüm Türkçe harfler kapsanır", () => {
    expect(foldSearchText("ÇĞIİÖŞÜ")).toBe("cgiiosu");
    expect(foldSearchText("çğıiöşü")).toBe("cgiiosu");
  });

  it("boş arama süzgeci yok sayar (tüm kayıtlar eşleşir)", () => {
    expect(foldedIncludes("herhangi", "   ")).toBe(true);
  });

  it("null/undefined alan çökmez, eşleşmez", () => {
    expect(foldedIncludes(null, "x")).toBe(false);
    expect(foldedIncludes(undefined, "x")).toBe(false);
  });

  it("alakasız terim eşleşmez (katlama her şeyi eşitlemiyor)", () => {
    // Körlük kontrolü: fold çok agresif olsaydı bu da true dönerdi.
    expect(foldedIncludes("ÇANAKKALE", "bursa")).toBe(false);
  });

  it("REGRESYON SINIFI: iğneye ön işlem uygulamak katlamayı boşa düşürür", () => {
    // 2026-08-19'a kadar beş ekran `foldedIncludes(alan, search.toLowerCase())`
    // yazıyordu. Büyük İ içeren HER arama 0 satır dönüyordu ve testler yeşildi
    // çünkü hepsi küçük harfli iğne kullanıyordu.
    expect(foldedIncludes("ŞAHİN TEKSTİL", "ŞAHİN")).toBe(true);
    expect(foldedIncludes("İSTASYON 3", "İSTASYON")).toBe(true);
    // Kirli girdi bile kurtarılır (katlama U+0307'yi de siler):
    expect(foldedIncludes("ŞAHİN TEKSTİL", "ŞAHİN".toLowerCase())).toBe(true);
  });

  it("yabancı harfler: sunucudaki tr_fold ile aynı karşılıklar", () => {
    expect(foldSearchText("Großmann")).toBe(foldSearchText("GROSSMANN"));
    expect(foldSearchText("Ø")).toBe("o");
    expect(foldSearchText("Æ")).toBe("ae");
  });

  it("boşluk teklenir ve kırpılır (çok kelimeli arama için)", () => {
    expect(foldSearchText("  ÖZ   ŞAHİN  ")).toBe("oz sahin");
    expect(foldSearchTokens(" ŞAHİN  tekstil ")).toEqual(["sahin", "tekstil"]);
  });

  it("LIKE jokerleri terimden düşer (sunucuya giden değer)", () => {
    expect(foldSearchTerm("%öz_şahin")).toBe("ozsahin");
  });

  it("katlama SIRALAMA aracı değildir", () => {
    // Türkçede Ç bütün C'lerden sonra gelir; katlanmış anahtar onu öne atar.
    const byFold = ["Ceyhan", "Çanakkale", "Cebeci"].sort((a, b) =>
      foldSearchText(a) < foldSearchText(b) ? -1 : 1,
    );
    expect(byFold[0]).toBe("Çanakkale"); // yanlış sıra — bilerek kanıtlanıyor
    const byTr = ["Ceyhan", "Çanakkale", "Cebeci"].sort((a, b) => a.localeCompare(b, "tr"));
    expect(byTr[2]).toBe("Çanakkale"); // doğru sıra
  });
});
