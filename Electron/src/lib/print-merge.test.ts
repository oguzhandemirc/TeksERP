import { describe, it, expect } from "vitest";
import { mergeDocsForPrint, pageSizeOf } from "./print-merge";

const doc = (opts: { size: string; css?: string; body?: string }) =>
  `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  @page { size: ${opts.size}; margin: 8mm 10mm 8mm 10mm; }
  body { margin: 0; font-family: Arial; font-size: 11px; }
  .sheet { border: 1px solid #000; }
  .wm { position: fixed; top: 42%; }
  @media screen { body { background: #94a3b8; } .sheet { width: 210mm; } }
  ${opts.css ?? ""}
</style></head>
<body>${opts.body ?? '<div class="sheet">içerik</div>'}</body></html>`;

describe("mergeDocsForPrint", () => {
  it("tek belgeyi AYNEN döndürür (tekil baskı çıktısı korunur)", () => {
    const html = doc({ size: "A5" });
    const res = mergeDocsForPrint([html]);
    expect(res.html).toBe(html);
    expect(res.unmergeable).toEqual([]);
    expect(res.pageSizes).toEqual(["A5"]);
  });

  it("her belgeyi kendi gölge köküne koyar (stil sızıntısı yapısal olarak imkânsız)", () => {
    const res = mergeDocsForPrint([doc({ size: "A5" }), doc({ size: "A4" })]);
    const hosts = res.html.match(/<template shadowrootmode="open">/g) ?? [];
    expect(hosts).toHaveLength(2);
    expect(res.html).toContain('class="wdoc wdoc0"');
    expect(res.html).toContain('class="wdoc wdoc1"');
  });

  it("@page'i gövde CSS'inden SÖKÜP adlandırılmış sayfaya taşır", () => {
    const res = mergeDocsForPrint([doc({ size: "A5" }), doc({ size: "A4" })]);
    // Gölge kök stillerinde @page KALMAMALI — kalsaydı belge geneline uygulanır,
    // son yazan kazanır ve A5 kart A4'e basılırdı.
    const shadowCss = res.html.split("<template shadowrootmode=\"open\"><style>").slice(1);
    for (const chunk of shadowCss) expect(chunk.split("</style>")[0]).not.toContain("@page");
    expect(res.html).toContain("@page wdoc0 { size: A5;");
    expect(res.html).toContain("@page wdoc1 { size: A4;");
    expect(res.html).toContain(".wdoc0 { page: wdoc0; }");
    expect(res.html).toContain(".wdoc1 { page: wdoc1; }");
    expect(res.pageSizes).toEqual(["A5", "A4"]);
  });

  it("ilk belgede sayfa kırma YOK, sonrakilerde var (boş ilk sayfa doğmasın)", () => {
    const res = mergeDocsForPrint([doc({ size: "A4" }), doc({ size: "A4" })]);
    expect(res.html).toContain(".wdoc + .wdoc { break-before: page;");
    // Satır başındaki (kardeş birleştiricisiz) `.wdoc` kuralı break TAŞIMAMALI.
    expect(res.html).not.toMatch(/(^|\n)\s*\.wdoc \{[^}]*break-before/);
  });

  it("body/html tip seçicilerini gölge kökteki sarmalayıcıya çevirir", () => {
    const res = mergeDocsForPrint([doc({ size: "A4" }), doc({ size: "A4" })]);
    expect(res.html).toContain(".wbody { margin: 0; font-family: Arial;");
    // @media içindeki body de çevrilir — yoksa ekran önizlemesi sessizce ölür.
    expect(res.html).toContain("@media screen { .wbody { background: #94a3b8; }");
    expect(res.html).toContain('<div class="wbody "');
  });

  it("sınıf seçicilerine ve bildirimlere dokunmaz", () => {
    const res = mergeDocsForPrint([
      doc({ size: "A4", css: ".op td { border-right: 0.5px solid #999; }" }),
      doc({ size: "A4" }),
    ]);
    expect(res.html).toContain(".op td { border-right: 0.5px solid #999; }");
    expect(res.html).toContain("font-family: Arial");
  });

  it("position: fixed → absolute (filigran yabancı belgelerin sayfasına taşmasın)", () => {
    const res = mergeDocsForPrint([doc({ size: "A4" }), doc({ size: "A4" })]);
    expect(res.html).not.toContain("position: fixed");
    expect(res.html).toContain(".wm { position: absolute; top: 42%; }");
  });

  it("gövde sınıfını korur, id çakışması gölge kökte izole kalır", () => {
    const res = mergeDocsForPrint([
      doc({ size: "A4" }).replace("<body>", '<body class="ceki">'),
      doc({ size: "A4" }),
    ]);
    expect(res.html).toContain('class="wbody ceki"');
  });

  it("</template> taşıyan belgeyi DIŞARIDA bırakır ve raporlar", () => {
    const bad = doc({ size: "A4", body: "<template>x</template>" });
    const res = mergeDocsForPrint([doc({ size: "A5" }), bad, doc({ size: "A4" })]);
    expect(res.unmergeable).toEqual([1]);
    expect(res.html.match(/<template shadowrootmode="open">/g) ?? []).toHaveLength(2);
    expect(res.pageSizes).toEqual(["A5", null, "A4"]);
  });

  // GERÇEK VAKA (2026-08-06): refakat kartının CSS'inde "…@page (yalnız baskı)…"
  // diye bir AÇIKLAMA YORUMU var. Yorumlar silinmeden tarandığında `@page` oradan
  // yakalanıyor, blok sayacı bir sonraki `@media screen` süslüsünde kapanıyor ve
  // ekran bloğunun bir kısmı sessizce siliniyordu → kart A5'te 1 yerine 2 sayfa
  // basıyordu (headless Chromium ile ölçüldü). Hata yok, log yok.
  it("YORUM içindeki @page tuzağına düşmez, komşu kuralları yutmaz", () => {
    const tricky = `<!doctype html><html><head><style>
      /* Ekran önizlemesi: @page (yalnız baskı) ekranda boyut göstermez */
      @media screen { .sheet { width: 148mm; } }
      @page { size: A5; margin: 8mm; }
      .foot { color: #555; }
    </style></head><body><div class="sheet">x</div></body></html>`;
    const res = mergeDocsForPrint([tricky, doc({ size: "A4" })]);
    expect(res.html).toContain("@media screen { .sheet { width: 148mm; } }");
    expect(res.html).toContain(".foot { color: #555; }");
    expect(res.html).toContain("@page wdoc0 { size: A5; margin: 8mm; }");
    expect(res.pageSizes[0]).toBe("A5");
  });

  it("pageSizeOf tek belgeden boyutu okur", () => {
    expect(pageSizeOf(doc({ size: "A5" }))).toBe("A5");
    expect(pageSizeOf("<html><body>x</body></html>")).toBeNull();
  });
});
