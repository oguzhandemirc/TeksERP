// =============================================================================
// Test: Belge şablonu YÖNERGE DERLEYİCİSİ — data-* → Liquid, konumlu Türkçe hata (T1A)
// Çalıştır: npx tsx scripts/test_belge_yonerge_derleyici.ts   (DB'siz — sorgu atmaz)
// =============================================================================
// İDDİA: görsel kipin data-each/if/if-not/alan+filtre/bag-src yönergeleri Liquid'e
// derlenir; yönergesiz baytlar AYNEN kalır; hata "Satır L, sütun C" ile kaynaktaki
// özniteliğe düşer (Liquid'in çalışma anı hatası dahil); derinlik ≤8; html/body yasak;
// görsel kipte ham `{% %}` kod kipi önerisi doğurur.
//   §1 yönergesiz kaynak bayt-aynı · §2 örnek tablo derlenir ve render edilir
//   §3 dilbilgisi hataları + konum · §4 derinlik 8 geçer / 9 düşer · §5 html/body yasak
//   §6 ham Liquid → editMode CODE önerisi · §7 render hatası kaynak konumuna eşlenir
// Negatif sonda: konum haritası kimlik döndürünce (§7) kırmızı — harita satırına bkz.
// GEREKLİ Mİ: evet — editördeki hata şeridinin satır/sütunu bu haritadan gelir.
// =============================================================================
import { docNum } from "../src/services/document-render/fmt-num";
import { LiquidTemplateError, parseLiquid, renderLiquid } from "../src/services/document-template/motor/liquid";
import { renderTemplate, TemplateRenderError } from "../src/services/document-template/motor/render";
import { compileDirectives, DIRECTIVE_MAX_DEPTH, formatIssue } from "../src/services/document-template/motor/yonerge";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}
const num = docNum({ numberRounding: "HALF_UP" });
function renderCompiled(liquid: string, ctx: Record<string, unknown>): string {
  return renderLiquid({ templates: parseLiquid(liquid), context: ctx, num, marker: (k) => `[[${k}]]`, svg: {} });
}

// ── §1 yönergesiz kaynak ────────────────────────────────────────────────────────
console.log("\n§1 — yönergesiz kaynak bayt-aynı");
const plain = `<div class="a" title='x > y'>\n  <!-- <p data-if="x"> yorum --><style>p[data-if]{color:red}</style>\n  <p>{{ belge.no }}</p><br/><img src="data:image/png;base64,AA">\n</div>`;
const p1 = compileDirectives(plain);
check("yönergesiz kaynak bayt-aynı", p1.liquid === plain && p1.errors.length === 0, JSON.stringify(p1.liquid.slice(0, 80)));
check("yorum ve style içindeki data-* dokunulmaz", p1.liquid.includes('<p data-if="x">') && p1.liquid.includes("p[data-if]"));

