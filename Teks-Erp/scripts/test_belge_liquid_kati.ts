// =============================================================================
// Test: Belge şablonu Liquid motoru KATI — izin listesi, kaçış, prototip, sınırlar (T1A)
// Çalıştır: npx tsx scripts/test_belge_liquid_kati.ts   (DB'siz — sorgu atmaz)
// =============================================================================
// İDDİA: kullanıcı şablonu JS çalıştıramaz, dosya/başka şablon çağıramaz, prototip
// zincirine erişemez, tanımsız alan/filtre sessiz geçmez, veri kaçışsız basılamaz
// (`{{ }}`, `{% echo %}`, `{% cycle %}` aynı kaçıştan), süre/bellek/çıktı sınırlıdır.
//   §1 motorun KAYITLI etiket/filtre kümesi izin listesine TAM EŞİT (sürüm yükseltmesi yeni ad sızdıramaz)
//   §2 RED etiket/filtre → Türkçe gerekçeli parse hatası
//   §3 tanımsız alan/filtre → hata; prototip (constructor/__proto__/toString) erişilemez
//   §4 kaçış: {{ }}, echo, cycle, liquid bloğu, capture, assign → HTML kaçışlı; işaret karakteri ayıklanır
//   §5 sınırlar: süre (2000 ms), bellek, capture katlama (4 MB), çıktı 4 MB, parse 200k
// Negatif sonda: `date`'i ALLOWED_BUILTIN_FILTERS'e eklemek → §1 ve §2 kırmızı (harita satırı).
// GEREKLİ Mİ: evet — echo/cycle/capture açıkları LiquidJS 10.30'da ÖLÇÜLDÜ (2026-10-24; §4/§5 her koşumda yeniden ölçer); sürüm sabit.
// =============================================================================
import { docNum } from "../src/services/document-render/fmt-num";
import { ALLOWED_BUILTIN_FILTERS, CUSTOM_FILTERS, REJECTED_FILTERS } from "../src/services/document-template/motor/filtreler";
import {
  ALLOWED_TAGS,
  engineRegistry,
  LiquidTemplateError,
  parseLiquid,
  REJECTED_TAGS,
  renderLiquid,
} from "../src/services/document-template/motor/liquid";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const num = docNum({ numberRounding: "HALF_UP" });
type Outcome = { ok: true; out: string } | { ok: false; msg: string; ms: number };
function run(src: string, ctx: Record<string, unknown> = {}): Outcome {
  const t0 = Date.now();
  try {
    const out = renderLiquid({ templates: parseLiquid(src), context: ctx, num, marker: (k) => `${k}`, svg: {} });
    return { ok: true, out };
  } catch (e) {
    if (!(e instanceof LiquidTemplateError)) throw e;
    return { ok: false, msg: e.record.message, ms: Date.now() - t0 };
  }
}
const msgOf = (o: Outcome): string => (o.ok ? `(çıktı) ${o.out.slice(0, 80)}` : o.msg);

// ── §1 kayıtlı küme = izin listesi ───────────────────────────────────────────────
console.log("\n§1 — motorun kayıtlı etiket/filtre kümesi");
const reg = engineRegistry();
const expectTags = [...ALLOWED_TAGS].sort();
const expectFilters = [...new Set([...ALLOWED_BUILTIN_FILTERS, ...Object.keys(CUSTOM_FILTERS)])].sort();
check("etiketler izin listesine TAM eşit", JSON.stringify(reg.tags) === JSON.stringify(expectTags), `fark: ${reg.tags.filter((t) => !expectTags.includes(t)).join(",") || "—"}`);
check("filtreler izin listesine TAM eşit", JSON.stringify(reg.filters) === JSON.stringify(expectFilters), `fazla: ${reg.filters.filter((t) => !expectFilters.includes(t)).join(",") || "—"}`);
for (const f of Object.keys(REJECTED_FILTERS)) check(`RED filtre kayıtlı DEĞİL: ${f}`, !reg.filters.includes(f));
for (const t of Object.keys(REJECTED_TAGS)) check(`RED etiket kayıtlı DEĞİL: ${t}`, !reg.tags.includes(t));

