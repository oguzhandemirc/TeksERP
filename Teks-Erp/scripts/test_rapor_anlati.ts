// =============================================================================
// test_rapor_anlati — Raporlar v2 anlatı motoru + Türkçe ek motoru + sunum zarfı (DB'siz)
// =============================================================================
// Koşum: npx tsx scripts/run-all-tests.ts test_rapor_anlati   (DB'siz, saf fonksiyonlar)
//
// §1 sayı biçimi + okunuş — binlik nokta/ondalık virgül; son okunan sözcük (ek bunu izler)
// §2 ek vakaları (≥60) — sayı 0–1.000.000, yüzde, ondalık, özel ad, cins ad; yabancı ad,
//    kısaltma ve ünlüsüz gövde `null` (çağıran eksiz yedek kalıba düşer)
// §3 kıyas — ±%2 eşiği, bölen 0, `null` "ölçülemedi"yi korur (0'a çökmez), iyiYon rengi
// §4 dönem etiketi FABRİKA gününden (UTC günüyle yazılsa 1 Ekim 00:00 "30 Eylül" olurdu)
// §5 altın cümleler — plan §3.5 kural kataloğunun HER kuralı birebir + yedek kalıplar
// §6 yasak sözcük (formül dili) — liste her sözcüğü yakalar, altın cümlelerde hiçbiri yok
// §7 önem sırası belirlenimli (girdi sırası karıştırılınca aynı çıktı) + tavan
// §9 (2026-10-25) para işareti: para birimli kaynaktan doğan cümle `paraIcerir: true` taşır (bulut fiyat izni
//    süzgeci onu okur); para dışı cümlede anahtar YOK (altın çıktı değişmez). NEGATİF SONDA: `ekle` para dalı
//    söküldü → §9a + §9b ❌; geri alındı → ✅.
// §8 zarf tip dosyası importsuz (Electron'a bayt-eşit aynalanır) · tr-case dışında harf dönüşümü yok
//
// Negatif sondalar (2026-10-24, ölçüldü, md5 ile birebir geri alındı; toplam 215 kontrol):
//   ① ek.ts sert ünsüz kümesinden `ç` çıkarıldı ("fstkşhp") → 10 ❌ (3/13/103/-3/%3/2,3'te,
//      3/23'ten, Koç'ta, Kılıç'tan — "üç" ile biten her okunuş ve ç'li özel ad)
//   ② kiyasHesapla'da `null` 0'a çevrildi (`simdi ?? 0`, `once ?? 0`) → 4 ❌ (§3 iki null kolu,
//      anaSayiKur null kıyası, §5 "önceki dönem ölçülemedi" cümlesi "42.300 m fazla"ya döndü)

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { anlatiUret, gozlemleriTopla, type NarrativeInput } from "../src/services/reports/anlati/anlati";
import { ayrilma, belirtme, bulunma, ile, ilgi, iyelik3, lik, durative, yonelme, type SuffixInput } from "../src/services/reports/anlati/ek";
import { KURAL_ADLARI, type KuralAdi } from "../src/services/reports/anlati/gozlem";
import { formatValue, sayiMetni } from "../src/services/reports/anlati/sayi-bicim";
import { sonOkunanSozcuk, tamSayiOkunus } from "../src/services/reports/anlati/sayi-okunus";
import { YASAK_SOZCUKLER, yasakSozcukBul } from "../src/services/reports/anlati/yasak-sozcuk";
import { narrativeOf } from "../src/services/reports/semantik/anlati-blok";
import type { SemanticResult } from "../src/services/reports/semantik/sonuc";
import { anaSayiKur, donemEtiketi, donemSozleri, kiyasHesapla } from "../src/services/reports/sunum/sunum-kur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const esit = (label: string, gercek: unknown, beklenen: unknown): void =>
  check(label, JSON.stringify(gercek) === JSON.stringify(beklenen), `beklenen ${JSON.stringify(beklenen)}, gelen ${JSON.stringify(gercek)}`);

const sayi = (deger: number): SuffixInput => ({ tur: "sayi", deger });
const yuzde = (deger: number): SuffixInput => ({ tur: "yuzde", deger });
const ad = (metin: string): SuffixInput => ({ tur: "ad", metin });
const cins = (metin: string, yumusamaz = false): SuffixInput => ({ tur: "ad", metin, kesme: false, yumusamaz });

// --- §1 sayı biçimi + okunuş ---------------------------------------------------
console.log("\n§1 sayı biçimi + okunuş");
esit("§1 42300 → 42.300", sayiMetni(42300), "42.300");
esit("§1 12.5 → 12,5", sayiMetni(12.5), "12,5");
esit("§1 12.46 → 12,5 (en çok 1 ondalık)", sayiMetni(12.46), "12,5");
esit("§1 -0.04 → 0 (eksi sıfır yok)", sayiMetni(-0.04), "0");
esit("§1 1234567.89 → 1.234.567,9", sayiMetni(1234567.89), "1.234.567,9");
esit("§1 para 0 ondalık + birim", formatValue(1200000.4, "TRY"), "1.200.000 TL");
esit("§1 oran", formatValue(78, "yuzde"), "%78");
esit("§1 okunuş 0", tamSayiOkunus(0), "sıfır");
esit("§1 okunuş 1.000 ('bir bin' denmez)", tamSayiOkunus(1000), "bin");
esit("§1 okunuş 1.001", tamSayiOkunus(1001), "bin bir");
esit("§1 okunuş 100.000", tamSayiOkunus(100000), "yüz bin");
esit("§1 okunuş 1.000.000", tamSayiOkunus(1000000), "bir milyon");
esit("§1 okunuş 1.234.567", tamSayiOkunus(1234567), "bir milyon iki yüz otuz dört bin beş yüz altmış yedi");
esit("§1 okunuş 2.000.000.000", tamSayiOkunus(2e9), "iki milyar");
esit("§1 son okunan '12,5' → beş", sonOkunanSozcuk("12,5"), "beş");
esit("§1 son okunan '12,05' → beş", sonOkunanSozcuk("12,05"), "beş");
esit("§1 son okunan '%12' → iki", sonOkunanSozcuk("%12"), "iki");
esit("§1 son okunan '42.300' → yüz", sonOkunanSozcuk("42.300"), "yüz");
esit("§1 son okunan 'abc' → null", sonOkunanSozcuk("abc"), null);

