// =============================================================================
// Test: Belge şablonu GÜVENLİĞİ — sıkı temizleyici, üst katman (filigran/künye), ayrılmış ad (T1A)
// Çalıştır: npx tsx scripts/test_belge_sablon_guvenlik.ts   (DB'siz — sorgu atmaz)
// =============================================================================
// İDDİA: tasarımcı şablonu dış kaynak yükleyemez (sıkı kip) ve filigranı/künyeyi gizleyemez;
// varsayılan kip (refakat kartı · etiket yolu) bu seçenekten ETKİLENMEZ.
//   §1 sıkı kip: dış http(s) img/a, CSS url(http…), @font-face kesilir; data: görsel kalır
//   §2 varsayılan kip: AYNI girdiler bayt-aynı (seçenek yokken ve strict:false iken)
//   §3 üst katmanı gizleme 5 sonda + yan yollar (doğrulayıcı reddi ya da yapısal üstünlük)
//   §4 Liquid'in çalışma anında ürettiği `tekserp` adı ve barkod işareti öznitelikte → render düşer
//   §5 meşru şablon: belge iskeleti, sayfa CSS'i, künye, filigran; sayfa ayarı FAIL-CLOSED
// Negatif sonda: temizleyicide `this.strict` yok sayılınca §1 kırmızı (harita satırı).
// GEREKLİ Mİ: evet — müşteri belgesinde İPTAL filigranının gizlenmesi sahte geçerli belge demek.
// =============================================================================
import { sanitizeCss } from "../src/services/document-render/template-html.css";
import { sanitizeUserHtml } from "../src/services/document-render/template-html.sanitize";
import { cssViolations, htmlViolations, normalizeCssForCheck } from "../src/services/document-template/motor/overlay";
import { renderTemplate, TemplateRenderError, type RenderOptions, type TemplateSource } from "../src/services/document-template/motor/render";
import { normalizePageSettings, PageSettingsError } from "../src/services/document-template/motor/sayfa";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

// ── §1 sıkı kip ─────────────────────────────────────────────────────────────────
console.log("\n§1 — sıkı kip dış kaynağı keser");
const EXTERNAL_HTML = [
  `<img src="https://evil.example/t.png">`,
  `<img src="HTTP://evil.example/t.png">`,
  `<a href="https://evil.example/">x</a>`,
  `<img src="&#104;ttps://evil.example/e.png">`,
];
for (const h of EXTERNAL_HTML) {
  const r = sanitizeUserHtml(h, { strict: true });
  check(`sıkı: ${h}`, !/evil\.example/.test(r.html) && r.removed.some((x) => x.includes("dış kaynak")), r.html);
}
const EXTERNAL_CSS = [
  `p{background:url(https://evil.example/b.png)}`,
  `p{background:url("http://evil.example/b.png")}`,
  `p{background:u\\72l(https://evil.example/b.png)}`,
  `@font-face{font-family:x;src:url(data:font/woff2;base64,AA)}p{color:red}`,
  `@FONT-FACE{font-family:x;src:local(Arial)}`,
];
for (const c of EXTERNAL_CSS) {
  const r = sanitizeCss(c, { strict: true });
  check(`sıkı CSS: ${c}`, !/evil\.example|font-face/i.test(r.css) && r.removed.length > 0, r.css);
}
const DATA_IMG = `<img src="data:image/png;base64,iVBORw0KGgo=" alt="x">`;
check("sıkı: data:image kalır", sanitizeUserHtml(DATA_IMG, { strict: true }).html === DATA_IMG);
check("sıkı: CSS data:image kalır", sanitizeCss(`p{background:url(data:image/png;base64,AA)}`, { strict: true }).css === `p{background:url(data:image/png;base64,AA)}`);
check("sıkı: font-face sonrası kural korunur", sanitizeCss(EXTERNAL_CSS[3]!, { strict: true }).css === "p{color:red}", sanitizeCss(EXTERNAL_CSS[3]!, { strict: true }).css);
const rel = sanitizeUserHtml(`<style>p{background:url(https://e.example/x)}</style><p style="background:url(http://e.example/y)">x</p>`, { strict: true });
check("sıkı: <style> ve style özniteliğindeki dış url kesilir", !rel.html.includes("e.example"), rel.html);

