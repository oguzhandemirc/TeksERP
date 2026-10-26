// =============================================================================
// Test: Belge şablonu Liquid FİLTRELERİ — fabrika saati, Türkçe harf, sayı/para rejimi (T1A)
// Çalıştır: npx tsx scripts/test_belge_liquid_filtre.ts   (DB'siz — sorgu atmaz)
// =============================================================================
// İDDİA: şablon saat dilimini, Türkçe büyük harfi ve sayı/para biçimini ATLATAMAZ — filtreler
// belge renderer'larının tek kaynak yardımcılarına bağlıdır:
//   §1 tarih/tarih_saat/takvim/saat fabrika diliminde — süreç TZ=UTC iken de aynı (alt süreç)
//   §2 upcase/downcase/capitalize Türkçe (istanbul → İSTANBUL, ILIK → ılık)
//   §3 sayi/metre/kg/adet docNum rejimi (ticari yuvarlama), hane argümanı 0–6
//   §4 para ↔ finans `fmtMoney` BAYT-EŞİT (makbuz renderer'ının GENEL TOPLAM hücresinden okunur)
//   §5 yaziyla tablosu (Türkçe tutar; "bir bin" yok, "bir milyon" var; kuruş ticari yuvarlama)
//   §6 barkod/qr işaretli SVG + satir_kir + css_metin kaçışı
// Negatif sonda: `date` izin listesine eklenince bu bekçi §1'de kırmızı (date açık kalmamalı).
// GEREKLİ Mİ: evet — şablon yazarının elindeki tek biçim yüzeyi bu filtreler.
// =============================================================================
import { spawnSync } from "node:child_process";
import { docNum } from "../src/services/document-render/fmt-num";
import { renderPaymentReceiptHtml } from "../src/services/document-render/finance-doc.html";
import { SAMPLE_PRINTED_DOCS } from "../src/services/document-render/sample-data";
import type { PrintedDocSnapshot } from "../src/services/printed-document.service";
import { LiquidTemplateError, parseLiquid, renderLiquid } from "../src/services/document-template/motor/liquid";

const num = docNum({ numberRounding: "HALF_UP" });
function run(src: string, ctx: Record<string, unknown> = {}, svg: Record<string, string> = {}): string {
  try {
    return renderLiquid({ templates: parseLiquid(src), context: ctx, num, marker: (k) => `[[${k}]]`, svg });
  } catch (e) {
    if (e instanceof LiquidTemplateError) return `HATA: ${e.record.message}`;
    throw e;
  }
}

const DATES = { t: "2026-08-01T22:30:00Z", d: "2026-08-01", gece: "2026-12-31T21:00:00Z" };
const DATE_CASES: Array<[string, string]> = [
  ["{{ t | tarih }}", "02.08.2026"],
  ["{{ t | tarih_saat }}", "02.08.2026 01:30"],
  ["{{ t | saat }}", "01:30"],
  ["{{ d | takvim }}", "01.08.2026"],
  ["{{ gece | tarih }}", "01.01.2027"],
  ["{{ bos | tarih }}", ""],
  ["{{ t | date: '%d.%m.%Y' }}", "HATA: Tarih için 'tarih', 'tarih_saat', 'takvim' ya da 'saat' filtresini kullanın (fabrika saat dilimi)"],
];

// Alt süreç kipi: yalnız tarih sonuçlarını JSON basar (TZ=UTC sondası).
if (process.env.BEKCI_TARIH_ALT === "1") {
  console.log(JSON.stringify(DATE_CASES.map(([src]) => run(src, { ...DATES, bos: null }))));
  process.exit(0);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}
function eq(label: string, got: string, want: string): void {
  check(label, got === want, got === want ? "" : `beklenen ${JSON.stringify(want)}, gelen ${JSON.stringify(got)}`);
}

// ── §1 fabrika saati ────────────────────────────────────────────────────────────
console.log("\n§1 — tarih filtreleri fabrika diliminde (yerel süreç + TZ=UTC alt süreç)");
for (const [src, want] of DATE_CASES) eq(`yerel: ${src}`, run(src, { ...DATES, bos: null }), want);
const child = spawnSync(process.execPath, [...process.execArgv, __filename], {
  env: { ...process.env, TZ: "UTC", BEKCI_TARIH_ALT: "1" },
  encoding: "utf8",
});
let childOut: string[] = [];
try {
  childOut = JSON.parse(child.stdout.trim().split("\n").pop() ?? "[]") as string[];
} catch {
  childOut = [];
}
check("TZ=UTC alt süreci koştu", child.status === 0 && childOut.length === DATE_CASES.length, child.stderr?.slice(0, 200));
DATE_CASES.forEach(([src, want], i) => eq(`TZ=UTC: ${src}`, childOut[i] ?? "(yok)", want));

// ── §2 Türkçe harf ─────────────────────────────────────────────────────────────
console.log("\n§2 — Türkçe büyük/küçük harf");
eq("upcase istanbul", run("{{ s | upcase }}", { s: "istanbul ılık" }), "İSTANBUL ILIK");
eq("downcase ILIK İZMİR", run("{{ s | downcase }}", { s: "ILIK İZMİR" }), "ılık izmir");
eq("capitalize", run("{{ s | capitalize }}", { s: "istanbul IŞIK" }), "İstanbul ışık");

