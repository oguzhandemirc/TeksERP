// Kısa top barkodu (TEKS+YYMMDD+H/F+A001..Z999) üreteç + seq kodlama testi.
// encode/decode saf; üretim atomik sayaç (roll_barcode_counters) → gerçek DB, izole
// gelecek tarih + finally temizlik. `npx tsx scripts/test_roll_barcode.ts`.

import prisma from "../src/lib/prisma";
import {
  ROLL_BARCODE_RE,
  MAX_ROLL_SEQ,
  encodeRollSeq,
  decodeRollSeq,
  rollBarcodePrefix,
  generateRollBarcode,
} from "../src/services/helpers/roll-barcode.helper";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

// İzole gelecek tarih (gerçek üretim gününe dokunmaz): 2099-12-31 → YYMMDD 991231.
const DATE = new Date(2099, 11, 31);
const DAY = "991231";

async function cleanup() {
  await prisma.rollBarcodeCounter.deleteMany({ where: { day: DAY } }).catch(() => {});
}

async function main() {
  await cleanup(); // önceki koşu kalıntısı

  // --- encode/decode round-trip (saf) ---
  check("encode n=1 → A001", encodeRollSeq(1) === "A001");
  check("encode n=999 → A999", encodeRollSeq(999) === "A999");
  check("encode n=1000 → B001 (A999 sonrası)", encodeRollSeq(1000) === "B001");
  check("encode n=MAX → Z999", encodeRollSeq(MAX_ROLL_SEQ) === "Z999");
  for (const n of [1, 2, 999, 1000, 5000, MAX_ROLL_SEQ]) {
    check(`decode(encode(${n})) === ${n}`, decodeRollSeq(encodeRollSeq(n)) === n);
  }
  check("decode geçersiz 'A000' → null", decodeRollSeq("A000") === null);
  check("decode geçersiz 'AA01' → null", decodeRollSeq("AA01") === null);
  check("prefix H", rollBarcodePrefix("H", DATE) === "TEKS991231H");

  // --- üretim: ilk çağrı A001, sonra sıralı artar (atomik sayaç) ---
  const b1 = await generateRollBarcode(prisma, "H", DATE);
  const b2 = await generateRollBarcode(prisma, "H", DATE);
  const b3 = await generateRollBarcode(prisma, "H", DATE);
  check("ilk → TEKS991231HA001", b1 === "TEKS991231HA001", b1);
  check("ikinci → A002", b2 === "TEKS991231HA002", b2);
  check("üçüncü → A003", b3 === "TEKS991231HA003", b3);
  check("üretilen barkod regex'e uyar", ROLL_BARCODE_RE.test(b1));

  // --- tip ayrımı: F kendi sayacından A001'den başlar ---
  const f1 = await generateRollBarcode(prisma, "F", DATE);
  check("F tipi bağımsız → TEKS991231FA001", f1 === "TEKS991231FA001", f1);

  // --- eşzamanlı (paralel) üretim → hepsi BENZERSİZ (çakışma yok) ---
  const many = await Promise.all(
    Array.from({ length: 20 }, () => generateRollBarcode(prisma, "H", DATE)),
  );
  check("20 paralel üretim hepsi benzersiz", new Set(many).size === 20);

  // --- A999 → B001 taşması (sayacı 999'a getir) ---
  await prisma.rollBarcodeCounter.update({ where: { day_type: { day: DAY, type: "H" } }, data: { n: 999 } });
  const rollover = await generateRollBarcode(prisma, "H", DATE);
  check("n=999 sonrası → B001 taşması", rollover === "TEKS991231HB001", rollover);

  // --- kapasite: sayaç MAX'ta → hata ---
  await prisma.rollBarcodeCounter.update({ where: { day_type: { day: DAY, type: "H" } }, data: { n: MAX_ROLL_SEQ } });
  let capErr = false;
  try { await generateRollBarcode(prisma, "H", DATE); } catch { capErr = true; }
  check("MAX aşımı → kapasite hatası", capErr);

  // --- eski format prefix'e karışmaz ---
  check("eski TEKS20991231… yeni TEKS991231H prefix'iyle EŞLEŞMEZ",
    !"TEKS20991231A1B2C3D4".startsWith("TEKS991231H"));
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(fail > 0 ? 1 : 0);
  });
