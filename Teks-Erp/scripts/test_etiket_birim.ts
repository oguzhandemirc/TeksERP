// =============================================================================
// Bekçi: etiket şablonu BİRİM SİSTEMİ + İE etiket bilgisinin uygulanması (Gülkesim S5)
// Çalıştır: npx tsx scripts/test_etiket_birim.ts   (DB'siz)
// =============================================================================
//   §1 dönüşüm katsayıları (m→yd ÷0,9144 · cm→in ÷2,54 · kg→lb ×2,20462), ondalık + ayırıcı
//   §2 metrik | ABD | ikisi yan yana — fieldDisplayValue + metraj bandı
//   §3 ayarsız / METRIC-varsayılan şablon → D4-F3 altın dosyasıyla BAYT-AYNI (5 render yolu)
//   §4 4 dilde (HTML/PPLA/PPLB/ZPL) ABD ve İKİSİ basılı metin + serbest İngilizce başlık
//   §5 withTemplateUnits: şablondan taşır, payload'daki (önizleme) kazanır, bozuk ayar → null
//   §6 İE etiket bilgisi: ekle / değiştir / "" boş bas / anahtar yok = kaynak; izinsiz anahtar uygulanmaz
// Negatif sonda (ölçüldü 2026-11-03): `toUs` cm dalı ×2,54 yapılınca §1/§2/§4 kırmızı.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatMeasure, readLabelUnitSettings, toUs, type LabelUnitSettings } from "../src/config/label-units";
import { applyLabelOverrides, readLabelOverrides } from "../src/config/label-overrides";
import { fieldDisplayValue } from "../src/services/helpers/label-field-values";
import { bannerValueText } from "../src/services/helpers/native-label.shared";
import { withTemplateUnits, type LabelRenderInput } from "../src/services/helpers/label-renderer.registry";
import type { CanvasLayout, LabelElement } from "../src/config/label-elements";
import type { LabelPayload } from "../src/types/label.types";
import { layoutWith, PAYLOAD, renderFive, renderRaw } from "./lib/etiket-musteri-kodu-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const US: LabelUnitSettings = { system: "US" };
const BOTH: LabelUnitSettings = { system: "BOTH" };
const withUnits = (u: LabelUnitSettings | null): LabelPayload => ({ ...PAYLOAD, unitSettings: u } as LabelPayload);

