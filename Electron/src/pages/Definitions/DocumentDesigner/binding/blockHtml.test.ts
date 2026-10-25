import { describe, expect, it } from "vitest";
import { barcodeHtml, dataFieldHtml, itemTableBlockHtml, logoHtml, pageBreakHtml, qrHtml, signatureHtml, totalBoxHtml } from "./blockHtml";
import { loadFixture } from "./testContract";

const { contract, settings } = loadFixture();
const el = (html: string): Element => new DOMParser().parseFromString(html, "text/html").body.firstElementChild!;

describe("blok → öznitelik", () => {
  it("veri alanı: data-alan + türden data-filtre", () => {
    const tarih = contract.kokler.find((f) => f.yol === "belge.tarih");
    const e = el(dataFieldHtml("belge.tarih", tarih));
    expect(e.getAttribute("data-alan")).toBe("belge.tarih");
    expect(e.getAttribute("data-filtre")).toBe("tarih");
    expect(el(dataFieldHtml("belge.no", contract.kokler[0])).hasAttribute("data-filtre")).toBe(false);
  });
  it("kalem tablosu: data-tablo + tr[data-each]", () => {
    const e = el(itemTableBlockHtml(contract));
    expect(e.getAttribute("data-tablo")).toBeTruthy();
    expect(e.querySelector("tr[data-each]")).not.toBeNull();
  });
  it("toplam kutusu yalnız toplamlar.*", () => {
    const paths = Array.from(el(totalBoxHtml(contract)).querySelectorAll("[data-alan]")).map((x) => x.getAttribute("data-alan")!);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.startsWith("toplamlar."))).toBe(true);
  });
  it("logo firma.logo'dan, görsel data: URI", () => {
    const e = el(logoHtml());
    expect(e.getAttribute("data-bag-src")).toBe("firma.logo");
    expect(e.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
  });
  it("barkod/QR filtreyle", () => {
    expect(el(barcodeHtml()).getAttribute("data-filtre")).toBe('barkod: "code128"');
    expect(el(qrHtml()).getAttribute("data-filtre")).toBe("qr");
  });
  it("imza alanı ayar.signatureLabels + ayar.showSignatures", () => {
    const e = el(signatureHtml(settings));
    expect(e.getAttribute("data-if")).toBe("ayar.showSignatures");
    expect(e.querySelector("[data-alan]")!.getAttribute("data-alan")).toBe("ayar.signatureLabels[0]");
    const bare = el(signatureHtml({}));
    expect(bare.hasAttribute("data-if")).toBe(false);
    expect(bare.querySelector("[data-alan]")).toBeNull();
  });
  it("sayfa kesmesi sınıfı", () => {
    expect(el(pageBreakHtml()).className).toBe("sayfa-kesmesi");
  });
});
