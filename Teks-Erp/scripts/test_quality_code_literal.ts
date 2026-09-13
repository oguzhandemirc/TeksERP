// =============================================================================
// KALİTE KODU LİTERALİ — AST tripwire, beş ağaç, RATCHET (2026-09-13, karar ①)
// =============================================================================
// NE ÖLÇER: `"1.KALITE"` / `"A1"` / `"FIRE"` gibi KATALOG KODLARININ koda
// gömülmesini. Kod fabrikaya AÇIK bir alandır (`quality-grade.adapter.ts`:
// "Kodu SİZ yazarsınız"); gömülü kod, kataloğu `1K/2K/HURDA` olan fabrikada
// SESSİZCE tutmaz ve fire SATILABİLİR STOK sayılır.
// Doğru cevaplar: kova → `targetStatus` · rol → `QualityGrade.role` ·
// sunum → `color`/`sortOrder`.
//
// ⚠️ NEDEN DÖRT KURAL — tek kural yetmez, üçü ölçülmüş kaçış yoludur:
//   §1 bağlam literali  — `grade === "FIRE"`, `qualityGrade: "1.KALITE"`
//   §2 adlandırılmış sabit — `const SHORT_CUT_QUALITY_CODE = 'A1'`
//   §3 tip birleşimi    — `type QualityGradeCode = '1.KALITE' | ...`
//   §4 AD üzerinden kural — `/1\s*\.?\s*kalite/i.test(qg.name)`
// §4'ün varlığı bu turun dersidir: `KK1Screen:734` KODA değil ADA bakıyordu,
// yani kod kataloğunu düzeltmek onu HİÇ ETKİLEMEZDİ. Bir sabite kapı kurarken
// aynı sabitin AD üzerinden kurulmuş hâli AYRICA aranır.
// §3'ün ölçülmüş getirisi: `mobil/src/types/models.ts` birleşimi bu fabrikada
// HİÇ OLMAYAN bir kod (`'2.KALITE'`) taşıyordu — tipin kurgu olduğunun kanıtı.
//
// RATCHET (kullanıcı kararı K4, 2026-09-13): tavan ağaç başınadır ve YALNIZ
// DÜŞER. Kapı ilk dilimde iner ki aradaki dilimlerde YENİ literal eklenmesin —
// üç ağaçta aynı anda çalışılıyor. Gerçek sayı tavanın ALTINA inerse de KIRMIZI
// verir ("tavanı düşür"): tavan çürürse kapı sessizce genişler.
//
// DB GEREKTİRMEZ — yalnız dosya okur. (Kendi ön koşulunun arkasında kalıp hiç
// koşmayan bekçi dersi, 2026-09-12.)
//
// ── ① ÇALIŞIYOR MU — negatif sondalar (2026-09-13, hepsi KOŞTURULDU) ────────
// Hedef dosya `src/services/sack-search.service.ts`; her sonda `cp` yedeği +
// sha256 ile BİREBİR geri alındı (dördünde de "BİREBİR ✓" ölçüldü).
//   S1 `roll.qualityGrade === "A1"`            → §1 KIRMIZI, rc=1   [ölçüldü]
//   S2 `const QUALITY_FIRE_CODE = "FIRE"`      → §2 KIRMIZI, rc=1   [ölçüldü]
//   S3 `type QualityCodesSonda = "A1"|"FIRE"`  → §3 KIRMIZI, rc=1   [ölçüldü]
//   S4 `/1\s*kalite/i.test(g.name)` — ilk hâli TUTMADI (rc=0).
//
// ⚠️ S4'ün ilk hâli neden tutmadı ve bu neden bir BULGU DEĞİL SORU:
// sonda regex'i `(g: { name: string }) => ...` içine koymuştu; ortada kalite
// adlı hiçbir ata yoktu, yani §4'ün "yakında kalite" şartı haklı olarak
// susmuştu. Kural değil SONDA yanlıştı. Gerçek şekliyle tekrarlandı —
// `qualityGrades.find((g) => /1\s*\.?\s*kalite/i.test(g.name))` —
//   S4' → §4 KIRMIZI (1 → 2 ihlal), rc=1.                   [ölçüldü]
// Kayda geçiyor çünkü "sonda tutmadı" iki şeyin işareti olabilir (kapı kör ya
// da sonda kurgu) ve hangisi olduğu ÖLÇÜLMEDEN bilinmez.
//
// Dört sondanın dördü de yalnız KENDİ §'ini kırmızıya çevirdi; FAIL satır
// sayısı özet sayısıyla tuttu (çöken sonda / yutulmuş hata yok).
//
// ── ② GEREKLİ Mİ — ÖLÇÜLDÜ, EVET ────────────────────────────────────────────
//   Kapı doğduğu gün ağaçtaki GERÇEK kusuru yakaladı: üretim kodunda 24 site
//   (12 backend + 11 mobil + 3 Electron; test/fixture/yorum/swagger hariç).
//   İkisi yalnız literal değil AÇIK ÜRÜN KUSURUYDU: `label.service.ts:604/686`
//   kalite KODU yerine ADINI ("1. Kalite") basıyordu ⇒ `showIf` koşullu
//   elemanları etiket tasarımcısının ÖNİZLEMESİNDE hiç görünmüyor, tasarımcı
//   onları yanlış konumlandırıyordu. Bu kalem taramada YOKTU; kapı buldu.
// =============================================================================
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import * as tsc from "typescript";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay?: string): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detay ? ` — ${detay}` : ""}`);
  }
}

// Repo kökü: bu betik `Teks-Erp/scripts/` içinde koşar.
const KOK = join(__dirname, "..", "..");

/**
 * ŞEMADAKİ ENUM'LAR — §3'ün AYNA İSTİSNASI için.
 *
 * ⚠️ §3 "kalite adlı tip takma adında string-literal birleşimi" arıyordu ve
 * `type QualityGradeRole = 'FIRST' | 'SECOND' | 'SCRAP'`i de yakalıyordu —
 * oysa o bir KAPALI enum'un istemci AYNASIDIR (`CompanyType`/`StationType`
 * emsali), fabrikanın AÇIK katalog kodları değil. Ayrım yapısaldır ve
 * tahmine gerek yok: birleşimin ÜYELERİ şemadaki aynı adlı enum'un
 * değerleriyle birebir örtüşüyorsa o bir aynadır.
 * Örtüşmüyorsa (ör. silinen `QualityGradeCode = '1.KALITE' | 'A1' | …`)
 * kural yine KIRMIZI verir — kurgu tip yakalanmaya devam eder.
 */
const SEMA_ENUMLARI: Map<string, Set<string>> = (() => {
  const harita = new Map<string, Set<string>>();
  const ham = readFileSync(join(KOK, "Teks-Erp/prisma/schema.prisma"), "utf8").replace(/\/\/[^\n]*/g, "");
  for (const m of ham.matchAll(/^enum\s+(\w+)\s*\{([^}]*)\}/gm)) {
    const degerler = new Set([...m[2]!.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*$/gm)].map((v) => v[1]!));
    harita.set(m[1]!, degerler);
  }
  return harita;
})();

/** Şemadaki TÜM enum değerleri — `kodOlamazMi` için düz küme. */
const SEMA_ENUM_DEGERLERI: Set<string> = new Set(
  [...SEMA_ENUMLARI.values()].flatMap((s) => [...s]),
);

/** Birleşim, aynı adlı şema enum'unun AYNASI mı (üyeler birebir örtüşüyor mu)? */
function semaAynasiMi(tipAdi: string, uyeler: string[]): boolean {
  const enumDegerleri = SEMA_ENUMLARI.get(tipAdi);
  if (!enumDegerleri) return false;
  return uyeler.length === enumDegerleri.size && uyeler.every((u) => enumDegerleri.has(u));
}

/**
 * TARANAN AĞAÇLAR ve TAVANLARI — tavan YALNIZ DÜŞER.
 *
 * Ölçüm 2026-09-13, (i) dilimi indikten sonra. Backend 0'a indi; mobil ve
 * Electron dilim (ii)/(iii)'te inecek ve tavanları o commit'lerde düşecek.
 */
const AGACLAR: Array<{ kok: string; tavan: number; dilim: string; sadece?: RegExp }> = [
  { kok: "Teks-Erp/src", tavan: 0, dilim: "(i) — indi 2026-09-13" },
  { kok: "Teks-Erp/prisma", tavan: 0, dilim: "(i) — indi 2026-09-13" },
  // ⚠️ BEKÇİLERİN KENDİ BORCU — d9'un ölçümü (2026-09-13): "ürün rolle çalışır,
  // bekçi literalde kalır" boşluğu. `test_roll_warehouse_stamp` bu yüzden rolsüz
  // fikstürde ÇÖKÜYORDU (dört check basıp özette beş diyerek). Bugün ölçülen
  // borç 163 site / ~88 dosya; TEMİZLİĞİ AYRI BİR DİLİM. Tavan buraya bugünkü
  // sayıyla konur ki borç BÜYÜMESİN — yeni bekçi literalle inemez.
  // `sadece` BEKÇİLER: `audit_repro_*` (tek seferlik arkeoloji), `seed-*` ve
  // `backfill-*` fixture/araç kurucularıdır — fixture kendi kurduğu kataloğu
  // koduyla okur, orası "gömülü varsayım" değil senaryonun TANIMIDIR.
  // Kapsam dışı bırakılan scripts/ dosyalarındaki sayı 37.
  // ⚠️ Tavan SAYAÇTAN okunur, bu bekçinin DÖKÜMÜNDEN değil: döküm §-başına
  // kırpılır, `grep -c` basılmayan ihlalleri saymaz. Sayı yalnız SIKILAŞAN
  // yönde hareket eder. İniş hikâyesi commit mesajlarında.
  // ⚠️ TAVAN 0'A İNMEZ ve bu bilinçlidir: kalan küme DÜZELTİLMESİ YANLIŞ OLAN
  // sınıfları taşır (bilerek katalog DIŞI kodlar, belge örnek verisi, ad biçimi).
  // Sayı bir BORÇ değil, beyan edilmiş bir BİLEŞİMDİR; bileşim commit mesajında.
  { kok: "Teks-Erp/scripts", tavan: 108, dilim: "bekçi borcu — dilim 1-4 indi; kalan sınıflar beyanlı", sadece: /\/scripts\/test_[^/]+\.ts$/ },
  { kok: "mobil/src", tavan: 0, dilim: "(ii) — indi 2026-09-13" },
  { kok: "Electron/src", tavan: 0, dilim: "(iii) — indi 2026-09-13" },
];

/**
 * GEREKÇELİ MUAFLAR — dosya başına, ve İZİNLİ DEĞERLER sayılarak.
 *
 * ⚠️ Muaf DOSYA değil DEĞER düzeyindedir: `inventory.service.ts`ı topluca
 * affetmek gerçek bir dosyayı kör ederdi. Listedeki değerler dışında bir
 * literal aynı dosyada yine KIRMIZI verir.
 * İki yönlü denetlenir: ölü muaf da KIRMIZI (düzelttiğin şeyi sonsuza dek
 * affeden tek yönlü liste, kapıların sessiz ölüm sebebidir).
 */
const MUAF: Record<string, { gerekce: string; izinli: string[] }> = {
  "Teks-Erp/prisma/seed.ts": {
    gerekce:
      "Temiz fabrika kurulumu KATALOĞU YARATIR — kodu burada yazmak literal gömmek " +
      "değil, veriyi tanımlamaktır. Migration'ın UPDATE'i boş tabloda damgalayamaz, " +
      "bu yüzden rol de burada AÇIKÇA yazılır (2026-08-10 appliesColor tuzağı).",
    izinli: ["1.KALITE", "A1", "FIRE"],
  },
  "Electron/src/lib/audit-field-labels.ts": {
    gerekce:
      "Backend `constants/audit-field-labels.ts`in AYNASI — aynı sınıf, aynı " +
      "gerekçe: alan adı → Türkçe ETİKET sözlüğü, katalog kodu taşımaz.",
    izinli: ["Kalite", "Alt top kalitesi", "Kalan parçanın kalitesi"],
  },
  "Electron/src/lib/import/template.ts": {
    gerekce:
      "İçe aktarım şablonunun VARLIK ADI sözlüğü (kullanıcıya 'kalite' diye " +
      "gösterilir); değer bir katalog kodu değil, ekranda okunan kelime.",
    izinli: ["kalite"],
  },
  "Electron/src/pages/Operations/Shipments/detail/ShipmentDetailToolbar.tsx": {
    gerekce:
      "Facet çipi ön eki (`Record<FacetKind, string>`): 'quality' yuvası bir " +
      "SÜZGEÇ BOYUTUNUN adıdır, kalite kodu değil; değeri ekranda basılan başlık.",
    izinli: ["Kalite"],
  },
  "Electron/src/pages/Reports/tile-config.ts": {
    gerekce:
      "Rapor KATEGORİSİ başlığı ('quality' = kalite raporları kümesi). Yuva bir " +
      "kategori anahtarıdır, kalite satırı değil.",
    izinli: ["Kalite"],
  },
  "Teks-Erp/src/constants/audit-field-labels.ts": {
    gerekce:
      "Alan adı → Türkçe ETİKET sözlüğü. Değerler kullanıcıya gösterilen metindir, " +
      "katalog kodu DEĞİL; burada kod hiç bulunmaz.",
    izinli: ["Kalite", "Alt top kalitesi", "Kalan parçanın kalitesi"],
  },
  "Teks-Erp/src/services/inventory.service.ts": {
    gerekce:
      "`byQuality` özet haritasında NULL kalitenin kova ANAHTARI. Kod değil sentinel; " +
      "değiştirmek panelin okuduğu yanıt anahtarını kırar (sözleşme tetiği).",
    izinli: ["BELIRSIZ"],
  },
  "mobil/src/store/deviceSettingsStore.ts": {
    gerekce:
      "`tamburResetQualityAfterCut` cihaz ayarının BOOLEAN-AS-STRING okuması. " +
      "Yuva adı ('tamburResetQuality') kalite desenine takılıyor ama değer " +
      "'true'/'false'; katalog koduyla hiçbir ilgisi yok.",
    izinli: ["true", "false"],
  },
  "Teks-Erp/src/services/document-render/sample-data.ts": {
    gerekce:
      "Belge şablonu ÖNİZLEMESİNİN statik örnek verisi (DB'ye erişmez, sabit fixture " +
      "olması AMAÇTIR). Değerler bilinçli olarak hiçbir kataloğun kodu değildir " +
      "('A'/'B'); etiket önizlemesinin aksine belge şablonunda kaliteye bağlı " +
      "KOŞULLU ELEMAN yoktur, yani yanlış önizleme üretmez.",
    izinli: ["A", "B"],
  },
};

/** Kalite bağlamı — bir adın bu soruyu sorup sormadığı. */
const KALITE_ADI = /qualit|grade|kalite/i;

/**
 * FİXTURE/DEMO KURUCULARI kapsam DIŞI — sayısı ayrıca basılır.
 *
 * Kapı KARAR KODUNU korur. Bir fixture kurucusu kendi kurduğu kataloğu koduyla
 * geri okur; orada kod "gömülü varsayım" değil, o senaryonun TANIMIDIR.
 * ⚠️ `prisma/seed.ts` KAPSAM İÇİNDEDİR ve bilerek: o müşteriye giden TEMİZ
 * KURULUM seed'idir, demo değil — rolü oraya yazmayı unutmak taze kurulumu kırar.
 */
function fixtureDosyasiMi(yol: string): boolean {
  return (
    /\.(test|spec)\.tsx?$/.test(yol) ||
    /(^|\/)(__tests__|__mocks__)\//.test(yol) ||
    /\/prisma\/seed-[^/]+\.ts$/.test(yol)
  );
}

function dosyalariTopla(kok: string): string[] {
  const cikti: string[] = [];
  const mutlakKok = join(KOK, kok);
  const gez = (dizin: string): void => {
    let girisler: string[];
    try {
      girisler = readdirSync(dizin);
    } catch {
      return;
    }
    for (const g of girisler) {
      if (g === "node_modules" || g === "out" || g === "dist" || g === ".git") continue;
      const p = join(dizin, g);
      if (statSync(p).isDirectory()) gez(p);
      else if (/\.tsx?$/.test(p)) cikti.push(p);
    }
  };
  gez(mutlakKok);
  return cikti;
}

interface Ihlal {
  bolum: "§1" | "§2" | "§3" | "§4";
  yol: string;
  satir: number;
  metin: string;
}

/**
 * Bir ifadenin KUYRUK ADI — `roll.qualityGrade` → `qualityGrade`, `qg?.code` →
 * `code`. Tam metin ALINMAZ: `z.string().uuid("Geçersiz kalite ID")` zincirinin
 * metni "kalite" içerir ve ad ölçütünü sahte kırmızıya boğar (ilk koşumda
 * ölçüldü: 372 isabetin çoğu etiket/mesajdı).
 */
function kuyrukAd(n: tsc.Node): string | null {
  let d = n;
  for (;;) {
    if (tsc.isParenthesizedExpression(d) || tsc.isNonNullExpression(d) || tsc.isAsExpression(d)) {
      d = d.expression;
      continue;
    }
    break;
  }
  if (tsc.isIdentifier(d)) return d.text;
  if (tsc.isPropertyAccessExpression(d)) return d.name.text;
  if (tsc.isElementAccessExpression(d) && d.argumentExpression && tsc.isStringLiteralLike(d.argumentExpression))
    return d.argumentExpression.text;
  return null;
}

/**
 * Bir ADIN kalite KODU taşıyan bir yuva olup olmadığı.
 *
 * ⚠️ Neden ADA bakıyoruz, literalin DEĞERİNE değil: değer listesi (`"FIRE"`,
 * `"A1"`) bu fabrikanın kataloğuna çakılı olurdu — tam da yasakladığımız şey.
 * Ad ölçütü fabrikadan bağımsızdır ve ikinci müşteride de çalışır.
 *
 * ⚠️ `...Id` DIŞARIDA: `qualityGradeId` bir FK'dır, kod değil — oraya yazılan
 * string bir uuid ya da Zod mesajıdır, katalog kodu değil.
 */
const KOD_YUVASI = /^(.*quality.*|.*grade.*)$/i;
/**
 * ÇIPLAK `code` yuvaları (`qg.code`, `currentCode`) — kendi başına hiçbir şey
 * söylemez: para birimi kodu, izin kodu, sebep kodu hepsi `code`tur (ilk
 * ölçümde 585 sahte kırmızı). Yalnız YAKININDA kalite geçiyorsa sayılır.
 */
const NOTR_KOD_YUVASI = /^(code|currentCode|defaultCode|effectiveCode)$/;

/**
 * Bir DEĞERİN katalog kodu OLAMAYACAĞI yapısal olarak biliniyor mu?
 *
 * ⚠️ Bunlar muafiyet DEĞİL, kuralın sınırıdır — üçü de şemadan/dilden çıkar:
 *   • 32 karakterden uzun: `QualityGrade.code` `@db.VarChar(32)`. Yardım
 *     metinleri, hata cümleleri buradan düşer.
 *   • Yol (`/api/…`): servis tanımı, kod değil.
 *   • Noktalama-yalnız (`—`, `-`, `?`, `N/A`): "değer yok" YER TUTUCUSU.
 *     Bir katalog kodu asla yalnız noktalamadan oluşmaz.
 * Sonuncusu dosya başına muafiyet yazmaktan iyidir: aynı şekil üç ağaçta da
 * geçiyor ve her birine ayrı satır yazmak listeyi şişirirdi.
 */
function kodOlamazMi(deger: string): boolean {
  // ⚠️ ŞEMA ENUM DEĞERİ bir katalog kodu DEĞİLDİR (2026-09-13).
  // `roleGrade("FIRST")` çağrısı bu kuralı tetikliyordu: çağrı adı `/grade/i`
  // desenine uyuyor ve `"FIRST"` ilk argüman. Ama `FIRST` bir
  // `QualityGradeRole` üyesidir — KAPALI bir küme, fabrikaya açık bir kod
  // değil. Aynı gerekçe §3'ün ayna istisnasında da kullanıldı.
  // ⚠️ Bu düzeltme olmadan MANDAL KENDİ KENDİNİ KİRLETİYORDU: düzelttiğim her
  // dosya bir `roleGrade(...)` çağrısı ekliyor ⇒ borç düştükçe sayı geri
  // tırmanıyordu. Sayı "kalan borç" değil "kalan borç + uygulanan düzeltme"
  // ölçüyordu — ölçtüğünü sandığın şeyi ölçmeyen bir sayaç.
  if (SEMA_ENUM_DEGERLERI.has(deger)) return true;
  if (deger.length > 32) return true;
  if (deger.startsWith("/")) return true;
  if (/^[\s\p{P}\p{S}]+$/u.test(deger)) return true;
  if (/^(N\/A|n\/a)$/.test(deger)) return true;
  return false;
}

function kodYuvasiMi(ad: string | null, n?: tsc.Node, sf?: tsc.SourceFile): boolean {
  if (!ad) return false;
  if (/Ids?$/.test(ad)) return false; // `qualityGradeId` bir FK'dır, kod değil
  // `...Enabled` bir BAYRAK ANAHTARIDIR (`qualityGradeRequiredEnabled`); değeri
  // modül adı ya da boolean'dır, katalog kodu değil.
  if (/Enabled$/.test(ad)) return false;
  // SCREAMING_SNAKE bir ANAHTAR sabitidir (`QUALITY_GRADE_REQUIRED_ENABLED`,
  // `..._LABEL`); yalnız `..._CODE` bir kod yuvasıdır.
  // ⚠️ Bu kural ATAMA dallarında vardı ama KARŞILAŞTIRMA dalında YOKTU — aynı ad
  // iki dalda iki farklı cevap alıyordu. Yuva sorusunun tek evi burasıdır.
  if (/^[A-Z0-9_]+$/.test(ad) && !/_CODE$/.test(ad)) return false;
  if (KOD_YUVASI.test(ad)) return true;
  if (NOTR_KOD_YUVASI.test(ad) && n && sf) return yakindaKaliteVar(n, sf);
  return false;
}

/** Düğümden yukarı 6 ata: ADLARDA (değerlerde DEĞİL) kalite geçiyor mu. */
function yakindaKaliteVar(n: tsc.Node, sf: tsc.SourceFile): boolean {
  let d: tsc.Node | undefined = n;
  for (let i = 0; d && i < 10; i++, d = d.parent) {
    if (tsc.isPropertyAssignment(d) && KALITE_ADI.test(d.name.getText(sf))) return true;
    if (tsc.isVariableDeclaration(d) && KALITE_ADI.test(d.name.getText(sf))) return true;
    if (tsc.isCallExpression(d)) {
      const ad = kuyrukAd(d.expression);
      if (ad && KALITE_ADI.test(ad)) return true;
      if (tsc.isPropertyAccessExpression(d.expression)) {
        const alici = kuyrukAd(d.expression.expression);
        if (alici && KALITE_ADI.test(alici)) return true;
      }
    }
  }
  return false;
}

/**
 * Literal bir KALİTE KODU olarak mı kullanılıyor — iki kabul edilmiş şekil:
 *   (A) KARŞILAŞTIRMA / VARSAYILAN: `grade === "FIRE"`, `qg?.code ?? "1.KALITE"`
 *   (B) KOD YUVASINA ATAMA: `qualityGrade: "1.KALITE"`, `setRecutQualityGrade("A1")`
 * Etiket sözlükleri (alan adı → Türkçe metin) (B)'ye benzer ama kod TAŞIMAZ;
 * onlar MUAF listesinde gerekçeleriyle durur ve iki yönlü denetlenir.
 */
/** Prisma süzgeç operatörleri — kod yuvası bunların KENDİSİ değil, bir ÜST alandır. */
const SUZGEC_OPERATORLERI = new Set([
  "not", "in", "notIn", "equals", "contains", "startsWith", "endsWith",
  "lt", "lte", "gt", "gte", "has", "hasSome", "hasEvery",
]);

function kaliteBaglamiMi(n: tsc.Node, sf: tsc.SourceFile): string | null {
  const p = n.parent;
  if (!p) return null;
  if (kodOlamazMi((n as tsc.StringLiteralLike).text)) return null;

  // (A) karşılaştırma ya da ?? varsayılanı
  if (tsc.isBinaryExpression(p)) {
    const op = p.operatorToken.kind;
    const ilgili =
      op === tsc.SyntaxKind.EqualsEqualsEqualsToken ||
      op === tsc.SyntaxKind.ExclamationEqualsEqualsToken ||
      op === tsc.SyntaxKind.EqualsEqualsToken ||
      op === tsc.SyntaxKind.ExclamationEqualsToken ||
      op === tsc.SyntaxKind.QuestionQuestionToken;
    if (ilgili) {
      const karsi = p.left === n ? p.right : p.left;
      const ad = kuyrukAd(karsi);
      if (kodYuvasiMi(ad, n, sf)) return `${ad} ${p.operatorToken.getText(sf)} "${(n as tsc.StringLiteralLike).text}"`;
    }
    return null;
  }

  // (B) kod yuvasına atama
  if (tsc.isPropertyAssignment(p) && tsc.isIdentifier(p.name) && kodYuvasiMi(p.name.text, n, sf)) {
    const ad = p.name.text;
    const deger = (n as tsc.StringLiteralLike).text;
    // Prisma sıralama yönü — `orderBy: { code: "asc" }` bir kod değildir.
    if (deger === "asc" || deger === "desc") return null;
    // (SCREAMING_SNAKE anahtar kuralı `kodYuvasiMi`de — tek ev.)
    return `${ad}: "${deger}"`;
  }
  // (B2) PRISMA SÜZGEÇ OPERATÖRÜ — `qualityGrade: { not: "FIRE" }`.
  // ⚠️ Operatörün KENDİ adı (`not`/`notIn`) bir kod yuvası değildir; yuva BİR ÜST
  // alandır. Bu sınıf ölçüldü (2026-09-13) ve mandalın KÖR NOKTASIYDI: katalog
  // değişince `not: "FIRE"` HİÇBİR satırı elemez ⇒ bekçi kırmızı vermez, sessizce
  // BAŞKA bir şey ölçmeye başlar. Yani kaçırdığı şey, en tehlikeli sınıftı.
  {
    let alt: tsc.Node = n;
    if (alt.parent && tsc.isArrayLiteralExpression(alt.parent)) alt = alt.parent; // `notIn: ["FIRE"]`
    const opAta = alt.parent;
    if (opAta && tsc.isPropertyAssignment(opAta) && tsc.isIdentifier(opAta.name) && SUZGEC_OPERATORLERI.has(opAta.name.text)) {
      const alanAta = opAta.parent?.parent;
      if (alanAta && tsc.isPropertyAssignment(alanAta) && tsc.isIdentifier(alanAta.name) && kodYuvasiMi(alanAta.name.text, n, sf)) {
        return `${alanAta.name.text}: { ${opAta.name.text}: "${(n as tsc.StringLiteralLike).text}" }`;
      }
    }
  }
  if (tsc.isVariableDeclaration(p) && kodYuvasiMi(p.name.getText(sf), n, sf)) {
    // `__SENTINEL__` biçimli değer katalog kodu değildir — bilerek katalogda
    // BULUNAMAYACAK bir işarettir. (SCREAMING_SNAKE kuralı `kodYuvasiMi`de.)
    const ad = p.name.getText(sf);
    const deger = (n as tsc.StringLiteralLike).text;
    if (/^__.*__$/.test(deger)) return null;
    return `${ad} = "${deger}"`;
  }
  // ⚠️ YALNIZ İLK ARGÜMAN: kod alan fonksiyon kodu ilk sırada alır
  // (`setRecutQualityGrade("A1")`). Sonraki argümanlar başka şeylerdir —
  // `resolveRemainingGradeCode(db, "scrap", id)`ın "scrap"i bir sözleşme
  // adıdır, katalog kodu değil (ölçüldü: sahte kırmızı).
  if (tsc.isCallExpression(p) && p.arguments[0] === n) {
    const ad = kuyrukAd(p.expression);
    if (kodYuvasiMi(ad, n, sf)) return `${ad}("${(n as tsc.StringLiteralLike).text}")`;
  }
  // `useState<string>('1.KALITE')` — çağrı adı nötr, ama SONUCUN adı kod yuvası
  if (tsc.isCallExpression(p) && p.parent && tsc.isVariableDeclaration(p.parent)) {
    const ad = p.parent.name.getText(sf);
    if (kodYuvasiMi(ad, n, sf)) return `${ad} = ${kuyrukAd(p.expression) ?? "?"}("${(n as tsc.StringLiteralLike).text}")`;
  }
  return null;
}

function main(): void {
  console.log("=== Kalite kodu literali — AST tripwire (beş ağaç) ===\n");

  const ihlaller: Ihlal[] = [];
  const agacIhlal = new Map<string, number>();
  let taranan = 0;
  let atlananTest = 0;
  let stringDugum = 0;
  const kullanilanMuaf = new Set<string>();

  for (const agac of AGACLAR) {
    let sayac = 0;
    for (const mutlak of dosyalariTopla(agac.kok)) {
      const yol = relative(KOK, mutlak).replace(/\\/g, "/");
      if (agac.sadece && !agac.sadece.test(yol)) continue;
      if (fixtureDosyasiMi(yol)) {
        atlananTest++;
        continue;
      }
      const muaf = MUAF[yol];
      taranan++;
      const ham = readFileSync(mutlak, "utf8");
      const sf = tsc.createSourceFile(yol, ham, tsc.ScriptTarget.Latest, true, tsc.ScriptKind.TSX);
      const satirNo = (nd: tsc.Node): number =>
        sf.getLineAndCharacterOfPosition(nd.getStart(sf)).line + 1;

      // MUAF DEĞER DÜZEYİNDEDİR: dosya topluca affedilmez, yalnız listedeki
      // değerler geçer. Listedeki değer gerçekten görüldüyse muaf CANLI sayılır
      // (iki yönlü denetim ölü satırı kırmızıya çevirir).
      const ekle = (bolum: Ihlal["bolum"], nd: tsc.Node, metin: string, deger?: string): void => {
        if (muaf && deger !== undefined && muaf.izinli.includes(deger)) {
          kullanilanMuaf.add(yol);
          return;
        }
        ihlaller.push({ bolum, yol, satir: satirNo(nd), metin });
        sayac++;
      };

      const gez = (nd: tsc.Node): void => {
        // §1 — bağlam literali
        if (tsc.isStringLiteralLike(nd)) {
          stringDugum++;
          if (nd.text.length > 0) {
            const baglam = kaliteBaglamiMi(nd, sf);
            // §2, ad-kalıplı SABİT bildirimi ayrı bölüm sayılır (kendi sondası var).
            if (baglam) {
              const sabitMi =
                nd.parent &&
                tsc.isVariableDeclaration(nd.parent) &&
                /^[A-Z0-9_]+$/.test(nd.parent.name.getText(sf));
              ekle(sabitMi ? "§2" : "§1", nd, `${baglam}`, nd.text);
            }
          }
        }
        // §3 — kalite adlı tip takma adında string-literal birleşimi
        if (
          tsc.isTypeAliasDeclaration(nd) &&
          KALITE_ADI.test(nd.name.text) &&
          tsc.isUnionTypeNode(nd.type) &&
          nd.type.types.some((t) => tsc.isLiteralTypeNode(t) && tsc.isStringLiteralLike(t.literal))
        ) {
          const uyeler = nd.type.types
            .filter((t): t is tsc.LiteralTypeNode => tsc.isLiteralTypeNode(t))
            .filter((t) => tsc.isStringLiteralLike(t.literal))
            .map((t) => (t.literal as tsc.StringLiteralLike).text);
          // AYNA İSTİSNASI: kapalı bir şema enum'unun istemci kopyası kusur
          // değildir; fabrikanın AÇIK katalog kodlarını tipe gömmek kusurdur.
          if (!semaAynasiMi(nd.name.text, uyeler)) ekle("§3", nd, `type ${nd.name.text}`);
        }
        // §4 — kalite nesnesinin ADINA uygulanan regex
        if (
          tsc.isCallExpression(nd) &&
          tsc.isPropertyAccessExpression(nd.expression) &&
          nd.expression.name.text === "test" &&
          nd.expression.expression.kind === tsc.SyntaxKind.RegularExpressionLiteral &&
          nd.arguments.length === 1 &&
          /\bname\b/i.test(nd.arguments[0]!.getText(sf)) &&
          // ⚠️ YAKINDA KALİTE ŞARTI: `.test(name)` her yerde var (yedek adı
          // doğrulaması, kod biçimi…). Kural yalnız KALİTE nesnesinin adına
          // uygulanan regex'i arar (ölçüldü: `offsite-backup.helper` sahte kırmızı).
          yakindaKaliteVar(nd, sf)
        ) {
          ekle("§4", nd, nd.getText(sf).slice(0, 60));
        }
        tsc.forEachChild(nd, gez);
      };
      gez(sf);
    }
    agacIhlal.set(agac.kok, sayac);
  }

  // ── Körlük zemini — "0 ihlal" ile "hiç bakılmadı" aynı yeşile çıkmasın ────
  check("§0 zemin: beş ağaçta dosya tarandı", taranan > 800, `${taranan} dosya`);
  check("§0 zemin: AST gezildi (string düğümü bulundu)", stringDugum > 20_000, `${stringDugum} string`);
  console.log(`   (kapsam dışı: ${atlananTest} test/fixture dosyası — sayım ÜRETİM kodudur)\n`);

  // ── Ağaç başına RATCHET ──────────────────────────────────────────────────
  for (const agac of AGACLAR) {
    const gercek = agacIhlal.get(agac.kok) ?? 0;
    check(
      `⭐ ${agac.kok}: literal ≤ tavan (${agac.tavan}) · dilim ${agac.dilim}`,
      gercek <= agac.tavan,
      `${gercek} ihlal`,
    );
    check(
      `${agac.kok}: tavan ÇÜRÜMEMİŞ (gerçek < tavan ise tavanı düşür)`,
      gercek >= agac.tavan,
      `gerçek ${gercek} · tavan ${agac.tavan}`,
    );
  }

  // ── Muaf listesi İKİ YÖNLÜ ───────────────────────────────────────────────
  const oluMuaf = Object.keys(MUAF).filter((m) => !kullanilanMuaf.has(m));
  check("muaf listesi ÖLÜ satır taşımıyor (iki yönlü)", oluMuaf.length === 0, oluMuaf.join(", ") || "0 ölü");
  check("her muafın gerekçesi yazılı", Object.values(MUAF).every((g) => g.gerekce.length > 30), `${Object.keys(MUAF).length} muaf`);
  console.log(`   (muaf sayısı: ${Object.keys(MUAF).length} — bu sayı ARTMAMALI; büyüyen muaf listesi kapıyı sessizce öldürür)\n`);

  // ── REÇETE — kapı "yanlış" der, "doğrusu şu" da demeli ────────────────────
  // ⚠️ Kapı yalnız ihlali basarsa, doğru yolu ARAMANIN maliyeti çarpan kişiye
  // yazılır; kapı öldürmez ama pahalılaştırır. Doğru biçim ucuzdur ve çoğunluk
  // pratiğidir (ölçüldü 2026-09-13: 65 bekçi `roleGrade` kullanıyor).
  //
  // ⚠️ VE REÇETENİN KENDİSİ BİR İDDİADIR: yol ya da ad değişirse kapı YANLIŞ
  // yol tarif eder. Bu yüzden metin yazılmaz, ÖLÇÜLÜR — dosya yoksa ya da
  // dışa aktarım adı değiştiyse aşağıdaki kontrol KIRMIZI verir.
  const receteYolu = join(KOK, "Teks-Erp", "scripts", "fixture-quality-grade.ts");
  const receteVar = existsSync(receteYolu);
  const receteAdi = receteVar && /export\s+(async\s+)?function\s+roleGrade\b/.test(readFileSync(receteYolu, "utf8"));
  check(
    "reçete CANLI — kapının tarif ettiği çözüm gerçekten var",
    receteVar && receteAdi,
    receteVar ? (receteAdi ? "roleGrade() · scripts/fixture-quality-grade.ts" : "dosya var ama `roleGrade` dışa aktarımı YOK") : "scripts/fixture-quality-grade.ts YOK",
  );
  if (ihlaller.length > 0 && receteVar && receteAdi) {
    console.log(
      "\n   ⤷ DÜZELTME: kaliteyi ROLDEN çöz — " +
        `import { roleGrade } from "./fixture-quality-grade";  →  (await roleGrade("FIRST")).code\n` +
        "     Literal ÖLÇÜMÜN KENDİSİYSE (katalogda bilerek OLMAYAN kod) muaf listesine gerekçesiyle yaz.\n",
    );
  }

  // ── Bölüm dökümü — hangi kuralın kaç ihlali var ──────────────────────────
  for (const bolum of ["§1", "§2", "§3", "§4"] as const) {
    const liste = ihlaller.filter((i) => i.bolum === bolum);
    console.log(`${bolum}: ${liste.length} ihlal`);
    for (const i of liste.slice(0, 200)) console.log(`     ${i.yol}:${i.satir}  ${i.metin}`);
    if (liste.length > 200) console.log(`     … +${liste.length - 200} satır`);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
