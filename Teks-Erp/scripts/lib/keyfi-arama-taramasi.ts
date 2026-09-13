// =============================================================================
// KEYFİ ARAMA TARAMASI — "bekçi ortamda ne varsa onu mu buluyor?"
// =============================================================================
// NEDEN: kök kural *"ortamdaki veriye BAĞIMLI OLMA"* der (`findFirst` ile
// "herhangi bir kayıt" üstüne test kurmak temiz CI DB'sinde düşer ya da VAKUMEN
// yeşil kalır). İhlal ölçüldü 2026-09-13: **176 çağrı / 123 dosya / 36 model**.
// 1e hükmü: düzeltme turu YOK (ürün kırılması yok, teşhis bulanıklığı var) —
// mevcut küme MANDALLA dondurulur, yenisi girmez.
//
// ⚠️ SINIFLANDIRMA SÖZDİZİMSEL OLARAK TAM YAPILAMAZ ve bu aracın merkezî sınırı:
// *"ortamda ne varsa" ile "iş anahtarıyla fikstür" metinsel olarak ayırt edilemez —
// ikisi de literal süzgeçtir.* Fark ANLAMSAL: literal bir İŞ ANAHTARINI mı
// adlandırıyor (`code: "PATOS"`, `username: "admin"`) yoksa yalnız bir NİTELİĞİ mi
// süzüyor (`isActive`, `role`)? Araç bu ayrımı elle kurulmuş bir anahtar listesiyle
// yapar ⇒ yeni bir anahtar alanı (`installationId`, `deviceCode`) eklenirse MEŞRU
// bir çağrı KEYFİ görünür. Bu yüzden üç kova **yalnız sınıflandırır**, mandalın
// TABANINI kurmaz; taban `dosya::model` kümesidir (d5 kararı 2026-09-13).
//
// ⚠️ Aracın geliştirilme tarihi: dört ayrı yüklem dört ayrı cevap verdi
// (5 · 30 · 13 · 632). Hiçbir sayı, aşağıdaki İKİ POZİTİF KONTROL geçmeden
// raporlanabilir değildir — `kendiniSina()` tam bu yüzden ihraç edilir.
// =============================================================================
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Kapının çıktısına BASILACAK kapsam şerhi — yeşilin ne demediğini söyler. */
export const KAPSAM_SERHI =
  "KAPSAM: `findFirst`/`findFirstOrThrow` çağrıları üç kovaya ayrılır ve sınıflandırma " +
  "SÖZDİZİMSELDİR. İŞ ANAHTARI listesi ELLE kuruludur — yeni bir anahtar alanı eklenirse " +
  "meşru bir çağrı KEYFİ görünür. Yeşil 'ortama yaslanma yok' DEMEZ; 'bilinen anahtar " +
  "alanlarıyla süzmeyen YENİ çağrı yok' der.";

/** Tekil kaydı ADLANDIRAN alanlar — literal süzgeci meşru kılan tek şey. */
const IS_ANAHTARI =
  /\b(code|username|name|barcode|sackNo|shipmentNo|workOrderNumber|countNo|key|slug|email)\s*:/;
/** Yalnız SINIF süzen alanlar — "ortamda bu sınıftan ne varsa". */
const NITELIK = /\b(isActive|itemType|status|role|category|kind|docType|type|unit|form)\s*:/;
/** Bağ SAYILMAYAN sağ taraflar: literal bir bağ değildir. */
const LITERAL = /^(true|false|null|undefined|asc|desc)$/;

export type Kova = "IS_ANAHTARI" | "BAGLI" | "KEYFI" | "PRISMA_DEGIL";

/**
 * Çağrı metnini kovaya ayırır. Mandal YENİ çağrıyı bununla sınıflandırır; taban
 * bununla KURULMAZ (yukarıdaki allowlist sınırı).
 */