// --- §2 ek vakaları --------------------------------------------------------------
console.log("\n§2 ek vakaları");
type Ek = (g: SuffixInput) => string | null;
const vakalar: [string, Ek, SuffixInput, string | null][] = [
  // bulunma — sayı okunuşu
  ["bulunma", bulunma, sayi(0), "0'da"],
  ["bulunma", bulunma, sayi(1), "1'de"],
  ["bulunma", bulunma, sayi(2), "2'de"],
  ["bulunma", bulunma, sayi(3), "3'te"],
  ["bulunma", bulunma, sayi(4), "4'te"],
  ["bulunma", bulunma, sayi(5), "5'te"],
  ["bulunma", bulunma, sayi(6), "6'da"],
  ["bulunma", bulunma, sayi(7), "7'de"],
  ["bulunma", bulunma, sayi(8), "8'de"],
  ["bulunma", bulunma, sayi(9), "9'da"],
  ["bulunma", bulunma, sayi(10), "10'da"],
  ["bulunma", bulunma, sayi(20), "20'de"],
  ["bulunma", bulunma, sayi(30), "30'da"],
  ["bulunma", bulunma, sayi(40), "40'ta"],
  ["bulunma", bulunma, sayi(50), "50'de"],
  ["bulunma", bulunma, sayi(60), "60'ta"],
  ["bulunma", bulunma, sayi(70), "70'te"],
  ["bulunma", bulunma, sayi(80), "80'de"],
  ["bulunma", bulunma, sayi(90), "90'da"],
  ["bulunma", bulunma, sayi(100), "100'de"],
  ["bulunma", bulunma, sayi(1000), "1.000'de"],
  ["bulunma", bulunma, sayi(9800), "9.800'de"],
  ["bulunma", bulunma, sayi(42300), "42.300'de"],
  ["bulunma", bulunma, sayi(1000000), "1.000.000'da"],
  ["bulunma", bulunma, sayi(-3), "-3'te"],
  ["bulunma", bulunma, sayi(12.5), "12,5'te"],
  ["bulunma", bulunma, sayi(0.5), "0,5'te"],
  ["bulunma", bulunma, sayi(7.9), "7,9'da"],
  ["bulunma", bulunma, sayi(13), "13'te"],
  ["bulunma", bulunma, sayi(103), "103'te"],
  ["bulunma", bulunma, yuzde(3), "%3'te"],
  ["bulunma", bulunma, sayi(2.3), "2,3'te"],
  // ayrılma
  ["ayrilma", ayrilma, sayi(3), "3'ten"],
  ["ayrilma", ayrilma, sayi(6), "6'dan"],
  ["ayrilma", ayrilma, sayi(15), "15'ten"],
  ["ayrilma", ayrilma, sayi(40), "40'tan"],
  ["ayrilma", ayrilma, sayi(1000), "1.000'den"],
  ["ayrilma", ayrilma, sayi(2_500_000), "2.500.000'den"],
  ["ayrilma", ayrilma, sayi(23), "23'ten"],
  // yönelme (kaynaştırma -ya/-ye)
  ["yonelme", yonelme, sayi(2), "2'ye"],
  ["yonelme", yonelme, sayi(3), "3'e"],
  ["yonelme", yonelme, sayi(6), "6'ya"],
  ["yonelme", yonelme, sayi(9), "9'a"],
  ["yonelme", yonelme, sayi(40), "40'a"],
  ["yonelme", yonelme, sayi(100), "100'e"],
  ["yonelme", yonelme, sayi(1000000), "1.000.000'a"],
  // belirtme, ilgi, iyelik, -lik, ile
  ["belirtme", belirtme, sayi(6), "6'yı"],
  ["belirtme", belirtme, sayi(2), "2'yi"],
  ["belirtme", belirtme, sayi(3), "3'ü"],
  ["belirtme", belirtme, sayi(10), "10'u"],
  ["ilgi", ilgi, sayi(1000), "1.000'in"],
  ["ilgi", ilgi, sayi(6), "6'nın"],
  ["ilgi", ilgi, sayi(2), "2'nin"],
  ["ilgi", ilgi, sayi(9), "9'un"],
  ["ilgi", ilgi, sayi(4), "4'ün"],
  ["iyelik3", iyelik3, yuzde(12), "%12'si"],
  ["iyelik3", iyelik3, yuzde(64), "%64'ü"],
  ["iyelik3", iyelik3, yuzde(23), "%23'ü"],
  ["iyelik3", iyelik3, yuzde(78), "%78'i"],
  ["iyelik3", iyelik3, yuzde(80), "%80'i"],
  ["iyelik3", iyelik3, yuzde(40), "%40'ı"],
  ["iyelik3", iyelik3, yuzde(50), "%50'si"],
  ["iyelik3", iyelik3, yuzde(100), "%100'ü"],
  ["iyelik3", iyelik3, yuzde(6), "%6'sı"],
  ["iyelik3", iyelik3, yuzde(9), "%9'u"],
  ["iyelik3", iyelik3, yuzde(12.5), "%12,5'i"],
  ["lik", lik, yuzde(12), "%12'lik"],
  ["lik", lik, yuzde(40), "%40'lık"],
  ["lik", lik, yuzde(100), "%100'lük"],
  ["lik", lik, yuzde(6), "%6'lık"],
  ["lik", lik, yuzde(9), "%9'luk"],
  ["lik", lik, yuzde(3), "%3'lük"],
  ["ile", ile, sayi(6), "6'yla"],
  ["ile", ile, sayi(3), "3'le"],
  // özel ad (kesmeli)
  ["bulunma", bulunma, ad("Kaya Tekstil"), "Kaya Tekstil'de"],
  ["bulunma", bulunma, ad("Ekim"), "Ekim'de"],
  ["bulunma", bulunma, ad("14 Ekim"), "14 Ekim'de"],
  ["bulunma", bulunma, ad("Demir Örme"), "Demir Örme'de"],
  ["ayrilma", ayrilma, ad("Ak Boya"), "Ak Boya'dan"],
  ["ayrilma", ayrilma, ad("Kaya Tekstil"), "Kaya Tekstil'den"],
  ["yonelme", yonelme, ad("Ekim"), "Ekim'e"],
  ["yonelme", yonelme, ad("Ak Boya"), "Ak Boya'ya"],
  ["ilgi", ilgi, ad("Kaya Tekstil"), "Kaya Tekstil'in"],
  ["ilgi", ilgi, ad("Ak Boya"), "Ak Boya'nın"],
  ["iyelik3", iyelik3, ad("Ak Boya"), "Ak Boya'sı"],
  ["bulunma", bulunma, ad("Müller"), "Müller'de"],
  ["bulunma", bulunma, ad("KAYA TEKSTİL"), "KAYA TEKSTİL'de"],
  ["bulunma", bulunma, ad("P07"), "P07'de"],
  ["yonelme", yonelme, ad("P07"), "P07'ye"],
  ["bulunma", bulunma, ad("Tezgah 12"), "Tezgah 12'de"],
  ["bulunma", bulunma, ad("Koç"), "Koç'ta"],
  ["ayrilma", ayrilma, ad("Kılıç Örme Kılıç"), "Kılıç Örme Kılıç'tan"],
  // cins ad (bitişik; yumuşama kestirilemezse null)
  ["ayrilma", ayrilma, cins("renk"), "renkten"],
  ["ayrilma", ayrilma, cins("üç müşteri"), "üç müşteriden"],
  ["ayrilma", ayrilma, cins("gün"), "günden"],
  ["bulunma", bulunma, cins("Depo"), "Depoda"],
  ["yonelme", yonelme, cins("eylül", true), "eylüle"],
  ["ile", ile, cins("eylül", true), "eylülle"],
  ["yonelme", yonelme, cins("mart", true), "marta"],
  ["yonelme", yonelme, cins("önceki dönem"), "önceki döneme"],
  ["durative", durative, cins("ay"), "aydır"],
  ["durative", durative, cins("hafta"), "haftadır"],
  ["durative", durative, cins("gün"), "gündür"],
  ["yonelme", yonelme, cins("renk"), null],
  ["belirtme", belirtme, cins("kumaş top"), null],
  // kestirilemeyen gövde → null (yedek kalıp)
  ["bulunma", bulunma, ad("THY"), null],
  ["bulunma", bulunma, ad("ABC"), null],
  ["bulunma", bulunma, ad("XYZ"), null],
  ["bulunma", bulunma, ad("A.Ş."), null],
  ["bulunma", bulunma, ad("Renault"), null],
  ["bulunma", bulunma, ad("Bordeaux"), null],
  ["bulunma", bulunma, ad("Smith"), null],
  ["bulunma", bulunma, ad("Sony"), null],
  ["bulunma", bulunma, ad("Ford"), null],
  ["bulunma", bulunma, ad("GmbH"), null],
  ["bulunma", bulunma, ad("Wagner"), null],
  ["bulunma", bulunma, ad(""), null],
  ["bulunma", bulunma, { tur: "sayi", deger: Number.NaN }, null],
];
for (const [ad_, f, g, beklenen] of vakalar) {
  const etiket = g.tur === "ad" ? g.metin : `${g.tur === "yuzde" ? "%" : ""}${g.deger}`;
  esit(`§2 ${ad_}(${etiket})`, f(g), beklenen);
}
check("§2 ek vakası sayısı ≥ 60", vakalar.length >= 60, `${vakalar.length} vaka`);

