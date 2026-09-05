import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss, { type Declaration, type Rule } from "postcss";

/**
 * Kaydırma çubuğu (yatay + dikey) global kuralının bekçisi.
 *
 * Bu bekçi METİN ARAMAZ — `index.css`i gerçekten AYRIŞTIRIR (postcss) ve
 * kuralların CSSOM düzeyinde ne söylediğini ölçer: hangi seçici, hangi
 * bildirim, hangi @media/@supports bağlamında.
 *
 * Kilitlenen dört karar:
 *  ① **Tema rengi** — çubuk `--primary` token'ından beslenir. Kişiselleştirme
 *    accent'i runtime'da tam bu değişkene yazar (`PreferencesProvider`), yani
 *    sabit renk yazmak "seçilen tema rengi" vaadini sessizce bozar.
 *  ② **Sönük → belirgin, YOK → VAR değil** (erişilebilirlik). Duruşta görünür
 *    bir iz kalmalı: kaydırılabilirliğin tek kalıcı görsel işareti odur.
 *    Hover'ı olmayan cihazda (dokunmatik panel) iz kalıcı olarak belirgin.
 *  ③ **⚠️ Chromium tuzağı — kap hover'ı çubuğa ULAŞMAZ.** Ölçüldü (Chromium
 *    13x, headed, piksel karşılaştırması): `kap:hover::-webkit-scrollbar-thumb`
 *    kuralı çığlık kırmızısıyla yazıldığında bile HİÇ boyamıyor; Chromium özel
 *    çubuğun stilini yalnız elemanın kendi hesaplanmış stili değişince yeniden
 *    kuruyor. Bu yüzden hover, thumb'a değil elemanın `--scrollbar-thumb`
 *    DEĞİŞKENİNE yazılır (o yol ölçümde boyuyor). "Sadeleştirme" refleksiyle
 *    doğrudan hover'a çevrilirse özellik sessizce ölür → §6b onu kırmızı yapar.
 *  ④ **⚠️ Chromium tuzağı — standart özellikler.** Bir elemanda
 *    `scrollbar-width`/`scrollbar-color` tanımlıysa Chromium o elemanın TÜM
 *    ::-webkit-scrollbar kurallarını yok sayar; bu ikisi yalnız pseudo-element'i
 *    tanımayan motorlar (@supports dalı) ya da bilinçli gizleme
 *    (`.no-scrollbar`) için yazılabilir.
 */
const cssPath = resolve(process.cwd(), "src/index.css");
const root = postcss.parse(readFileSync(cssPath, "utf-8"), { from: cssPath });

interface CssRuleMeasurement {
  selector: string;
  decls: Record<string, string>;
  /** Kuralı saran at-kural zinciri: ["media (hover: hover)", …] */
  context: string[];
}

const kurallar: CssRuleMeasurement[] = [];
root.walkRules((rule: Rule) => {
  const decls: Record<string, string> = {};
  rule.each((node) => {
    if (node.type === "decl") decls[(node as Declaration).prop] = (node as Declaration).value;
  });
  const context: string[] = [];
  for (let p = rule.parent; p && p.type !== "root"; p = p.parent) {
    if (p.type === "atrule") {
      const at = p as unknown as { name: string; params: string };
      context.unshift(`${at.name} ${at.params}`.trim());
    }
  }
  for (const selector of rule.selectors) kurallar.push({ selector, decls, context });
});

const scrollbarKurallari = kurallar.filter((k) => k.selector.includes("-webkit-scrollbar"));
const bul = (selector: string, context: string[] = []) =>
  kurallar.find((k) => k.selector === selector && k.context.join("|") === context.join("|"));

/** `hsl(var(--primary) / 0.18)` → 0.18 */
function alfa(value: string | undefined): number {
  const m = /\/\s*([\d.]+)\s*\)/.exec(value ?? "");
  expect(m, `alfa okunamadı: ${value}`).toBeTruthy();
  return Number(m![1]);
}

const tabanDegisken = bul("*")?.decls["--scrollbar-thumb"];
const hoverDegisken = bul("*:hover", ["media (hover: hover)"])?.decls["--scrollbar-thumb"];

