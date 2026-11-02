// =============================================================================
// TERİM — "Dokuma İş Emri" (WeavingOrder) / "Terbiye İş Emri" (WorkOrder) tek kaynaktan; eski ad cırcırı
// (kullanıcı kararı 2026-10-11: görünen adlar değişir; kod/model adı, izin kodu, numara DEĞİŞMEZ).
//   §1 terim modülü `Teks-Erp/src/constants/terim.ts` TEK KAYNAK; Electron · mobil · patron/uygulama
//      `src/lib/terim.ts` BAYT-EŞİT (sha256; eksik ayna ÖLÇÜLEMEDİ → kırmızı). Emsal: test_istemci_saat_dilimi §1.
//   §2 modül iç tutarlılığı: küçük/büyük biçim tekilden elle-TR katlamayla türer · çekimler yalın + ek
//      (iki terim de -i ile biter ⇒ -ni/-ne/-nde/-nden/-nin/-yle) · yalın = tekil/çoğul.
//   §3 ESKİ AD CIRCIRI — kullanıcıya görünen METİNDE (AST: dizge · şablon parçası · JSX metni) dosya başına:
//      a "dokumaIsi": "Dokuma işi/İşi/işleri/işine…" (ardından "emri" gelmeyen "dokuma iş")
//      b "isEmri"   : önünde "Terbiye"/"Dokuma" OLMAYAN "iş emri/İş Emri/iş emirleri…" (WorkOrder'ın çıplak adı)
//      c "sevkMuhasebe": "Sevkiyatlar (Muhasebe)" — KÜÇÜK-F 2026-10-26 ile `TERIM_AD.sevkEdilenler` ("Sevk Edilenler")
//      d "terbiyeSabit": SABİT yazılmış "Terbiye İş Emri/terbiye iş emrine/TERBİYE İŞ EMRİ…" (K20 2026-11-03: WorkOrder
//        adı dokuma rejiminden çözülür — dokuma kapalı "İş Emri"; sabit metin rejimi kaçırır → `TERIM.terbiyeIsEmri`)
//      terim modülünün kendisi (kaynak + aynalar) taranmaz.
//      Hariç: yorum (AST'de yok) · import/export yolu · tanımlayıcı · test dosyası (*.test/*.spec, __tests__,
//      test/) · .d.ts · .json (surum-notlari.json dâhil) · migration (src dışında). Taban `terim-eski-ad-baseline.json`
//      (dosya → {dokumaIsi, isEmri}); ARTIŞ her yerde SERT · ÇÜRÜME `curumeKolu` (commit kapısında ⚠️, CI'da sert).
//      Tabanı düşürmek: `npx tsx scripts/test_terim_eski_ad.ts --yaz` (metni çeviren dilim AYNI commit'te yazar).
// ÖLÇMEDİĞİ: çok parçalı şablonda parçalar arasına bölünmüş ad (`Dokuma ${x} işi`) · .css/.html/.json içi metin ·
//   "Hızlı İş Emri" gibi ön ekli ad da çıplak sayılır (önünde Terbiye/Dokuma yok) — bilinçli: karar dilimde verilir.
// ⭐ KALICI SONDA ✓K (her koşumda): eşleyici sentetik metinlerde ısırır/susar · AST sentetik kaynakta yorum ve
//   tanımlayıcıyı saymaz, dizge/JSX/şablonu sayar · karşılaştırıcı sentetik tabanda artışı ve çürümeyi görür.
// ⭐ BİR KEZLİK SONDA ✓B (2026-10-11, bu commit): gerçek dosyaya eski ad eklenince §3 artış kırmızı; tabanlı
//   dosyadan bir geçiş silinince §3 çürüme kırmızı (CI kipi) / ⏭ (TEKSERP_KAPI_ADIMI=commit); ikisi de `cmp` ile geri alındı.
// GEREKLİ Mİ: doğduğu gün tabanda 2.000+ geçiş — kusur değil, dilim ②–⑤'in çevireceği borç; bekçi yeni borcu durdurur.
//   §2b çözücü: `terimDokumaAyarla(false)` → "İş Emri" ailesi, `true` → "Terbiye İş Emri" (varsayılan = bugünkü).
//   §4 DONMA: `src/constants` içinde TERIM okuyan modüller rejim KAPALIYA çevrildikten sonra serileştirilir —
//      modül düzeyinde bir kez okunup donmuş "Terbiye İş Emri" kalırsa kırmızı (okumayı getter/fonksiyona al).
// Koşum: npx tsx scripts/test_terim_eski_ad.ts   (DB GEREKMEZ)
// =============================================================================
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { IS_EMRI_BICIMLERI, TERIM, terimDokumaAyarla, terimDokumaRejimi, type Term, type TermCases } from "../src/constants/terim";
import { atlamaDefteri } from "./lib/atlama";
import { curumeKolu } from "./lib/circir-kolu";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}
const ATLAMA = atlamaDefteri((mesaj) => check(mesaj, false));

