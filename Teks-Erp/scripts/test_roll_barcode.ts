// Kısa top barkodu (T+GGAAYY+H/F+NNNN) üreteç testi. Üretim atomik sayaç
// (roll_barcode_counters) → gerçek DB, izole gelecek tarih + finally temizlik.
// `npx tsx scripts/test_roll_barcode.ts`.

import prisma from "../src/lib/prisma";
import {
  ROLL_BARCODE_RE,
  MAX_ROLL_SEQ,
  rollBarcodePrefix,
  generateRollBarcodeTx,
  reserveRollBarcodesTx,
  rollSeqCapacity,
} from "../src/services/helpers/roll-barcode.helper";
// ⚠️ `invalidateNumberSeriesCache` DEĞİL `refreshNumberSeriesCache`: ilki önbelleği
// boşaltıyor ve `resolveSeriesFormat` o hâlde DB satırını değil KATALOG TOHUMUNU
// döndürüyor (fail-safe). Ölçüm tohumu okuyup "ayar bağlı değil" derdi.
import { refreshNumberSeriesCache, resolveSeriesFormat } from "../src/services/number-series.service";
import { matchesSeries } from "../src/services/helpers/series-format.helper";
import { ROLL_DISPLAY_ORDER } from "../src/constants/roll-order";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

// İzole gelecek tarih (gerçek üretim gününe dokunmaz): 2099-12-31 → GGAAYY 311299.
const DATE = new Date(2099, 11, 31);
const DAY = "311299";

async function cleanup() {
  await prisma.rollBarcodeCounter.deleteMany({ where: { day: DAY } }).catch(() => {});
}