export function siniflandir(cagri: string): Kova {
  const c = cagri.replace(/\s+/g, " ");
  if (c.includes("=>")) return "PRISMA_DEGIL"; // lambda — `Array.prototype` vb.
  if (IS_ANAHTARI.test(c)) return "IS_ANAHTARI";
  // BAĞLI: testin KENDİ yarattığı veriye referans.
  //   `\w+!?\.id` — `!` ŞART: `injRec!.id` aksi hâlde bağsız görünür (ölçüldü).
  if (/\w+!?\.id\b|\$\{|\bin:\s*\[/.test(c)) return "BAGLI";
  if (/\{\s*[a-z][A-Za-z0-9]*\s*[,}]/.test(c)) return "BAGLI"; // kısayol { propertyId, code }
  const saglar = [...c.matchAll(/:\s*([A-Za-z_][A-Za-z0-9_.!]*)/g)].map((m) => m[1]);
  if (saglar.some((s) => !LITERAL.test(s))) return "BAGLI";
  if (NITELIK.test(c) || !/where/.test(c)) return "KEYFI";
  return "BAGLI";
}

/** `findFirst(` çağrısının metnini DENGELİ PARANTEZLE çıkarır. */
function cagriMetni(kaynak: string, aramaBasi: number): string {
  const ac = kaynak.indexOf("(", aramaBasi);
  if (ac < 0) return "";
  let derinlik = 0;
  for (let i = ac; i < kaynak.length && i < ac + 4000; i++) {
    if (kaynak[i] === "(") derinlik++;
    else if (kaynak[i] === ")") {
      derinlik--;
      if (derinlik === 0) return kaynak.slice(ac, i + 1);
    }
  }
  return kaynak.slice(ac, ac + 400);
}

// ⚠️ TEK SATIR REGEX YETMEZ: çok satırlı `findFirst({\n where: …\n })` çağrıları
// kaçar (ölçüldü: 911 ↔ 940 farkı tam buydu). Model çağrının SOLUNDAN okunur.
const CAGRI = /\b(?:prisma|tx|db)\.([A-Za-z]+)\.(?:findFirst|findFirstOrThrow)\b/g;

export interface Bulgu {
  dosya: string;
  model: string;
  /** `dosya::model` — mandalın taban üyesi. */
  uye: string;
  metin: string;
}

/** Bir dosyanın keyfi çağrıları. */
export function dosyaninKeyfileri(dosya: string, kaynak: string): Bulgu[] {
  const out: Bulgu[] = [];
  for (const m of kaynak.matchAll(CAGRI)) {
    const metin = cagriMetni(kaynak, m.index + m[0].length - 1);
    if (siniflandir(metin) !== "KEYFI") continue;
    out.push({ dosya, model: m[1] as string, uye: `${dosya}::${m[1]}`, metin: metin.replace(/\s+/g, " ").slice(0, 120) });
  }
  return out;
}

/**
 * MANDALIN TABANI: `dosya::model` kümesi.
 *
 * Neden çağrı değil: çağrının SABİT KİMLİĞİ yok (taşınır, düzenlenir, sırası
 * değişir) ⇒ sahte "yeni üye" gürültüsü. Neden yalnız dosya değil: adres vermez
 * ("bu dosyada bir şey arttı"). `dosya::model` hem sabit hem adresli, ve bir gün
 * düzeltilirse dilimlenme ekseniyle (MODEL) aynı.
 */
export function keyfiCagrilar(kokDizin: string): Set<string> {
  const uyeler = new Set<string>();
  for (const d of readdirSync(kokDizin).filter((f) => /^test_.*\.ts$/.test(f)).sort()) {
    for (const b of dosyaninKeyfileri(d, readFileSync(join(kokDizin, d), "utf8"))) uyeler.add(b.uye);
  }
  return uyeler;
}

/** Tarama sayıları — PAYDA AYRI basılır (bkz. `kendiniSina` şerhi). */
export function olcum(kokDizin: string): {
  taranan: number;
  icerenDosya: number;
  populasyon: number;
  keyfiCagri: number;
  keyfiDosya: number;
  uyeler: Set<string>;
} {
  const dosyalar = readdirSync(kokDizin).filter((f) => /^test_.*\.ts$/.test(f)).sort();
  let populasyon = 0, icerenDosya = 0, keyfiCagri = 0;
  const keyfiDosyalar = new Set<string>(), uyeler = new Set<string>();
  for (const d of dosyalar) {
    const s = readFileSync(join(kokDizin, d), "utf8");
    const n = [...s.matchAll(CAGRI)].length;
    populasyon += n;
    if (n > 0) icerenDosya++;
    for (const b of dosyaninKeyfileri(d, s)) {
      keyfiCagri++;
      keyfiDosyalar.add(d);
      uyeler.add(b.uye);
    }
  }
  return { taranan: dosyalar.length, icerenDosya, populasyon, keyfiCagri, keyfiDosya: keyfiDosyalar.size, uyeler };
}

/**
 * ARACIN KENDİ SONDASI — gömülü, çünkü kapının kendi körlüğünü ölçmenin tek yolu.
 * Koşan her kapı ÖNCE bunu çağırır ve başarısızsa fail-closed durur: sınıflandırıcı
 * bozulduğunda "0 ihlal" ile "hiç bakılmadı" aynı görünür.
 *
 * ⚠️ Dördüncü vaka gerçek bir yanlış negatifti: `isActive: true` bir turda "BAĞLI"
 * sayılmıştı, çünkü `true` tanımlayıcıya benziyor. `LITERAL` maddesi onu kapatır.
 */
export function kendiniSina(): { gecti: boolean; satirlar: string[] } {
  const vakalar: Array<[string, string, Kova]> = [
    ["bilinen MEŞRU — iş anahtarı", `({ where: { code: "PATOS" }, select: { id: true } })`, "IS_ANAHTARI"],
    ["bilinen KUSURLU — yalnız nitelik", `({ where: { role: "FIRST", isActive: true } })`, "KEYFI"],
    ["süzgeçsiz", `({ select: { id: true } })`, "KEYFI"],
    ["kendi verisine bağlı", `({ where: { rollId: r1.id } })`, "BAGLI"],
    // ⚠️ KISAYOL `IS_ANAHTARI` DEĞİL `BAGLI` döner ve bu doğru: kısayolda iki nokta
    // yoktur (`code` değil `code:`), yani anahtar yüklemi eşleşmez — ama değişken
    // testin kendi verisini taşır. İki kova da "meşru" tarafta; ayrım yalnız
    // GEREKÇEyi söyler. (Bu satır ilk yazımda yanlış beklentiyle kuruldu ve gömülü
    // sonda onu ARAÇ İNMEDEN yakaladı — sondanın varlık sebebi tam bu.)
    ["kısayol değişken", `({ where: { propertyId, code } })`, "BAGLI"],
    ["`!` ile bağ", `({ where: { customerId: injRec!.id } })`, "BAGLI"],
    ["literal bağ DEĞİLDİR", `({ where: { isActive: true } })`, "KEYFI"],
    ["Prisma değil (lambda)", `((needle) => fnBody.indexOf(needle))`, "PRISMA_DEGIL"],
  ];
  const satirlar: string[] = [];
  let gecti = true;
  for (const [ad, metin, beklenen] of vakalar) {
    const bulunan = siniflandir(metin);
    const ok = bulunan === beklenen;
    if (!ok) gecti = false;
    satirlar.push(`${ok ? "✅" : "❌"} ${ad}: beklenen ${beklenen}, bulunan ${bulunan}`);
  }
  return { gecti, satirlar };
}