const KOK = path.resolve(__dirname, "..", "..");
const KAYNAK = "Teks-Erp/src/constants/terim.ts";
const AYNALAR = ["Electron/src/lib/terim.ts", "mobil/src/lib/terim.ts", "patron/uygulama/src/lib/terim.ts"];
const TABAN_DOSYA = path.join(__dirname, "terim-eski-ad-baseline.json");
/** Tarama kökleri + körlük zemini (en az bu kadar dosya okunmalı). */
const TARAMA: readonly { kok: string; enAz: number }[] = [
  { kok: "Teks-Erp/src", enAz: 300 },
  { kok: "Electron/src", enAz: 500 },
  { kok: "mobil/src", enAz: 100 },
  { kok: "patron/uygulama/src", enAz: 10 },
  { kok: "patron/uygulama/app", enAz: 5 },
];

type Tur = "dokumaIsi" | "isEmri" | "sevkMuhasebe" | "terbiyeSabit";
const TURLER: readonly Tur[] = ["dokumaIsi", "isEmri", "sevkMuhasebe", "terbiyeSabit"];
const TERIM_DOSYALARI = new Set([KAYNAK, ...AYNALAR]);
type Sayim = Partial<Record<Tur, number>>;
type DosyaSayim = Record<string, Sayim>;

// ---------------------------------------------------------------------------
// Eşleyici (saf)
// ---------------------------------------------------------------------------
/** Elle TR katlama — toLocale* yasak; İ/I/ı farkı açıkça. */
export function trKucuk(s: string): string {
  return s.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}
export function trBuyuk(s: string): string {
  return s.replace(/i/g, "İ").replace(/ı/g, "I").toUpperCase();
}

const DOKUMA_IS = /(?<!\p{L})(?:dokuma|Dokuma|DOKUMA)\s+(?:iş|İş|İŞ|IŞ)(\p{L}*)/gu;
/** "Dokuma iş(…)" ardından gelebilecek ESKİ ad ekleri (işlem/işçi gibi başka kelimeler sayılmaz). */
const DOKUMA_EKLER = new Set([
  "", "i", "in", "ini", "ine", "inde", "inden", "inin", "iyle", "idir", "e", "le", "te", "ten",
  "ler", "leri", "lerin", "lerini", "lerine", "lerinde", "lerinden", "lerinin", "leriyle", "lerdir",
]);
const IS_EMRI = /(?<!\p{L})(?:iş|İş|İŞ|IŞ)\s+(?:emr|Emr|EMR|emir|Emir|EMİR|EMIR)/gu;
/** Eski karo/katalog adı; parantezli ad kalktı (TERIM_AD.sevkEdilenler). Büyük/küçük biçimleri de ısırır. */
const SEVK_MUHASEBE = /(?:sevkiyatlar|Sevkiyatlar|SEVKİYATLAR|SEVKIYATLAR)\s*\(\s*(?:muhasebe|Muhasebe|MUHASEBE)\s*\)/gu;
/** K20: sabit yazılmış WorkOrder adı — rejimden çözülmez (TERIM.terbiyeIsEmri kullanılmalı). */
const TERBIYE_SABIT = /(?<!\p{L})(?:terbiye|Terbiye|TERBİYE|TERBIYE)\s+(?:iş|İş|İŞ|IŞ)\s+(?:emr|Emr|EMR|emir|Emir|EMİR|EMIR)/gu;
const ONEK_YENI = /(?<!\p{L})(?:terbiye|Terbiye|TERBİYE|TERBIYE|dokuma|Dokuma|DOKUMA)\s+$/u;

