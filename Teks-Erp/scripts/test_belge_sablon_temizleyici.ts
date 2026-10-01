// =============================================================================
// Test: Belge/etiket ŞABLON TEMİZLEYİCİSİ — izin listesi (güvenlik denetimi 2026-10-01, IST-4)
// Çalıştır: npx tsx scripts/test_belge_sablon_temizleyici.ts   (DB'siz — sorgu atmaz)
// =============================================================================
// İDDİA: kullanıcı yazımı belge HTML'i (refakat kartı RAW_HTML · etiket RASTER_HTML)
// temizleyiciden geçince TARAYICININ okuyacağı biçimde betik, olay özniteliği, gömülü
// bağlam, izinsiz adres (javascript:/file:/UNC/göreli) ya da kaynak yükleyen CSS taşımaz —
// alan değeri ve döngü tekrarı doldurmadan SONRA da; meşru belge biçimleri korunur.
//
// KAHİN BAĞIMSIZ: temizleyicinin belirteçleyicisini KULLANMAZ. Çıktının KANONİK dilbilgisine
// (metinde '<' yok · yorumda '--' yok · öznitelik çift tırnaklı) uyduğunu ayrı, katı bir
// ayrıştırıcıyla doğrular; o dilbilgisinin tarayıcı okuması tektir → kahinin gördüğü =
// tarayıcının gördüğü. Sonra o görünümde tehlikeli yapı arar.
//
//   §1 saldırı külliyatı (raporun üç atlatma sınıfı + klasik vektörler) → kahin temiz
//   §2 doldurma sonrası: değer ve döngü tekrarı yapıyı bozamaz (renderRawTemplate · applyRawCode)
//   §3 meşru külliyat: kanonik şablon BAYT-BAYT aynı, kesilen yok; kanonik olmayan yazım eşdeğere
//   §4 idempotentlik + tohumlu bulanık test (rastgele parça birleşimleri)
//   §5 KALICI SONDA (K): ESKİ düzenli-ifade temizleyicisi aynı külliyatta kahinden KALIR —
//      raporun üç sınıfının HER biri ayrı ayrı (külliyat ayırt edici, kahin kör değil)
//   §6 bağlama: kayıt (şablon servisi · etiket ham kodu) ve render yolları temizleyiciden geçer
// Negatif sonda (B): `sanitizeUserHtml` gövdesi girdiyi aynen döndürünce → bkz. harita satırı.
// GEREKLİ Mİ: evet — §5 ağaçta duran GERÇEK atlatmaları (eski kod) ölçüyor.
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrinterLanguage } from "@prisma/client";
import { sanitizeUserHtml } from "../src/services/document-render/template-html.sanitize";
import { describeSanitization, renderRawTemplate, type RawContext } from "../src/services/document-render/traveler-card-raw";
import { applyRawCode } from "../src/services/helpers/label-rawcode";
import type { LabelPayload } from "../src/types/label.types";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

// ── Kahin: katı kanonik ayrıştırıcı + tehlike denetimi (temizleyiciden BAĞIMSIZ) ──────────
interface OracleTag {
  readonly name: string;
  readonly attrs: ReadonlyMap<string, string | null>;
}
const RAW_KEPT = new Set(["style", "title", "textarea"]);
const DANGEROUS_TAGS = new Set([
  "script", "iframe", "frame", "frameset", "object", "embed", "applet", "portal", "fencedframe", "svg", "math",
  "base", "link", "noscript", "template", "xmp", "plaintext", "noembed", "noframes", "form", "button", "select",
  "option", "audio", "video", "source", "track", "image", "isindex", "param", "keygen",
]);
const DANGEROUS_ATTRS = new Set(["srcdoc", "formaction", "action", "xlink:href", "background", "poster", "srcset", "ping", "dynsrc", "lowsrc", "data", "target"]);
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", colon: ":", tab: "\t", newline: "\n" };

function oracleDecode(v: string): string | null {
  let bad = false;
  const out = v.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);?/gi, (m: string, body: string) => {
    if (body[0] === "#") {
      const cp = body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : "";
    }
    const ch = ENT[body.toLowerCase()];
    if (ch === undefined && m.endsWith(";")) bad = true;
    return ch ?? m;
  });
  return bad ? null : out;
}

const squash = (s: string): string => [...s].filter((c) => c.charCodeAt(0) > 0x20 && c.charCodeAt(0) !== 0x7f).join("").toLowerCase();