// --- §3 kıyas -------------------------------------------------------------------
console.log("\n§3 kıyas");
const yukari = { iyiYon: "yukari" as const };
esit("§3 +%2 tam eşikte → artti", kiyasHesapla(102, 100, yukari).yon, "artti");
esit("§3 +%1,99 → degismedi", kiyasHesapla(101.99, 100, yukari).yon, "degismedi");
esit("§3 -%1,99 → degismedi", kiyasHesapla(98.01, 100, yukari).yon, "degismedi");
esit("§3 -%2 → azaldi", kiyasHesapla(98, 100, yukari).yon, "azaldi");
esit("§3 esikYuzde=5 ile +%4 → degismedi", kiyasHesapla(104, 100, { iyiYon: "yukari", esikYuzde: 5 }).yon, "degismedi");
esit("§3 bölen 0 → yuzde null, yön farktan", kiyasHesapla(5, 0, yukari), { deger: 0, fark: 5, yuzde: null, yon: "artti", durum: "iyi" });
esit("§3 0 → 0 → degismedi", kiyasHesapla(0, 0, yukari).yon, "degismedi");
esit("§3 şimdi null → fark/yüzde/yön null (0 değil)", kiyasHesapla(null, 100, yukari), { deger: 100, fark: null, yuzde: null, yon: null, durum: "notr" });
esit("§3 önceki null → deger null korunur (0 değil)", kiyasHesapla(100, null, yukari), { deger: null, fark: null, yuzde: null, yon: null, durum: "notr" });
esit("§3 iyiYon asagi + artti → kotu", kiyasHesapla(120, 100, { iyiYon: "asagi" }).durum, "kotu");
esit("§3 iyiYon yukari + azaldi → kotu", kiyasHesapla(80, 100, yukari).durum, "kotu");
esit("§3 iyiYon notr → notr", kiyasHesapla(120, 100, { iyiYon: "notr" }).durum, "notr");
esit("§3 yüzde 1 ondalığa yuvarlı", kiyasHesapla(42300, 37768, yukari).yuzde, 12);
const olcusuz = anaSayiKur({ olcu: "termin.zamaninda", ad: "Zamanında teslim", deger: null, birim: "yuzde", onceki: 84, iyiYon: "yukari" });
check("§3 anaSayiKur null → deger null + olculemedi nedeni", olcusuz.deger === null && typeof olcusuz.olculemedi === "string" && olcusuz.olculemedi.length > 0);
check("§3 anaSayiKur null → kıyas farkı null", olcusuz.kiyas?.fark === null && olcusuz.kiyas?.yon === null);
check("§3 anaSayiKur onceki verilmezse kıyas yok", anaSayiKur({ olcu: "x", ad: "X", deger: 5, birim: "m", iyiYon: "yukari" }).kiyas === undefined);

