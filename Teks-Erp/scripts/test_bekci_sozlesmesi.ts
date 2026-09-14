// =============================================================================
// BEKÇİ ÇIKTI SÖZLEŞMESİ — META BEKÇİ (2026-09-06)
// =============================================================================
// NEDEN: koşucu (`run-all-tests.ts`) her bekçinin kaç kontrol koşturduğunu
// ÇIKTIDAN kazır; tanımadığı formatı sessizce "geçti (exit 0)" diye yazar. O
// satır yeşildir ama kontrol sayısını GİZLER — kontrol sayısı sıfıra düşse bile
// fark edilmez. Bu tam olarak reponun kovaladığı sınıf: sessiz yanlış-BAŞARI.
// 2026-09-06 ölçümü: iki dosya İngilizce `== N passed, M failed ==` basıyordu
// (test_manual_move_backflush, test_manual_move_qc_reversal) ve ikisi de özet
// tablosunda "geçti (exit 0)" görünüyordu — 14 kontrol görünmezdi.
//
// İKİNCİ ÖLÇÜ: "N atlandı" sayacı yalnız ÖZET SATIRINDA anlamlıdır. Serbest
// metindeki "atlandı" kelimesi koşucunun demirli regex'ine takılmaz; ama bir
// bekçi gerçekten kontrol atlıyorsa sayıyı özet satırında BEYAN ETMEK zorundadır
// yoksa "yeşil ≠ kapsandı" bandı o dosyayı hiç göstermez.
//
// KÖRLÜK ZEMİNİ: taranan dosya sayısı bir tabanın altına düşerse bekçi kırmızı
// verir — "0 ihlal" ile "hiç bakmadım" aynı yeşile çıkamaz.
//
// ÜÇÜNCÜ ÖLÇÜ (2026-09-14) — KÜRESEL AYAR YAZIMI `try` İÇİNDE OLMALI. Bir bekçi
// `systemSetting`/bayrak satırını `try`dan ÖNCE yazarsa, fikstür eksikliği ya da erken
// bir hata `finally`yi HİÇ koşturmaz ve bayrak SIZAR — sızan bayrak kendi dosyasını
// değil KOMŞU bekçileri kırar. Ölçüldü: taze bir sonda DB'sinde tam paketin ilk koşumu
// 136 dosya "Seed fixture eksik" ile çöktü, `devere.enabled=true` sızdı ve ikinci
// koşumda `module_flag_off` kırmızı verdi; üç oturum bunu "şablon farkı" sandı.
// ⚠️ Kural DAR: yalnız KÜRESEL ayar (fikstür satırı değil) ve yalnız AYNI kapsamda
// `try`dan önce duran yazım. Fonksiyon gövdesindeki yazım ÇAĞRILDIĞINDA koşar, sayılmaz.
//
// ÖLÇÜLDÜ VE YAZILMADI: "kontrol atlayan bekçi sayıyı özet satırında beyan
// etmeli" kuralı METİNDEN ölçülemiyor. Aday yüklem ("atlandı" kelimesi geçiyor
// ama özet satırında sayaç yok) 458 dosyanın 52'sini işaretledi ve tek tek
// bakıldığında çoğu bir check ETİKETİNDE geçen kelimeydi — yüklem gerçek
// atlamayı değil kelimeyi ölçüyor. Ölçüm çürüttüğü için kural YAZILMADI;
// gerçek atlama sayacı bugün koşucunun `Sonuç:` satırına demirli regex'iyle
// ölçülüyor (run-all-tests.ts) ve kapsam kaybı orada görünüyor.
// =============================================================================
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { git } from "./lib/git";
import { atlamaDefteri } from "./lib/atlama";
import { curumeKolu } from "./lib/circir-kolu";

const SCRIPTS_DIR = join(__dirname);
/** Koşucunun bugünkü dosya süzgeci ile BİREBİR aynı (run-all-tests.ts:219). */
const BEKCI_DESENI = /^test_.*\.ts$/;
/** Bugün 458 dosya var; taban körlüğe karşı. Dosya sayısı düşerse bilerek kırmızı. */
const EN_AZ_DOSYA = 400;

