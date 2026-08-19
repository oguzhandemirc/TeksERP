import { describe, it, expect } from "vitest";
import { foldSearchText, foldedIncludes } from "./search-fold";

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
});
