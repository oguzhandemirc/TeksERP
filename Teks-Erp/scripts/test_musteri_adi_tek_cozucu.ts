// =============================================================================
// BEKÇİ: MÜŞTERİ RENK ADI TEK ÇÖZÜCÜ — iki alias tablosunu ad için okuyan TEK yer
// Çalıştır: npx tsx scripts/run-all-tests.ts test_musteri_adi_tek_cozucu
// =============================================================================
// Tasarım: docs/design/MUSTERI-KUMAS-RENK-ADI.md §5. Müşterinin renk adı iki
// tablodan gelir (kumaşa özel `CustomerItemColorAlias` → genel `CustomerColorAlias`)
// ve özelden genele TEK çözücüde çözülür (`customer-name.helper#loadCustomerColorIndex`).
// Etiket kendi kopya sorgusunu yazarsa etiket ile irsaliye farklı ad basar — bu
// "ayrışan yüzey" sınıfıdır ve sessizdir (tip geçer, testler çoğu fikstürde yeşil).
//
// ÜÇ KANAL (src/ altında, yorumlar hariç AST):
//   ① model delegesi OKUMASI: `<x>.customerColorAlias|customerItemColorAlias.find*/count/aggregate/groupBy`
//   ② ilişki alanı: include/select/where/orderBy nesnelerinde ya da arama yolu
//      dizgesinde renk-adı ilişkileri (`colorAliases` · `itemColorAliases` ·
//      `customerAliases` · `customerItemAliases` · `customerColorAliases`)
//   ③ dizge içinde tablo adı (`customer_color_aliases` · `customer_item_color_aliases`)
//
// BEYAN ANAHTARI DOSYA + FONKSİYON adıdır, satır numarası DEĞİL (satır kayar, fonksiyon
// kaymaz). Her beyan bir SINIFA bağlanır; sınıflar ad-DIŞI okuyuculardır (ad seçmez
// ya da ad CRUD'u yapar). İKİ YÖNLÜ: beyansız isabet kırmızı, isabetsiz beyan (ölü)
// kırmızı — ölü beyan gerçek bir okuyucuyu sessizce kapsam dışında tutardı.
//
// NEGATİF SONDALAR (ölçüldü, md5 ile geri alındı):
//   ① label.service#getRollLabel'e doğrudan `customerColorAlias.findUnique` eklenir → kırmızı
//   ② sack-content-mismatch#loadLookups kendi `customerColorAlias.findMany`ine döndürülür → kırmızı
//   ③ POZİTİF: beyanlı bir okuyucu (order.service#kumasaOzelRenkCiftleri) kaldırılır → ölü beyan kırmızısı
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { walkTs } from "./lib/ts-tarama";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const SRC = path.resolve(__dirname, "..", "src");
const MODELLER = new Set(["customerColorAlias", "customerItemColorAlias"]);
const OKUMA = /^(find|count$|aggregate$|groupBy$)/;
const ILISKILER = ["colorAliases", "itemColorAliases", "customerAliases", "customerItemAliases", "customerColorAliases"];
const TABLOLAR = ["customer_color_aliases", "customer_item_color_aliases"];
const SORGU_ANAHTARLARI = new Set(["include", "select", "where", "orderBy", "_count"]);
/** Prisma ilişki süzgeci/seçimi — sorgu nesnesinin DIŞINDA kurulan where parçası da yakalansın. */
const ILISKI_OPS = new Set(["some", "none", "every", "is", "isNot", "include", "select", "where", "orderBy"]);

type Kanal = "model" | "iliski" | "tablo";
/** `dosya#fonksiyon` → { sınıf, kanallar }. Sınıf kümesi KAPALI (aşağıdaki SINIFLAR). */
const SINIFLAR = {
  COZUCU: "tek çözücünün kendisi",
  CRUD: "ad eşlemesi CRUD'u (liste/yazım/audit için mevcut satır) — ad ÇÖZMEZ",
  ATAMA: "`assigned` münhasırlığı — renk kime atanmış, ad seçmez",
  RENK_FORMU: "renk formu müşteri ataması/adı düzenleme — CRUD",
  DISA_AKTARIM: "içe/dışa aktarma adaptörü — tabloyu satır satır taşır",
  TERFI: "sipariş satırı adının terfisi — yalnız VARLIK kontrolü",
  BIRLESTIRME: "birleştirme haritası/önizleme — tablo adı ya da taşınacak satır listesi",
  ARAMA: "arama alanı (`customerAliases.some.alias`) — kaydı BULUR, ad seçmez",
} as const;
type Sinif = keyof typeof SINIFLAR;