// ── §2 varsayılan kip ────────────────────────────────────────────────────────────
console.log("\n§2 — varsayılan kip etkilenmez (bayt-aynı)");
const DEFAULT_SAME = [
  `<img src="https://cdn.example/logo.png">`,
  `<a href="https://example.com/">site</a>`,
  `<style>p{background:url(https://cdn.example/b.png)}@font-face{font-family:x;src:local(Arial)}</style>`,
];
for (const h of DEFAULT_SAME) {
  const a = sanitizeUserHtml(h);
  const b = sanitizeUserHtml(h, {});
  const c = sanitizeUserHtml(h, { strict: false });
  check(`varsayılan: ${h.slice(0, 50)}`, a.html === h && b.html === h && c.html === h && a.removed.length === 0, a.html);
}
const cssDef = `p{background:url(https://cdn.example/b.png)}@font-face{font-family:x;src:local(Arial)}`;
check("varsayılan CSS bayt-aynı", sanitizeCss(cssDef).css === cssDef && sanitizeCss(cssDef, { strict: false }).css === cssDef);

// ── §3 üst katmanı gizleme ───────────────────────────────────────────────────────
console.log("\n§3 — filigran/künye gizleme denemeleri");
const VIOLATIONS: Array<[string, RegExp]> = [
  [`#tekserp-f{display:none}`, /tekserp/],
  [`#TEKSERP-F{opacity:0}`, /tekserp/],
  [`#\\74 ekserp-f{display:none}`, /tekserp/],
  [`[id^="tek\\73 erp"]{display:none}`, /tekserp/],
  [`:is(#a#a#a) div{display:none!important}`, /kimlik seçicisi/],
  [`div:nth-child(1 of #a, html){display:none}`, /kimlik seçicisi/],
  [`:not(#x):not(#y):not(#z){visibility:hidden}`, /kimlik seçicisi/],
  [`body > :where(#a, div){display:none}`, /kimlik seçicisi/],
  [`@page{@bottom-left{content:"sahte"}}`, /@bottom-left/],
  [`@page{@bottom-\\6c eft{content:"sahte"}}`, /@bottom-left/],
  [`@page{margin:0}`, /@page margin/],
  [`@page :first{margin-bottom:0}`, /@page margin/],
  [`@page{/*x*/margin-bottom/**/:0}`, /@page margin/],
];
for (const [css, re] of VIOLATIONS) {
  const v = cssViolations(css);
  check(`reddedilir: ${css}`, v.some((m) => re.test(m)), v.join(" | ") || "(ihlal yok)");
}
check("kaçış çözücü: @bottom-\\6c eft → @bottom-left", normalizeCssForCheck("@bottom-\\6c eft").includes("@bottom-left"));
const LEGIT_CSS = `p{color:#333}.a:not(.b){margin:2mm}td:nth-child(2n){background:#eee}@page{size:A4}h1{font-size:14pt}`;
check("meşru CSS ihlal vermez (renkte # serbest, @page size serbest)", cssViolations(LEGIT_CSS).length === 0, cssViolations(LEGIT_CSS).join(" | "));