export function eskiAdSay(metin: string): Required<Sayim> {
  const terbiyeSabit = [...metin.matchAll(TERBIYE_SABIT)].length;
  let dokumaIsi = 0;
  for (const m of metin.matchAll(DOKUMA_IS)) {
    const ek = trKucuk(m[1] ?? "");
    if (!DOKUMA_EKLER.has(ek)) continue;
    const sonra = metin.slice((m.index ?? 0) + m[0].length);
    if (ek === "" && /^\s+(?:emr|emir)/u.test(trKucuk(sonra))) continue; // yeni ad: "Dokuma İş Emri"
    dokumaIsi++;
  }
  let isEmri = 0;
  for (const m of metin.matchAll(IS_EMRI)) {
    if (ONEK_YENI.test(metin.slice(0, m.index ?? 0))) continue;
    isEmri++;
  }
  const sevkMuhasebe = [...metin.matchAll(SEVK_MUHASEBE)].length;
  return { dokumaIsi, isEmri, sevkMuhasebe, terbiyeSabit };
}

/** Kaynak metindeki görünen metin parçaları (dizge · şablon parçası · JSX metni); yorum/tanımlayıcı/modül yolu hariç. */
export function metinParcalari(kaynak: string, dosyaAdi = "x.tsx"): string[] {
  const sf = ts.createSourceFile(dosyaAdi, kaynak, ts.ScriptTarget.Latest, true,
    dosyaAdi.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const gez = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isImportEqualsDeclaration(n)) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (!(ts.isCallExpression(n.parent) && n.parent.expression.kind === ts.SyntaxKind.ImportKeyword)
        && !ts.isExternalModuleReference(n.parent) && !ts.isLiteralTypeNode(n.parent) && !ts.isModuleDeclaration(n.parent)) out.push(n.text);
    } else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text);
    else if (ts.isJsxText(n)) out.push(n.text);
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return out;
}

export function dosyaSay(kaynak: string, dosyaAdi: string): Sayim {
  const s: Required<Sayim> = { dokumaIsi: 0, isEmri: 0, sevkMuhasebe: 0, terbiyeSabit: 0 };
  for (const p of metinParcalari(kaynak, dosyaAdi)) {
    const c = eskiAdSay(p);
    for (const t of TURLER) s[t] += c[t];
  }
  const out: Sayim = {};
  for (const t of TURLER) if (s[t]) out[t] = s[t];
  return out;
}

/** gerçek ↔ taban: artış (yeni borç) ve çürüme (ödenmiş borç) listeleri. */
export function karsilastir(gercek: DosyaSayim, taban: DosyaSayim): { artis: string[]; curume: string[]; curumeAdet: number } {
  const artis: string[] = [];
  const curume: string[] = [];
  let curumeAdet = 0;
  const dosyalar = new Set([...Object.keys(gercek), ...Object.keys(taban)]);
  for (const d of [...dosyalar].sort()) {
    for (const t of TURLER) {
      const g = gercek[d]?.[t] ?? 0;
      const b = taban[d]?.[t] ?? 0;
      if (g > b) artis.push(`${d} ${t} ${b}→${g}`);
      else if (g < b) {
        curume.push(`${d} ${t} ${b}→${g}`);
        curumeAdet += b - g;
      }
    }
  }
  return { artis, curume, curumeAdet };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== "node_modules" && e !== "__tests__" && e !== "test" && e !== "tests") walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.tsx?$/.test(e) && !/\.d\.ts$/.test(e)) out.push(p);
  }
  return out;
}
const rel = (p: string): string => path.relative(KOK, p).split(path.sep).join("/");
const sha = (p: string): string | null =>
  existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : null;