describe("global kaydırma çubuğu stili", () => {
  it("§1 global kural VAR ve iki ekseni de kapsar (dikey width + yatay height)", () => {
    const bar = bul("*::-webkit-scrollbar");
    expect(bar, "*::-webkit-scrollbar kuralı yok — çubuk tarayıcı varsayılanına düşer").toBeTruthy();
    expect(bar!.decls.width, "dikey çubuk genişliği tanımsız").toBeTruthy();
    expect(bar!.decls.height, "yatay çubuk yüksekliği tanımsız").toBeTruthy();
    // "İnce ve kibar" — native Windows çubuğu ~15–17px.
    expect(parseInt(bar!.decls.width ?? "", 10)).toBeLessThanOrEqual(12);
    expect(parseInt(bar!.decls.height ?? "", 10)).toBeLessThanOrEqual(12);
  });

  it("§2 renk TEMA TOKEN'INDAN gelir — sabit renk yazılmaz", () => {
    const renkli = [
      ...scrollbarKurallari.filter((k) => k.decls["background-color"]),
      ...kurallar.filter((k) => k.decls["--scrollbar-thumb"]),
    ];
    expect(renkli.length, "renk taşıyan tek bir çubuk kuralı bile yok").toBeGreaterThanOrEqual(4);
    for (const k of renkli) {
      const v = k.decls["background-color"] ?? k.decls["--scrollbar-thumb"];
      expect(v, `${k.selector} tema token'ı kullanmıyor: ${v}`).toMatch(
        /var\(--primary\)|var\(--scrollbar-thumb\)/,
      );
      expect(v, `${k.selector} sabit renk taşıyor: ${v}`).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(/i);
    }
    // Thumb'ın taban rengi değişkenden okunmalı (hover mekanizmasının tek yolu).
    expect(bul("*::-webkit-scrollbar-thumb")!.decls["background-color"]).toBe(
      "var(--scrollbar-thumb)",
    );
  });

  it("§3 duruşta İZ KALIR (a11y) — global kural çubuğu gizlemez", () => {
    const bar = bul("*::-webkit-scrollbar")!;
    expect(bar.decls.display, "global çubuk display:none ile gizlenmiş").not.toBe("none");
    expect(parseInt(bar.decls.width ?? "", 10)).toBeGreaterThan(0);

    expect(tabanDegisken, "--scrollbar-thumb tabanı yok").toBeTruthy();
    expect(tabanDegisken, "duruş rengi şeffaf — çubuk tamamen kaybolur").not.toMatch(
      /transparent|\/\s*0\s*\)/,
    );
    expect(alfa(tabanDegisken), "duruş izi görünmez").toBeGreaterThan(0.1);
  });

  it("§4 hover SÖNÜK→BELİRGİN yapar (yok→var değil)", () => {
    expect(hoverDegisken, "(hover: hover) dalında belirginleşme kuralı yok").toBeTruthy();
    expect(alfa(hoverDegisken)).toBeGreaterThan(alfa(tabanDegisken));

    const tutamak = bul("*::-webkit-scrollbar-thumb:hover");
    expect(tutamak, "çubuğun KENDİ hover'ı tanımsız").toBeTruthy();
    expect(alfa(tutamak!.decls["background-color"])).toBeGreaterThan(alfa(hoverDegisken));
  });

  it("§5 hover'ı olmayan cihazda iz KALICI olarak belirgin", () => {
    const dokunmatik = bul("*", ["media (hover: none)"])?.decls["--scrollbar-thumb"];
    expect(dokunmatik, "(hover: none) dalı yok — dokunmatik panelde çubuk hep sönük").toBeTruthy();
    expect(alfa(dokunmatik)).toBeGreaterThan(alfa(tabanDegisken));
  });

  it("§6 ⚠️ scrollbar-width/color global kapsama SIZMAZ (Chromium tuzağı)", () => {
    const standart = kurallar.filter(
      (k) => k.decls["scrollbar-width"] || k.decls["scrollbar-color"],
    );
    expect(standart.length, "standart özellik hiç yok — Firefox/dist-web karşılığı kayıp").toBeGreaterThan(0);
    for (const k of standart) {
      const supportsDali = k.context.some((c) =>
        c.startsWith("supports not selector(::-webkit-scrollbar)"),
      );
      const bilincliGizleme = k.selector.startsWith(".no-scrollbar");
      expect(
        supportsDali || bilincliGizleme,
        `${k.selector} (${k.context.join("|") || "kök"}) scrollbar-width/color taşıyor → ` +
          "Chromium bu elemanın TÜM ::-webkit-scrollbar kurallarını yok sayar",
      ).toBe(true);
    }
  });

  it("§6b ⚠️ ÖLÜ FORM: kap-hover doğrudan thumb'a yazılmaz", () => {
    const oluForm = scrollbarKurallari.filter((k) => /:hover.*::-webkit-scrollbar/.test(k.selector));
    expect(
      oluForm.map((k) => k.selector),
      "kap hover'ı Chromium'da çubuğu YENİDEN BOYAMAZ (ölçüldü) — hover " +
        "--scrollbar-thumb değişkenine yazılmalı",
    ).toEqual([]);
    // Taban değişken `*` üzerinde olmalı: custom property miras alınır ve fare
    // pencerede oldukça html/body de :hover'dır → `:root`a yazılan güçlü ton
    // tüm çubuklara iner, "yalnız üstüne gelince" vaadi çöker.
    expect(bul(":root")?.decls["--scrollbar-thumb"], "taban :root'a yazılmış — miras sızar").toBeUndefined();
    expect(tabanDegisken, "taban `*` üzerinde tanımlı değil").toBeTruthy();
  });

  it("§7 kaydırma kabına PAHALI efekt konmaz (uzun/sanal listeler)", () => {
    for (const k of scrollbarKurallari) {
      for (const prop of ["box-shadow", "filter", "backdrop-filter"]) {
        expect(k.decls[prop], `${k.selector} pahalı efekt taşıyor: ${prop}`).toBeUndefined();
      }
      const t = k.decls.transition;
      if (t) expect(t, `${k.selector} geçişi renkle sınırlı değil: ${t}`).toMatch(/^(background-color|none)/);
    }
  });

  it("§8 `.no-scrollbar` opt-out'u korunur (sekme şeridi)", () => {
    expect(kurallar.find((k) => k.selector === ".no-scrollbar::-webkit-scrollbar")?.decls.display).toBe("none");
  });
});