const BEYAN: Record<string, { sinif: Sinif; kanal: Kanal[] }> = {
  "services/helpers/customer-name.helper.ts#loadCustomerColorIndex": { sinif: "COZUCU", kanal: ["model"] },
  "services/customer-alias.service.ts#listColorAliases": { sinif: "CRUD", kanal: ["model"] },
  "services/customer-alias.service.ts#upsertColorAlias": { sinif: "CRUD", kanal: ["model"] },
  "services/customer-alias.service.ts#deleteColorAlias": { sinif: "CRUD", kanal: ["model"] },
  "services/customer-item-color-alias.service.ts#listByCustomer": { sinif: "CRUD", kanal: ["model"] },
  "services/customer-item-color-alias.service.ts#listByItem": { sinif: "CRUD", kanal: ["model"] },
  "services/customer-item-color-alias.service.ts#upsert": { sinif: "CRUD", kanal: ["model"] },
  "services/helpers/color-assignment.helper.ts#assertColorsAssignableToCustomer": { sinif: "ATAMA", kanal: ["model"] },
  "services/color.service.ts#extraWhere": { sinif: "ATAMA", kanal: ["iliski"] },
  "services/color.service.ts#findById": { sinif: "RENK_FORMU", kanal: ["model"] },
  "services/color.service.ts#syncCustomerAssignments": { sinif: "RENK_FORMU", kanal: ["model"] },
  "services/import/adapters/customer-alias.adapter.ts#findExisting": { sinif: "DISA_AKTARIM", kanal: ["model"] },
  "services/import/adapters/customer-alias.adapter.ts#exportRows": { sinif: "DISA_AKTARIM", kanal: ["model"] },
  "services/import/adapters/customer-item-color-alias.adapter.ts#findExisting": { sinif: "DISA_AKTARIM", kanal: ["model"] },
  "services/import/adapters/customer-item-color-alias.adapter.ts#exportRows": { sinif: "DISA_AKTARIM", kanal: ["model"] },
  "services/order.service.ts#promoteCustomerAliases": { sinif: "TERFI", kanal: ["model"] },
  "services/order.service.ts#kumasaOzelRenkCiftleri": { sinif: "TERFI", kanal: ["model"] },
  "services/helpers/merge-shadowing.helper.ts#describeItemColorShadowing": { sinif: "BIRLESTIRME", kanal: ["model"] },
  "constants/merge-map.customer.ts#<modül>": { sinif: "BIRLESTIRME", kanal: ["tablo"] },
  "constants/merge-map.color.ts#<modül>": { sinif: "BIRLESTIRME", kanal: ["tablo"] },
  "constants/merge-map.item.ts#<modül>": { sinif: "BIRLESTIRME", kanal: ["tablo"] },
  "constants/search-entities.ts#<modül>": { sinif: "ARAMA", kanal: ["iliski"] },
  "routes/color.routes.ts#<modül>": { sinif: "ARAMA", kanal: ["iliski"] },
  "routes/item.routes.ts#<modül>": { sinif: "ARAMA", kanal: ["iliski"] },
  "routes/order.routes.ts#<modül>": { sinif: "ARAMA", kanal: ["iliski"] },
  "services/inventory.service.ts#buildRollWhere": { sinif: "ARAMA", kanal: ["iliski"] },
  "services/tambur.service.ts#listRecentOutputRolls": { sinif: "ARAMA", kanal: ["iliski"] },
  "services/order.service.ts#findAvailableForWorkOrder": { sinif: "ARAMA", kanal: ["iliski"] },
  "services/order.service.ts#findAvailableOrderLines": { sinif: "ARAMA", kanal: ["iliski"] },
};

interface Isabet {
  anahtar: string;
  kanal: Kanal;
  yer: string;
}

/** En yakın ADLI fonksiyon/metot; yoksa `<modül>`. İsimsiz ok fonksiyonu atlanır. */
function fonksiyonAdi(node: ts.Node): string {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText();
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parent) {
      const p = n.parent;
      if (ts.isVariableDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertyAssignment(p)) return p.name.getText();
    }
  }
  return "<modül>";
}