// ---------------------------------------------------------------------------
// §0 kalıcı sondalar
// ---------------------------------------------------------------------------
console.log("\n§0 — kalıcı sondalar (✓K)");
const ISIRMALI: [string, Tur][] = [
  ["Dokuma işi bulunamadı", "dokumaIsi"], ["DOKUMA İŞİ", "dokumaIsi"], ["dokuma işlerine aktar", "dokumaIsi"],
  ["Dokuma İşleri", "dokumaIsi"], ["bu dokuma işiyle", "dokumaIsi"],
  ["İş emri kapalı", "isEmri"], ["bu iş emrine bağlı", "isEmri"], ["İŞ EMİRLERİ", "isEmri"], ["Hızlı İş Emri", "isEmri"],
  ["Terbiye İş Emri", "terbiyeSabit"], ["terbiye iş emrine", "terbiyeSabit"], ["TERBİYE İŞ EMİRLERİ", "terbiyeSabit"],
  ["Terbiye iş emri bulunamadı", "terbiyeSabit"],
  ["Sevkiyatlar (Muhasebe)", "sevkMuhasebe"], ["SEVKİYATLAR (MUHASEBE)", "sevkMuhasebe"], ["Operasyon → Sevkiyatlar ( Muhasebe )", "sevkMuhasebe"],
];
const SUSMALI = [
  "Terbiye", "terbiye işlemi", "Dokuma İş Emri", "dokuma iş emirlerinden",
  "DOKUMA İŞ EMRİ", "dokuma işlemi", "Dokuma işçiliği", "iş emniyeti", "kiş emri", "Sevk Edilenler", "Sevkiyatlar · Muhasebe",
];
for (const [m, t] of ISIRMALI) check(`K eşleyici ısırır: "${m}" → ${t}`, eskiAdSay(m)[t] === 1);
check("K ayrık türler: \"Terbiye İş Emri\" yalnız terbiyeSabit sayılır (isEmri değil)",
  eskiAdSay("Terbiye İş Emri").isEmri === 0 && eskiAdSay("Terbiye İş Emri").terbiyeSabit === 1);
for (const m of SUSMALI) {
  const c = eskiAdSay(m);
  check(`K eşleyici susar: "${m}"`, TURLER.every((t) => c[t] === 0));
}
const SENTETIK = [
  `import x from "./İş emri";`,
  `// İş emri yorumda`,
  `/* Dokuma işi blok yorum */`,
  `const isEmri = 1; type T = "İş emri";`,
  `const a = "İş emri"; const b = \`Dokuma işi \${a} sonu\`;`,
  `const c = <b title="bu iş emrine">Dokuma işleri</b>;`,
].join("\n");
const sentetik = dosyaSay(SENTETIK, "sonda.tsx");
check("K AST: dizge + şablon + JSX metni + öznitelik sayılır; yorum · import · tanımlayıcı · tip literal'i sayılmaz",
  sentetik.isEmri === 2 && sentetik.dokumaIsi === 2, JSON.stringify(sentetik));
const kSonda = karsilastir({ a: { isEmri: 2 }, b: { dokumaIsi: 1 } }, { a: { isEmri: 1 }, b: { dokumaIsi: 3 }, c: { isEmri: 1 } });
check("K karşılaştırıcı: artış ve çürüme ayrı görülür",
  kSonda.artis.length === 1 && kSonda.curume.length === 2 && kSonda.curumeAdet === 3, JSON.stringify(kSonda));

// ---------------------------------------------------------------------------
// §1 ayna
// ---------------------------------------------------------------------------
console.log("\n§1 — terim modülü tek kaynak, aynalar BAYT-EŞİT");
const kaynakSha = sha(path.join(KOK, KAYNAK));
check(`§1 kaynak var: ${KAYNAK}`, kaynakSha !== null);
for (const a of AYNALAR) {
  const s = sha(path.join(KOK, a));
  check(`§1 ${a} sha256 = kaynak (düzeltme: kaynakta değiştir, \`cp -p ${KAYNAK} ${a}\`)`,
    s !== null && s === kaynakSha, s === null ? "ÖLÇÜLEMEDİ — dosya yok" : "");
}