// --- §4 dönem etiketi (fabrika günü) ------------------------------------------------
console.log("\n§4 dönem etiketi");
const IST = (s: string): Date => new Date(`${s}+03:00`);
const EKIM = { from: IST("2026-10-01T00:00:00"), to: IST("2026-10-31T23:59:59.999") };
const EYLUL = { from: IST("2026-09-01T00:00:00"), to: IST("2026-09-30T23:59:59.999") };
esit("§4 tam ay", donemEtiketi(EKIM), "Ekim 2026");
esit("§4 ay içi kısmi", donemEtiketi({ from: EKIM.from, to: IST("2026-10-24T14:02:00") }), "1–24 Ekim 2026");
esit("§4 tek gün", donemEtiketi({ from: IST("2026-10-24T00:00:00"), to: IST("2026-10-24T23:59:59.999") }), "24 Ekim 2026");
esit("§4 ay aşan", donemEtiketi({ from: IST("2026-09-28T00:00:00"), to: IST("2026-10-24T23:59:59") }), "28 Eylül – 24 Ekim 2026");
esit("§4 yıl aşan", donemEtiketi({ from: IST("2025-12-28T00:00:00"), to: IST("2026-01-03T23:59:59") }), "28 Aralık 2025 – 3 Ocak 2026");
esit("§4 tam yıl", donemEtiketi({ from: IST("2026-01-01T00:00:00"), to: IST("2026-12-31T23:59:59.999") }), "2026");
esit("§4 kıyas adı: ekim ↔ eylül", donemSozleri(EKIM, EYLUL), { donem: { tur: "ad", metin: "Ekim", kesme: true }, kiyas: { tur: "ad", metin: "eylül", kesme: false, yumusamaz: true } });
esit("§4 kıyas adı: ocak ↔ aralık (yıl dönümü)", donemSozleri({ from: IST("2027-01-01T00:00:00"), to: IST("2027-01-31T23:59:59.999") }, { from: IST("2026-12-01T00:00:00"), to: IST("2026-12-31T23:59:59.999") }).kiyas, { tur: "ad", metin: "aralık", kesme: false, yumusamaz: true });
esit("§4 geçen yılın ekimi → ad yok (önceki dönem yedeği)", donemSozleri(EKIM, { from: IST("2025-10-01T00:00:00"), to: IST("2025-10-31T23:59:59.999") }).kiyas, null);