// ── §2 RED → Türkçe gerekçe ─────────────────────────────────────────────────────
console.log("\n§2 — RED etiket/filtre Türkçe gerekçeyle düşer");
const redCases: Array<[string, RegExp]> = [
  ["{{ t | date: '%Y' }}", /'tarih'/],
  ["{{ n | plus: 1 }}", /hesap yapmaz/],
  ["{{ n | divided_by: 2 }}", /hesap yapmaz/],
  ["{{ a | raw }}", /'raw' filtresi kapalı/],
  ["{{ o | json }}", /'json' filtresi kapalı/],
  ["{{ a | newline_to_br }}", /'satir_kir'/],
  ["{% include 'x' %}", /başka şablon ya da dosya/],
  ["{% render 'x' %}", /başka şablon ya da dosya/],
  ["{% layout 'x' %}", /başka şablon ya da dosya/],
  ["{% tablerow x in arr %}{% endtablerow %}", /'tablerow' kapalı/],
  ["{% increment c %}", /Sayaç etiketleri kapalı/],
  ["{{ a | olmayan_filtre }}", /Bilinmeyen ya da izinsiz filtre/],
  ["{% olmayan %}", /Bilinmeyen ya da izinsiz etiket/],
];
for (const [src, re] of redCases) {
  const o = run(src, { t: "2026-01-01", n: 1, a: "x", o: { x: 1 }, arr: [1] });
  check(`RED: ${src}`, !o.ok && re.test(o.msg), msgOf(o));
}

// ── §3 tanımsız + prototip ─────────────────────────────────────────────────────
console.log("\n§3 — tanımsız alan ve prototip erişimi");
const ctx = { o: { x: 1 }, arr: [1, 2], s: "abc" };
const undef = run("{{ yok }}", ctx);
check("tanımsız alan → 'Tanımsız alan'", !undef.ok && /Tanımsız alan: yok/.test(undef.msg), msgOf(undef));
for (const src of ["{{ o.constructor }}", "{{ o.__proto__ }}", "{{ arr.constructor }}", "{{ o.toString }}", "{{ s.constructor }}", "{{ o.hasOwnProperty }}", "{{ o.constructor.constructor }}"]) {
  const r = run(src, ctx);
  check(`prototip erişilemez: ${src}`, !r.ok && /Tanımsız alan/.test(r.msg), msgOf(r));
}
const objOut = run("{{ o }}", ctx);
check("nesne doğrudan basılamaz", !objOut.ok && /Nesne doğrudan basılamaz/.test(objOut.msg), msgOf(objOut));
// JS ifadesi Liquid'de yalnız metin/yol olarak okunur, çalışmaz.
const js = run("{{ 'x'.constructor('return 1')() }}", ctx);
check("JS ifadesi çalışmaz", !js.ok || !js.out.includes("1"), msgOf(js));
// Sınıf örneği/getter bağlamdan düşer (düz JSON gidiş-dönüşü).
class Gizli {
  get sir(): string {
    return "SIZDI";
  }
}
const getter = run("{{ g.sir }}", { g: new Gizli() });
check("bağlamdaki getter/sınıf okunamaz", !getter.ok, msgOf(getter));

