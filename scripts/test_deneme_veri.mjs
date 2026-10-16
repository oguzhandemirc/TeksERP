#!/usr/bin/env node
// =============================================================================
// BEKÇİ — deneme-veri (anonimleştirme çekirdeği + doldurma belirlenimi) · zero-dep, DB'siz, ağsız
// =============================================================================
// Kaynak: scripts/deneme-veri/lib/{anonim,kolonlar,token}.mjs (anonimlestir.mjs ve doldur.mjs bunları kullanır).
//   §1 sözlük: belirlenimli (girdi sırası fark etmez) · kendi çıktısında BOŞ (ikinci koşum 0) · biçim korunur
//      (BÜYÜK/küçük/Baş) · genel kelime korunur · tümü-genel unvan ifade sözlüğüne girer
//   §2 havuz: havuz ∩ genel kelime = ∅ · havuzlar kendi içinde tekil · karışık gerçek ad çakışma verir
//   §3 serbest metin: sistem kodu korunur · ad taşıyan metin değişir · sistem öneki korunur, kuyruk değişir
//   §4 telefon deseni: UUID parçası / önekli belge-barkod kodu telefon DEĞİL; gerçek biçimler telefon;
//      telefonlu sistem metni korunmaz
//   §5 sahte değerler: IBAN mod-97 geçerli · vergi no 10 hane · telefon desene takılmaz (tarama kendi çıktısını saymaz)
//   §6 kolon rolü: GENERATED/kod/numara/sır dokunulmaz; taxNumber KISISEL; notes SERBEST; katalog tablosunda METIN
//   §7 bulut kataloğu gerçek kaynaktan okunur (customers.name, subcontractors.name projeksiyonda)
//   §8 doldurma tokenı: UUIDv5 biçimi, belirlenimli, anahtara duyarlı
//   §9 kablolama: CI bu bekçiyi (+ --sonda) koşar; commit kancası scripts/deneme-veri/ değişince koşar
//
// ÜÇ SONUÇ: 0 yeşil · 1 kırmızı · 2 ÖLÇÜLEMEDİ.
//   node scripts/test_deneme_veri.mjs          # dinlenme durumu
//   node scripts/test_deneme_veri.mjs --sonda  # kalıcı negatif sondalar (bozulmuş kopyalar kırmızı vermeli)
// =============================================================================
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KOK = join(dirname(fileURLToPath(import.meta.url)), "..");
const CI_REL = ".github/workflows/ci.yml";
const KANCA_REL = "scripts/hooks/pre-commit.mjs";
const BEN_REL = "scripts/test_deneme_veri.mjs";

let A, K, T;
try {
  A = await import("./deneme-veri/lib/anonim.mjs");
  K = await import("./deneme-veri/lib/kolonlar.mjs");
  T = await import("./deneme-veri/lib/token.mjs");
} catch (e) {
  console.log(`⛔ ÖLÇÜLEMEDİ — kitaplık yüklenemedi: ${e.message}`);
  process.exit(2);
}