function urlProblem(value: string | null, kind: "href" | "src"): string | null {
  if (value === null) return null;
  const d = oracleDecode(value);
  if (d === null) return "çözülemeyen varlık";
  const u = squash(d);
  if (u === "" || u.startsWith("#") || u.startsWith("http://") || u.startsWith("https://")) return null;
  if (kind === "href" && (u.startsWith("mailto:") || u.startsWith("tel:"))) return null;
  if (kind === "src" && /^data:image\/(png|jpeg|jpg|gif|webp|bmp|svg\+xml)[;,]/.test(u)) return null;
  return `izinsiz adres ${u.slice(0, 40)}`;
}

const unescapeCss = (s: string): string =>
  s.replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?|\\([\s\S])/gi, (_m, h: string | undefined, ch: string | undefined) =>
    h ? String.fromCodePoint(Math.min(parseInt(h, 16) || 0xfffd, 0x10ffff)) : (ch === "\n" ? "" : (ch ?? "")),
  );

/** CSS dizesinin sonu (tırnak, satır sonu ya da metin sonu — tarayıcının "bozuk dize" kuralı). */
function cssStringEnd(css: string, i: number): number {
  const q = css[i];
  let j = i + 1;
  while (j < css.length && css[j] !== q && css[j] !== "\n") j += css[j] === "\\" ? 2 : 1;
  return Math.min(j + 1, css.length);
}