// ---------------------------------------------------------------------------
// §2 modül iç tutarlılığı
// ---------------------------------------------------------------------------
console.log("\n§2 — terim modülü iç tutarlılığı");
const EKLER: Record<keyof TermCases, string> = {
  yalin: "", belirtme: "ni", yonelme: "ne", bulunma: "nde", ayrilma: "nden", ilgi: "nin", vasita: "yle",
};
const terimler: [string, Term][] = [
  ["terbiyeIsEmri(terbiye)", IS_EMRI_BICIMLERI.terbiye], ["terbiyeIsEmri(yalin)", IS_EMRI_BICIMLERI.yalin],
  ["dokumaIsEmri", TERIM.dokumaIsEmri],
];
check("§2 iki terim tanımlı (terbiyeIsEmri · dokumaIsEmri)", Object.keys(TERIM).length === 2 && "terbiyeIsEmri" in TERIM && "dokumaIsEmri" in TERIM);
const basBuyuk = (x: string): string => trBuyuk(trKucuk(x).slice(0, 1)) + trKucuk(x).slice(1);
for (const [ad, t] of terimler) {
  const hatalar: string[] = [];
  if (t.tekilKucuk !== trKucuk(t.tekil)) hatalar.push("tekilKucuk");
  if (t.cogulKucuk !== trKucuk(t.cogul)) hatalar.push("cogulKucuk");
  if (t.tekilBuyuk !== trBuyuk(t.tekil)) hatalar.push("tekilBuyuk");
  if (t.cogulBuyuk !== trBuyuk(t.cogul)) hatalar.push("cogulBuyuk");
  if (!t.tekil.endsWith("i") || !t.cogul.endsWith("i")) hatalar.push("ek tablosu -i sonu varsayar");
  for (const [bicimAdi, cekim, yalin] of [
    ["cekim", t.cekim, t.tekil], ["cekimKucuk", t.cekimKucuk, t.tekilKucuk],
    ["cogulCekim", t.cogulCekim, t.cogul], ["cogulCekimKucuk", t.cogulCekimKucuk, t.cogulKucuk],
    ["cumleBasi", t.cumleBasi, basBuyuk(t.tekil)], ["cumleBasiCogul", t.cumleBasiCogul, basBuyuk(t.cogul)],
  ] as const) {
    for (const [hal, ek] of Object.entries(EKLER) as [keyof TermCases, string][]) {
      if (cekim[hal] !== yalin + ek) hatalar.push(`${bicimAdi}.${hal}="${cekim[hal]}" ≠ "${yalin + ek}"`);
    }
  }
  // yalın biçim ("İş Emri") BİLEREK çıplak addır — yalnız terim modülünde yaşar, §3 taramasının dışında.
  const eski = [t.tekil, t.cogul, t.tekilBuyuk, t.cogulBuyuk].map(eskiAdSay).some((c) => c.dokumaIsi + (ad.includes("yalin") ? 0 : c.isEmri) > 0);
  if (eski) hatalar.push("terimin kendisi eski ad eşleyicisine takılıyor");
  check(`§2 ${ad}: biçimler ve çekimler tutarlı`, hatalar.length === 0, hatalar.slice(0, 4).join(" · "));
}

// ---------------------------------------------------------------------------
// §2b çözücü (K20)
// ---------------------------------------------------------------------------
console.log("\n§2b — WorkOrder adı dokuma rejiminden çözülür (K20)");
check("§2b varsayılan rejim (bildirilmeden) = bugünkü ad \"Terbiye İş Emri\"",
  terimDokumaRejimi() === true && TERIM.terbiyeIsEmri.tekil === "Terbiye İş Emri");
