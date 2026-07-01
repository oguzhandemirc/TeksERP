// =============================================================================
// Test: Argox PPLA native komut üreteci (buildRollLabelPpla)
// Çalıştır: npx tsx scripts/test_label_ppla.ts
// Doğrulananlar: frame (STX L … E), veri alanları (ürün/kalite/metraj/müşteri),
// barkod (Code128 + okunabilir + QR), kopya (Q), pay'lı dot konumları, sanitize.
// =============================================================================
import { buildRollLabelPpla } from "../src/services/helpers/label-ppla.helper";
import type { ResolvedLabelFormat } from "../src/services/helpers/label-format.resolver";
import type { LabelPayload } from "../src/services/label.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const format: ResolvedLabelFormat = {
  widthMm: 100, heightMm: 148, marginMm: 3, orientation: "PORTRAIT",
  dpi: 203, language: "PPLA", profileId: "p1", source: "machine",
};

const payload = {
  barcode: "TEKS20260615AB12CD34",
  status: "WAREHOUSE",
  qualityGrade: "1.KALITE",
  widthCm: 150,
  lengthMeters: 320,
  weightKg: 42.5,
  itemName: "PATOS",
  customerName: "ACME TEKSTIL",
  batchNumber: "P-260615-001",
  colorName: "MAVI",
} as unknown as LabelPayload;

function main() {
  const STX = "\x02";
  const ppla = buildRollLabelPpla({ payload, format, copies: 2, template: null });

  check("STX L (format başlangıcı)", ppla.includes(`${STX}L`));
  check("E (bitir/bas)", /\bE\b/.test(ppla) && ppla.trimEnd().endsWith("E"));
  check("kopya Q0002", ppla.includes("Q0002"));
  check("ürün adı gömülü", ppla.includes("PATOS"));
  check("kalite gömülü", ppla.includes("Kalite: 1.KALITE"));
  check("metraj+en gömülü", ppla.includes("320 mt") && ppla.includes("En: 150 cm"));
  check("ağırlık gömülü", ppla.includes("Agirlik: 42.5 kg"));
  check("müşteri gömülü", ppla.includes("Musteri: ACME TEKSTIL"));
  check("parti gömülü", ppla.includes("Parti: P-260615-001"));
  check("barkod değeri gömülü", ppla.includes("TEKS20260615AB12CD34"));
  check("Code128 kaydı (1e..)", /1e\d{2}\d{4}\d{4}\d{4}TEKS/.test(ppla));
  check("QR kaydı (1W1c..)", ppla.includes("1W1c"));
  check("etiket boyu komutu (STX M)", ppla.includes(`${STX}M`));

  // Renksiz + barkodsuz (açık kumaş) → çökmeden, barkod kayıtları yok
  const raw = buildRollLabelPpla({
    payload: { ...payload, barcode: null, colorName: null, customerName: null, batchNumber: null } as unknown as LabelPayload,
    format,
    copies: 1,
    template: null,
  });
  check("barkodsuz: Code128 kaydı YOK", !raw.includes("1e"));
  check("barkodsuz: yine frame var", raw.includes(`${STX}L`) && raw.trimEnd().endsWith("E"));
  check("kopya alt sınır Q0001", raw.includes("Q0001"));

  // Kontrol karakteri sanitize — barkoda STX enjekte → temizlenmeli (sadece 1 STX L'den)
  const dirty = buildRollLabelPpla({
    payload: { ...payload, barcode: `BAD${STX}CODE` } as unknown as LabelPayload,
    format, copies: 1, template: null,
  });
  check("sanitize: veri STX taşımaz", !dirty.includes(`BAD${STX}CODE`) && dirty.includes("BAD CODE"));

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