async function main() {
  await cleanup(); // önceki koşu kalıntısı

  // --- prefix (GGAAYY, Türkiye tarih sırası) ---
  check("prefix H", rollBarcodePrefix("H", DATE) === "T311299H", rollBarcodePrefix("H", DATE));
  check("prefix F", rollBarcodePrefix("F", DATE) === "T311299F", rollBarcodePrefix("F", DATE));

  // --- üretim: ilk çağrı 0001, sonra sıralı artar (atomik sayaç) ---
  const b1 = await generateRollBarcodeTx(prisma, "H", DATE);
  const b2 = await generateRollBarcodeTx(prisma, "H", DATE);
  const b3 = await generateRollBarcodeTx(prisma, "H", DATE);
  check("ilk → T311299H0001", b1 === "T311299H0001", b1);
  check("ikinci → 0002", b2 === "T311299H0002", b2);
  check("üçüncü → 0003", b3 === "T311299H0003", b3);
  check("üretilen barkod regex'e uyar", ROLL_BARCODE_RE.test(b1));

  // --- tip ayrımı: F kendi sayacından 0001'den başlar ---
  const f1 = await generateRollBarcodeTx(prisma, "F", DATE);
  check("F tipi bağımsız → T311299F0001", f1 === "T311299F0001", f1);

  // --- eşzamanlı (paralel) üretim → hepsi BENZERSİZ (çakışma yok) ---
  const many = await Promise.all(
    Array.from({ length: 20 }, () => generateRollBarcodeTx(prisma, "H", DATE)),
  );
  check("20 paralel üretim hepsi benzersiz", new Set(many).size === 20);

  // --- sayaç ardışık: n=9998 sonrası → 9999 ---
  await prisma.rollBarcodeCounter.update({ where: { day_type: { day: DAY, type: "H" } }, data: { n: 9998 } });
  const near = await generateRollBarcodeTx(prisma, "H", DATE);
  check("n=9998 sonrası → 9999", near === "T311299H9999", near);

  // --- kapasite: sayaç MAX'ta → hata ---
  await prisma.rollBarcodeCounter.update({ where: { day_type: { day: DAY, type: "H" } }, data: { n: MAX_ROLL_SEQ } });
  let capErr = false;
  try { await generateRollBarcodeTx(prisma, "H", DATE); } catch { capErr = true; }
  check("MAX aşımı → kapasite hatası", capErr);

  // --- eski/yeni format ayrımı: eski TEKS… yeni T311299H prefix'iyle EŞLEŞMEZ ---
  // ⚠️ BİLİNÇLİ ÇAPA: burada TOHUM biçimin regex'i kullanılıyor, çünkü iddia
  // "bugünkü seri ne derse desin, 2026 öncesi `TEKS…` kodları bu serinin kodu
  // DEĞİLDİR" — seriden türetilse fabrika biçimi değiştirdiğinde iddia kayardı.
  check("eski TEKS… yeni regex'e UYMAZ", !ROLL_BARCODE_RE.test("TEKS991231HA001"));

  // ── DOLGU AYARDAN: `digits` bir GÖRÜNÜM ayarıdır, kapasite DEĞİL (D2③) ──────
  // Kullanıcı isteği 2026-09-23: "…0005 yerine …5 yazabilir miyiz? baştaki
  // sıfırları silmek bir ÖZELLİK olsun." Kapasite bundan ETKİLENMEMELİ.
  await cleanup();
  const seri = await prisma.numberSeries.findUnique({ where: { key: "roll" }, select: { digits: true, maxValue: true } });
  if (!seri) {
    console.log("⏭ ÖLÇÜLEMEDİ: `roll` serisi bu DB'de yok (boot uzlaştırması koşmamış)");
  } else {
    try {
      await prisma.numberSeries.update({ where: { key: "roll" }, data: { digits: 1 } });
      await refreshNumberSeriesCache();
      const f = resolveSeriesFormat("roll");
      check("dolgusuz rejim kuruldu (digits=1)", f.digits === 1, String(f.digits));
      check("⭐ KAPASİTE DOLGUDAN BAĞIMSIZ: digits=1 iken de üst sınır 9999",
        rollSeqCapacity() === 9999, String(rollSeqCapacity()));

      // ⭐ SIRALAMA: dolgusuz kodlarda `…H10` METİN olarak `…H9`dan ÖNCE gelir;
      // liste sırası bu yüzden doğuş anına (`ROLL_DISPLAY_ORDER`) bağlandı.
      await prisma.rollBarcodeCounter.update({ where: { day_type: { day: DAY, type: "H" } }, data: { n: 8 } }).catch(async () => {
        await prisma.rollBarcodeCounter.create({ data: { day: DAY, type: "H", n: 8 } });
      });
      const dokuz = await generateRollBarcodeTx(prisma, "H", DATE);
      const on = await generateRollBarcodeTx(prisma, "H", DATE);
      check("dolgusuz kod dolgu YAZMIYOR (…H9 · …H10)", dokuz.endsWith("H9") && on.endsWith("H10"), `${dokuz} · ${on}`);
      check("dolgusuz kod seriye UYUYOR (okutulabilir)", matchesSeries(resolveSeriesFormat("roll"), on), on);
      // Metin sırası TERS, doğuş sırası DOĞRU — sabitin varlık sebebi bu farktır.
      check("⭐ körlük zemini: metin sırası GERÇEKTEN ters (…H10 < …H9)", on < dokuz, `${on} < ${dokuz}`);
      check("⭐ ROLL_DISPLAY_ORDER doğuş sırasını BİRİNCİL anahtar yapıyor",
        ROLL_DISPLAY_ORDER[0]?.createdAt === "asc" && ROLL_DISPLAY_ORDER[1]?.barcode === "asc",
        JSON.stringify(ROLL_DISPLAY_ORDER));
    } finally {
      await prisma.numberSeries.update({ where: { key: "roll" }, data: { digits: seri.digits, maxValue: seri.maxValue } });
      await refreshNumberSeriesCache();
    }
  }

  // ── SINIRSIZ SERİ: üst sınır boşsa kapasite kapısı YOKTUR ──────────────────
  const seri2 = await prisma.numberSeries.findUnique({ where: { key: "roll" }, select: { maxValue: true } });
  if (seri2) {
    try {
      await prisma.numberSeries.update({ where: { key: "roll" }, data: { maxValue: null } });
      await refreshNumberSeriesCache();
      check("üst sınır boşken kapasite SINIRSIZ", rollSeqCapacity() === null, String(rollSeqCapacity()));
      await prisma.rollBarcodeCounter.update({ where: { day_type: { day: DAY, type: "H" } }, data: { n: MAX_ROLL_SEQ } });
      const asan = await reserveRollBarcodesTx(prisma, "H", 1, DATE);
      check("⭐ 9999 ÜSTÜ üretilebiliyor (sınır kalkınca gün dolmuyor)", asan[0]?.endsWith("10000") === true, asan[0] ?? "(yok)");
    } finally {
      await prisma.numberSeries.update({ where: { key: "roll" }, data: { maxValue: seri2.maxValue } });
      await refreshNumberSeriesCache();
    }
  }
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(fail > 0 ? 1 : 0);
  });
