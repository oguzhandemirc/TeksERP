// =============================================================================
// Test: şablon-başına yerleşim (satır aralığı + QR boyutu) — 3 native dil generator
// null → dile-özel varsayılan (byte-compat); dolu → değer yansır + makul aralık clamp.
// Çalıştır: npx tsx scripts/test_label_template_layout.ts
// =============================================================================
import { buildRollLabelPpla } from "../src/services/helpers/label-ppla.helper";
import { buildRollLabelPplb } from "../src/services/helpers/label-pplb.helper";
import { buildRollLabelZpl } from "../src/services/helpers/label-zpl.helper";
import type { ResolvedLabelFormat } from "../src/services/helpers/label-format.resolver";
import type { LabelPayload } from "../src/services/label.service";
import type { LabelTemplate } from "@prisma/client";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const format: ResolvedLabelFormat = {
  widthMm: 100, heightMm: 50, marginMm: 2,
  marginTopMm: 2, marginRightMm: 2, marginBottomMm: 2, marginLeftMm: 2, gapMm: 3,
  orientation: "PORTRAIT",
  dpi: 203, language: "PPLB", profileId: "p1", source: "machine",
};
const payload = {
  barcode: "TEKS20260701ABCD1234", qualityGrade: "1.KALITE", widthCm: 150,
  lengthMeters: 320, weightKg: 40, itemName: "PATOS", colorName: "MAVI",
  customerName: "ACME", batchNumber: "P-1",
} as unknown as LabelPayload;

const fields = [
  { key: "lengthMeters", label: "Metraj", order: 1, isVisible: true },
  { key: "weightKg", label: "Agirlik", order: 2, isVisible: true },
];

// Şablon kurucu: yalnız yerleşim alanları farklı (generator template.qrScale/lineStepMm okur).
function tpl(layout: { qrScale?: number | null; lineStepMm?: number | null }): LabelTemplate {
  return { kind: "ROLL_RAW", fields, rawCode: null, ...layout } as unknown as LabelTemplate;
}
const base = { payload, format, copies: 1 };

// --- 1. null yerleşim → dile-özel varsayılan (byte-compat) ---
const pplbNull = buildRollLabelPplb({ ...base, template: null });
const zplNull = buildRollLabelZpl({ ...base, template: null });
const pplaNull = buildRollLabelPpla({ ...base, template: null });
check("PPLB null → varsayılan QR s5", /b\d+,\d+,Q,m2,s5,/.test(pplbNull));
check("ZPL null → varsayılan QR mag 3", pplbNull && zplNull.includes("^BQN,2,3^FD"));
check("PPLA null → varsayılan QR modül 06", pplaNull.includes("1W1c0606"));

// --- 2. qrScale set → her dilde yansır ---
const q = { qrScale: 8, lineStepMm: null };
check("PPLB qrScale8 → s8", /b\d+,\d+,Q,m2,s8,/.test(buildRollLabelPplb({ ...base, template: tpl(q) })));
check("ZPL qrScale8 → mag 8", buildRollLabelZpl({ ...base, template: tpl(q) }).includes("^BQN,2,8^FD"));
check("PPLA qrScale8 → modül 08", buildRollLabelPpla({ ...base, template: tpl(q) }).includes("1W1c0808"));

// --- 3. qrScale clamp (aralık dışı) ---
check("PPLB qrScale 99 → 15'e kısılır (s15)", /,s15,/.test(buildRollLabelPplb({ ...base, template: tpl({ qrScale: 99 }) })));
check("PPLB qrScale 1 → 2'ye kısılır (s2)", /,s2,/.test(buildRollLabelPplb({ ...base, template: tpl({ qrScale: 1 }) })));
check("ZPL qrScale 99 → mag 10'a kısılır (BQ üst sınır)", buildRollLabelZpl({ ...base, template: tpl({ qrScale: 99 }) }).includes("^BQN,2,10^FD"));

// --- 4. lineStepMm set → satır adımı DEĞİŞİR (iki A satırının y farkı = 6mm dot) ---
const stepBig = buildRollLabelPplb({ ...base, template: tpl({ lineStepMm: 12 }) });
const rowsBig = [...stepBig.matchAll(/A\d+,(\d+),0,/g)].map((m) => Number(m[1]));
const stepDef = buildRollLabelPplb({ ...base, template: null });
const rowsDef = [...stepDef.matchAll(/A\d+,(\d+),0,/g)].map((m) => Number(m[1]));
const dot12 = Math.round((12 * 203) / 25.4); // 12mm → dot
check("PPLB lineStepMm 12 → satır farkı ~12mm dot", rowsBig.length >= 2 && Math.abs(rowsBig[1] - rowsBig[0] - dot12) <= 1, `fark=${rowsBig[1] - rowsBig[0]} beklenen≈${dot12}`);
check("PPLB null → font-türevli adım (12mm'den küçük)", rowsDef.length >= 2 && rowsDef[1] - rowsDef[0] < dot12);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