const base: TemplateSource = { sourceHtml: `<p>Belge {{ belge.no }}</p>`, css: "", pageSettings: null };
const opts: RenderOptions = {
  context: { belge: { no: "SVK-0001" } },
  snapshot: { numberRounding: "HALF_UP" },
  overlay: { watermark: "VOIDED", imprint: { docNo: "SVK-0001", versionNo: 2, status: "İptal", reviseReason: "Adres düzeltme", reconstructed: true } },
};
function tryRender(t: TemplateSource, o: RenderOptions = opts): { html?: string; issues?: string } {
  try {
    return { html: renderTemplate(t, o).html };
  } catch (e) {
    if (e instanceof TemplateRenderError) return { issues: e.issues.map((i) => i.mesaj).join(" | ") };
    throw e;
  }
}
// Sonda 1–3 doğrulayıcıda (yukarıda); render da CSS alanında aynı reddi verir.
const p1 = tryRender({ ...base, css: `#tekserp-f{display:none}` });
check("sonda 1: #tekserp-f gizleme → render reddi", !!p1.issues && /tekserp/.test(p1.issues), p1.issues);
const p2 = tryRender({ ...base, css: `:is(#a#a#a) div{display:none!important}` });
check("sonda 2: :is(#a#a#a) özgüllük şişirme → render reddi", !!p2.issues, p2.issues);
const p3 = tryRender({ ...base, css: `@page{@bottom-\\6c eft{content:""}}` });
check("sonda 3: kaçışlı @bottom-left → render reddi", !!p3.issues, p3.issues);
// Sonda 4: evrensel gizleme + <body style> birleştirme — yapısal üstünlük.
const p4 = tryRender({ ...base, sourceHtml: `<body style="display:none" class="x" id="y"><p>a</p></body>`, css: `*{display:none!important;visibility:hidden!important}@layer z{div{display:none!important}}` });
const html4 = p4.html ?? "";
check("sonda 4: render başarılı", !!p4.html, p4.issues);
check("sonda 4: kök öğeler id/class/style DOLU (öznitelik birleştirmesi kapalı)", html4.startsWith(`<!DOCTYPE html><html lang="tr" id="tekserp-h" class="" style="">`) && html4.includes(`<body id="tekserp-b" class="" style="">`));
const firstStyle = /<style>([\s\S]*?)<\/style>/.exec(html4)?.[1] ?? "";
check("sonda 4: ilk ifade üst katman @layer bildirimi (şablon @layer'ı sonra gelir)", firstStyle.startsWith("@layer tekserp-o;@layer tekserp-o{"), firstStyle.slice(0, 40));
check("sonda 4: filigran kuralı !important + en üst z-index", /#tekserp-f#tekserp-f#tekserp-f\{[^}]*display:block!important[^}]*z-index:2147483647!important/.test(firstStyle));
check("sonda 4: üst katman stili şablon stilinden ÖNCE", html4.indexOf("@layer tekserp-o") < html4.indexOf("*{display:none"));
check("sonda 4: filigran öğesi body'nin SON çocuğu", /<div id="tekserp-f" class="" style="" aria-hidden="true">İPTAL<\/div><\/body><\/html>$/.test(html4));
// Sonda 5: html::after kaplama.
const p5 = tryRender({ ...base, css: `html::after{content:"";position:fixed;inset:0;background:#fff;z-index:2147483647}` });
const style5 = /<style>([\s\S]*?)<\/style>/.exec(p5.html ?? "")?.[1] ?? "";
check("sonda 5: html/body ::before/::after üst katmanda kapalı", style5.includes("#tekserp-h#tekserp-h#tekserp-h::after") && /::after[^{]*\{content:none!important;display:none!important\}/.test(style5));
check("yan yol: kök sıfırlaması transform/filter/opacity/contain/will-change'i kapsar", ["transform:none!important", "filter:none!important", "opacity:1!important", "contain:none!important", "will-change:auto!important", "content-visibility:visible!important", "zoom:1!important"].every((d) => style5.includes(d)));
check("yan yol: künye alt kenarı ≥ 8 mm !important", /@page\{margin-bottom:15\.0mm!important;@bottom-left\{content:"SVK-0001 · v2 · İptal · Adres düzeltme · yeniden kurulmuş kopya"/.test(style5), style5.slice(style5.indexOf("@page"), style5.indexOf("@page") + 140));
const tight = tryRender({ ...base, pageSettings: { kenar: { alt: 2 } } });
check("yan yol: alt kenar 2 mm → künye için 8 mm", /margin-bottom:8\.0mm!important/.test(tight.html ?? ""));

// ── §4 çalışma anında üretilen ad / işaret ─────────────────────────────────────
console.log("\n§4 — Liquid'in ürettiği ayrılmış ad ve yanlış yerdeki barkod işareti");
const gen = tryRender({ ...base, sourceHtml: `{% assign p = "tekserp" %}<div id="{{ p }}-f">x</div>` });
check("Liquid ile üretilen tekserp id → render reddi", !!gen.issues && /tekserp/.test(gen.issues), gen.issues);
const genCss = tryRender({ ...base, sourceHtml: `<style>#{{ p }}-f{display:none}</style><p>x</p>`, css: "" }, { ...opts, context: { p: "tekserp", belge: { no: "1" } } });
check("veriden gelen ad gövdedeki <style>'da → render reddi", !!genCss.issues && /tekserp/.test(genCss.issues), genCss.issues);
const genStyleAttr = tryRender({ ...base, sourceHtml: `<p style="{{ s }}">x</p>` }, { ...opts, context: { s: "x:1;}@page{margin:0}", belge: { no: "1" } } });
check("style özniteliğinde üretilen @page margin → reddedilir ya da etkisiz", !genStyleAttr.html || !/@page\{margin:0/.test(genStyleAttr.html.replace(/<style>[\s\S]*?<\/style>/g, "")), genStyleAttr.issues);
const mkAttr = tryRender({ ...base, sourceHtml: `<p title="{{ v | barkod }}">x</p>` }, { ...opts, context: { v: "TP-1", belge: { no: "1" } } });
check("barkod işareti öznitelikte → render reddi", !!mkAttr.issues && /yalnız metin içinde/.test(mkAttr.issues), mkAttr.issues);
const mkTitle = tryRender({ ...base, sourceHtml: `<title>{{ v | qr }}</title><p>x</p>` }, { ...opts, context: { v: "TP-1", belge: { no: "1" } } });
check("QR işareti ham içerikte (<title>) → render reddi", !!mkTitle.issues, mkTitle.issues);
const mkOk = tryRender({ ...base, sourceHtml: `<p>{{ v | barkod }}</p>` }, { ...opts, context: { v: "TP-1", belge: { no: "1" } } });
check("barkod metin içinde → SVG yerleşir", /<p><svg[\s\S]*<\/svg>\s*<\/p>/.test(mkOk.html ?? ""), mkOk.issues);
const forged = tryRender({ ...base, sourceHtml: `<p>S1</p>{{ v | barkod }}` }, { ...opts, context: { v: "TP-1", belge: { no: "1" } } });
check("kaynağa yazılmış sahte işaret ayıklanır (tek SVG)", (forged.html?.match(/<svg/g) ?? []).length === 1, forged.issues);
const ext = tryRender({ ...base, sourceHtml: `<img src="{{ u }}"><p>x</p>` }, { ...opts, context: { u: "https://evil.example/p.png", belge: { no: "1" } } });
check("veriden gelen dış adres de kesilir (doldurma sonrası sıkı temizlik)", !!ext.html && !ext.html.includes("evil.example"));
check("htmlViolations: class'ta tekserp", htmlViolations(`<p class="a tekserp-x">`).length === 1);

// ── §5 meşru şablon + sayfa ayarı ─────────────────────────────────────────────
console.log("\n§5 — meşru şablon ve sayfa ayarı");
const ok = renderTemplate(
  {
    sourceHtml: `<h1 data-alan="belge.no">no</h1>`,
    css: `h1{font-size:14pt;text-transform:uppercase}`,
    pageSettings: { kagit: "A5", yon: "yatay", kenar: { ust: 10, sag: 12, alt: 14, sol: 12.5 }, ustBilgi: { sag: 'Firma "A"' }, sayfaNo: { konum: "alt-sag", bicim: "Sayfa {n} / {N}" }, ilkSayfaFarkli: true },
  },
  { context: { belge: { no: "SVK-0001" } }, overlay: null },
);
check("<html lang=\"tr\">", ok.html.includes(`<html lang="tr"`));
check("@page boyut + kenar", ok.html.includes("@page{size:A5 landscape;margin:10.0mm 12.0mm 14.0mm 12.5mm;"));
check("üst bilgi CSS dizesi kaçışlı", ok.html.includes(`@top-right{content:"Firma \\22 A\\22 "}`));
check("sayfa no counter(page)/counter(pages)", ok.html.includes(`@bottom-right{content:"Sayfa " counter(page) " / " counter(pages)}`));
check("ilk sayfa farklı → :first boş kutular", ok.html.includes("@page :first{@top-right{content:none}@bottom-right{content:none}}"));
check("temel baskı CSS'i", ok.html.includes("thead{display:table-header-group}tr{break-inside:avoid}"));
check("overlay yokken filigran/künye yok", !ok.html.includes("tekserp-f\"") && !ok.html.includes("@bottom-left"));
check("ölçüm (ms, bayt)", ok.metrics.bytes === Buffer.byteLength(ok.html) && ok.metrics.ms >= 0);
const BAD_PAGES: Array<[unknown, RegExp]> = [
  [{ kagit: "A3" }, /kagit/],
  [{ kenar: { alt: 60 } }, /0–50 mm/],
  [{ altBilgi: { sol: "x" } }, /bilinmeyen alan: altBilgi\.sol/],
  [{ renk: "x" }, /bilinmeyen alan: renk/],
  [{ sayfaNo: { konum: "alt-sag" }, altBilgi: { sag: "x" } }, /boş olmalı/],
  ["A4", /nesne/],
];
for (const [ps, re] of BAD_PAGES) {
  let msg = "";
  try {
    normalizePageSettings(ps);
  } catch (e) {
    if (e instanceof PageSettingsError) msg = e.messages.join(" | ");
    else throw e;
  }
  check(`sayfa ayarı FAIL-CLOSED: ${JSON.stringify(ps)}`, re.test(msg), msg || "(hata yok)");
}
const badRender = tryRender({ ...base, pageSettings: { kenar: { ust: -1 } } });
check("geçersiz sayfa ayarı render'ı düşürür", !!badRender.issues && /kenar\.ust/.test(badRender.issues), badRender.issues);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail ? 1 : 0;
