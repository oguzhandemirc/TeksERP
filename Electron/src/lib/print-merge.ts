// =============================================================================
// TOPLU BELGE — N ayrı belge HTML'ini TEK baskı işine birleştirme
// =============================================================================
// Sorun: her belge (refakat kartı, fason çeki, kabul makbuzu…) KENDİ BAŞINA tam
// bir HTML belgesidir — kendi `<style>`ı, kendi `@page { size }` kuralı ve
// GENERİK sınıf adları (`.sheet`, `.company`, `.cell`, `table`) ile. Bunları
// `getBulkRollLabelsHtml` paterniyle (ilk belgenin <head>'i + gövdeler) alt alta
// eklemek YALNIZ tek tip belgede doğrudur: etiketlerin CSS'i birebir aynıdır.
// Karışık belge kümesinde aynı sınıf adları FARKLI değerler taşır → biri
// diğerinin üstüne yazar ve resmi belge sessizce yanlış görünümde basılır.
//
// ÇÖZÜM — iki mekanizma, ikisi de ölçüldü (headless Chromium, 2026-08-06):
//   1) İZOLASYON: her belge kendi **gölge köküne** (declarative shadow DOM,
//      `<template shadowrootmode="open">`) konur. Stil sızıntısı YAPISAL olarak
//      imkânsız; id çakışması da izole olur. Script GEREKMEZ — baskı iframe'i
//      `allow-scripts` TAŞIMIYOR (bkz. lib/print.ts) ve gölge kök HTML
//      ayrıştırıcısı tarafından kurulur (`document.write` yolunda da doğrulandı).
//      ⚠️ iframe DEĞİL: iframe içeriği sayfalara BÖLÜNMEZ, taşan kısım kırpılır.
//      Gölge kök normal yerleşimin parçasıdır → çok sayfalı belge doğal akar.
//   2) SAYFA KURULUMU: `@page` gövde CSS'inde kalamaz (belge geneline uygulanır,
//      son yazan kazanır) → **adlandırılmış sayfaya** taşınır: `@page wdoc3 {…}`
//      + sarmalayıcıda `page: wdoc3`. Böylece A5 kart ile A4 çeki aynı işte kendi
//      boyutunda basılır (ölçüm: 2×A5 + 1×A4 → 420/420/595pt).
//
// ⚠️ TEK BELGEDE BİRLEŞTİRME YAPILMAZ — HTML aynen döner. Bugünkü tekil baskı
// yolunun çıktısı bayt-bayt korunur; birleştirme yalnız gerçekten N>1 iken devreye
// girer.
// =============================================================================

export interface MergeResult {
  /** Basılacak birleşik belge. */
  html: string;
  /**
   * Birleştirilemeyen belge indeksleri — gövdesinde `</template>` geçenler
   * (uzman modu şablonu böyle bir şey içerebilir). Gölge kökü ERKEN KAPATIP
   * kalan belgeleri dışarı taşırdı; sessizce bozuk basmaktansa DIŞARIDA bırakılır
   * ve çağıran bunu kullanıcıya söyler.
   */
  unmergeable: number[];
  /** Belge başına sayfa boyutu (`@page size`ten; çözülemezse null). Karışık
   *  boyut baskıyı bozmaz ama yazıcı tek kağıt taşıyorsa arayüz uyarmalıdır. */
  pageSizes: (string | null)[];
}

const STYLE_RE = /<style[^>]*>([\s\S]*?)<\/style>/gi;
const BODY_RE = /<body([^>]*)>([\s\S]*)<\/body>/i;

/** Gölge kök içinde `<body>`nin yerine geçen sarmalayıcı sınıfı. */
const BODY_CLASS = "wbody";

/**
 * CSS yorumlarını siler. ⚠️ SIRA ZORUNLU: aşağıdaki iki tarayıcı da düz metne
 * bakar (`@page` arar / süslü parantez sayar) ve YORUM İÇİNDEKİ metni ayırt
 * edemez. Gerçek belgede ölçüldü (2026-08-06): refakat kartının CSS'inde
 * "Ekran önizlemesi: @page (yalnız baskı)…" diye bir açıklama yorumu var; yorum
 * silinmeden tarandığında `@page` oradan yakalanıyor, blok sayacı yorumdan
 * SONRAKİ `@media screen` süslüsünde kapanıyor ve ekran bloğunun bir kısmı
 * sessizce SİLİNİYORDU → kart A5'te 1 yerine 2 sayfa basıyordu. Hata yok, log
 * yok; tek belirti fazladan kâğıt.
 * (Yorum baskıya girmez. Yorum başlatan dizgenin veri içinde geçmesi bu
 * CSS'lerde mümkün değil: `content` dizgesi ya da SVG data-url'i yok.)
 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * CSS'ten `@page` bloklarını SÖKER (blok gövdeleri ayrı döner). Süslü parantez
 * sayarak ilerler — `@page` içinde kenar kutusu (`@top-center {…}`) olsa bile
 * blok doğru yerde biter.
 */
function splitPageRules(css: string): { rest: string; pages: { prelude: string; block: string }[] } {
  const pages: { prelude: string; block: string }[] = [];
  let rest = "";
  let i = 0;
  for (;;) {
    const at = css.indexOf("@page", i);
    if (at < 0) {
      rest += css.slice(i);
      return { rest, pages };
    }
    rest += css.slice(i, at);
    const open = css.indexOf("{", at);
    if (open < 0) {
      rest += css.slice(at);
      return { rest, pages };
    }
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      const ch = css[j];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      j++;
    }
    // `@page :first {…}` gibi sayfa seçicisi korunur ("@page ad:first").
    pages.push({ prelude: css.slice(at + 5, open).trim(), block: css.slice(open, j) });
    i = j;
  }
}

