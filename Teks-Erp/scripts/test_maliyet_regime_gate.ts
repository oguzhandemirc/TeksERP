// =============================================================================
// MALİYET REJİM KAPISI BEKÇİSİ — `maliyet` modülü kapalıyken maliyet girdisi
// tablolarına dokunan HER router `requireMaliyetEnabled` taşıyor mu?
// =============================================================================
// MAL-1 dört tablo doğurdu (parametre seti, iplik maliyet fiyatı, apre tarifesi,
// ürün maliyet yapısı); hepsi `/api/cost` altında ve tek kapıdan geçer. Bir
// sonraki dilim bu tablolara başka bir router'dan (ör. rapor) dokunursa kapı
// unutulamaz: model kümesinden TÜRETİLİR. Sonraki MAL dilimleri modellerini bu
// sete ekler. WeftSpec bu sette YOK — dokuma ürün yapısıdır, `requireDokumaEnabled`
// (test_dokuma_regime_gate §6e).
//
// Tarayıcı ORTAK: `scripts/lib/regime-gate-scan.ts`. Salt-okunur.
// Koşum: npx tsx scripts/test_maliyet_regime_gate.ts
//
// NEGATİF SONDA — 2026-10-25 koşuldu (cp + shasum ile birebir geri alındı):
//   cost.routes.ts'ten `requireMaliyetEnabled` kapısı sökülünce → §2 + §4 ❌
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { rejimTaramasiKur } from "./lib/regime-gate-scan";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const SRC = path.resolve(__dirname, "../src");
const KAPI = "requireMaliyetEnabled";

/** Maliyet modülüne ÖZEL Prisma model erişimcileri (sonraki MAL dilimleri buraya ekler). */
const MALIYET_MODELLERI = new Set([
  "costParameterSet",
  "yarnCostPrice",
  "finishingRate",
  "costStructure",
  // MAL-2: standart maliyet sürümü (donmuş fotoğraf) + kalemleri
  "standardCostVersion",
  "standardCostLine",
  // MAL-4: satış teklifi + fiyat listesi
  "salesQuote",
  "salesQuoteLine",
  "priceList",
  "priceListLine",
  // D4-G1a: makine saat ücreti + hizmet sarf normu (kârlılık girdisi)
  "machineCostRate",
  "serviceConsumableNorm",
]);

const ADLA_BEKLENEN_KAPILI: ReadonlyArray<{ dosya: string; neden: string }> = [
  {
    dosya: "routes/cost.routes.ts",
    neden: "Maliyet yüzeyi: girdiler (MAL-1) + önizleme, kumaş maliyet listesi, standart maliyet sürümleri (MAL-2).",
  },
  { dosya: "routes/quote.routes.ts", neden: "Satış teklifi (MAL-4): maliyet tabanlı fiyat önerisi — modül kapalıyken uç kapalı." },
  { dosya: "routes/price-list.routes.ts", neden: "Fiyat listesi (MAL-4): standart maliyetten doldurma + teklif önerisi kaynağı." },
];

function main(): void {
  console.log("=== MALİYET REJİM KAPISI BEKÇİSİ (maliyet) ===\n");
  const tarama = rejimTaramasiKur({ src: SRC, modeller: MALIYET_MODELLERI, kapiAdlari: [KAPI] });
  const ilgili = tarama.ilgiliRouterlar();

  check("§1a Körlük zemini: router dosyaları tarandı", tarama.routerlar.length >= 40, `router=${tarama.routerlar.length}`);
  check(
    "§1b Körlük zemini: maliyet router'ları TÜRETİLEBİLDİ",
    ilgili.length >= 1,
    `bulunan=${ilgili.length} → ${ilgili.map((x) => path.basename(x.f)).join(", ")}`,
  );

  const kapisiz = ilgili.filter((x) => !tarama.kapiliMi(x.f));
  check(
    "§2 ⭐ Maliyet modellerine dokunan HER router rejim kapısı taşıyor",
    kapisiz.length === 0,
    kapisiz.length === 0 ? `${ilgili.length} router kapılı` : `KAPISIZ: ${kapisiz.map((x) => path.relative(SRC, x.f)).join(", ")}`,
  );

  for (const b of ADLA_BEKLENEN_KAPILI) {
    const f = path.join(SRC, b.dosya);
    check(`§3 ${b.dosya} dosyası VAR`, fs.existsSync(f));
    check(`§4 ⭐ ${b.dosya} rejim kapısı TAŞIYOR`, fs.existsSync(f) && tarama.kapiliMi(f));
    console.log(`   ℹ️  adla beklenen: ${b.dosya} — ${b.neden}`);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail ? 1 : 0;
}

main();
