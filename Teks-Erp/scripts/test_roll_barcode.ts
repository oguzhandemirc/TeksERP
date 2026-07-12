// Kısa top barkodu (T+GGAAYY+H/F+NNNN) üreteç testi. Üretim atomik sayaç
// (roll_barcode_counters) → gerçek DB, izole gelecek tarih + finally temizlik.
// `npx tsx scripts/test_roll_barcode.ts`.

import prisma from "../src/lib/prisma";
import {
  ROLL_BARCODE_RE,
  MAX_ROLL_SEQ,
  rollBarcodePrefix,
  generateRollBarcode,
} from "../src/services/helpers/roll-barcode.helper";

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
  const b1 = await generateRollBarcode(prisma, "H", DATE);
  const b2 = await generateRollBarcode(prisma, "H", DATE);
  const b3 = await generateRollBarcode(prisma, "H", DATE);
  check("ilk → T311299H0001", b1 === "T311299H0001", b1);
  check("ikinci → 0002", b2 === "T311299H0002", b2);
  check("üçüncü → 0003", b3 === "T311299H0003", b3);
  check("üretilen barkod regex'e uyar", ROLL_BARCODE_RE.test(b1));

  // --- tip ayrımı: F kendi sayacından 0001'den başlar ---
  const f1 = await generateRollBarcode(prisma, "F", DATE);
  check("F tipi bağımsız → T311299F0001", f1 === "T311299F0001", f1);

  // --- eşzamanlı (paralel) üretim → hepsi BENZERSİZ (çakışma yok) ---
  const many = await Promise.all(
    Array.from({ length: 20 }, () => generateRollBarcode(prisma, "H", DATE)),
  );
  check("20 paralel üretim hepsi benzersiz", new Set(many).size === 20);

  // --- sayaç ardışık: n=9998 sonrası → 9999 ---
  await prisma.rollBarcodeCounter.update({ where: { day_type: { day: DAY, type: "H" } }, data: { n: 9998 } });
  const near = await generateRollBarcode(prisma, "H", DATE);
  check("n=9998 sonrası → 9999", near === "T311299H9999", near);

  // --- kapasite: sayaç MAX'ta → hata ---
  await prisma.rollBarcodeCounter.update({ where: { day_type: { day: DAY, type: "H" } }, data: { n: MAX_ROLL_SEQ } });
  let capErr = false;
  try { await generateRollBarcode(prisma, "H", DATE); } catch { capErr = true; }
  check("MAX aşımı → kapasite hatası", capErr);

  // --- eski/yeni format ayrımı: eski TEKS… yeni T311299H prefix'iyle EŞLEŞMEZ ---
  check("eski TEKS… yeni regex'e UYMAZ", !ROLL_BARCODE_RE.test("TEKS991231HA001"));
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(fail > 0 ? 1 : 0);
  });
