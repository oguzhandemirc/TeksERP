// =============================================================================
// Test: boyut-bilinçli HTML render (buildRollLabelHtml format/pay)
// Çalıştır: npx tsx scripts/test_label_html_format.ts
// Doğrulananlar: @page size = medya, margin = pay; .label width = medya − 2×pay;
// default (format yok) = 100×148+3 (içerik 94); landscape = iki-kolon düzen
// (sayfa MEDYA ölçüsünde — takas YOK; orientation yalnız düzeni seçer, `d016105`).
// =============================================================================
import { buildRollLabelHtml } from "../src/services/helpers/label-html.helper";
import type { LabelPayload } from "../src/services/label.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const payload = {
  barcode: "TEKS-1", status: "WAREHOUSE", qualityGrade: "1.KALITE",
  widthCm: 150, lengthMeters: 320, weightKg: 40, itemName: "PATOS",
} as unknown as LabelPayload;

const base = { payload, template: null, barcodeSvg: "<svg/>", qrSvg: "<svg/>", copies: 1 };

function main() {
  // 1) Default (format yok) → 100×148 + 3mm pay → içerik 94mm
  const def = buildRollLabelHtml({ ...base });
  check("default @page 100mm 148mm + margin 3mm",
    def.includes("size: 100mm 148mm") && def.includes("margin: 3mm"));
  check("default içerik genişliği 94mm", def.includes("width: 94mm"));

  // 2) Argox 104×148 + 2mm pay → içerik 100mm
  const argox = buildRollLabelHtml({ ...base, format: { widthMm: 104, heightMm: 148, marginMm: 2, orientation: "PORTRAIT" } });
  check("104×148 @page + margin 2mm", argox.includes("size: 104mm 148mm") && argox.includes("margin: 2mm"));
  check("104 − 2×2 = içerik 100mm", argox.includes("width: 100mm"));

  // 3) Pay 0 → içerik = medya
  const noPad = buildRollLabelHtml({ ...base, format: { widthMm: 100, heightMm: 150, marginMm: 0, orientation: "PORTRAIT" } });
  check("pay 0 → @page margin 0mm + içerik 100mm",
    noPad.includes("size: 100mm 150mm") && noPad.includes("margin: 0mm") && noPad.includes("width: 100mm"));

  // 4) LANDSCAPE → iki-kolon kumaş etiketi düzeni (kumaş etiketi 100×58). Sayfa
  //    MEDYA ölçüsünde kalır (takas YOK — orientation yalnız düzen dalını seçer);
  //    içerik = medya genişliği − 2×pay; portrait'ın dikey .qty istifi yerine
  //    landscape'in iki-kolon .metraj düzeni üretilir.
  const land = buildRollLabelHtml({ ...base, format: { widthMm: 100, heightMm: 58, marginMm: 3, orientation: "LANDSCAPE" } });
  check("landscape @page = medya 100mm 58mm (takas YOK)", land.includes("size: 100mm 58mm"));
  check("landscape içerik = 100 − 2×3 = 94mm", land.includes("width: 94mm"));
  check("landscape iki-kolon düzen seçildi (.metraj var, portrait .qty yok)", land.includes(".metraj") && !land.includes(".qty"));

  // 5) A6 sabit-kodu KALMADI (regresyon)
  check("eski 'size: A6' yok", !def.includes("size: A6") && !def.includes("width: 105mm"));

  // 6) Kopya korunur (page-break)
  const two = buildRollLabelHtml({ ...base, copies: 2 });
  check("copies=2 → 2 .label bloğu", (two.match(/class="label"/g) || []).length === 2);

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