/**
 * Koşucunun TANIDIĞI özet formatları (run-all-tests.ts:299-302).
 * Kaynak metinde şablon literali olarak arandığı için `${...}` yerine `.*` var.
 */
const TANINAN_OZET = [
  // ① `Sonuç:`/`SONUÇ:` başlıklı ② başlıksız `N geçti, M başarısız|kaldı`
  // ③ `N/T geçti`. Kaynak metinde şablon literali arandığı için sayı yerine
  // `${...}` de kabul edilir. ⚠️ "düştü"/"passed" gibi kelimeler BİLEREK yok:
  // koşucu onları tanımıyor (2026-09-06'da üç dosya bu yüzden görünmezdi).
  /(?:Sonuç|SONUÇ):[^`\n]*geçti,[^`\n]*(?:başarısız|kaldı)/,
  /geçti,\s*(?:\$\{[^}]*\}|\d+)\s*(?:başarısız|kaldı)/,
  /(?:\$\{[^}]*\}|\d+)\/(?:\$\{[^}]*\}|\d+)\s*geçti/,
];

/**
 * Özet satırı basmayan meşru dosyalar. İKİ YÖNLÜ: listede olup ARTIK özet basan
 * dosya da kırmızı verir (muafiyet bayatlarsa görünür).
 * ⚠️ Bu listeye ekleme yapmadan önce sor: dosya gerçekten kontrol saymıyor mu?
 */
const MUAF: readonly string[] = [];

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const ATLAMA = atlamaDefteri((mesaj) => check(mesaj, false));
const dosyalar = readdirSync(SCRIPTS_DIR).filter((f) => BEKCI_DESENI.test(f)).sort();

check(
  `körlük zemini: en az ${EN_AZ_DOSYA} bekçi dosyası tarandı`,
  dosyalar.length >= EN_AZ_DOSYA,
  `${dosyalar.length} dosya`,
);

const ozetsiz: string[] = [];
const ingilizce: string[] = [];
// STANDART biçim `Sonuç:`/`SONUÇ:` ÇAPALIDIR (2026-09-14, 1e hükmü — 6e'nin sorusu): koşucu
// ②/③'ü de tanır ama ", N atlandı" ve BİLİNMEYEN beyanını yalnız çapalı satırdan okur; çapasız
// özet atlamayı GÖRÜNMEZ kılar. Ölçüldü 2026-09-14: 552 dosyanın 7'si çapasızdı (5 çıplak · 2 `N/T geçti`),
// hepsi standarda çekildi ⇒ taban 0, SERT.
const capasiz: string[] = [];

for (const f of dosyalar) {
  if (f === "test_bekci_sozlesmesi.ts") continue;
  const kaynak = readFileSync(join(SCRIPTS_DIR, f), "utf8");

  if (/\$\{[^}]*\}\s*passed,\s*\$\{[^}]*\}\s*failed/.test(kaynak)) ingilizce.push(f);

  const taniniyor = TANINAN_OZET.some((r) => r.test(kaynak));
  if (!taniniyor && !MUAF.includes(f)) ozetsiz.push(f);
  if (taniniyor && !TANINAN_OZET[0].test(kaynak)) capasiz.push(f);

}

check(
  "⭐ her bekçi koşucunun TANIDIĞI özet formatını basıyor",
  ozetsiz.length === 0,
  ozetsiz.length ? ozetsiz.join(", ") : `${dosyalar.length - 1} dosya uyuyor`,
);

check(
  "⭐ özet satırı `Sonuç:` ÇAPALI (standart biçim; ②/③ tanınır ama atlama beyanını taşıyamaz)",
  capasiz.length === 0,
  capasiz.length ? capasiz.join(", ") : "hepsi çapalı",
);

check(
  "İngilizce `N passed, M failed` formatı KULLANILMIYOR (koşucu tanımaz)",
  ingilizce.length === 0,
  ingilizce.join(", ") || "temiz",
);