/** Kahinin KENDİ CSS taraması: dize ve yorum İÇİ işlev değildir (tarayıcı gibi); işlev/at-kural adları kaçış çözülerek. */
function cssProblem(css: string): string | null {
  let i = 0;
  while (i < css.length) {
    const c = css[i] ?? "";
    if (c === "/" && css[i + 1] === "*") {
      const e = css.indexOf("*/", i + 2);
      i = e < 0 ? css.length : e + 2;
    } else if (c === '"' || c === "'") i = cssStringEnd(css, i);
    else if (/[a-z0-9_@\\-]/i.test(c) || c.charCodeAt(0) > 0x7f) {
      const m = /^@?(?:[a-z0-9_-]|[\u0080-￿]|\\(?:[0-9a-f]{1,6}[ \t\n\r\f]?|[^\n]))+/i.exec(css.slice(i));
      const word = m?.[0] ?? c;
      const name = unescapeCss(word).toLowerCase();
      i += word.length;
      // At-kural ancak GERÇEK '@' ile başlar; `\\@import` bir ad belirtecidir (CSS Sözdizimi §4.3.1).
      if (word.startsWith("@") && unescapeCss(word.slice(1)).toLowerCase() === "import") return "@import";
      if (css[i] !== "(") continue;
      if (["image-set", "-webkit-image-set", "cross-fade", "-webkit-cross-fade", "element", "-moz-element", "expression", "src", "image"].includes(name)) return `${name}(`;
      if (name !== "url") continue;
      let j = i + 1;
      while (/[ \t\n\r\f]/.test(css[j] ?? "")) j++;
      const quoted = css[j] === '"' || css[j] === "'";
      const end = quoted ? cssStringEnd(css, j) : (css.indexOf(")", j) < 0 ? css.length : css.indexOf(")", j));
      const arg = quoted ? css.slice(j + 1, Math.max(j + 1, end - 1)) : css.slice(j, end);
      const u = squash(unescapeCss(arg));
      if (u !== "" && !u.startsWith("http://") && !u.startsWith("https://") && !/^data:image\//.test(u)) return `css url ${u.slice(0, 40)}`;
      i = end;
    } else i++;
  }
  return null;
}

function tagProblems(t: OracleTag): string[] {
  const out: string[] = [];
  if (DANGEROUS_TAGS.has(t.name)) out.push(`etiket <${t.name}>`);
  if (t.name === "meta" && [...t.attrs.keys()].some((k) => k !== "charset")) out.push("meta (charset dışı)");
  if (t.name === "input" && !["checkbox", "radio", "text"].includes((t.attrs.get("type") ?? "text").toLowerCase())) out.push("input türü");
  for (const [name, value] of t.attrs) {
    if (name.startsWith("on")) out.push(`olay ${name}`);
    if (DANGEROUS_ATTRS.has(name)) out.push(`öznitelik ${name}`);
    if (name === "href" || name === "src") {
      const p = urlProblem(value, name);
      if (p) out.push(p);
      if (value !== null && squash(oracleDecode(value) ?? "").startsWith("{{")) out.push("yer tutucuyla başlayan adres");
    }
    if (name === "style" && value !== null) {
      const p = cssProblem(oracleDecode(value) ?? "url(x)");
      if (p) out.push(`style ${p}`);
    }
  }
  return out;
}

/** Kanonik dilbilgisine uymayan ya da tehlikeli yapı taşıyan her şey bir sorundur. */
function oracle(html: string): string[] {
  const problems: string[] = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] !== "<") {
      const lt = html.indexOf("<", i);
      i = lt < 0 ? html.length : lt;
      continue;
    }
    const rest = html.slice(i);
    if (rest.startsWith("<!--")) {
      const end = html.indexOf("-->", i + 4);
      const body = end < 0 ? null : html.slice(i + 4, end);
      if (body === null || body.includes("--") || body.startsWith(">") || body.startsWith("->")) return [...problems, `bozuk yorum @${i}`];
      i = end + 3;
      continue;
    }
    const doctype = /^<!doctype[^>]*>/i.exec(rest);
    const endTag = /^<\/([a-z][a-z0-9]*)>/.exec(rest);
    const start = /^<([a-z][a-z0-9]*)((?: [a-z][a-z0-9_.:-]*(?:="[^"]*")?)*)>/.exec(rest);
    if (doctype) i += doctype[0].length;
    else if (endTag) i += endTag[0].length;
    else if (start) {
      const name = start[1] ?? "";
      const attrs = new Map<string, string | null>();
      for (const a of (start[2] ?? "").matchAll(/ ([a-z][a-z0-9_.:-]*)(?:="([^"]*)")?/g)) if (!attrs.has(a[1] ?? "")) attrs.set(a[1] ?? "", a[2] ?? null);
      problems.push(...tagProblems({ name, attrs }));
      i += start[0].length;
      if (RAW_KEPT.has(name)) {
        const close = html.toLowerCase().indexOf(`</${name}`, i);
        if (close < 0 || !html.startsWith(`</${name}>`, close)) return [...problems, `ham içerik kapanışı bozuk <${name}> @${i}`];
        const body = html.slice(i, close);
        if (name === "style") {
          const p = cssProblem(body);
          if (p) problems.push(`style öğesi ${p}`);
        } else if (body.includes("<")) problems.push(`<${name}> içinde '<'`);
        i = close;
      }
    } else return [...problems, `kanonik olmayan '<' @${i}: ${rest.slice(0, 30)}`];
  }
  return problems;
}

// ── Saldırı külliyatı — sınıf → örnekler (raporun üç sınıfı ilk üç) ─────────────────────
const ATTACKS: Record<string, readonly string[]> = {
  "iç içe yerleştirme": [
    "<scr<script></script>ipt>alert(1)</scr<script></script>ipt>",
    '<img src=x on<script></script>error="alert(1)">',
    '<a href="javas<script></script>cript:alert(1)">x</a>',
    "<ifr<iframe></iframe>ame srcdoc=x></iframe>",
  ],
  "boşluksuz öznitelik ayırıcısı": [
    '<img src="x"/onerror="alert(1)">',
    '<img src="x"onerror="alert(1)">',
    "<body/onload=alert(1)>",
    "<div\nonclick=alert(1)>x</div><div\fonclick=alert(1)>y</div>",
  ],
  "varlık kodlu şema": [
    '<a href="&#106;avascript:alert(1)">a</a>',
    '<a href="&#x6A;avascript:alert(1)">b</a>',
    '<a href="javascript&colon;alert(1)">c</a>',
    '<a href="jav&#x09;ascript:alert(1)">d</a>',
    '<a href="jav&Tab;ascript:alert(1)">e</a>',
    '<a href="&#0000106&#0000097vascript:alert(1)">f</a>',
  ],
  "şema ve UNC": [
    '<a href=" JaVaScRiPt:alert(1)">a</a><a href="vbscript:msgbox(1)">b</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD4=">c</a><img src="data:text/html,x">',
    '<img src="file://saldirgan/pay/a.png"><img src="\\\\saldirgan\\pay\\b.png"><img src="//saldirgan/pay/c.png">',
    '<a href="search-ms:query=x">d</a><a href="ms-msdt:/id x">e</a><a href="file:///C:/Windows/calc.exe">f</a>',
  ],
  "gömülü bağlam ve tam belge": [
    '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe><object data="javascript:alert(1)"></object><embed src="x">',
    '<html><head><meta http-equiv="refresh" content="0;url=file://s/p"><base href="file://s/"><link rel="stylesheet" href="//s/x.css"></head><body onload="alert(1)">x</body></html>',
    '<div srcdoc="x" formaction="javascript:alert(1)" background="//s/b.png">y</div>',
  ],
  "ayrıştırıcı farkı (mXSS)": [
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
    "<svg><style><img src=x onerror=alert(1)></style></svg>",
    "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>",
    "<template><img src=x onerror=alert(1)></template><xmp><img src=x onerror=alert(1)></xmp>",
    "<!--><img src=x onerror=alert(1)>--><!-- a --!><img src=x onerror=alert(2)>",
    // Bulanık testin bulduğu (tohum 1): yer tutucu ayıklanınca veri '>>' ile başlıyordu → "<!-->" boş yorum.
    "<!--{{itemName}}>><img src=x onerror=alert(1)>--><!--{{x}}->-><img src=x onerror=alert(2)>-->",
    "<style></style><img src=x onerror=alert(1)></style><title></title><img src=x onerror=alert(2)>",
    "a < b <<script>x</script>img src=x onerror=alert(1)>",
  ],
  "CSS kaynak yükleme": [
    '<div style="background:url(//saldirgan/x)">a</div><div style="background:u\\72l(file://s/x)">b</div>',
    '<div style="background:url(&quot;file://s/x&quot;)">c</div><div style="behavior:url(x.htc)">d</div>',
    '<style>@import url(//s/x.css); .a{background:-webkit-image-set("//s/x.png" 1x)} @\\69mport "y.css";</style>',
    // Bulanık testin bulduğu: metin sonunda KAPANMAYAN url( argümanının son karakteri kesiliyordu.
    '<div style="background:url(/">a</div><style>.b{background:url(-</style>',
  ],
  "form ve diğer": [
    '<form action="javascript:alert(1)"><button formaction="javascript:alert(2)">x</button></form>',
    '<input type="image" src="x" onerror="alert(1)"><input type="text" autofocus onfocus="alert(1)">',
    '<details open ontoggle="alert(1)">x</details><video><source onerror="alert(1)"></video><isindex type=image>',
    '<a href="https://x" target="_blank">x</a><img src=x onerror=alert(1)',
  ],
};

// ── ESKİ temizleyici (2026-10-01 öncesi traveler-card-raw.ts STRIP_RULES) — K-sonda fikstürü ──
const LEGACY_RULES: readonly RegExp[] = [
  /<script\b[\s\S]*?(?:<\/script\s*>|$)/gi,
  /<\/?(?:iframe|object|embed|applet)\b[^>]*>/gi,
  /<(?:link|meta)\b[^>]*>/gi,
  /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
  /(?:javascript|vbscript)\s*:/gi,
  /data\s*:\s*text\/html/gi,
];
function legacySanitize(html: string): string {
  let out = html;
  for (const re of LEGACY_RULES) out = out.replace(re, "");
  return out;
}

const clean = (html: string): string => sanitizeUserHtml(html).html;

function section1(): void {
  console.log("\n=== §1 Saldırı külliyatı → kahin temiz ===");
  const total = Object.values(ATTACKS).reduce((n, list) => n + list.length, 0);
  check("körlük zemini: ≥ 8 sınıf, ≥ 30 örnek", Object.keys(ATTACKS).length >= 8 && total >= 30, `${total}`);
  for (const [cls, list] of Object.entries(ATTACKS)) {
    const bad = list.map((x) => ({ x, p: oracle(clean(x)) })).filter((r) => r.p.length > 0);
    check(`${cls}: ${list.length} örneğin hepsi temiz`, bad.length === 0, bad.map((b) => `${b.x.slice(0, 40)} → ${b.p.join("; ")}`).join(" | "));
  }
  const removed = sanitizeUserHtml(ATTACKS["varlık kodlu şema"]?.join("") ?? "").removed;
  check("kesilen kategori raporlanır (stüdyo uyarısı)", removed.includes("script şeması"), removed.join(", "));
  // İlk geçişin kendi sözleşmesi (ikinci geçiş de kapatıyor; bunlar stüdyo uyarısı + derinlemesine savunma):
  const loopInComment = sanitizeUserHtml("{{#steps}}<!-- {{/steps}} {{itemName}} -->");
  check("yorumdaki yer tutucu/döngü işareti ayıklanır ve raporlanır", loopInComment.html === "{{#steps}}<!--   -->" && loopInComment.removed.includes("yanlış yerde döngü işareti"), loopInComment.html);
  const loopInStyle = sanitizeUserHtml('<style>{{#steps}}.a{}</style><td title="{{/steps}}x">t</td>');
  check("stil içi ve öznitelik içi döngü işareti ayıklanır", loopInStyle.html === '<style>.a{}</style><td title="x">t</td>' && loopInStyle.removed.includes("yanlış yerde döngü işareti"), loopInStyle.html);
}

// ── §2 Doldurma sonrası: düşmanca değerler + döngü tekrarı ─────────────────────────────
const HOSTILE = {
  quote: '" onmouseover="alert(1)',
  apos: "' onmouseover='alert(1)",
  comment: "--><img src=x onerror=alert(1)>",
  css: "red;background:url(//saldirgan/p)",
  scheme: "javascript:alert(1)",
  marker: "qrSvg",
};
const QR = '<svg viewBox="0 0 1 1"><path d="M0 0h1"/></svg>';

function travelerCtx(qrSvg: string): RawContext {
  return {
    fields: { itemName: HOSTILE.quote, colorName: HOSTILE.apos, footerNote: HOSTILE.comment, properties: HOSTILE.css, phone: HOSTILE.scheme, workOrderNumber: HOSTILE.marker, qrSvg },
    loops: { steps: [{ seq: "1", notes: HOSTILE.comment }, { seq: "2", notes: HOSTILE.quote }], batches: [], orders: [] },
  };
}

const TRAVELER_HOSTILE_TEMPLATES = [
  "<td title='{{itemName}}' class={{colorName}}>x</td>",
  "<!-- not: {{footerNote}} --><p>{{footerNote}}</p>",
  '<style>.a{color:{{properties}}}</style><div style="color:{{properties}}">x</div>',
  '<a href="{{phone}}">t</a><img src="{{phone}}">',
  "{{#batches}}<!--{{/batches}}<img src=x onerror=alert(1)>-->",
  '{{#steps}}<td title="{{/steps}} onmouseover=alert(1) x=">',
  "{{#batches}}<style>{{/batches}}<img src=x onerror=alert(1)></style>",
  '<table>{{#steps}}<tr><td title="{{notes}}">{{notes}}</td><!-- {{notes}} --></tr>{{/steps}}</table>',
  "<b>{{workOrderNumber}}</b>",
];

const LABEL_PAYLOAD = {
  rollId: "x", barcode: "BC-1", status: "STOCK", qualityGrade: "", widthCm: 150, lengthMeters: 47.5, weightKg: 14,
  markedForKartela: false, itemCode: "PA", itemName: HOSTILE.comment, itemNameDefault: "Pamuk", itemNameSource: "DEFAULT",
  colorCode: null, colorName: HOSTILE.css, colorNameDefault: null, colorNameSource: null, customerName: HOSTILE.quote,
  customerId: null, orderNumber: HOSTILE.scheme, orderLineId: null, batchNumber: HOSTILE.marker, printedAt: new Date().toISOString(),
} as unknown as LabelPayload;

function section2(): void {
  console.log("\n=== §2 Doldurma sonrası: değer ve döngü yapıyı bozamaz ===");
  for (const tpl of TRAVELER_HOSTILE_TEMPLATES) {
    const out = renderRawTemplate(tpl, travelerCtx(""));
    const p = oracle(out);
    check(`refakat: ${tpl.slice(0, 48)}`, p.length === 0, p.join("; ") || out.slice(0, 80));
  }
  const qrOut = renderRawTemplate("<div>{{qrSvg}}</div><i>{{workOrderNumber}}</i>", travelerCtx(QR));
  check("sunucu QR SVG'si BAYT-BAYT ve TEK kez (değerdeki sahte işaret SVG doğurmaz)", qrOut.split(QR).length === 2, qrOut);
  check("QR dışındaki çıktı temiz", oracle(qrOut.replace(QR, "")).length === 0);

  const label =
    "<!doctype html><html><head><style>.n{font-size:{{itemName}}} .c{color:{{colorName}}}</style></head><body>" +
    "<!-- {{itemName}} --><div title='{{customerName}}'>{{itemName}}</div><a href=\"{{orderNumber}}\">s</a>" +
    "<img src=\"{{barcode}}\"><b>{{batchNumber}}</b>{{barcodeSvg}}</body></html>";
  const lab = applyRawCode(label, LABEL_PAYLOAD, PrinterLanguage.RASTER_HTML, { barcodeSvg: QR, qrSvg: "<svg></svg>" });
  check("etiket RASTER_HTML: barkod SVG'si BAYT-BAYT ve TEK kez", lab.split(QR).length === 2, lab.slice(0, 120));
  const lp = oracle(lab.replace(QR, ""));
  check("etiket RASTER_HTML: düşmanca değerlerle çıktı temiz", lp.length === 0, lp.join("; "));
  const native = applyRawCode("^FD{{itemName}}^FS<script>", LABEL_PAYLOAD, PrinterLanguage.ZPL);
  check("yerli yazıcı dili (ZPL) HTML temizliğine girmez (komut çerçevesi korunur)", native.startsWith("^FD") && native.endsWith("^FS<script>"), native);
}

// ── §3 Meşru külliyat ──────────────────────────────────────────────────────────────────
const LEGIT_TRAVELER = `<style>
  @page { size: A5; margin: 8mm; }
  .kart { font-family: Arial, sans-serif; font-size: 11px; }
  table.adim { width: 100%; border-collapse: collapse; }
  table.adim td, table.adim th { border: 1px solid #333; padding: 2px 4px; }
  .logo { background: url(data:image/png;base64,iVBORw0KGgo=) no-repeat; width: 40px; height: 20px; }
  @media print { .ekran { display: none; } }
</style>
<div class="kart">
  <div class="baslik"><span class="logo"></span><h2>{{companyName}}</h2><div>{{qrSvg}}</div></div>
  <!-- Ürün bilgisi -->
  <p><b>İş Emri:</b> {{workOrderNumber}} &nbsp;·&nbsp; <b>Ürün:</b> {{itemCode}} — {{itemName}} &amp; {{colorName}}</p>
  <table class="adim" cellpadding="0" cellspacing="0">
    <thead><tr><th>#</th><th>İstasyon</th><th>Fason</th><th>Not</th><th>Onay</th></tr></thead>
    <tbody>{{#steps}}<tr><td>{{seq}}</td><td>{{stationName}}</td><td>{{subcontractorName}}</td><td>{{notes}}</td><td><input type="checkbox"></td></tr>{{/steps}}</tbody>
  </table>
  <ul>{{#batches}}<li>{{batchNumber}}: {{rollCount}} top / {{quantity}} m</li>{{/batches}}</ul>
  <hr>
  <p style="font-size: 9px; color: #555">{{footerNote}} · <a href="https://etkiliyazilim.com">site</a> · <a href="mailto:destek@ornek.com.tr">destek</a></p>
  <img src="data:image/png;base64,iVBORw0KGgo=" alt="logo" width="40"><br>
  <textarea rows="3" cols="40"></textarea>
</div>`;

const LEGIT_LABEL = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>Top Etiketi</title>
<style>
  @page { size: 100mm 60mm; margin: 0; }
  body { margin: 0; font-family: "DejaVu Sans", Arial, sans-serif; }
  .satir { display: flex; gap: 2mm; font-size: 9pt; }
  .kod svg { width: 60mm; height: 12mm; }
</style>
</head>
<body>
<div class="satir"><b>{{itemName}}</b></div>
<div class="satir"><span>Renk: {{colorName}}</span><span>En: {{widthCm}}</span><span>Kat: {{foldType}}</span></div>
<div class="kod">{{barcodeSvg}}</div>
<div style="position: absolute; right: 2mm; bottom: 2mm">{{qrSvg}}</div>
</body>
</html>`;

const LEGIT_CANONICAL = [
  "<div><b>{{itemName}}</b></div>",
  "<b>{{itemName}}</b>",
  `<h1>{{itemName}}</h1><i>{{workOrderNumber}}</i><div>{{qrSvg}}</div>
<table>{{#steps}}<tr><td>{{seq}}</td><td>{{stationName}}</td><td>{{subcontractorName}}</td></tr>{{/steps}}</table>
<p>[{{yokBoyleAlan}}]</p>`,
  LEGIT_TRAVELER,
  LEGIT_LABEL,
];

const LEGIT_EQUIVALENT: ReadonlyArray<readonly [string, string]> = [
  ["<TABLE border=1><TR><TD class='x'>{{itemName}}</TD></TR></TABLE><br/>", '<table border="1"><tr><td class="x">{{itemName}}</td></tr></table><br>'],
  ["<P ALIGN=center>A</P><font face='Arial' color=red>x</font>", '<p align="center">A</p><font face="Arial" color="red">x</font>'],
  ['<div style="font-family: &quot;Arial&quot;">x</div>', '<div style="font-family: &quot;Arial&quot;">x</div>'],
];

function section3(): void {
  console.log("\n=== §3 Meşru külliyat korunur ===");
  for (const tpl of LEGIT_CANONICAL) {
    const r = sanitizeUserHtml(tpl);
    check(`kanonik meşru şablon BAYT-BAYT aynı, kesilen yok: ${tpl.slice(0, 40).replace(/\n/g, " ")}`, r.html === tpl && r.removed.length === 0, r.removed.join(", "));
  }
  for (const [input, expected] of LEGIT_EQUIVALENT) {
    const r = sanitizeUserHtml(input);
    check(`kanonik olmayan yazım eşdeğere çevrilir, kesilen yok: ${input.slice(0, 40)}`, r.html === expected && r.removed.length === 0, `${r.html} · ${r.removed.join(",")}`);
  }
  check("stüdyo: temiz şablonda uyarı yok", describeSanitization(LEGIT_TRAVELER).length === 0);
}

// ── §4 İdempotentlik + tohumlu bulanık test ────────────────────────────────────────────
const FUZZ_PARTS = [
  "<", ">", '"', "'", "=", "/", " ", "\n", "\t", "\f", "a", "x", "-", "!", "&", ";", "#", "(", ")", ":", "\\",
  "<script>", "</script>", "<!--", "-->", "--!>", "<style>", "</style>", "<title>", "</title>", "<img src=x ",
  "onerror=", "alert(1)", "javascript:", "&#106;", "&colon;", "&Tab;", "{{#steps}}", "{{/steps}}", "{{itemName}}",
  "<svg>", "</svg>", '<a href="', "url(", "u\\72l(", "//s/x", "@import ", "<noscript>", "</noscript>", "<textarea>",
  "</textarea>", "<p title=\"", "<div style=\"", "data:text/html,", "file://s/p", "<!doctype html>", "<![CDATA[",
];

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function section4(): void {
  console.log("\n=== §4 İdempotentlik + bulanık test ===");
  const corpus = [...Object.values(ATTACKS).flat(), ...LEGIT_CANONICAL, ...LEGIT_EQUIVALENT.map(([i]) => i)];
  const notIdem = corpus.filter((x) => clean(clean(x)) !== clean(x));
  check(`külliyat (${corpus.length}) idempotent: s(s(x)) = s(x)`, notIdem.length === 0, notIdem.map((x) => x.slice(0, 40)).join(" | "));
  // Derin kampanya: BEKCI_FUZZ_TOHUM / BEKCI_FUZZ_SAYI (varsayılan koşum sabit tohumla, belirlenimli).
  const seed = Number(process.env.BEKCI_FUZZ_TOHUM ?? 20261001);
  const rnd = prng(seed);
  const RUNS = Number(process.env.BEKCI_FUZZ_SAYI ?? 4000);
  const failures: string[] = [];
  for (let n = 0; n < RUNS && failures.length < 5; n++) {
    let doc = "";
    const len = 1 + Math.floor(rnd() * 30);
    for (let k = 0; k < len; k++) doc += FUZZ_PARTS[Math.floor(rnd() * FUZZ_PARTS.length)];
    const once = clean(doc);
    const p = oracle(once);
    const filled = oracle(renderRawTemplate(doc, travelerCtx("")));
    if (p.length) failures.push(`${JSON.stringify(doc)} → ${p.join("; ")}`);
    else if (clean(once) !== once) failures.push(`idempotent değil: ${JSON.stringify(doc)}`);
    else if (filled.length) failures.push(`doldurma sonrası: ${JSON.stringify(doc)} → ${filled.join("; ")}`);
  }
  check(`bulanık test: ${RUNS} rastgele belge (tohum ${seed}) temiz + idempotent + doldurma sonrası temiz`, failures.length === 0, failures.join(" | "));
}

// ── §5 KALICI SONDA: eski temizleyici açık veriyordu; kahin kör değil ───────────────────
function section5(): void {
  console.log("\n=== §5 K-sonda: eski düzenli-ifade temizleyicisi + kahin duyarlılığı ===");
  const nested = legacySanitize("<scr<script></script>ipt>alert(1)</scr<script></script>ipt>");
  check("K1 iç içe yerleştirme: ESKİ temizleyici <script> doğuruyordu", /<script>alert\(1\)<\/script>/.test(nested), nested);
  const sep = legacySanitize('<img src="x"/onerror="alert(1)">');
  check("K2 boşluksuz ayırıcı: ESKİ temizleyici onerror bırakıyordu", /onerror\s*=/.test(sep), sep);
  const ent = legacySanitize('<a href="&#106;avascript:alert(1)">a</a>');
  check("K3 varlık kodlu şema: ESKİ temizleyici javascript: bırakıyordu", (oracleDecode(ent) ?? "").includes("javascript:"), ent);
  check("K4 aynı üç girdi YENİ temizleyicide kahin-temiz", [nested, sep, ent].length === 3 &&
    ["<scr<script></script>ipt>alert(1)</scr<script></script>ipt>", '<img src="x"/onerror="alert(1)">', '<a href="&#106;avascript:alert(1)">a</a>']
      .every((x) => oracle(clean(x)).length === 0));
  const leaked = Object.values(ATTACKS).flat().filter((x) => {
    const old = legacySanitize(x);
    return /on[a-z]+\s*=|<script|<svg|<iframe|srcdoc|url\(|@import|file:|<noscript/i.test(oracleDecode(old) ?? old);
  });
  // Ölçüldü 2026-10-01: 37 örneğin 15'i eski temizleyiciden sızıyor; taban 12 (külliyat küçülürse ya da dedektör körleşirse kırmızı).
  check("K5 eski temizleyiciden SIZAN örnek sayısı ≥ 12 (külliyat ayırt edici)", leaked.length >= 12, `${leaked.length}`);
  const known = ['<img src="x" onerror="a">', '<a href="javascript:x">y</a>', '<div style="background:url(//s/x)">z</div>', "<!-- a -- b -->", "<p title='x'>"];
  const blind = known.filter((x) => oracle(x).length === 0);
  check("K6 kahin bilinen kötü/kanonik dışı girdiyi YAKALAR", blind.length === 0, blind.join(" | "));
}

// ── §6 Bağlama: kayıt ve render yolları temizleyiciden geçer ───────────────────────────
function section6(): void {
  console.log("\n=== §6 Bağlama ===");
  const read = (p: string): string => readFileSync(resolve(__dirname, "..", p), "utf8");
  const svc = read("src/services/traveler-template.service.ts");
  const raw = read("src/services/document-render/traveler-card-raw.ts");
  const labelCode = read("src/services/helpers/label-rawcode.ts");
  const labelSvc = read("src/services/label-template.service.ts");
  check("refakat şablonu kaydı temizler (shapeHtml)", /return sanitizeTemplateHtml\(raw\);/.test(svc));
  check("refakat render: şablon → doldur → yeniden temizle (renderUserTemplate)", /return renderUserTemplate\(/.test(raw));
  check("refakat temizleyicisi izin listesine devreder; eski kural listesi yok", /return sanitizeUserHtml\(html\)\.html;/.test(raw) && !/STRIP_RULES/.test(raw));
  check("etiket render: RASTER_HTML dalı renderUserTemplate'ten geçer", /if \(language === PrinterLanguage\.RASTER_HTML\) \{\s*return renderUserTemplate\(/.test(labelCode));
  check("etiket kaydı: RASTER_HTML ham kodu temizlenir (normalizeRawCode)", /k === "RASTER_HTML" \? sanitizeUserHtml\(v\)\.html : v/.test(labelSvc));
  const evil = '<div onclick="alert(1)">x</div><script>alert(2)</script><iframe src="http://k"></iframe><a href="javascript:alert(3)">y</a>';
  const cats = describeSanitization(evil);
  check("stüdyo /inspect: dört sınıf ayrı ayrı raporlanır", ["olay özniteliği", "script etiketi", "gömülü içerik etiketi", "script şeması"].every((c) => cats.includes(c)), cats.join(", "));
}

function main(): void {
  section1();
  section2();
  section3();
  section4();
  section5();
  section6();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