/**
 * Seçici listelerini dönüştürür. Yalnız KURAL ÖNCÜLLERİ (bir `{`den önceki
 * metin) map'ten geçer; `@media`/`@supports` gibi at-kuralları ve bildirim
 * gövdeleri dokunulmadan kalır. Bildirimler `{` içermediği için basit tarama
 * yeterli — bu CSS'ler elle yazılmış, `content: "{"` gibi tuzak taşımıyor.
 */
function mapSelectors(css: string, map: (sel: string) => string): string {
  let out = "";
  let chunkStart = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{" || ch === "}") {
      const prelude = css.slice(chunkStart, i);
      out += ch === "{" && !prelude.trimStart().startsWith("@") ? map(prelude) : prelude;
      out += ch;
      chunkStart = i + 1;
    }
  }
  return out + css.slice(chunkStart);
}

/** `html`/`body` TİP seçicilerini gölge kökteki sarmalayıcıya çevirir. */
function rewriteRootSelectors(sel: string): string {
  return sel.replace(/(^|[\s,>+~])(?:html|body)\b(?![-\w(])/g, `$1.${BODY_CLASS}`);
}

/**
 * Tek belgeyi birleşik belgenin bir parçasına çevirir.
 * `position: fixed` → `absolute`: sabit konumlu eleman (İPTAL/TASLAK filigranı)
 * görüntü alanına göre yerleşir ve gölge kökten TAŞAR → birleşik işte YABANCI
 * belgelerin sayfalarına da basardı. Mutlak konum belgenin kendi kutusunda kalır
 * (bedeli: filigran her sayfada değil, belgenin içinde bir kez görünür).
 */
function buildPiece(html: string, index: number): {
  style: string;
  markup: string;
  pageSize: string | null;
} {
  const name = `wdoc${index}`;
  const styles: string[] = [];
  for (const m of html.matchAll(STYLE_RE)) styles.push(m[1] ?? "");
  const { rest, pages } = splitPageRules(stripCssComments(styles.join("\n")));

  const scoped = mapSelectors(rest, rewriteRootSelectors).replace(
    /position:\s*fixed/gi,
    "position: absolute",
  );

  const bodyMatch = BODY_RE.exec(html);
  const attrs = bodyMatch?.[1] ?? "";
  const inner = bodyMatch?.[2] ?? html;
  const cls = /class\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? "";
  const restAttrs = attrs.replace(/class\s*=\s*"[^"]*"/i, "");

  const pageCss = pages
    .map((p) => `@page ${name}${p.prelude ? p.prelude : ""} ${p.block}`)
    .join("\n  ");
  const size = /size:\s*([A-Za-z0-9]+)/.exec(pages.map((p) => p.block).join(" "))?.[1] ?? null;

  return {
    style: [pageCss, pages.length ? `.${name} { page: ${name}; }` : ""].filter(Boolean).join("\n  "),
    markup:
      `<div class="wdoc ${name}"><template shadowrootmode="open"><style>${scoped}</style>` +
      `<div class="${BODY_CLASS} ${cls}"${restAttrs}>${inner}</div></template></div>`,
    pageSize: size,
  };
}

/**
 * N belge → tek baskı belgesi. Tek belge verilirse HTML AYNEN döner (bugünkü
 * tekil çıktı korunur). Belgeler verildiği SIRADA basılır.
 */
export function mergeDocsForPrint(htmls: string[]): MergeResult {
  const unmergeable: number[] = [];
  const usable: { html: string; index: number }[] = [];
  htmls.forEach((html, i) => {
    if (/<\/template\s*>/i.test(html)) unmergeable.push(i);
    else usable.push({ html, index: i });
  });

  if (usable.length === 1 && unmergeable.length === 0) {
    return { html: usable[0]!.html, unmergeable, pageSizes: [pageSizeOf(usable[0]!.html)] };
  }

  const pieces = usable.map((u, i) => buildPiece(u.html, i));
  const pageSizes: (string | null)[] = htmls.map(() => null);
  usable.forEach((u, i) => {
    pageSizes[u.index] = pieces[i]!.pageSize;
  });

  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Toplu Belge</title>
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
  /* Her belge kendi kutusu: filigran gibi mutlak konumlu ögeler burada kalır. */
  .wdoc { display: block; position: relative; }
  /* İLK belgede break YOK (boş ilk sayfa doğardı) — sonrakilerin her biri yeni
     sayfada başlar. Adlandırılmış sayfa değişimi zaten kırar; bu ikinci hat. */
  .wdoc + .wdoc { break-before: page; page-break-before: always; }
  /* Ekranda (önizleme) belgeler arasına ince bir ayraç. Zemin RENGİ VERİLMEZ:
     belgenin kendi ekran kuralı (varsa kâğıt taklidi) kendi kutusunda çalışsın —
     ortak bir gri zemin, kâğıt taklidi olmayan belgelerin altını boyardı. */
  @media screen { .wdoc + .wdoc { border-top: 1px dashed #cbd5e1; } }
  ${pieces.map((p) => p.style).filter(Boolean).join("\n  ")}
</style></head>
<body>
${pieces.map((p) => p.markup).join("\n")}
</body></html>`;

  return { html, unmergeable, pageSizes };
}

/** Belgenin `@page size` değeri (yoksa null) — birleştirmeden de okunabilsin diye. */
export function pageSizeOf(html: string): string | null {
  // Yorumlar burada da SİLİNİR: açıklama metnindeki "@page" yanlış boyut okutur
  // (bkz. stripCssComments'teki saha vakası).
  return /@page[^{]*\{[^}]*size:\s*([A-Za-z0-9]+)/i.exec(stripCssComments(html))?.[1] ?? null;
}