// ── KÜRESEL AYAR YAZIMI `try` İÇİNDE Mİ (2026-09-14) ────────────────────────
// Ön süzgeç METİNDİR (yalnız `systemSetting`/`moduleFlag` geçen dosya parse edilir):
// 458 dosyanın 72'si parse ediliyor, ek maliyet ~0,3 sn — mandal hızlı kalıyor.
const KURESEL_DELEGE = /^(systemSetting|moduleFlag)$/;
const YAZ_METOT = /^(create|createMany|update|updateMany|upsert|delete|deleteMany)$/;

/** İfadeyi kapsayan en yakın FONKSİYON (ya da dosya) — çağrıldığında koşan gövdeyi ayırır. */
function kapsam(n: ts.Node): ts.Node | undefined {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p)
      || ts.isMethodDeclaration(p) || ts.isSourceFile(p)) return p;
  }
  return undefined;
}

/** Bir dosyadaki "try'dan ÖNCE küresel ayar yazımı" yerleri. SAF — girdi kaynak metni. */
export function korumasizKureselYazim(ad: string, kaynak: string): string[] {
  const sf = ts.createSourceFile(ad, kaynak, ts.ScriptTarget.Latest, true);
  const tryler: ts.TryStatement[] = [];
  const topla = (n: ts.Node): void => { if (ts.isTryStatement(n) && n.finallyBlock) tryler.push(n); n.forEachChild(topla); };
  topla(sf);
  const tryIcinde = (n: ts.Node): boolean => {
    for (let p: ts.Node | undefined = n; p; p = p.parent) {
      const u: ts.Node | undefined = p.parent;
      if (u && ts.isTryStatement(u) && (u.tryBlock === p || u.finallyBlock === p)) return true;
    }
    return false;
  };
  const out: string[] = [];
  const gez = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && YAZ_METOT.test(n.expression.name.text)) {
      const ic = n.expression.expression;
      if (ts.isPropertyAccessExpression(ic) && KURESEL_DELEGE.test(ic.name.text) && !tryIcinde(n)) {
        const k = kapsam(n);
        // AYNI kapsamda, BU yazımdan SONRA gelen bir try/finally var mı?
        if (tryler.some((t) => kapsam(t) === k && t.getStart(sf) > n.getStart(sf))) {
          out.push(`${ad}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} ${ic.name.text}.${n.expression.name.text}`);
        }
      }
    }
    n.forEachChild(gez);
  };
  gez(sf);
  return out;
}

