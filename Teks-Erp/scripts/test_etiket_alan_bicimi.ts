// =============================================================================
// Bekçi: kanvas alan elemanının BİÇİMİ (`fmt`) — GK ihracat etiketi (2026-11-10)
// Çalıştır: npx tsx scripts/test_etiket_alan_bicimi.ts   (DB'siz)
// =============================================================================
//   §1 formatFieldMeasure: m→yd / cm→in dönüşümü, sabit hane, sıfır dolgu, birim metni
//   §2 fieldElementValue: fmt'siz = fieldDisplayValue · değersiz alan biçimle de atlanır ·
//      sayısal ezme biçimlenir, metin ezme aynen · saatsiz tarih (gün sıfırsız, fabrika günü)
//   §3 fmt'siz şablon D4-F3 altın dosyasıyla BAYT-AYNI (5 render yolu)
//   §4 4 dilde (HTML/PPLA/PPLB/ZPL) biçimli metin basılır
//   §5 doğrulayıcı: bilinmeyen anahtar, metin alanında fmt, yanlış dönüşüm, aralık dışı → 400
// Negatif sonda (ölçüldü 2026-11-10): `formatFieldMeasure` padInt dalı atlanınca §1/§4 kırmızı;
// HTML emitter `fieldDisplayValue`a geri çevrilince §4 html kırmızı.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fieldFormatError, formatFieldMeasure } from "../src/config/label-units";
import { CanvasValidationError, validateCanvasLayout, type CanvasLayout, type LabelElement } from "../src/config/label-elements";
import { fieldDisplayValue, fieldElementValue } from "../src/services/helpers/label-field-values";
import type { LabelPayload } from "../src/types/label.types";
import { layoutWith, PAYLOAD, renderFive, renderRaw } from "./lib/etiket-musteri-kodu-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const P = { ...PAYLOAD, lengthMeters: 7, weightKg: 1.42, widthCm: 300, printedAt: "2026-05-04T22:30:00.000Z" } as unknown as LabelPayload;
const YDS = { to: "yd", decimals: 2, unit: "yds" } as const;
const MT = { decimals: 2, padInt: 2, unit: "mt" } as const;
const KG = { decimals: 2, unit: "kg" } as const;

function rejects(el: Record<string, unknown>): boolean {
  try {
    validateCanvasLayout({ v: 1, elements: [{ id: "qr", type: "qr", x: 1, y: 1 }, { id: "f", type: "field", x: 30, y: 3, ...el }] }, { widthMm: 100, heightMm: 60 });
    return false;
  } catch (e) {
    return e instanceof CanvasValidationError;
  }
}

