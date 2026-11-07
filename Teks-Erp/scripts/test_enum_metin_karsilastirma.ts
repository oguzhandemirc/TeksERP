// =============================================================================
// MANDAL — HAM SQL'DE KOLONU METNE ÇEVİRİP KÜME KARŞILAŞTIRMASI YOK (`::text IN` / `::text = ANY`)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts enum_metin_karsilastirma   (DB'siz)
//
// ⭐ NEDEN (perf 2026-11-07): `r.status::text IN ('A','B')` enum'u metne çevirir → kolonun index'i
//    kullanılamaz ve planlayıcının satır tahmini bozulur (stock-scorecard, Adnan kopyası: Seq Scan
//    2,9 ms ↔ `r.status = ANY($1::"RollStatus"[])` ile Bitmap Index 0,76 ms; 5× veride doğrusal büyür).
//    Doğrusu parametreyi kolonun tipine çevirmek: `= ANY(${dizi}::"EnumAdı"[])` · `<> ALL(...)` (NOT IN).
//
// NE ÖLÇER (AST — yalnız şablon/dizge sabitleri; yorumdaki bahisler SAYILMAZ):
//   §1 `src/` altında `<ifade>::text [NOT] IN (` ve `<ifade>::text =|<> ANY|ALL (` YOK; şablonun
//      `${…}` parçaları birleştirilerek ölçülür (desen parça sınırına bölünse de yakalanır)
//   §2 BEYANLI İSTİSNALAR tam eşleşir: beyanlı dosyada sayı eşit; fazla = kırmızı, düşen/hayalet = kırmızı
//   §3 KALICI SONDALAR (sentetik kaynak, her koşumda): ihlal biçimleri yakalanır, düzeltilmiş biçim
//      ve yorum yakalanmaz — tarayıcının kendisi ölçülür (sessiz kapı olmasın)
//   §4 körlük zemini: taranan dosya > 100 ve SQL şablonu taşıyan bilinen dosya tarandı
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const KOK = path.join(__dirname, "..");
const SRC = path.join(KOK, "src");

/**
 * İstisnalar: değer KULLANICI GİRDİSİ ve doğrulanmamış — kolon tipine çevirmek geçersiz değerde
 * boş sonuç yerine 22P02 (500) üretirdi. Bu üç yerde metin karşılaştırması bilinçli.
 */
const ISTISNALAR: Record<string, { adet: number; neden: string }> = {
  "src/services/helpers/expense-summary.helper.ts": { adet: 1, neden: "para birimi rapor hücresinden (cell.deger) gelir, doğrulanmaz" },
  "src/services/helpers/system-log-islem.helper.ts": { adet: 1, neden: "kategori süzgeci istemciden; geçersiz kategori boş liste vermeli" },
  "src/services/reports/wip-scorecard.report.service.ts": { adet: 1, neden: "uuid (enum değil) sahip id'leri CSV'den, uuid doğrulaması yok" },
};