// ⚠️ CIRCIR TABANI — oturum DOKUNMAZ (ilk sabit hariç). Bugün 3, ÜÇÜ DE AYNI ŞEKİL:
// bayrak `try`dan ÖNCEKİ düz akışta TÜKETİLİYOR, yani yazımı içeri almak testin
// ÖNKOŞULUNU bozar (`test_p2_auth` ×2 kilitlenme denemeleri · `test_tambur_cut_concurrency`
// aşım bayrağı §1–§4'ü besliyor). Onarım try'ı YUKARI taşımaktır, yazımı aşağı değil.
// ⚠️ ÜÇÜNCÜSÜ BİR REGRESYONLA ÖĞRENİLDİ (2026-09-14): yazım "ondan sonraki ilk try"a
// taşındı, ama o try §5'in mock try'ıydı — bayrak §1–§4'ü geçti ve CI'da §4 kırmızı
// verdi. ⇒ *"try'dan önce" bir KONUM ölçüsüdür; hangi try'ın o yazımı KORUDUĞU ayrı bir
// sorudur ve otomatik taşıma onu bilemez.*
const KURESEL_YAZIM_TABAN = 3;
{
  const korumasiz: string[] = [];
  let parseEdilen = 0;
  for (const f of dosyalar) {
    const kaynak = readFileSync(join(SCRIPTS_DIR, f), "utf8");
    if (!/\.(systemSetting|moduleFlag)\./.test(kaynak)) continue;   // ön süzgeç
    parseEdilen++;
    korumasiz.push(...korumasizKureselYazim(f, kaynak));
  }
  check("körlük zemini: küresel ayar yazan bekçi parse edildi", parseEdilen > 20, `${parseEdilen} dosya`);
  check(
    "⭐ küresel ayar yazımı `try` İÇİNDE (sızan bayrak KOMŞU bekçiyi kırar)",
    korumasiz.length <= KURESEL_YAZIM_TABAN,
    korumasiz.length <= KURESEL_YAZIM_TABAN
      ? `${korumasiz.length} ≤ ${KURESEL_YAZIM_TABAN}`
      : `${korumasiz.length} > ${KURESEL_YAZIM_TABAN} ⇒ YENİ korumasız yazım:\n      ` + korumasiz.join("\n      "),
  );
  if (korumasiz.length > 0) {
    console.log(`   ⓘ duran borç (${korumasiz.length}) — try'dan önce küresel ayar yazımı:`);
    for (const x of korumasiz) console.log(`      • ${x}`);
  }
  // SONDALAR — saf yüklem, sentetik kaynak.
  const S = (k: string) => korumasizKureselYazim("sonda.ts", k);
  check("§s1 ⭐ try'dan ÖNCE yazım YAKALANIR",
    S("async function t() {\n  await prisma.systemSetting.upsert({ where: {}, create: {}, update: {} });\n  try { } finally { }\n}").length === 1);
  check("§s2 ⭐ try İÇİNDE yazım temiz",
    S("async function t() {\n  try { await prisma.systemSetting.upsert({ where: {} }); } finally { }\n}").length === 0);
  check("§s3 ⭐ FONKSİYON gövdesindeki yazım sayılmaz (çağrıldığında koşar)",
    S("const set = async () => { await prisma.systemSetting.upsert({ where: {} }); };\nasync function t() {\n  try { await set(); } finally { }\n}").length === 0);
  check("§s4 ⭐ fikstür yazımı KÜRESEL DEĞİL (kural dar)",
    S("async function t() {\n  await prisma.customer.create({ data: {} });\n  try { } finally { }\n}").length === 0);
  check("§s5 `finally` YOKSA sayılmaz (geri alma sözü verilmemiş)",
    S("async function t() {\n  await prisma.systemSetting.upsert({ where: {} });\n  try { } catch { }\n}").length === 0);
  check("§s6 OKUMA yazım değildir (foto `try` dışında kalabilir)",
    S("async function t() {\n  await prisma.systemSetting.findMany({});\n  try { } finally { }\n}").length === 0);
}