async function main(): Promise<void> {
  console.log("\n[§1] formatFieldMeasure");
  check("§1 7 m → 7,66 yds", formatFieldMeasure(7, "m", YDS) === "7,66 yds", formatFieldMeasure(7, "m", YDS));
  check("§1 7 m → 07,00 mt", formatFieldMeasure(7, "m", MT) === "07,00 mt", formatFieldMeasure(7, "m", MT));
  check("§1 12,5 m → 12,50 mt (dolgu taşmaz)", formatFieldMeasure(12.5, "m", MT) === "12,50 mt");
  check("§1 1,4 kg → 1,40 kg (sabit hane sıfırı tutar)", formatFieldMeasure(1.4, "kg", KG) === "1,40 kg");
  check("§1 300 cm → 118 in", formatFieldMeasure(300, "cm", { to: "in", decimals: 0 }) === "118 in");
  check("§1 300 cm → 118 INCHES", formatFieldMeasure(300, "cm", { to: "in", decimals: 0, unit: "INCHES" }) === "118 INCHES");
  check("§1 unit '' → birimsiz", formatFieldMeasure(300, "cm", { decimals: 0, unit: "" }) === "300");
  check("§1 nokta ayırıcı + dolgu → 07.00 mt", formatFieldMeasure(7, "m", MT, ".") === "07.00 mt");

  console.log("\n[§2] fieldElementValue");
  for (const key of ["widthCm", "lengthMeters", "weightKg", "itemName", "printedAt"]) {
    const a = fieldElementValue(P, { bind: key });
    const b = fieldDisplayValue(P, key);
    check(`§2 fmt'siz ${key} = fieldDisplayValue`, a.value === b.value && a.present === b.present && a.role === b.role);
  }
  check("§2 metre → 7,66 yds", fieldElementValue(P, { bind: "lengthMeters", fmt: YDS }).value === "7,66 yds");
  check("§2 rol kaynaktan (metre headline)", fieldElementValue(P, { bind: "lengthMeters", fmt: YDS }).role === "headline");
  check("§2 kg yok → biçimle de present:false", fieldElementValue({ ...P, weightKg: null } as LabelPayload, { bind: "weightKg", fmt: KG }).present === false);
  check("§2 sayısal ezme biçimlenir (6,4 → 06,40 mt)", fieldElementValue({ ...P, displayOverrides: { lengthMeters: "6,4" } } as LabelPayload, { bind: "lengthMeters", fmt: MT }).value === "06,40 mt");
  check("§2 metin ezme aynen", fieldElementValue({ ...P, displayOverrides: { weightKg: "tartılmadı" } } as LabelPayload, { bind: "weightKg", fmt: KG }).value === "tartılmadı");
  const d = fieldElementValue(P, { bind: "printedAt", fmt: { date: "D.MM.YYYY" } }).value;
  check("§2 tarih fabrika günü, gün sıfırsız (22:30Z → 5.05.2026)", d === "5.05.2026", d);
  check("§2 tarih DD.MM.YYYY → 05.05.2026", fieldElementValue(P, { bind: "printedAt", fmt: { date: "DD.MM.YYYY" } }).value === "05.05.2026");
  check("§2 bozuk fmt render'da yok sayılır", fieldElementValue(P, { bind: "lengthMeters", fmt: { to: "lb" } }).value === fieldDisplayValue(P, "lengthMeters").value);

  console.log("\n[§3] fmt'siz şablon bayt-aynı (altın)");
  const altin = JSON.parse(readFileSync(join(__dirname, "lib", "etiket-musteri-kodu-altin.json"), "utf8")) as Record<string, string>;
  const now = await renderFive(layoutWith(), PAYLOAD);
  for (const k of ["html", "ppla", "pplb", "zpl", "raster"] as const) check(`§3 ${k}: altınla bayt-aynı`, now[k] === altin[k]);

  console.log("\n[§4] 4 dilde biçimli metin");
  const layout: CanvasLayout = {
    v: 1,
    elements: [
      { id: "y", type: "field", bind: "lengthMeters", x: 60, y: 3, fmt: YDS },
      { id: "m", type: "field", bind: "lengthMeters", x: 60, y: 12, fmt: MT },
      { id: "k", type: "field", bind: "weightKg", x: 60, y: 21, fmt: KG },
      { id: "i", type: "field", bind: "widthCm", x: 3, y: 30, fmt: { to: "in", decimals: 0, unit: "INCHES" } },
      { id: "t", type: "field", bind: "printedAt", x: 3, y: 40, fmt: { date: "D.MM.YYYY" } },
    ] as unknown as LabelElement[],
  };
  const out = await renderRaw(layout, P);
  for (const k of ["html", "ppla", "pplb", "zpl"] as const) {
    const s = out[k];
    check(`§4 ${k}: 7,66 yds · 07,00 mt · 1,42 kg · 118 INCHES · 5.05.2026`,
      s.includes("7,66 yds") && s.includes("07,00 mt") && s.includes("1,42 kg") && s.includes("118 INCHES") && s.includes("5.05.2026"));
    check(`§4 ${k}: saatli tarih basılmaz`, !s.includes("05.05.2026 01:30"));
  }

  console.log("\n[§5] doğrulayıcı");
  check("§5 geçerli fmt kabul", !rejects({ bind: "lengthMeters", fmt: YDS }) && !rejects({ bind: "printedAt", fmt: { date: "D.MM.YYYY" } }));
  check("§5 metin alanında fmt RED", rejects({ bind: "itemName", fmt: { decimals: 2 } }));
  check("§5 bilinmeyen anahtar RED", rejects({ bind: "weightKg", fmt: { decimals: 2, prefix: "x" } }));
  check("§5 yanlış dönüşüm (metre→in) RED", rejects({ bind: "lengthMeters", fmt: { to: "in" } }));
  check("§5 decimals 4 RED", rejects({ bind: "weightKg", fmt: { decimals: 4 } }));
  check("§5 padInt 0 RED", rejects({ bind: "weightKg", fmt: { padInt: 0 } }));
  check("§5 ölçüde date RED", rejects({ bind: "weightKg", fmt: { date: "D.MM.YYYY" } }));
  check("§5 tarihte decimals RED", rejects({ bind: "printedAt", fmt: { decimals: 1 } }));
  check("§5 uzun birim RED", rejects({ bind: "weightKg", fmt: { unit: "x".repeat(17) } }));
  check("§5 dizi fmt RED", fieldFormatError([], "weightKg") !== null);
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(() => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
  });