async function main(): Promise<void> {
  console.log("\n[§1] dönüşüm + biçim");
  check("§1 100 m → 109,36 yd", formatMeasure(100, "m", US) === "109,36 yd", formatMeasure(100, "m", US));
  check("§1 150 cm → 59,06 in", formatMeasure(150, "cm", US) === "59,06 in", formatMeasure(150, "cm", US));
  check("§1 18 kg → 39,68 lb", formatMeasure(18, "kg", US) === "39,68 lb", formatMeasure(18, "kg", US));
  check("§1 toUs ham katsayılar", Math.abs(toUs(0.9144, "m") - 1) < 1e-12 && Math.abs(toUs(2.54, "cm") - 1) < 1e-12 && Math.abs(toUs(1, "kg") - 2.20462) < 1e-12);
  check("§1 ondalık 0 → 59 in", formatMeasure(150, "cm", { system: "US", decimals: 0 }) === "59 in");
  check("§1 ondalık 3 + nokta → 59.055 in", formatMeasure(150, "cm", { system: "US", decimals: 3, decimalSep: "." }) === "59.055 in");
  check("§1 sabit ondalık sıfırı tutar → 150,00 cm", formatMeasure(150, "cm", { system: "METRIC", decimals: 2 }) === "150,00 cm");
  check("§1 varsayılan: sondaki sıfır atılır → 120,5 m", formatMeasure(120.5, "m", null) === "120,5 m");

  console.log("\n[§2] metrik | ABD | ikisi yan yana");
  check("§2 METRIC en = 150 cm", fieldDisplayValue(withUnits(null), "widthCm").value === "150 cm");
  check("§2 US en = 59,06 in", fieldDisplayValue(withUnits(US), "widthCm").value === "59,06 in");
  const both = fieldDisplayValue(withUnits(BOTH), "widthCm").value;
  check("§2 BOTH en = '150 cm / 59,06 in'", both === "150 cm / 59,06 in", both);
  check("§2 BOTH metre = '120,5 m / 131,78 yd'", fieldDisplayValue(withUnits(BOTH), "lengthMeters").value === "120,5 m / 131,78 yd");
  check("§2 US kg = 39,68 lb", fieldDisplayValue(withUnits(US), "weightKg").value === "39,68 lb");
  check("§2 eksik değer birim sisteminde de boş (present:false)", fieldDisplayValue({ ...withUnits(US), weightKg: null } as LabelPayload, "weightKg").present === false);
  check("§2 bant: ayarsız 120,5m (bugünkü)", bannerValueText(withUnits(null)) === "120,5m");
  check("§2 bant: US 131,78yd", bannerValueText(withUnits(US)) === "131,78yd", bannerValueText(withUnits(US)));
  check("§2 bant: BOTH dar şeritte metrik 120,5m", bannerValueText(withUnits(BOTH)) === "120,5m");

  console.log("\n[§3] ayarsız şablon bayt-aynı (altın)");
  const altin = JSON.parse(readFileSync(join(__dirname, "lib", "etiket-musteri-kodu-altin.json"), "utf8")) as Record<string, string>;
  const metricDefault = await renderFive(layoutWith(), withUnits({ system: "METRIC" }));
  const yok = await renderFive(layoutWith(), withUnits(null));
  for (const k of ["html", "ppla", "pplb", "zpl", "raster"] as const) {
    check(`§3 ${k}: unitSettings=null altınla bayt-aynı`, yok[k] === altin[k]);
    check(`§3 ${k}: METRIC varsayılan altınla bayt-aynı`, metricDefault[k] === altin[k]);
  }

  console.log("\n[§4] 4 dilde ABD / İKİSİ + İngilizce başlık");
  const layout: CanvasLayout = {
    v: 1,
    elements: [
      { id: "w", type: "field", bind: "widthCm", label: "Width", x: 30, y: 3 },
      { id: "l", type: "field", bind: "lengthMeters", label: "Length", x: 30, y: 10 },
      { id: "k", type: "field", bind: "weightKg", label: "Weight", x: 30, y: 17 },
    ] as unknown as LabelElement[],
  };
  const us = await renderRaw(layout, withUnits(US));
  const bo = await renderRaw(layout, withUnits(BOTH));
  for (const k of ["html", "ppla", "pplb", "zpl"] as const) {
    check(`§4 ${k}: US 59,06 in + 131,78 yd + 39,68 lb`, us[k].includes("59,06 in") && us[k].includes("131,78 yd") && us[k].includes("39,68 lb"));
    check(`§4 ${k}: US çıktıda metrik 'cm' yok`, !us[k].includes("150 cm"));
    check(`§4 ${k}: BOTH yan yana '150 cm / 59,06 in'`, bo[k].includes("150 cm / 59,06 in"));
    check(`§4 ${k}: serbest başlık 'Width'`, us[k].includes("Width"));
  }

  console.log("\n[§5] withTemplateUnits");
  const base = { payload: PAYLOAD, template: { unitSettings: { system: "US", decimals: 1 } } } as unknown as LabelRenderInput;
  const t = withTemplateUnits(base);
  check("§5 şablondan payload'a taşınır", t.payload.unitSettings?.system === "US" && t.payload.unitSettings?.decimals === 1);
  const pre = withTemplateUnits({ ...base, payload: withUnits(BOTH) });
  check("§5 payload'daki ayar (stüdyo önizlemesi) kazanır", pre.payload.unitSettings?.system === "BOTH");
  const none = withTemplateUnits({ ...base, template: null } as unknown as LabelRenderInput);
  check("§5 şablonsuz → payload değişmez (aynı nesne)", none === ({ ...base, template: null } as unknown as LabelRenderInput) || none.payload.unitSettings === undefined);
  check("§5 bozuk ayar → null", readLabelUnitSettings({ system: "IMPERIAL" }) === null && readLabelUnitSettings("US") === null);
  check("§5 ondalık sınır dışı yok sayılır", readLabelUnitSettings({ system: "US", decimals: 7 })?.decimals === null);

  console.log("\n[§6] İE etiket bilgisi uygulaması");
  const p = { ...PAYLOAD, deliveryNoteItemText: null, deliveryNoteColorText: "KIRMIZI" } as unknown as LabelPayload;
  applyLabelOverrides(p, readLabelOverrides({ deliveryNoteItemText: "DESEN 77", colorName: "", widthCm: "152,5", barcode: "HACK" }));
  check("§6 eksik alan eklendi (desen)", fieldDisplayValue(p, "deliveryNoteItemText").value === "DESEN 77");
  check("§6 '' → boş basılır", fieldDisplayValue(p, "colorName").present === false);
  check("§6 en sayıya çevrilir (152,5)", p.widthCm === 152.5);
  check("§6 anahtar yok → kaynak değer korunur", (p as unknown as Record<string, unknown>).deliveryNoteColorText === "KIRMIZI");
  check("§6 izinsiz anahtar (barcode) uygulanmaz", p.barcode === PAYLOAD.barcode);
  const q = { ...PAYLOAD } as LabelPayload;
  applyLabelOverrides(q, { widthCm: "" });
  check("§6 en '' → boş bas", fieldDisplayValue(q, "widthCm").present === false);
  check("§6 bozuk JSON → boş harita", Object.keys(readLabelOverrides([1, 2])).length === 0 && Object.keys(readLabelOverrides({ itemName: 5 })).length === 0);
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(() => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
  });