const DESENLER: RegExp[] = [
  /::\s*text\s+(?:not\s+)?in\s*\(/gi,
  /::\s*text\s*(?:=|<>|!=)\s*(?:any|all)\s*\(/gi,
];

function tsDosyalari(dizin: string): string[] {
  const out: string[] = [];
  for (const ad of fs.readdirSync(dizin, { withFileTypes: true })) {
    const p = path.join(dizin, ad.name);
    if (ad.isDirectory()) out.push(...tsDosyalari(p));
    else if (ad.name.endsWith(".ts") && !ad.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** Kaynaktaki her şablon/dizge sabitinin metni (şablonda `${…}` yerine ` $X `). */
function sabitMetinleri(kaynak: string, ad = "x.ts"): string[] {
  const sf = ts.createSourceFile(ad, kaynak, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const gez = (n: ts.Node): void => {
    if (ts.isNoSubstitutionTemplateLiteral(n) || ts.isStringLiteral(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) {
      out.push(n.head.text + n.templateSpans.map((s) => " $X " + s.literal.text).join(""));
      n.templateSpans.forEach((s) => gez(s.expression));
      return;
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return out;
}

function ihlalSay(kaynak: string): number {
  let n = 0;
  for (const m of sabitMetinleri(kaynak)) for (const d of DESENLER) n += (m.match(d) ?? []).length;
  return n;
}

// §1–§2
const dosyalar = tsDosyalari(SRC);
const bulunan = new Map<string, number>();
for (const p of dosyalar) {
  const n = ihlalSay(fs.readFileSync(p, "utf8"));
  if (n > 0) bulunan.set(path.relative(KOK, p).split(path.sep).join("/"), n);
}
for (const [dosya, n] of bulunan) {
  const ist = ISTISNALAR[dosya];
  if (!ist) check(`§1 ${dosya}: kolon metne çevrilip küme karşılaştırması YOK`, false, `${n} yer — '= ANY(\${dizi}::"EnumAdı"[])' / '<> ALL(...)' kullan`);
  else check(`§2 ${dosya}: beyanlı istisna sayısı tutar (${ist.neden})`, n === ist.adet, `beyan ${ist.adet}, bulunan ${n}`);
}
for (const [dosya, ist] of Object.entries(ISTISNALAR)) {
  if (!bulunan.has(dosya)) check(`§2 ${dosya}: istisna hâlâ gerekli (hayalet beyan olmasın)`, false, `beyan ${ist.adet}, bulunan 0 — satırı sil`);
}
check("§1 beyansız ihlal yok", [...bulunan.keys()].every((d) => d in ISTISNALAR), `${bulunan.size} dosyada eşleşme`);

// §3 kalıcı sondalar
const SONDA_IHLAL = [
  "const a = Prisma.sql`WHERE r.status::text IN (${Prisma.join(x)})`;",
  "const b = Prisma.sql`AND r.status::TEXT NOT IN (${Prisma.join(x)})`;",
  "const c = Prisma.sql`r.status::text = ANY(${x}::text[])`;",
  "const d = Prisma.sql`NOT (r.status:: text <> all(${x}::text[]))`;",
  "const e = Prisma.sql`WHERE r.status::text ${Prisma.raw('')} IN (${Prisma.join(x)})`.length;",
  "const f = \"SELECT 1 FROM rolls WHERE status::text IN ('A')\";",
];
SONDA_IHLAL.forEach((k, i) => {
  // e: `${…}` parça sınırında desen bölünür — birleştirme " $X " koyduğu için yakalanmaz; bu bilinçli
  // (araya ifade giren biçim gerçek desen değildir). Beklenen: e hariç hepsi ≥1.
  const beklenen = i === 4 ? 0 : 1;
  check(`§3 sonda ihlal #${i + 1} ${beklenen ? "yakalanır" : "araya ifade giren biçim sayılmaz"}`, ihlalSay(k) === beklenen, `bulunan ${ihlalSay(k)}`);
});
const SONDA_TEMIZ = [
  "const a = Prisma.sql`WHERE r.status = ANY(${x}::\"RollStatus\"[])`;",
  "const b = Prisma.sql`AND r.status <> ALL(${x}::\"RollStatus\"[])`;",
  "// eski biçim: r.status::text IN (...) — yorumda geçer\nconst c = 1;",
  "const d = Prisma.sql`SELECT r.status::text AS status, s.type::text IN_ALIAS FROM rolls r`;",
];
SONDA_TEMIZ.forEach((k, i) => check(`§3 sonda temiz #${i + 1} yakalanmaz`, ihlalSay(k) === 0, `bulunan ${ihlalSay(k)}`));

// §4 körlük zemini
check("§4 taranan dosya > 100", dosyalar.length > 100, `${dosyalar.length}`);
check(
  "§4 SQL şablonu taşıyan bilinen dosya tarandı (stock-scorecard)",
  dosyalar.some((p) => p.endsWith(path.join("reports", "stock-scorecard.report.service.ts"))),
);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