/** Saf ölçüm: L = kitaplık yüzeyi (sondalar bozulmuş kopya verir), d = okunan dosyalar. */
function olc(L, d) {
  const kirmizi = [];
  const ok = (etiket, kosul) => { if (!kosul) kirmizi.push(etiket); };
  const firma = ["ACMEX TEKSTİL SAN. TİC. LTD. ŞTİ.", "Zorvan Perde", "LALELİ TEKSTİL", "QUENTRA HOME"];
  const kisi = ["Hüsnü Karabağlı", "Nurtaç Gebeşoğlu"];

  // §1
  const s1 = L.sozlukKur({ kisiAdlari: kisi, firmaAdlari: firma });
  const s1b = L.sozlukKur({ kisiAdlari: [...kisi].reverse(), firmaAdlari: [...firma].reverse() });
  ok("§1 sözlük girdi sırasından bağımsız", JSON.stringify([...s1.kelime]) === JSON.stringify([...s1b.kelime]) && JSON.stringify([...s1.ifade]) === JSON.stringify([...s1b.ifade]));
  const yeniFirma = firma.map((f) => L.metniDegistir(f, s1));
  const yeniKisi = kisi.map((k) => L.metniDegistir(k, s1));
  ok("§1 her firma adı değişir", yeniFirma.every((y, i) => y !== firma[i]));
  ok("§1 her kişi adı değişir", yeniKisi.every((y, i) => y !== kisi[i]));
  ok("§1 eski ayırt edici parça çıktıda yok", ![...yeniFirma, ...yeniKisi].some((y) => /ACMEX|Zorvan|QUENTRA|Hüsnü|Karabağlı|Nurtaç|Gebeşoğlu/i.test(y)));
  ok("§1 genel kelime + hukuki ek korunur", yeniFirma[0].endsWith(" TEKSTİL SAN. TİC. LTD. ŞTİ.") && / Perde$/.test(yeniFirma[1]) && / HOME$/.test(yeniFirma[3]));
  ok("§1 tümü-genel unvan ifade sözlüğünde", s1.ifade.has("LALELİ TEKSTİL") && yeniFirma[2] !== "LALELİ TEKSTİL");
  ok("§1 biçim korunur (BÜYÜK · Baş)", yeniFirma[0].split(" ")[0] === L.buyukTr(yeniFirma[0].split(" ")[0]) && /^\p{Lu}\p{Ll}+ Perde$/u.test(yeniFirma[1]));
  ok("§1 küçük harf biçimi", L.bicimle("acmex", "Lavanta") === "lavanta" && L.bicimle("ACMEX", "İncir") === "İNCİR" && L.bicimle("Acmex", "ırmak") === "Irmak");
  const s2 = L.sozlukKur({ kisiAdlari: yeniKisi, firmaAdlari: yeniFirma });
  ok("§1 ikinci koşum boş sözlük (idempotent)", s2.kelime.size === 0 && s2.ifade.size === 0);
  ok("§1 aynı cari her metinde aynı takma ad", L.metniDegistir("Sevk: Zorvan Perde 12 top", s1).includes(yeniFirma[1]));
  ok("§1 JSON yalnız değerleri değiştirir", JSON.stringify(L.jsonDegistir({ Zorvan: ["Zorvan Perde", 3] }, (x) => L.metniDegistir(x, s1))) === JSON.stringify({ Zorvan: [yeniFirma[1], 3] }));

  // §2
  const havuz = [...L.HAVUZ_MARKA, ...L.HAVUZ_AD, ...L.HAVUZ_SOYAD];
  ok("§2 havuz ∩ genel kelime = ∅", havuz.every((h) => !L.GENEL_KELIMELER.has(L.katla(h))));
  for (const [ad, h] of [["MARKA", L.HAVUZ_MARKA], ["AD", L.HAVUZ_AD]]) ok(`§2 ${ad} havuzu tekil`, new Set(h.map(L.katla)).size === h.length);
  ok("§2 karışık gerçek ad çakışma verir", L.havuzCakismalari(["Lavanta Zorvan Tekstil"]).length === 1);
  ok("§2 tamamı havuz ad çakışma değildir", L.havuzCakismalari(["Lavanta Tekstil", "Mert Kaya"]).length === 0);

  // §3
  ok("§3 sistem kodu korunur", L.serbestMetinKarari("RETURNED_VIA_RECEIPT:FK0510260012") === null && L.serbestMetinKarari("DISPATCH:FS0810260020") === null);
  ok("§3 iş dili korunur", L.serbestMetinKarari("Müşteri talebine göre paketlendi") === null);
  ok("§3 ad taşıyan not değişir", L.serbestMetinKarari("Zorvan beyden teyit alınacak") === "");
  ok("§3 sistem öneki korunur, kuyruk değişir", L.serbestMetinKarari("WO_CANCEL_CANCELLED: Zorvan istemedi") === "WO_CANCEL_CANCELLED: ");

  // §4
  const tel = (s) => L.telefonlar(s).length;
  ok("§4 UUID parçası telefon değil", tel("1a2b3c4d-5321-4567-a890-532145678912") === 0 && tel("9f0e0532-1234-4abc-8def-001122334455") === 0);
  ok("§4 önekli belge/barkod kodu telefon değil", tel("RETURNED_VIA_RECEIPT:FK5321234567") === 0 && tel("T5321234567") === 0 && tel("5321234567-01") === 0);
  ok("§4 gerçek biçimler telefon", tel("0532 123 45 67") === 1 && tel("+90 532 123 4567") === 1 && tel("5321234567") === 1 && tel("ara: 05321234567.") === 1);
  ok("§4 telefonlu sistem metni korunmaz (önek kalır)", L.serbestMetinKarari("WO_CLOSE_SCRAP: 5321234567 (X:FK5321234567)") === "WO_CLOSE_SCRAP: ");
  ok("§4 harfsiz telefon serbest metinde değişir", L.serbestMetinKarari("5321234567") === "");

  // §5
  const ibanlar = ["a", "b", "customers:1", "subcontractors:9"].map(L.sahteIban);
  ok("§5 sahte IBAN mod-97 geçerli + 26 hane", ibanlar.every((i) => L.ibanGecerliMi(i) && i.length === 26));
  ok("§5 IBAN doğrulayıcı bozuğu reddeder", !L.ibanGecerliMi(ibanlar[0].slice(0, 25) + ((Number(ibanlar[0][25]) + 1) % 10)));
  ok("§5 sahte vergi no 10 hane", ["x", "y"].map(L.sahteVergiNo).every((v) => /^\d{10}$/.test(v)));
  ok("§5 sahte telefon desene takılmaz", ["x", "y", "z"].map(L.sahteTelefon).every((t) => tel(t) === 0));
  ok("§5 sahte değer belirlenimli", L.sahteAdres("q") === L.sahteAdres("q") && L.sahteIban("q") === L.sahteIban("q"));

  // §6
  const rol = (t, c, tip = "text", gen = "NEVER") => L.kolonRolu(t, { c, tip, gen });
  ok("§6 GENERATED dokunulmaz", rol("customers", "nameFold", "text", "ALWAYS") === null);
  ok("§6 kod/numara/sır dokunulmaz", ["code", "barcode", "documentNo", "invoiceNumber", "passwordHash", "clientToken", "totpSecret", "orderId"].every((c) => rol("shipments", c) === null));
  ok("§6 taxNumber KISISEL", rol("customers", "taxNumber") === "KISISEL" && L.kisiselKolonTuru("taxNumber") === "VERGI_NO");
  ok("§6 notes SERBEST, katalogda METIN", rol("rolls", "notes") === "SERBEST" && rol("reason_presets", "description") === "METIN");
  ok("§6 users/devices özel rol", rol("users", "fullName") === "AD" && rol("users", "username") === "KULLANICI_ADI" && rol("devices", "name") === "CIHAZ_ADI");
  ok("§6 sayısal kolon dokunulmaz", rol("shipments", "totalMeters", "numeric") === null);

  // §7
  try {
    const p = L.projeksiyonKolonlari(KOK);
    ok("§7 bulut kataloğu: customers.name + subcontractors.name", p.get("customers")?.has("name") && p.get("subcontractors")?.has("name"));
  } catch (e) { ok(`§7 bulut kataloğu okunamadı: ${e.message}`, false); }

  // §8
  const t1 = L.belirlenimliToken("cari:ACME"), t2 = L.belirlenimliToken("cari:ACME"), t3 = L.belirlenimliToken("cari:ACMF");
  ok("§8 token UUIDv5 biçimi", /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(t1));
  ok("§8 token belirlenimli + anahtara duyarlı", t1 === t2 && t1 !== t3);

  // §9
  ok("§9 CI bu bekçiyi (+ --sonda) koşar", d[CI_REL].includes(`node ${BEN_REL} && node ${BEN_REL} --sonda`));
  ok("§9 commit kancası scripts/deneme-veri/ değişince koşar", d[KANCA_REL].includes(`"scripts/deneme-veri/"`) && d[KANCA_REL].includes(`"${BEN_REL}"`));
  return kirmizi;
}