/** İlişki anahtarı Prisma biçiminde mi kullanılmış: `true` ya da ilişki operatörlü nesne. */
function iliskiBicimi(init: ts.Expression): boolean {
  if (init.kind === ts.SyntaxKind.TrueKeyword) return true;
  return ts.isObjectLiteralExpression(init) &&
    init.properties.some((p) => ts.isPropertyAssignment(p) && ILISKI_OPS.has(p.name.getText().replace(/["']/g, "")));
}

/** Nesne literali bir sorgu anahtarının (include/select/where/…) değerinin içinde mi. */
function sorguIcinde(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isPropertyAssignment(n) && SORGU_ANAHTARLARI.has(n.name.getText().replace(/["']/g, ""))) return true;
    if (ts.isCallExpression(n) || ts.isBlock(n)) return false;
  }
  return false;
}

function tara(dosya: string, kaynak = fs.readFileSync(dosya, "utf8")): Isabet[] {
  const sf = ts.createSourceFile(dosya, kaynak, ts.ScriptTarget.Latest, true);
  const rel = path.relative(SRC, dosya).split(path.sep).join("/");
  const out: Isabet[] = [];
  const ekle = (node: ts.Node, kanal: Kanal): void => {
    const satir = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    out.push({ anahtar: `${rel}#${fonksiyonAdi(node)}`, kanal, yer: `${rel}:${satir}` });
  };
  const gez = (node: ts.Node): void => {
    // ① `<x>.customerColorAlias.findMany(…)` — okuma metodu çağrısı
    if (ts.isPropertyAccessExpression(node) && MODELLER.has(node.name.text) && ts.isPropertyAccessExpression(node.parent)
      && node.parent.expression === node && OKUMA.test(node.parent.name.text)) ekle(node, "model");
    // ② sorgu nesnesinde ilişki anahtarı
    if (ts.isPropertyAssignment(node) && ILISKILER.includes(node.name.getText().replace(/["']/g, ""))
      && (sorguIcinde(node) || iliskiBicimi(node.initializer))) ekle(node, "iliski");
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const t = node.text;
      // ② arama yolu dizgesi (`customerAliases.some.alias`)
      if (ILISKILER.some((r) => new RegExp(`(^|\\.)${r}\\.`).test(t))) ekle(node, "iliski");
      // ③ tablo adı
      if (TABLOLAR.some((tb) => new RegExp(`\\b${tb}\\b`).test(t))) ekle(node, "tablo");
    }
    ts.forEachChild(node, gez);
  };
  gez(sf);
  return out;
}

function degerlendir(isabetler: Isabet[]): { beyansiz: Isabet[]; olu: string[] } {
  const beyansiz = isabetler.filter((i) => !BEYAN[i.anahtar]?.kanal.includes(i.kanal));
  const olu = Object.entries(BEYAN).flatMap(([k, b]) =>
    b.kanal.filter((kn) => !isabetler.some((i) => i.anahtar === k && i.kanal === kn)).map((kn) => `${k} [${kn}]`));
  return { beyansiz, olu };
}

function main(): void {
  const dosyalar = walkTs(SRC);
  const isabetler = dosyalar.flatMap((d) => tara(d));
  console.log("=== §0 Körlük zemini ===");
  check("src/ tarandı (>300 dosya)", dosyalar.length > 300, `${dosyalar.length}`);
  for (const k of ["model", "iliski", "tablo"] as const) {
    const n = isabetler.filter((i) => i.kanal === k).length;
    check(`kanal '${k}' isabet üretiyor (tarayıcı kör değil)`, n >= 3, `${n}`);
  }
  check("tek çözücü GERÇEKTEN okuyor (kanal ① isabeti var)",
    isabetler.some((i) => i.anahtar === "services/helpers/customer-name.helper.ts#loadCustomerColorIndex"));
  check("beyan sınıfları kapalı kümeden", Object.values(BEYAN).every((b) => b.sinif in SINIFLAR));

  console.log("\n=== §1 Beyansız renk adı okuyucusu YOK ===");
  const { beyansiz, olu } = degerlendir(isabetler);
  check("her okuma beyanlı (dosya#fonksiyon + kanal)", beyansiz.length === 0,
    beyansiz.map((i) => `${i.yer} ${i.anahtar} [${i.kanal}] — tek çözücüye geçir ya da gerekçeli sınıfla beyan et`).join("\n     "));

  console.log("\n=== §2 Ölü beyan YOK (iki yönlü) ===");
  check("her beyan hâlâ bir okuyucuya denk geliyor", olu.length === 0, olu.join(", "));

  console.log("\n=== §3 Tarayıcının kendi sondaları (bellekte, dosyaya dokunmadan) ===");
  const sahte = path.join(SRC, "services", "label.service.ts");
  const kopya = "async function x(){ await prisma.customerColorAlias.findUnique({ where: { id: '1' } }); }";
  check("sonda: label.service'te kopya findUnique → beyansız isabet",
    degerlendir(tara(sahte, kopya)).beyansiz.some((i) => i.kanal === "model"));
  const iliski = "const r = prisma.color.findMany({ include: { customerItemAliases: true } });";
  check("sonda: include içinde kumaşa özel ilişki → isabet", tara(sahte, iliski).some((i) => i.kanal === "iliski"));
  const yorum = "// customer_color_aliases tablosu\nconst a = 1;";
  check("sonda: yorumdaki tablo adı isabet DEĞİL", tara(sahte, yorum).length === 0);
}

main();
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
