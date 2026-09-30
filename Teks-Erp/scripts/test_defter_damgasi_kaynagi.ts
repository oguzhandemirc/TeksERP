// =============================================================================
// Bekçi: DEFTER DAMGASI TEK KAYNAKTAN — DB gerekmez
// Çalıştır: npx tsx scripts/test_defter_damgasi_kaynagi.ts
// =============================================================================
// "Olay anı nasıl damgalanır" sorusunun cevabı `helpers/ledger-stamp.helper.ts`tir: DB saati ms'ye
// yukarı, varlığın son satırı + 1 ms. Aynı SQL kartela ve levent yardımcılarında elle kopyaydı
// (2026-09-26 birleştirildi, davranış bayt bayt aynı: SQL metni değişmeden taşındı).
//   §1 ⭐ damga SQL'i (`to_timestamp(ceil(… clock_timestamp() …))` ya da `+ interval '1 millisecond'`
//      zinciri) `src/` altında YALNIZ yardımcıda; yüklem sorgu süresi gibi çıplak `clock_timestamp()`i saymaz
//   §2 ⭐ yardımcının her damga fonksiyonu KENDİ defterinin yazarında çağrılır, iki yönlü (çağrısız fonksiyon
//      da, beyansız fonksiyon da kırmızı)
// KAPSAM BEYANI: top durum defteri (`roll_status_events`) damgasını DB tetikleyicisi verir (9b, aynı algoritma;
// `20260926170000_roll_status_event_sira` · bekçi `test_roll_status_events` §11) — mekanizma migration'dadır,
// `src/` ham SQL'i değildir; bu kapının ölçtüğü yazar kümesinde yoktur.
// Gerekli mi: doğduğu gün aynı damga SQL'i iki dosyada elle kopyaydı (kartela · levent); birleştirme aynı commit'te.
// Sonda (✓B2, bu commit; md5 ile geri alındı): ① kartela yardımcısına damga SQL'i geri kopyalanır → §1 ❌1,
// kaldırınca 10/0 (pozitif) · ② levent yazarı damga fonksiyonunu çağırmaz → §2 ❌1.
// =============================================================================
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";
import { walkTs } from "./lib/ts-tarama";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const ROOT = join(__dirname, "..");
const YARDIMCI = "src/services/helpers/ledger-stamp.helper.ts";

/** Damga fonksiyonu → kendi defterinin yazarı. Yeni damga fonksiyonu buraya yazılır (§2 iki yönlü). */
const YAZAR: Record<string, string> = {
  workOrderEventStampTx: "src/services/helpers/workorder-event.helper.ts",
  warehouseMovementStampTx: "src/services/helpers/warehouse-ledger.helper.ts",
  swatchEventStampTx: "src/services/helpers/swatch-event.helper.ts",
  warpBeamEventStampTx: "src/services/helpers/warp-beam-event.helper.ts",
  factoryTimezonePeriodStampTx: "src/services/factory-timezone.service.ts",
};

/** Damga biçimi: ms'ye yukarı yuvarlanan DB saati ya da "son satır + 1 ms" zinciri. */
const DAMGA = [
  /to_timestamp\s*\(\s*ceil\s*\(\s*extract\s*\(\s*epoch\s+FROM\s+clock_timestamp\s*\(\s*\)/i,
  /\+\s*interval\s+'1 millisecond'/i,
];
const damgaMi = (metin: string): boolean => DAMGA.some((r) => r.test(metin));

function kaynak(rel: string): ts.SourceFile {
  const abs = join(ROOT, rel);
  return ts.createSourceFile(abs, readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true);
}
function gez(n: ts.Node, fn: (n: ts.Node) => void): void {
  fn(n);
  ts.forEachChild(n, (c) => gez(c, fn));
}
/** Dizge/şablon literalinin SQL metni (yorumlar AST'de yok — açıklama satırı sayılmaz). */
function literalMetni(n: ts.Node): string | null {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) return [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(" ");
  return null;
}

console.log("§1 ⭐ Damga SQL'i yalnız ortak yardımcıda");
{
  check("yüklem damga biçimini tanır, çıplak clock_timestamp()i saymaz",
    damgaMi("to_timestamp(ceil(extract(epoch FROM clock_timestamp()) * 1000) / 1000)")
      && damgaMi(`max("createdAt") + interval '1 millisecond'`)
      && !damgaMi("SELECT max(extract(epoch FROM (clock_timestamp() - query_start)))"));
  const yerler: string[] = [];
  let yardimcida = 0;
  const dosyalar = walkTs(join(ROOT, "src")).map((a) => relative(ROOT, a));
  for (const rel of dosyalar) {
    gez(kaynak(rel), (n) => {
      const m = literalMetni(n);
      if (m === null || !damgaMi(m)) return;
      if (rel === YARDIMCI) yardimcida++;
      else yerler.push(`${rel}:${n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
    });
  }
  check("körlük zemini: ≥ 300 kaynak dosya tarandı", dosyalar.length >= 300, `${dosyalar.length}`);
  check(`yardımcıda ${Object.keys(YAZAR).length} damga sorgusu`, yardimcida === Object.keys(YAZAR).length, `${yardimcida}`);
  check("yardımcı dışında damga SQL'i yok", yerler.length === 0, yerler.join(" · "));
}

console.log("§2 ⭐ Her damga fonksiyonu kendi defterinin yazarında çağrılır (iki yönlü)");
{
  const disa: string[] = [];
  gez(kaynak(YARDIMCI), (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) disa.push(n.name.text);
  });
  const beyansiz = disa.filter((f) => !(f in YAZAR));
  const hayalet = Object.keys(YAZAR).filter((f) => !disa.includes(f));
  check("yardımcının her damga fonksiyonu beyanlı (yazarı belli)", beyansiz.length === 0, beyansiz.join(", "));
  check("beyandaki her fonksiyon yardımcıda var", hayalet.length === 0, hayalet.join(", "));
  for (const [fn, yazar] of Object.entries(YAZAR)) {
    let cagri = 0;
    gez(kaynak(yazar), (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === fn) cagri++;
    });
    check(`${fn} → ${yazar.replace("src/services/helpers/", "")} çağırır`, cagri > 0, `${cagri} çağrı`);
  }
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