function dosyalar() {
  const d = {};
  for (const f of [CI_REL, KANCA_REL]) d[f] = readFileSync(join(KOK, f), "utf8");
  return d;
}
const L0 = { ...A, ...K, ...T };

/** Negatif sondalar: her biri gerçekçi bir gerilemeyi taklit eder; HER BİRİ kırmızı vermeli. */
function sondalar(d) {
  const liste = [
    ["N1 telefon deseni gevşer (UUID/kod parçası telefon sayılır)", { telefonlar: (s) => String(s).match(/(?<!\d)0?5\d{2}[ -]?\d{3}[ -]?\d{2}[ -]?\d{2}(?!\d)/g) ?? [] }],
    ["N2 DOKUNULMAZ'dan No$ çıkar (belge numarası değişir)", { kolonRolu: (t, k) => K.kolonRolu(t, k, new RegExp(K.DOKUNULMAZ.source.replace("|No$", ""))) }],
    ["N3 sözlük girdi sırasına bağımlı", { sozlukKur: (g) => { const s = A.sozlukKur(g); if (g.kisiAdlari[0]?.startsWith("N")) s.kelime = new Map([...s.kelime].reverse().map(([k], i, a) => [k, a[(i + 1) % a.length][1]])); return s; } }],
    ["N4 havuza genel kelime girer", { HAVUZ_MARKA: [...A.HAVUZ_MARKA, "Tekstil"] }],
    ["N5 sistem kodu koruması düşer", { serbestMetinKarari: (s, k) => (A.sistemMetniMi(s) ? "" : A.serbestMetinKarari(s, k)) }],
    ["N6 IBAN kontrol hanesi bozulur", { sahteIban: (t) => A.sahteIban(t).replace(/^TR(\d\d)/, (_, k) => `TR${String((Number(k) + 1) % 100).padStart(2, "0")}`) }],
    ["N7 sözlük kendi çıktısını yeniden eşler", { sozlukKur: (g) => { const s = A.sozlukKur(g); if (s.kelime.size === 0) s.kelime.set("LAVANTA", "Defne"); return s; } }],
    ["N8 token rastgele", { belirlenimliToken: () => crypto.randomUUID() }],
    ["N9 CI kablosu sökülür", null, { [CI_REL]: d[CI_REL].replace(`node ${BEN_REL} --sonda`, "true") }],
  ];
  let kotu = 0;
  for (const [ad, bozuk, dBozuk] of liste) {
    let k;
    try { k = olc({ ...L0, ...(bozuk ?? {}) }, { ...d, ...(dBozuk ?? {}) }); } catch (e) { k = [`istisna: ${e.message}`]; }
    if (k.length === 0) { console.log(`❌ ${ad} — kırmızı VERMEDİ`); kotu++; } else console.log(`✅ ${ad} — kırmızı (${k[0]})`);
  }
  console.log(kotu ? `\n❌ ${kotu} sonda beklenmeyen sonuç verdi` : `\n✅ ${liste.length} sonda beklendiği gibi`);
  return kotu === 0;
}

let d;
try { d = dosyalar(); } catch (e) { console.log(`⛔ ÖLÇÜLEMEDİ — ${e.message}`); process.exit(2); }
const taban = olc(L0, d);
if (process.argv.includes("--sonda")) {
  console.log("test_deneme_veri — kalıcı negatif sondalar\n");
  if (taban.length) { console.log(`⛔ ÖLÇÜLEMEDİ — sonda tabanı yeşil değil: ${taban.join(" · ")}`); process.exit(2); }
  process.exit(sondalar(d) ? 0 : 1);
}
if (taban.length) { for (const k of taban) console.log(`❌ ${k}`); console.log(`\n❌ test_deneme_veri: ${taban.length} kırmızı`); process.exit(1); }
console.log("✅ test_deneme_veri: tüm bölümler yeşil (§1–§9)");
