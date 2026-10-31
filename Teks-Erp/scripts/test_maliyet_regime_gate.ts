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
// 2026-10-30 (D4-G1a): item-lifecycle.helper'a cost-rate-validity importu eklenince muafa rağmen
//   §2 ❌ (item.routes zincirinde machineCostRate) — model-kapsamlı muaf başka modeli örtmez.
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

/**
 * MODEL-KAPSAMLI MUAF — router YALNIZ adı geçen modele dokunduğu için muaf; aynı router'ın
 * zincirinde BAŞKA bir maliyet modeli bulunursa muaf düşer (§2 o modeli muafsız taramayla ölçer).
 * İki yönlü: dokunuş kalkarsa ya da router kapı taşırsa §2b "gereksiz muaf" der.
 */
const MODEL_MUAF: ReadonlyArray<{ dosya: string; model: string; neden: string }> = [
  {
    dosya: "routes/item.routes.ts",
    model: "serviceConsumableNorm",
    neden: "Kart yaşam döngüsü (item-lifecycle) aktif sarf normunu canlı referans olarak yalnız SAYAR — pasife almayı reddetmek için; maliyet kapalıyken norm doğamaz, sayım 0'dır (D4-G1a).",
  },
  {
    dosya: "routes/production-proposal.routes.ts",
    model: "finishingRate",
    neden: "Üretim önerisi (SY-M1) terbiye tarifesinden yalnız çekme %'sini OKUR (ham ihtiyaç önerisi); tarife yoksa çekme boş, plan = açık metre — maliyet kapalıyken öneri yine çalışır.",
  },
  {
    dosya: "routes/production-proposal.routes.ts",
    model: "costStructure",
    neden: "Üretim önerisi (SY-M1) ürün yapısından yalnız tarife KODUNU okur (varyantta yoksa; effectiveFinishingRateCode); fiyat okumaz.",
  },
];

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

  // Muaf model(ler) çıkarılmış ikinci tarama: muaf router'ın zincirinde KALAN maliyet dokunuşunu ölçer.
  const muafModeller = new Set(MODEL_MUAF.map((m) => m.model));
  const muafsizTarama = rejimTaramasiKur({ src: SRC, modeller: new Set([...MALIYET_MODELLERI].filter((m) => !muafModeller.has(m))), kapiAdlari: [KAPI] });
  const muafDosyalar = new Set(MODEL_MUAF.map((m) => path.join(SRC, m.dosya)));
  const kapisiz = ilgili.filter((x) => !tarama.kapiliMi(x.f) && !(muafDosyalar.has(x.f) && muafsizTarama.modelDokunusu(x.f) === null));
  check(
    "§2 ⭐ Maliyet modellerine dokunan HER router rejim kapısı taşıyor",
    kapisiz.length === 0,
    kapisiz.length === 0 ? `${ilgili.length} router kapılı` : `KAPISIZ: ${kapisiz.map((x) => path.relative(SRC, x.f)).join(", ")}`,
  );

  const gereksizMuaf = MODEL_MUAF.filter((m) => {
    const f = path.join(SRC, m.dosya);
    return !fs.existsSync(f) || tarama.kapiliMi(f) || tarama.modelDokunusu(f) === null || m.neden.trim().length < 20;
  });
  check("§2b Model-kapsamlı muaf listesi bayat değil (dosya var, kapısız, dokunuş sürüyor, gerekçeli)", gereksizMuaf.length === 0, gereksizMuaf.map((m) => m.dosya).join(", "));
  for (const m of MODEL_MUAF) console.log(`   ℹ️  muaf: ${m.dosya} [${m.model}] — ${m.neden}`);

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