// ── §2 örnek tablo ───────────────────────────────────────────────────────────────
console.log("\n§2 — örnek tablo derlenir ve render edilir");
const table = [
  `<table class="kalem">`,
  `  <tr data-each="satir in tablolar.kalemler" data-if="satir.metre > 0" class="r">`,
  `    <td data-alan="satir.urun">Ürün</td>`,
  `    <td data-alan="satir.metre" data-filtre="metre: 1">0</td>`,
  `    <td><span data-if-not="satir.not == blank" data-alan="satir.not">not</span></td>`,
  `  </tr>`,
  `</table>`,
  `<img data-bag-src="firma.logo" src="ornek.png" alt="logo">`,
].join("\n");
const c2 = compileDirectives(table);
check("hata yok", c2.errors.length === 0, c2.errors.map(formatIssue).join(" | "));
const wantLiquid = [
  `<table class="kalem">`,
  `  {% for satir in tablolar.kalemler %}{% if satir.metre > 0 %}<tr class="r">`,
  `    <td>{{ satir.urun }}</td>`,
  `    <td>{{ satir.metre | metre: 1 }}</td>`,
  `    <td>{% unless satir.not == blank %}<span>{{ satir.not }}</span>{% endunless %}</td>`,
  `  </tr>{% endif %}{% endfor %}`,
  `</table>`,
  `<img alt="logo" src="{{ firma.logo }}">`,
].join("\n");
check("derlenmiş Liquid beklenen metin", c2.liquid === wantLiquid, c2.liquid === wantLiquid ? "" : `\n${c2.liquid}`);
const ctx = {
  tablolar: { kalemler: [{ urun: "Poplin <A>", metre: 12.34, not: "acil" }, { urun: "Saten", metre: 0, not: null }, { urun: "Keten", metre: 5, not: "" }] },
  firma: { logo: "data:image/png;base64,AA" },
};
const out2 = renderCompiled(c2.liquid, ctx);
check("render: süzgeç + filtre + kaçış", out2.includes("<td>Poplin &lt;A&gt;</td>") && out2.includes("12,3 m") && !out2.includes("Saten") && out2.includes("<span>acil</span>"), out2.replace(/\s+/g, " ").slice(0, 200));
check("render: boş not satırında span yok", (out2.match(/<span>/g) ?? []).length === 1);
check("gidiş-dönüş: aynı kaynak aynı Liquid (deterministik)", compileDirectives(table).liquid === c2.liquid);

// ── §3 dilbilgisi hataları + konum ─────────────────────────────────────────────────
console.log("\n§3 — dilbilgisi hataları satır/sütunla");
const errCases: Array<[string, RegExp, number, number]> = [
  [`<p>\n  <b data-each="satir tablolar">x</b></p>`, /data-each biçimi/, 2, 17],
  [`<i data-if="a.b ==">x</i>`, /sonrasında değer/, 1, 13],
  [`<i data-if="a.b and">x</i>`, /alan yolu bekleniyordu/, 1, 13],
  [`<i data-if="a.b xor c">x</i>`, /'and' ya da 'or'/, 1, 13],
  [`<i data-if="a.b == '{{x}}'">x</i>`, /değer bekleniyordu/, 1, 13],
  [`<i data-alan="a.b" data-filtre="date">x</i>`, /izinsiz filtre: 'date'/, 1, 33],
  [`<i data-alan="a.b" data-filtre="sayi: x">x</i>`, /argümanı geçersiz/, 1, 33],
  [`<i data-filtre="sayi">x</i>`, /yalnız data-alan ile/, 1, 4],
  [`<br data-alan="a">`, /data-alan <br>/, 1, 5],
  [`<p data-bag-src="a.b">x</p>`, /yalnız <img>/, 1, 4],
  [`<p data-if="a" data-if-not="b">x</p>`, /birlikte kullanılamaz/, 1, 16],
  [`<div data-if="a">\n<p>x`, /kapanışı yok/, 1, 1],
  [`<p data-alan="a"><b data-if="c">x</b></p>`, /data-alan içeriği/, 1, 18],
  [`<p data-alan="a{{b}}">x</p>`, /geçersiz alan yolu/, 1, 15],
];
for (const [src, re, line, col] of errCases) {
  const r = compileDirectives(src);
  const e = r.errors.find((x) => re.test(x.mesaj));
  check(`${re.source} → ${line}:${col}`, !!e && e.satir === line && e.sutun === col, r.errors.map(formatIssue).join(" | ") || "(hata yok)");
}
check("hata metni biçimi", formatIssue({ satir: 3, sutun: 7, mesaj: "x" }) === "Satır 3, sütun 7: x");

