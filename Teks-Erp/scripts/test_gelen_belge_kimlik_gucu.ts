// Bekçi: kimlik yazısı GÜCÜ (2026-11-10) — yalnız genel alan etiketleriyle (Tarih, Cinsi, Mamul En, Açıklama…) eşik
// geçen şablon ADAY OLMAZ; en az bir güçlü yazı (başlık / firma adı) ya da regex tutmalı (`motor/kimlik-gucu.ts`,
// `classify.ts` `templateMatches`). Gerçek demo taramaları anonim: `src/lib/gelen-belge/motor/__tests__/fikstur/kimlik/`.
// DB/sunucu yok; motor saftır.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyWithFallback, extractDocument, isStrongIdentifier, templatesOverThreshold, type DocumentTemplate, type OcrResult } from "../src/lib/gelen-belge/motor";
import { loadTemplates } from "../src/lib/gelen-belge/motor/templates";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✓" : "✗"} ${label}${!ok && detay ? ` — ${detay}` : ""}`);
}

const FIKSTUR = join(__dirname, "../src/lib/gelen-belge/motor/__tests__/fikstur/kimlik");
const tarama = (ad: string): OcrResult => JSON.parse(readFileSync(join(FIKSTUR, `${ad}.json`), "utf8")) as OcrResult;
const sablon = (id: string, keywords: string[], regex?: string[]): DocumentTemplate =>
  ({ id, name: id, version: 1, identifiers: { keywords, minScore: 0.6, ...(regex ? { regex } : {}) }, fields: [] }) as unknown as DocumentTemplate;

// Demo kurulumunun aktif kullanıcı şablonlarının kimlikleri (sender_templates, 2026-11-10) — birebir.
const cekiCikis = sablon("u-cikis-ceki", ["Tarih", "Müşteri KG", "Müşteri MT", "Çıkış Çeki Listesi", "Sevk Tarihi", "Cinsi", "Mamül En", "Açıklama"]);
const cekiKumas = sablon("u-kumas-ceki", ["KUMAŞ ÇEKİ LİSTESl", "TARIH", "FIŞ NO", "FAT/IRSALIYE NO", "FIRMA", "AÇIKLAMA", "Sipariş No", "Model", "Sira No Top No", "Top", "Kilo", "Metre"]);
const aktif = [cekiCikis, cekiKumas];
const genel = loadTemplates().find((t) => t.id === "genel")!;

// §1 güç sınıflaması: genel etiket ve "X No" zayıf; başlık / firma adı güçlü
{
  const zayif = ["Tarih", "Müşteri KG", "Müşteri MT", "Sevk Tarihi", "Cinsi", "Mamül En", "Açıklama", "FIŞ NO", "FAT/IRSALIYE NO", "Sira No Top No", "Miktar 1", "Taşıma Tipi", "GİRİŞ TOPLAM MT", "Evrak No", "Irsaliye No", "Ham PartiNo", "Top", "Kilo"];
  const guclu = ["Çıkış Çeki Listesi", "KUMAŞ ÇEKİ LİSTESİ", "ÜRÜN SEVK FİŞİ", "KESİM TAKİP FORMU", "KUMAŞ İRSALİYESİ", "Örnek Tekstil", "Kömürhan"];
  const yanlisZayif = zayif.filter((k) => isStrongIdentifier(k));
  const yanlisGuclu = guclu.filter((k) => !isStrongIdentifier(k));
  check("§1 genel alan etiketleri zayıf", yanlisZayif.length === 0, yanlisZayif.join(", "));
  check("§1 başlık ve firma adı güçlü", yanlisGuclu.length === 0, yanlisGuclu.join(", "));
}

// §2 ⭐ genel-etiketli yabancı belge (ürün sevk fişi) çeki listesi şablonuna EŞLEŞMEZ — skor eşiği geçse de
{
  const ocr = tarama("urun-sevk-fisi-genel-etiketli");
  const r = classifyWithFallback(ocr, aktif, null);
  const ham = r.scores[cekiCikis.id] ?? 0;
  check("§2 körlük zemini: yalnız genel etiketlerle ham skor eşiği geçiyor (≥ 0,6)", ham >= 0.6, `skor ${ham}`);
  check("§2 ⭐ güçlü yazısı tutmayan şablon aday olmaz → tanınmadı", r.templateId === null, `seçilen ${r.templateId}`);
  check("§2 GENEL yedekle: belge tanınmadı (Tanıt yolu)", classifyWithFallback(ocr, [...aktif, genel], "genel").templateId === "genel");
  check("§2 benzer şablon uyarısı (K30-B) yabancı şablonu göstermez", templatesOverThreshold(ocr, aktif).length === 0);
  check("§2 okuma işi de GENEL'e düşer", extractDocument(ocr, [...aktif, genel], "genel").regions[0]?.templateId === "genel");
  const fis = sablon("u-urun-sevk-fisi", ["ÜRÜN SEVK FİŞİ", "SEVK NO", "GİRİŞ TOPLAM MT", "ÇIKIŞ ADET", "TOPLAM METRE"]);
  check("§2 kendi başlıklı şablonu varsa ona eşleşir", classifyWithFallback(ocr, [...aktif, fis], null).templateId === fis.id);
}

// §3 kendi belgeleri kendi şablonlarına eşleşmeye devam eder
{
  check("§3 çıkış çeki listesi → kendi şablonu", classifyWithFallback(tarama("cikis-ceki-listesi"), aktif, null).templateId === cekiCikis.id);
  check("§3 kumaş çeki listesi → kendi şablonu", classifyWithFallback(tarama("kumas-ceki-listesi"), aktif, null).templateId === cekiKumas.id);
}

// §4 kapı kenarları: regex güçlü sayılır; yalnız zayıf yazılı şablon hiçbir belgeye eşleşmez (fail-closed)
{
  const ocr = tarama("cikis-ceki-listesi");
  const zayifRegexli = sablon("u-zayif-regex", ["Tarih", "Müşteri KG", "Müşteri MT", "Cinsi"], ["\\bISM\\d{7}\\b"]);
  check("§4 regex tutarsa yalnız-zayıf yazılı şablon aday olur", classifyWithFallback(ocr, [zayifRegexli], null).templateId === zayifRegexli.id);
  const zayif = sablon("u-zayif", ["Tarih", "Müşteri KG", "Müşteri MT", "Cinsi"]);
  const r = classifyWithFallback(ocr, [zayif], null);
  check("§4 yalnız zayıf yazılı şablon skoru 1 olsa da aday olmaz", r.templateId === null && (r.scores[zayif.id] ?? 0) === 1, `seçilen ${r.templateId} skor ${r.scores[zayif.id]}`);
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