// --- §5 altın cümleler ----------------------------------------------------------------
console.log("\n§5 altın cümleler (plan §3.5)");
const goruldu = new Set<KuralAdi>();
const altinlar: string[] = [];
function altin(label: string, girdi: NarrativeInput, kural: KuralAdi, beklenen: string): void {
  const c = anlatiUret(girdi, { kurallar: [kural] });
  const metin = c[0]?.metin;
  esit(`§5 ${label}`, metin, beklenen);
  if (metin === beklenen) goruldu.add(kural);
  if (metin) altinlar.push(metin);
}
const siparis = anaSayiKur({ olcu: "siparis.metre", ad: "Alınan sipariş", deger: 42300, birim: "m", onceki: 37768, iyiYon: "yukari" });
const ifade = { yuklem: "sipariş aldınız" };
altin("anaSayiKiyas", { donem: EKIM, kiyasDonemi: EYLUL, anaSayi: siparis, anaSayiIfadesi: ifade }, "anaSayiKiyas", "Ekim'de 42.300 m sipariş aldınız; eylüle göre %12 fazla.");
altin(
  "anaSayiKiyas ±%2 altı",
  { donem: EKIM, kiyasDonemi: EYLUL, anaSayi: anaSayiKur({ olcu: "siparis.metre", ad: "Alınan sipariş", deger: 42300, birim: "m", onceki: 41700, iyiYon: "yukari" }), anaSayiIfadesi: ifade },
  "anaSayiKiyas",
  "Ekim'de 42.300 m sipariş aldınız; eylülle aynı düzeyde.",
);
altin(
  "anaSayiKiyas oran (§4.1)",
  { donem: EKIM, kiyasDonemi: EYLUL, anaSayi: anaSayiKur({ olcu: "termin.zamaninda", ad: "Zamanında teslim", deger: 78, birim: "yuzde", onceki: 84, iyiYon: "yukari" }), anaSayiIfadesi: { ozne: "Siparişlerin", yuklem: "terminde gitti" } },
  "anaSayiKiyas",
  "Siparişlerin %78'i terminde gitti; eylüle göre 6 puan düşük.",
);
altin(
  "anaSayiKiyas adsız dönem yedeği",
  { donem: { from: IST("2026-10-05T00:00:00"), to: IST("2026-11-03T23:59:59") }, kiyasDonemi: { from: IST("2026-09-05T00:00:00"), to: IST("2026-10-04T23:59:59") }, anaSayi: siparis, anaSayiIfadesi: ifade },
  "anaSayiKiyas",
  "Bu dönemde 42.300 m sipariş aldınız; önceki döneme göre %12 fazla.",
);
altin(
  "anaSayiKiyas önceki ölçülemedi",
  { donem: EKIM, kiyasDonemi: EYLUL, anaSayi: anaSayiKur({ olcu: "siparis.metre", ad: "Alınan sipariş", deger: 42300, birim: "m", onceki: null, iyiYon: "yukari" }), anaSayiIfadesi: ifade },
  "anaSayiKiyas",
  "Ekim'de 42.300 m sipariş aldınız; önceki dönem ölçülemediği için kıyas yok.",
);
// Özel rapor (R2-ANLATI): ölçünün yüklemi yok → ölçü adıyla açılır; oran ölçüsünde de aynı kalıp.
altin("anaSayiKiyas yüklemsiz (özel rapor)", { donem: EKIM, kiyasDonemi: EYLUL, anaSayi: siparis, anaSayiIfadesi: {} }, "anaSayiKiyas", "Alınan sipariş: Ekim'de 42.300 m; eylüle göre %12 fazla.");
altin(
  "anaSayiKiyas yüklemsiz adsız dönem",
  { donem: { from: IST("2026-10-05T00:00:00"), to: IST("2026-11-03T23:59:59") }, kiyasDonemi: { from: IST("2026-09-05T00:00:00"), to: IST("2026-10-04T23:59:59") }, anaSayi: anaSayiKur({ olcu: "termin.zamaninda", ad: "Zamanında teslim", deger: 78, birim: "yuzde", onceki: 84, iyiYon: "yukari" }), anaSayiIfadesi: {} },
  "anaSayiKiyas",
  "Zamanında teslim: bu dönemde %78; önceki döneme göre 6 puan düşük.",
);
const musteri = (satirlar: [string, number][]) => ({ boyut: "müşteri", birim: "m" as const, satirlar: satirlar.map(([a, d]) => ({ ad: a, deger: d })) });
altin("enBuyukPay", { kirilim: musteri([["Kaya Tekstil", 9800], ["Demir Örme", 9000], ["Ak Boya", 8000], ["Yıldız", 7000], ["Ege", 5000], ["Bora", 3800]]) }, "enBuyukPay", "En büyük pay Kaya Tekstil'de: 9.800 m (toplamın %23'ü).");
altin("enBuyukPay yabancı ad → eksiz yedek", { kirilim: musteri([["Renault", 9800], ["Demir Örme", 9000], ["Ak Boya", 8000], ["Yıldız", 7000], ["Ege", 5000], ["Bora", 3800]]) }, "enBuyukPay", "En büyük pay — Renault: 9.800 m (toplamın %23'ü).");
altin("yogunlasma", { kirilim: musteri([["A", 30], ["B", 20], ["C", 14], ["D", 10], ["E", 10], ["F", 8], ["G", 8]]) }, "yogunlasma", "İşin %64'ü üç müşteriden geliyor.");
const renkler = { boyut: "renk", adTuru: "cins" as const, birim: "m" as const, satirlar: [{ ad: "lacivert", deger: 150, onceki: 100 }, { ad: "siyah", deger: 130, onceki: 100 }, { ad: "beyaz", deger: 120, onceki: 100 }] };
altin("degisimKaynagi", { kirilim: renkler }, "degisimKaynagi", "Artışın yarısı lacivert renkten geliyor.");
const ay = (ys: (number | null)[], olcuAdi = "Zamanında teslim") => ({ olcuAdi, birim: "yuzde" as const, zamanBirimi: "ay" as const, noktalar: ys.map((y, i) => ({ etiket: `${i + 1}. ay`, deger: y })) });
altin("egilim", { seri: ay([86, 88, 87, 89, 85, 83, 80]) }, "egilim", "Zamanında teslim üç aydır düşüyor.");
altin("egilim ardışık < 2 → eğilim kalıbı", { seri: ay([90, 88, 86, 82, 80, 81]) }, "egilim", "Zamanında teslim son 6 ayda düşüş eğiliminde.");
const fire = { olcuAdi: "Fire", olcuAdiCumleIci: "fire", birim: "m" as const, zamanBirimi: "gün" as const, noktalar: [110, 120, 130, 115, 125, 118, 640, 120, 122].map((d, i) => ({ etiket: `${8 + i} Ekim`, deger: d })) };
altin("aykiri", { seri: fire }, "aykiri", "14 Ekim'de fire olağandışı yüksek: 640 m (normalde 120 m).");
altin("esikAsimi", { esikler: [{ yer: "Depo", esik: 90, esikBirimi: "gün", sifat: "eski", deger: 6800, birim: "m", nesne: "mal" }] }, "esikAsimi", "Depoda 90 günden eski 6.800 m mal var.");
const BUGUN = IST("2026-10-24T15:00:00");
const demir = { ad: "Demir Örme", siparisTarihleri: ["2026-07-11", "2026-07-31", "2026-08-20", "2026-09-09"].map((d) => IST(`${d}T10:00:00`)) };
const duzenli = { ad: "Kaya Tekstil", siparisTarihleri: ["2026-09-20", "2026-10-01", "2026-10-12", "2026-10-22"].map((d) => IST(`${d}T10:00:00`)) };
altin("sessizlesen", { musteriRitmi: { musteriler: [duzenli, demir], bugun: BUGUN } }, "sessizlesen", "Demir Örme 45 gündür sipariş vermiyor; normalde 20 günde bir veriyordu.");
altin("kapsamNotu", { kapsam: [{ sayi: 12, nesne: "sipariş", neden: "Termini olmayan", sonuc: "orana katılmadı" }] }, "kapsamNotu", "Termini olmayan 12 sipariş orana katılmadı.");
altin("suzgecKesti", { veri: { satirSayisi: 0, suzgec: { customerId: ["x"], dusenSatir: 340 } } }, "suzgecKesti", "Seçtiğiniz süzgeçle kayıt kalmadı (süzgeçsiz 340 kayıt var).");
altin("veriYok", { veri: { satirSayisi: 0 } }, "veriYok", "Bu dönemde kayıt yok.");
altin("veriYok (süzgeç hiçbir şey kesmedi)", { veri: { satirSayisi: 0, suzgec: { customerId: ["x"], dusenSatir: 0 } } }, "veriYok", "Bu dönemde kayıt yok.");
const olcusuzGirdi: NarrativeInput = {
  donem: EKIM,
  kiyasDonemi: EYLUL,
  anaSayi: anaSayiKur({ olcu: "termin.zamaninda", ad: "Zamanında teslim", deger: null, birim: "yuzde", olculemedi: "dönemde termini olan sipariş yok.", onceki: 84, iyiYon: "yukari" }),
  anaSayiIfadesi: { ozne: "Siparişlerin", yuklem: "terminde gitti" },
};
altin("olculemedi", olcusuzGirdi, "olculemedi", "Zamanında teslim ölçülemedi: dönemde termini olan sipariş yok.");
const olcusuzCikti = anlatiUret(olcusuzGirdi);
check("§5 ölçülemeyen ana sayı 0/%0 cümlesi ÜRETMEZ", olcusuzCikti.every((c) => !/(^|\s)%?0(\s|'|;|\.|$)/.test(c.metin)) && !olcusuzCikti.some((c) => c.kural === "anaSayiKiyas"), JSON.stringify(olcusuzCikti.map((c) => c.metin)));

// eşik altı: koşul sağlanmazsa gözlem yok
check("§5 yogunlasma eşik altı (ilk üç %59) → yok", anlatiUret({ kirilim: musteri([["A", 25], ["B", 20], ["C", 14], ["D", 14], ["E", 14], ["F", 13]]) }, { kurallar: ["yogunlasma"] }).length === 0);
check("§5 degisimKaynagi katkı < %40 → yok", anlatiUret({ kirilim: { ...renkler, satirlar: [{ ad: "a", deger: 135, onceki: 100 }, { ad: "b", deger: 135, onceki: 100 }, { ad: "c", deger: 130, onceki: 100 }] } }, { kurallar: ["degisimKaynagi"] }).length === 0);
check("§5 egilim 5 nokta → yok", anlatiUret({ seri: ay([90, 88, 86, 84, 82]) }, { kurallar: ["egilim"] }).length === 0);
check("§5 egilim gürültü (R² < 0,5) → yok", anlatiUret({ seri: ay([80, 90, 78, 92, 79, 91, 81]) }, { kurallar: ["egilim"] }).length === 0);
check("§5 aykiri 7 nokta → yok", anlatiUret({ seri: { ...fire, noktalar: fire.noktalar.slice(0, 7) } }, { kurallar: ["aykiri"] }).length === 0);
check("§5 sessizlesen ritminde müşteri → yok", anlatiUret({ musteriRitmi: { musteriler: [duzenli], bugun: BUGUN } }, { kurallar: ["sessizlesen"] }).length === 0);
check("§5 analiz girdisi yokken korelasyon/örneklem gözlemi yok", !gozlemleriTopla({}).length);

// R3-ISTAT: analiz cümleleri — kanıt dili + HER cümlenin sonunda "İlişki, nedeni göstermez."
const oranKanit = { yontem: "kiKare" as const, tur: "oran" as const, n: 1240, nesne: "kayıt", olcuAdi: "bulunan hata", yer: "Gece vardiyasında", birimSozu: "1.000 m'de", oran: 4.1, digerOran: 2, kat: 2.05 };
altin("korelasyon oran güçlü", { analiz: { korelasyon: { ...oranKanit, p: 0.0004 }, orneklem: null } }, "korelasyon",
  "Gece vardiyasında bulunan hata 1.000 m'de 4,1; diğerlerinde 2 — yaklaşık 2,1 katı. Bu fark tesadüf olmayacak kadar büyük (güçlü kanıt; 1.240 kayıt üzerinden ölçüldü). İlişki, nedeni göstermez.");
altin("korelasyon oran kanıt var", { analiz: { korelasyon: { ...oranKanit, p: 0.03 }, orneklem: null } }, "korelasyon",
  "Gece vardiyasında bulunan hata 1.000 m'de 4,1; diğerlerinde 2 — yaklaşık 2,1 katı. Bu fark tesadüf olmayacak kadar büyük (kanıt var; 1.240 kayıt üzerinden ölçüldü). İlişki, nedeni göstermez.");
altin("korelasyon oran belirgin değil", { analiz: { korelasyon: { ...oranKanit, oran: 2.3, digerOran: 2.2, kat: 1.05, p: 0.4 }, orneklem: null } }, "korelasyon",
  "Gece vardiyasında bulunan hata 1.000 m'de 2,3; diğerlerinde 2,2. Belirgin bir fark görünmüyor (1.240 kayıt üzerinden ölçüldü). İlişki, nedeni göstermez.");
altin("korelasyon tablo", { analiz: { korelasyon: { yontem: "kiKare", tur: "tablo", n: 412, p: 0.002, nesne: "kayıt", yer: "Gece vardiyasında", ikinciAd: "çözgü", pay: 41, genelPay: 28 }, orneklem: null } }, "korelasyon",
  "Gece vardiyasında çözgü payı %41; genelde %28. Bu fark tesadüf olmayacak kadar büyük (güçlü kanıt; 412 kayıt üzerinden ölçüldü). İlişki, nedeni göstermez.");
altin("korelasyon iki ölçü", { analiz: { korelasyon: { yontem: "spearman", n: 45, p: 0.02, r: -0.42, nesne: "gün", xAdi: "Duruş süresi", yAdi: "biten kumaş" }, orneklem: null } }, "korelasyon",
  "Duruş süresi arttıkça biten kumaş azalıyor (orta düzeyde ilişki). Bu ilişki tesadüf olmayacak kadar belirgin (kanıt var; 45 gün üzerinden ölçüldü). İlişki, nedeni göstermez.");
altin("korelasyon ilişki yok", { analiz: { korelasyon: { yontem: "pearson", n: 60, p: 0.7, r: 0.05, nesne: "gün", xAdi: "Duruş süresi", yAdi: "biten kumaş" }, orneklem: null } }, "korelasyon",
  "Duruş süresi ile biten kumaş birlikte değişmiyor. Belirgin bir ilişki görünmüyor (60 gün üzerinden ölçüldü). İlişki, nedeni göstermez.");
altin("orneklemUyarisi az kayıt", { analiz: { korelasyon: { ...oranKanit, n: 9, p: 0.001 }, orneklem: { n: 9, enKucukBeklenen: 1.5, nesne: "kayıt", gereken: 30 } } }, "orneklemUyarisi",
  "Yalnız 9 kayıt var; karar vermek için en az 30 gerekir. İlişki, nedeni göstermez.");
altin("orneklemUyarisi küçük hücre", { analiz: { korelasyon: null, orneklem: { n: 80, enKucukBeklenen: 3.2, nesne: "kayıt", gereken: 30 } } }, "orneklemUyarisi",
  "Bazı gruplarda kayıt çok az; karar vermek için daha uzun bir dönem seçin. İlişki, nedeni göstermez.");
const kucuk = anlatiUret({ analiz: { korelasyon: { ...oranKanit, n: 9, p: 0.001 }, orneklem: { n: 9, enKucukBeklenen: 1.5, nesne: "kayıt", gereken: 30 } } });
check("§5 örneklem uyarısı varken kanıt cümlesi KURULMAZ (yalnız uyarı)", kucuk.length === 1 && kucuk[0]!.kural === "orneklemUyarisi", JSON.stringify(kucuk.map((c) => c.kural)));
const katalog = KURAL_ADLARI;
const eksik = katalog.filter((k) => !goruldu.has(k));
check("§5 R0 kural kataloğunun HER kuralı bir altın cümleyle ölçüldü", eksik.length === 0, eksik.join(", ") || `${katalog.length} kural`);

// --- §6 yasak sözcük ------------------------------------------------------------------------
console.log("\n§6 yasak sözcük");
const ornekler: Record<string, string> = {
  "Σ": "Σ atkı / Σ hedef",
  P90: "Teslim süresi P90 değeri",
  P50: "p50 süresi",
  medyan: "Medyanı 12 gün",
  OEE: "OEE düştü",
  ABC: "ABC sınıfı müşteri",
  RFM: "RFM puanı",
  "take-up": "Take-up oranı",
  kohort: "kohortlara göre",
  "mikro duruş": "Mikro duruşlar arttı",
  p: "fark anlamlı (p < 0,01)",
  korelasyon: "Korelasyon güçlü",
  katsayı: "ilişki katsayısı 0,8",
  "ki-kare": "ki-kare testine göre",
  istatistiksel: "istatistiksel olarak anlamlı",
  "Pearson/Spearman": "Spearman sırası",
  regresyon: "Regresyon çizgisi",
};
for (const y of YASAK_SOZCUKLER) check(`§6 '${y.sozcuk}' yakalanır`, yasakSozcukBul(ornekler[y.sozcuk] ?? "").includes(y.sozcuk), ornekler[y.sozcuk]);
check("§6 '∑' (toplam simgesi) yakalanır", yasakSozcukBul("∑ metre").includes("Σ"));
check("§6 'abece' / 'Kaya Tekstil' / 'oee'siz metin temiz", yasakSozcukBul("abece sırasıyla Kaya Tekstil; deneme") .length === 0);
check("§6 'p' yalnız tek başına yakalanır ('P50', 'pay', 'parti' temiz)", yasakSozcukBul("pay, parti, kapı, top").length === 0);
const kirli = altinlar.filter((m) => yasakSozcukBul(m).length > 0);
check("§6 altın cümlelerde formül dili yok", altinlar.length > 15 && kirli.length === 0, kirli.join(" | ") || `${altinlar.length} cümle`);

// --- §7 önem sırası --------------------------------------------------------------------------
console.log("\n§7 önem sırası");
const genis: NarrativeInput = {
  donem: EKIM,
  kiyasDonemi: EYLUL,
  anaSayi: siparis,
  anaSayiIfadesi: ifade,
  kirilim: musteri([["Kaya Tekstil", 30], ["Demir Örme", 20], ["Ak Boya", 14], ["Yıldız", 10], ["Ege", 10], ["Bora", 8], ["Ada", 8]]),
  seri: fire,
  esikler: [{ yer: "Depo", esik: 90, esikBirimi: "gün", sifat: "eski", deger: 6800, birim: "m", nesne: "mal", toplam: 20000 }],
  musteriRitmi: { musteriler: [duzenli, demir], bugun: BUGUN },
  kapsam: [
    { sayi: 12, nesne: "sipariş", neden: "Termini olmayan", sonuc: "orana katılmadı" },
    { sayi: 3, nesne: "sipariş", neden: "İptal edilen", sonuc: "hesaba katılmadı" },
  ],
};
const karisik: NarrativeInput = {
  ...genis,
  kirilim: { ...genis.kirilim!, satirlar: [...genis.kirilim!.satirlar].reverse() },
  kapsam: [...genis.kapsam!].reverse(),
  musteriRitmi: { musteriler: [demir, duzenli], bugun: BUGUN },
};
const a1 = anlatiUret(genis, { enFazla: 20 });
const a2 = anlatiUret(karisik, { enFazla: 20 });
esit("§7 girdi sırası karışınca çıktı birebir aynı", a2, a1);
check("§7 önem azalan", a1.every((c, i) => i === 0 || a1[i - 1].onem >= c.onem), a1.map((c) => `${c.kural}:${c.onem}`).join(" "));
const esitOnem = a1.filter((c) => c.kural === "kapsamNotu");
check("§7 eşit önemde metin sırası (belirlenimli eşitlik bozucu)", esitOnem.length === 2 && esitOnem[0].metin < esitOnem[1].metin, esitOnem.map((c) => c.metin).join(" | "));
check("§7 varsayılan tavan 5", anlatiUret(genis).length === 5);
check("§7 enFazla 3 (ekran)", anlatiUret(genis, { enFazla: 3 }).length === 3);
check("§7 kanıt JSON-güvenli (Date yok, gidiş-dönüş eşit)", JSON.stringify(JSON.parse(JSON.stringify(a1))) === JSON.stringify(a1) && !JSON.stringify(a1).includes("T00:00"));
esit("§7 kural süzgeci yalnız istenen kuralları verir", [...new Set(anlatiUret(genis, { kurallar: ["kapsamNotu"], enFazla: 20 }).map((c) => c.kural))], ["kapsamNotu"]);

// --- §8 zarf tip dosyası + harf dönüşümü -----------------------------------------------------
console.log("\n§8 zarf tip dosyası");
const kok = join(__dirname, "..", "src", "services", "reports");
const tipler = readFileSync(join(kok, "sunum", "sunum.types.ts"), "utf8");
const kodSatiri = (s: string): string => s.replace(/^\s*\/\/.*$/gm, "");
check("§8 sunum.types.ts import/require taşımaz (Electron aynası derlenebilsin)", !/^\s*import\b/m.test(kodSatiri(tipler)) && !/\brequire\(/.test(kodSatiri(tipler)));
check("§8 sunum.types.ts ayna beyanını taşır", tipler.includes("ayna: Electron/src/pages/Reports/_v2/sunum.ts"));
const dosyalar = ["anlati", "sunum"].flatMap((d) => readdirSync(join(kok, d)).filter((f) => f.endsWith(".ts")).map((f) => join(kok, d, f)));
check("§8 körlük zemini: anlati/ + sunum/ dosyaları bulundu", dosyalar.length >= 8, `${dosyalar.length} dosya`);
const harfDonusumu = dosyalar.filter((f) => /toLocale(Upper|Lower)Case|\.to(Upper|Lower)Case\(/.test(kodSatiri(readFileSync(f, "utf8"))));
check("§8 harf dönüşümü yalnız utils/tr-case üzerinden", harfDonusumu.length === 0, harfDonusumu.join(", "));


console.log("\n§9 para işareti (`paraIcerir`)");
{
  const tlKirilim = { ...musteri([["Kaya Tekstil", 9800], ["Demir Örme", 9000], ["Ak Boya", 8000], ["Yıldız", 7000], ["Ege", 5000], ["Bora", 3800]]), birim: "TRY" as const };
  const tl = anlatiUret({ kirilim: tlKirilim });
  check("§9a ⭐ TRY kırılımından doğan her cümle `paraIcerir: true`", tl.length > 0 && tl.every((c) => c.paraIcerir === true), tl.map((c) => `${c.kural}:${String(c.paraIcerir)}`).join(","));
  const tlRenk = anlatiUret({ kirilim: { ...renkler, birim: "USD" as const } }, { kurallar: ["degisimKaynagi"] });
  check("§9b ⭐ kanıtı birimsiz kural (degisimKaynagi) da KAYNAK birimden işaretlenir", tlRenk.length === 1 && tlRenk[0]!.paraIcerir === true, JSON.stringify(tlRenk[0]?.kanit));
  const metre = anlatiUret({ kirilim: { ...tlKirilim, birim: "m" as const }, seri: ay([90, 88, 86, 84, 82, 80, 78, 76]) });
  check("§9c para dışı cümlede `paraIcerir` anahtarı YOK (altın çıktı aynen)", metre.length > 0 && metre.every((c) => !("paraIcerir" in c)), metre.map((c) => c.kural).join(","));
}

console.log("\n§10 özel rapor anlatı bloğu (R2-ANLATI) — girdi rapordaki bloklardan, cümle motordan");
{
  const OLCU = { kimlik: "sevk.brutMetre", ad: "Sevk edilen", aciklama: "", birim: "metre", iyiYon: "artis" };
  const res = (o: Partial<SemanticResult>): SemanticResult => ({
    kosuId: null, kup: { kimlik: "sevk", ad: "Sevkiyat" }, olculer: [OLCU], boyutlar: [], aralik: { dateFrom: "2026-09-30T21:00:00.000Z", dateTo: "2026-10-31T20:59:59.999Z" },
    donemler: null, satirlar: [], toplam: { degerler: { "sevk.brutMetre": 12400 } }, kiyas: null, tavan: 50, uyarilar: [], notlar: [], kisiAdi: false, onbellek: { isabet: false }, ...o,
  });
  const row = (ad: string, deger: number, diger?: true) => ({ anahtarlar: { musteri: { deger: ad, etiket: ad, ...(diger ? { diger } : {}) } }, degerler: { "sevk.brutMetre": deger } });
  const kiyas = { aralik: { dateFrom: "2026-08-31T21:00:00.000Z", dateTo: "2026-09-30T20:59:59.999Z" }, toplam: { degerler: { "sevk.brutMetre": 10000 } } };
  const ana = { id: "k1", tur: "anaSayi", durum: "tamam", sonuclar: [res({ kiyas })] };
  const tablo = { id: "t1", tur: "tablo", durum: "tamam", sonuclar: [res({ boyutlar: [{ kimlik: "musteri", ad: "Müşteri" }], satirlar: [row("Kaya Tekstil", 8000), row("Ege", 2400), row("Bora", 2000)] })] };
  type NarrativeArg = Parameters<typeof narrativeOf>[0];
  const blk = (kurallar: NarrativeArg["kurallar"], enFazla = 3): NarrativeArg => ({ id: "n1", tur: "anlati", kurallar, enFazla });
  const none = new Map();
  const both = narrativeOf(blk(["anaSayiKiyas", "enBuyukPay"]), [ana, tablo], none);
  console.log("   " + both.map((c) => c.metin).join(" | "));
  check("§10a ana sayı + kırılım → iki cümle (yüklemsiz kalıp + en büyük pay)", both.length === 2 && both.some((c) => c.kural === "anaSayiKiyas" && c.metin.startsWith("Sevk edilen:")) && both.some((c) => c.kural === "enBuyukPay" && c.metin.includes("Kaya Tekstil")), both.map((c) => c.metin).join(" | "));
  const only = narrativeOf(blk(["enBuyukPay"]), [ana, tablo], none);
  check("§10b kural seçimi uyulur (yalnız en büyük pay)", only.length === 1 && only[0]!.kural === "enBuyukPay");
  check("§10c tavan uyulur (enFazla 1)", narrativeOf(blk(["anaSayiKiyas", "enBuyukPay"], 1), [ana, tablo], none).length === 1);
  const denied = narrativeOf(blk(["anaSayiKiyas"]), [{ ...ana, durum: "yetkisiz", sonuclar: undefined }], none);
  check("§10d yetkisiz blok girdi vermez → cümle yok", denied.length === 0, JSON.stringify(denied));
  const other = { ...tablo, sonuclar: [res({ boyutlar: [{ kimlik: "musteri", ad: "Müşteri" }], satirlar: [row("Kaya Tekstil", 8000), row("Ege", 2400), row("Diğer", 9000, true)] })] };
  check("§10e \"Diğer\" kovalı kırılımdan pay cümlesi kurulmaz (yanlış pay)", narrativeOf(blk(["enBuyukPay"]), [other], none).length === 0);
  const dirty = both.filter((c) => yasakSozcukBul(c.metin).length > 0);
  check("§10f blok cümlelerinde yasak sözcük yok", dirty.length === 0, dirty.map((c) => c.metin).join(" | "));
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