terimDokumaAyarla(false);
const kapali = TERIM.terbiyeIsEmri;
check("§2b dokuma KAPALI → \"İş Emri\" ailesi",
  kapali.tekil === "İş Emri" && kapali.cogul === "İş Emirleri" && kapali.cekimKucuk.yonelme === "iş emrine"
  && kapali.cumleBasi.yalin === "İş emri" && kapali.tekilBuyuk === "İŞ EMRİ", JSON.stringify([kapali.tekil, kapali.cekimKucuk.yonelme]));
const degisti = terimDokumaAyarla(true);
check("§2b dokuma AÇIK → \"Terbiye İş Emri\" (değişim bildirilir)",
  degisti && TERIM.terbiyeIsEmri.tekil === "Terbiye İş Emri" && TERIM.terbiyeIsEmri.cekimKucuk.ilgi === "terbiye iş emrinin");
check("§2b Dokuma İş Emri rejimden bağımsız", (terimDokumaAyarla(false), TERIM.dokumaIsEmri.tekil === "Dokuma İş Emri"));
terimDokumaAyarla(true);

// ---------------------------------------------------------------------------
// §3 eski ad cırcırı
// ---------------------------------------------------------------------------
console.log("\n§3 — eski ad cırcırı (dosya başına)");
const gercek: DosyaSayim = {};
for (const { kok, enAz } of TARAMA) {
  const dizin = path.join(KOK, kok);
  if (!existsSync(dizin)) {
    check(`§3 körlük zemini: ${kok}`, false, "ÖLÇÜLEMEDİ — dizin yok");
    continue;
  }
  const dosyalar = walk(dizin);
  check(`§3 körlük zemini: ${kok} ≥ ${enAz} dosya`, dosyalar.length >= enAz, `${dosyalar.length} dosya`);
  for (const f of dosyalar) {
    if (TERIM_DOSYALARI.has(rel(f))) continue;
    const s = dosyaSay(readFileSync(f, "utf8"), f);
    if (Object.keys(s).length) gercek[rel(f)] = s;
  }
}
const toplam = (d: DosyaSayim, t: Tur): number => Object.values(d).reduce((a, s) => a + (s[t] ?? 0), 0);
const ozet = (d: DosyaSayim): string => TURLER.map((t) => `${t} ${toplam(d, t)}`).join(" · ");
console.log(`   bugün: ${ozet(gercek)} · ${Object.keys(gercek).length} dosya`);

if (process.argv.includes("--yaz")) {
  const sirali: DosyaSayim = {};
  for (const k of Object.keys(gercek).sort()) sirali[k] = gercek[k];
  writeFileSync(TABAN_DOSYA, `${JSON.stringify({
    aciklama: "test_terim_eski_ad §3 tabanı: dosya → eski ad geçiş sayısı. Yalnız DÜŞER; --yaz ile yazılır.",
    dosyalar: sirali,
  }, null, 2)}\n`);
  console.log(`✍️  taban yazıldı: ${Object.keys(sirali).length} dosya`);
  process.exit(fail > 0 ? 1 : 0);
}
if (!existsSync(TABAN_DOSYA)) {
  check("§3 taban dosyası var", false, "yok — `--yaz` ile üret");
} else {
  const taban = (JSON.parse(readFileSync(TABAN_DOSYA, "utf8")) as { dosyalar: DosyaSayim }).dosyalar;
  console.log(`   taban: ${ozet(taban)} · ${Object.keys(taban).length} dosya`);
  check("§3 körlük zemini: taban boş değil", Object.keys(taban).length > 0);
  const { artis, curume, curumeAdet } = karsilastir(gercek, taban);
  check("⭐ §3 ARTIŞ yok — görünen metne YENİ eski ad girmedi (TERIM'i kullan: src/constants/terim.ts · src/lib/terim.ts)",
    artis.length === 0, artis.length ? `${artis.length}: ${artis.slice(0, 6).join(" · ")}` : "");
  const tabanToplam = TURLER.reduce((a, t) => a + toplam(taban, t), 0);
  curumeKolu(check, ATLAMA.atla, "§3 taban ÇÜRÜMEMİŞ (gerçek < taban ise `--yaz` ile düşür, aynı commit'te)",
    tabanToplam - curumeAdet, tabanToplam);
  if (curume.length) console.log(`     ↓ ${curume.slice(0, 6).join(" · ")}${curume.length > 6 ? ` (+${curume.length - 6})` : ""}`);
}