// ── §4 derinlik ──────────────────────────────────────────────────────────────────
console.log(`\n§4 — iç içe derinlik ≤${DIRECTIVE_MAX_DEPTH}`);
const nest = (n: number): string => "<div data-if=\"a\">".repeat(n) + "x" + "</div>".repeat(n);
check("derinlik 8 geçer", compileDirectives(nest(8)).errors.length === 0);
const d9 = compileDirectives(nest(9));
check("derinlik 9 düşer", d9.errors.some((e) => /derinliği 8/.test(e.mesaj)), d9.errors.map(formatIssue).join(" | "));
const each4 = "<div data-each=\"a in b\" data-if=\"a\">".repeat(4) + "x" + "</div>".repeat(4);
check("each+if aynı öğede 2 kat sayılır (4 öğe = 8)", compileDirectives(each4).errors.length === 0);
const each5 = "<div data-each=\"a in b\" data-if=\"a\">".repeat(5) + "x" + "</div>".repeat(5);
check("5 öğe each+if = 10 → düşer", compileDirectives(each5).errors.length > 0);

// ── §5 html/body ─────────────────────────────────────────────────────────────────
console.log("\n§5 — html/head/body üzerinde yönerge yasak");
for (const tag of ["html", "head", "body"]) {
  const r = compileDirectives(`<${tag} data-if="a">x</${tag}>`);
  check(`<${tag}> yönergesi reddedilir`, r.errors.some((e) => e.mesaj.includes(`<${tag}> üzerinde yönerge`)));
}

// ── §6 ham Liquid ────────────────────────────────────────────────────────────────
console.log("\n§6 — görsel kipte ham Liquid → kod kipi önerisi");
const raw = compileDirectives(`<p>x</p>\n<p>{% if a %}y{% endif %}</p>`);
check("öneri editMode CODE", raw.suggestion?.editMode === "CODE");
check("uyarı konumlu", raw.warnings.some((w) => w.startsWith("Satır 2, sütun 4:")), raw.warnings.join(" | "));
check("kod kipinde öneri yok", compileDirectives(`{% if a %}y{% endif %}`, "CODE").suggestion === null);

// ── §7 render hatası kaynak konumuna ────────────────────────────────────────────
console.log("\n§7 — Liquid çalışma anı hatası kaynaktaki özniteliğe düşer");
const src7 = `<table>\n  <tr data-each="satir in tablolar.kalemler">\n    <td data-alan="satir.urnu">x</td>\n  </tr>\n</table>`;
let issue: { satir: number | null; sutun: number | null; mesaj: string } | undefined;
try {
  renderTemplate({ sourceHtml: src7, editMode: "VISUAL", css: "", pageSettings: null }, { context: ctx });
} catch (e) {
  if (e instanceof TemplateRenderError) issue = e.issues[0];
  else throw e;
}
check("tanımsız alan hatası", !!issue && /Tanımsız alan/.test(issue.mesaj), JSON.stringify(issue));
check("konum 3:20 (data-alan değeri)", issue?.satir === 3 && issue?.sutun === 20, JSON.stringify(issue));
const src7b = `<p>a</p>\n<p data-if="belge.yok">b</p>`;
let issueB: { satir: number | null; sutun: number | null } | undefined;
try {
  renderTemplate({ sourceHtml: src7b, css: "", pageSettings: null }, { context: { belge: {} } });
} catch (e) {
  if (e instanceof TemplateRenderError) issueB = e.issues[0];
  else throw e;
}
check("data-if tanımsız yol → 2:4 (yönerge özniteliği)", issueB?.satir === 2 && issueB?.sutun === 4, JSON.stringify(issueB));
let codeIssue: { satir: number | null; sutun: number | null } | undefined;
try {
  renderTemplate({ sourceHtml: "<p>\n  {{ x | date }}</p>", editMode: "CODE", css: "", pageSettings: null }, { context: { x: 1 } });
} catch (e) {
  if (e instanceof TemplateRenderError) codeIssue = e.issues[0];
  else throw e;
}
check("kod kipi parse hatası → 2:3", codeIssue?.satir === 2 && codeIssue?.sutun === 3, JSON.stringify(codeIssue));
check("LiquidTemplateError dışa açık (kayıt ofsetli)", (() => {
  try {
    parseLiquid("{{ a | date }}");
    return false;
  } catch (e) {
    return e instanceof LiquidTemplateError && e.record.offset === 0;
  }
})());

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail ? 1 : 0;