// ── §4 kaçış ───────────────────────────────────────────────────────────────────
console.log("\n§4 — veri her yoldan kaçışlı basılır");
const evil = { a: "<img src=x onerror=alert(1)>", m: "S1" };
const esc = "&lt;img src=x onerror=alert(1)&gt;";
const escCases: Array<[string, string]> = [
  ["{{ a }}", esc],
  ["{% echo a %}", esc],
  ["{% cycle a, 'b' %}", esc],
  ["{% liquid\necho a\n%}", esc],
  ["{% assign z = a %}{{ z }}", esc],
  ["{% capture c %}{{ a }}{% endcapture %}{{ c }}", esc],
  ["{{ a | escape }}", esc],
  ["{{ a | upcase }}", "&lt;İMG SRC=X ONERROR=ALERT(1)&gt;"],
  ["{{ a | strip }}", esc],
];
for (const [src, want] of escCases) {
  const o = run(src, evil);
  check(`kaçışlı: ${src.replace(/\n/g, "⏎")}`, o.ok && o.out === want, msgOf(o));
}
const mk = run("{{ m }}|{% echo m %}", evil);
check("veri içindeki sunucu işareti ayıklanır (sahte SVG yeri yok)", mk.ok && !/[]/.test(mk.out), msgOf(mk));
// Filtre zinciri GuvenliHtml'i metne çevirince yeniden kaçışlanır (satir_kir sonrası append).
const chain = run("{{ a | satir_kir | append: '<b>' }}", evil);
check("güvenli parça sonrası filtre → yine kaçışlı", chain.ok && !chain.out.includes("<b>") && !chain.out.includes("<img"), msgOf(chain));

// ── §5 sınırlar ──────────────────────────────────────────────────────────────────
console.log("\n§5 — süre, bellek, çıktı ve parse sınırları");
// Gövde koşul taşır: boş döngü hızlı makinede 2000 ms altında bitebiliyordu (iç aralık bellek sayacı 16M ile tavanda, döngü büyütülemez).
const slow = run("{% for i in (1..4000) %}{% for j in (1..4000) %}{% if j > i and i > 0 %}{% endif %}{% endfor %}{% endfor %}");
check("süre sınırı (2000 ms) Türkçe düşer", !slow.ok && /süresi sınırı/.test(slow.msg) && slow.ms < 6000, `${msgOf(slow)} · ${slow.ok ? "-" : slow.ms} ms`);
const big = run("{% for i in (1..100000000) %}x{% endfor %}");
check("dev aralık → bellek/çıktı sınırı", !big.ok && /(bellek|4 MB|süresi)/.test(big.msg), msgOf(big));
const out4 = run("{% for i in (1..5000) %}{{ s }}{% endfor %}", { s: "x".repeat(1000) });
check("çıktı 4 MB sınırı", !out4.ok && /4 MB/.test(out4.msg), msgOf(out4));
const lit4 = run(`{% for i in (1..5000) %}${"y".repeat(1000)}{% endfor %}`);
check("düz HTML tekrarı da 4 MB'a sayılır", !lit4.ok && /4 MB/.test(lit4.msg), msgOf(lit4));
const fold = run("{% assign s = 'xxxxxxxxxxxxxxxx' %}{% for i in (1..40) %}{% capture s %}{{ s }}{{ s }}{% endcapture %}{% endfor %}{{ s | size }}");
check("capture katlama ~512 MB'a şişmez (sınırda düşer)", !fold.ok && /(4 MB|bellek)/.test(fold.msg), msgOf(fold));
const fold2 = run("{% capture s %}x{% endcapture %}{% for i in (1..40) %}{% capture s %}{{ s }}{{ s }}{% endcapture %}{% endfor %}ok");
check("capture katlama (yazdırılmadan) da düşer", !fold2.ok, msgOf(fold2));
const parseBig = run("x".repeat(200_001));
check("parse sınırı (200.000 karakter)", !parseBig.ok && /çok büyük/.test(parseBig.msg), msgOf(parseBig));
const cap = run("{% capture c %}{{ a }}{% endcapture %}{% if c == blank %}BOŞ{% else %}{{ c }}{% endif %}", { a: "A & B" });
check("capture çift kaçışlamaz, karşılaştırma metinle çalışır", cap.ok && cap.out === "A &amp; B", msgOf(cap));
const okSmall = run("{% for r in arr %}{{ r }},{% endfor %}", { arr: [1, 2, 3] });
check("meşru döngü çalışır", okSmall.ok && okSmall.out === "1,2,3,", msgOf(okSmall));

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail ? 1 : 0;