// ---------------------------------------------------------------------------
// §4 donma (K20): modül düzeyinde okunup saklanan ad rejim değişince donmuş kalır
// ---------------------------------------------------------------------------
console.log("\n§4 — sabit kataloglarda donmuş WorkOrder adı yok (rejim KAPALIYA çevrilince)");
/** Değerdeki dizgeleri gezer (getter'lar okunur; döngü + derinlik sınırlı). */
export function dizgeTopla(v: unknown, yol: string, out: [string, string][], gorulen = new WeakSet<object>(), derinlik = 0): void {
  if (typeof v === "string") { out.push([yol, v]); return; }
  if (!v || typeof v !== "object" || derinlik > 8 || gorulen.has(v)) return;
  gorulen.add(v);
  if (v instanceof Map) { for (const [k, x] of v) dizgeTopla(x, `${yol}[${String(k)}]`, out, gorulen, derinlik + 1); return; }
  if (v instanceof Set) { for (const x of v) dizgeTopla(x, `${yol}{}`, out, gorulen, derinlik + 1); return; }
  for (const k of Object.keys(v)) {
    let x: unknown;
    try { x = (v as Record<string, unknown>)[k]; } catch { continue; }
    dizgeTopla(x, `${yol}.${k}`, out, gorulen, derinlik + 1);
  }
}
{
  // sonda: getter'lı katalog donmaz, düz sabit donar
  terimDokumaAyarla(true);
  const donan = { ad: TERIM.terbiyeIsEmri.tekil };
  const canli = { get ad() { return TERIM.terbiyeIsEmri.tekil; } };
  terimDokumaAyarla(false);
  const sd: [string, string][] = [];
  const sc: [string, string][] = [];
  dizgeTopla(donan, "donan", sd);
  dizgeTopla(canli, "canli", sc);
  check("K §4 sonda: düz sabit donar (ısırır), getter donmaz (susar)",
    sd.some(([, x]) => eskiAdSay(x).terbiyeSabit > 0) && !sc.some(([, x]) => eskiAdSay(x).terbiyeSabit > 0));
  terimDokumaAyarla(true);
}
{
  const dizinler = ["Teks-Erp/src/constants", "Teks-Erp/src/config"];
  const adaylar = dizinler.flatMap((d) => walk(path.join(KOK, d)))
    .filter((f) => !TERIM_DOSYALARI.has(rel(f)) && readFileSync(f, "utf8").includes("TERIM.terbiyeIsEmri"));
  check("§4 körlük zemini: TERIM okuyan ≥ 10 sabit modülü", adaylar.length >= 10, `${adaylar.length} modül`);
  terimDokumaAyarla(true);
  const moduller: [string, Record<string, unknown>][] = [];
  for (const f of adaylar) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      moduller.push([rel(f), require(f) as Record<string, unknown>]);
    } catch (e) {
      check(`§4 ${rel(f)} yüklenebilir`, false, `ÖLÇÜLEMEDİ — ${(e as Error).message.slice(0, 80)}`);
    }
  }
  terimDokumaAyarla(false);
  const donmus: string[] = [];
  for (const [r, m] of moduller) {
    const dizgeler: [string, string][] = [];
    for (const k of Object.keys(m)) dizgeTopla(m[k], k, dizgeler);
    for (const [y, x] of dizgeler) if (eskiAdSay(x).terbiyeSabit > 0) donmus.push(`${r} ${y}`);
  }
  terimDokumaAyarla(true);
  check("⭐ §4 DONMA yok — rejim kapalıyken katalogda \"Terbiye İş Emri\" kalmadı (okumayı getter'a al)",
    donmus.length === 0, donmus.length ? `${donmus.length}: ${donmus.slice(0, 5).join(" · ")}` : `${moduller.length} modül`);
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
process.exitCode = fail > 0 ? 1 : 0;