// ── ÇIPLAK `git` SPAWN'I (2026-09-14) ───────────────────────────────────────
// NEDEN: `execFileSync`in varsayılan `maxBuffer`ı 1 MB'tır ve aşıldığında komut
// ENOBUFS ile ÇÖKER — kontrol kırmızı vermez, BEKÇİ ÖLÜR. `CLAUDE-NOT-ARSIVI.md`
// 1 MB'ı aştığı gün `test_identity_ledger` tam olarak böyle düştü: ihlal yoktu,
// tampon yetmedi. ⇒ *Bir aracın kapasite sınırı, ölçtüğü şeyin büyümesiyle sessizce
// ihlale dönüşür* — ve kapı "ölçemedim" bile diyemez, çünkü diyecek kod hiç koşmaz.
// Tamponu çağrı başına ayarlamak sınıfı KAPATMAZ: sayı her dosyada ayrı yaşar (ölçüldü:
// aynı gün altı bekçi varsayılanla, biri 32 MB, biri 64 MB, biri 256 MB koşuyordu).
// ⚠️ TEK MEŞRU SİTE YAPISALDIR, liste değil: `git`i EXPORT EDEN dosyanın kendisi.
{
  // ⚠️ DESEN PARÇALARDAN KURULUR: düz yazılırsa bu dosya KENDİ deseniyle eşleşir ve
  // sayıyı iki artırır (ölçüldü — kapı kendi kaynağını da tarıyor).
  const GIT_SPAWN = new RegExp(`(execFileSync|execSync)\\(\\s*["\`]${"git"}`);
  // ⚠️ TABAN SATIR DEĞİL EŞLEŞME sayar: `grep | wc -l` 22 diyordu, gerçek 24 —
  // bir satırda iki spawn olabiliyor. Sayılan şeyin TANECİĞİ yazılmazsa taban yanlış kurulur.
  const CIPLAK_GIT_TABAN = 0;
  const ciplak: string[] = [];
  const tara = (dizin: string): void => {
    for (const e of readdirSync(dizin, { withFileTypes: true })) {
      const tam = join(dizin, e.name);
      if (e.isDirectory()) { tara(tam); continue; }
      if (!e.name.endsWith(".ts")) continue;
      const kaynak = readFileSync(tam, "utf8");
      if (/export function git\(/.test(kaynak)) continue;      // yardımcının KENDİSİ
      const n = (kaynak.match(new RegExp(GIT_SPAWN.source, "g")) ?? []).length;
      if (n > 0) ciplak.push(`${tam.slice(tam.indexOf("scripts/"))}×${n}`);
    }
  };
  tara(SCRIPTS_DIR);
  const toplam = ciplak.reduce((a, x) => a + Number(x.split("×")[1]), 0);
  check("⭐ çıplak `git` spawn'ı ARTMADI (tampon tek yerde: `lib/git.ts`)", toplam <= CIPLAK_GIT_TABAN,
    toplam <= CIPLAK_GIT_TABAN ? `${toplam} ≤ ${CIPLAK_GIT_TABAN} · ${ciplak.length} dosya`
      : `${toplam} > ${CIPLAK_GIT_TABAN} ⇒ YENİ çıplak spawn:\n      ` + ciplak.join("\n      "));
  curumeKolu(check, ATLAMA.atla, "⭐ çıplak git tabanı ÇÜRÜMEDİ", toplam, CIPLAK_GIT_TABAN);

  // CANLI ÖLÇÜM — sentetik değil: yardımcı, BUGÜNKÜ en büyük belgeyi okuyabiliyor mu?
  // (Sonda burada "1 MB'a çekip ENOBUFS göster" değil, DOĞRUDAN gerçek dosyadır:
  //  arşiv 1 MB'ı zaten aştı, yani varsayılan tamponla bu çağrı ÇÖKERDİ.)
  let arsivBayt = 0;
  let arsivHata = "";
  try {
    // ⚠️ BAYT ölçülür, KARAKTER değil: `maxBuffer` bayt sayar ve Türkçe metinde ikisi
    // AYRILIR (bu dosya 966.514 karakter ama 1.050.551 bayt — ilk yazımda eşik karakterle
    // karşılaştırıldı ve kontrol haksız kırmızı verdi).
    arsivBayt = Buffer.byteLength(git(["show", "HEAD:docs/history/CLAUDE-NOT-ARSIVI.md"], { cwd: join(SCRIPTS_DIR, "..", "..") }), "utf8");
  } catch (e) { arsivHata = String((e as Error).message).slice(0, 120); }
  check("⭐ yardımcı 1 MB'ı AŞAN arşivi okuyabiliyor (varsayılan tamponla ÇÖKERDİ)",
    arsivBayt > 1_048_576, arsivHata || `${arsivBayt} bayt`);
}

// Muafiyet listesi iki yönlü: artık özet basan bir dosya listede kalmamalı.
const bayatMuaf = MUAF.filter((f) => {
  if (!dosyalar.includes(f)) return true;
  return TANINAN_OZET.some((r) => r.test(readFileSync(join(SCRIPTS_DIR, f), "utf8")));
});
check(
  "muafiyet listesi bayat değil (iki yönlü)",
  bayatMuaf.length === 0,
  bayatMuaf.join(", ") || `${MUAF.length} muaf`,
);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
process.exit(fail > 0 ? 1 : 0);