// ── §3 sayı rejimi ─────────────────────────────────────────────────────────────
console.log("\n§3 — sayı filtreleri (docNum, ticari yuvarlama)");
const n = { n: "1234.565", m: 1.005, z: 0, neg: -1234.5, bos: null, metin: "abc" };
eq("sayi varsayılan 2 hane", run("{{ n | sayi }}", n), "1.234,57");
eq("sayi: 0", run("{{ n | sayi: 0 }}", n), "1.235");
eq("sayi 1.005 → 1,01 (ikili yuvarlama değil)", run("{{ m | sayi }}", n), "1,01");
eq("metre: 1", run("{{ n | metre: 1 }}", n), "1.234,6 m");
eq("kg", run("{{ n | kg }}", n), "1.234,57 kg");
eq("adet", run("{{ n | adet }}", n), "1.235 adet");
eq("negatif", run("{{ neg | sayi }}", n), "-1.234,50");
eq("sıfır", run("{{ z | sayi }}", n), "0,00");
eq("boş → ''", run("{{ bos | metre }}", n), "");
eq("metin → ''", run("{{ metin | sayi }}", n), "");
check("hane 9 → Türkçe hata", /hane 0–6/.test(run("{{ n | sayi: 9 }}", n)));
check("hesap filtresi yok (plus)", /hesap yapmaz/.test(run("{{ n | plus: 1 }}", n)));

// ── §4 para ↔ fmtMoney ─────────────────────────────────────────────────────────
console.log("\n§4 — para ↔ makbuz renderer'ının fmtMoney çıktısı");
const receipt = SAMPLE_PRINTED_DOCS.PAYMENT_RECEIPT as Record<string, unknown>;
function fmtMoneyOracle(amount: string | null): string {
  const snapshot = {
    company: { name: "Örnek", letterhead: null, logoHash: null },
    docConfigOverride: null,
    doc: { ...receipt, amount, header: { ...(receipt.header as object), currency: "TRY" } },
  } as unknown as PrintedDocSnapshot;
  const html = renderPaymentReceiptHtml(snapshot, {});
  const m = /<div class="row grand"><span>[^<]*<\/span><b>([\s\S]*?) TRY<\/b><\/div>/.exec(html);
  return m ? m[1]! : "(bulunamadı)";
}
for (const v of ["50000.00", "0", "0.005", "-1234.5", "1234567.891", "12", "abc<", null, ""]) {
  const oracle = fmtMoneyOracle(v);
  const got = run("{{ v | para: 'TRY' }}", { v });
  eq(`para ${JSON.stringify(v)} ↔ fmtMoney`, got, `${oracle} TRY`);
}
eq("para birimsiz", run("{{ v | para }}", { v: "50000" }), "50.000,00");
check("para birimi kodu denetlenir", /üç büyük harfli/.test(run("{{ v | para: 'tl' }}", { v: "1" })));

// ── §5 yaziyla ─────────────────────────────────────────────────────────────────
console.log("\n§5 — yaziyla tablosu");
const WORDS: Array<[unknown, string]> = [
  [0, "Yalnız sıfır TL"],
  [0.5, "Yalnız elli Kr"],
  [1, "Yalnız bir TL"],
  [10, "Yalnız on TL"],
  [100, "Yalnız yüz TL"],
  [1000, "Yalnız bin TL"],
  [1001, "Yalnız bin bir TL"],
  [2000, "Yalnız iki bin TL"],
  [1_000_000, "Yalnız bir milyon TL"],
  [1_001_000, "Yalnız bir milyon bin TL"],
  ["1234.565", "Yalnız bin iki yüz otuz dört TL elli yedi Kr"],
  [-15.2, "Yalnız eksi on beş TL yirmi Kr"],
  [987_654_321.09, "Yalnız dokuz yüz seksen yedi milyon altı yüz elli dört bin üç yüz yirmi bir TL dokuz Kr"],
];
for (const [v, want] of WORDS) eq(`yaziyla ${JSON.stringify(v)}`, run("{{ v | yaziyla }}", { v }), want);
eq("yaziyla USD", run("{{ v | yaziyla: 'USD' }}", { v: 12.3 }), "Yalnız on iki ABD Doları otuz Sent");
check("yaziyla bilinmeyen birim → hata", /desteklemiyor/.test(run("{{ v | yaziyla: 'JPY' }}", { v: 1 })));
eq("yaziyla boş → ''", run("{{ v | yaziyla }}", { v: null }), "");
// Okunuş tek kaynağı `reports/anlati/sayi-okunus.ts` (sınır 10^12): sınırın iki yanı.
eq("yaziyla 10^12 − 1 (milyar)", run("{{ v | yaziyla }}", { v: 999_999_999_999 }), "Yalnız dokuz yüz doksan dokuz milyar dokuz yüz doksan dokuz milyon dokuz yüz doksan dokuz bin dokuz yüz doksan dokuz TL");
check("yaziyla 10^12 → Türkçe hata", /büyüklükte/.test(run("{{ v | yaziyla }}", { v: 1e12 })));

// ── §6 barkod / satir_kir / css_metin ─────────────────────────────────────────
console.log("\n§6 — barkod/qr işareti, satir_kir, css_metin");
const svg: Record<string, string> = {};
const bc = run("{{ v | barkod }}|{{ v | qr }}", { v: "TP-000123" }, svg);
eq("barkod/qr işaret basar", bc, "[[S1]]|[[S2]]");
check("SVG'ler depoya yazıldı", (svg.S1 ?? "").startsWith("<svg") && (svg.S2 ?? "").startsWith("<svg"));
check("barkod türü denetlenir", /code128/.test(run("{{ v | barkod: 'ean' }}", { v: "1" })));
eq("satir_kir önce kaçış sonra <br>", run("{{ v | satir_kir }}", { v: "a<b\nc&d" }), "a&lt;b<br>c&amp;d");
eq("css_metin tırnak/köşeli kaçışı", run("{{ v | css_metin }}", { v: 'a"b<\\' }), '"a\\22 b\\3c \\\\"');

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail ? 1 : 0;
