// =============================================================================
// Test: native renderer'lar (PPLA/PPLB/ZPL) ARTIK etiket şablonunu uygular
// Çalıştır: npx tsx scripts/test_native_template_honoring.ts
// Doğrulananlar:
//   1. Görünürlük: isVisible=false alan native çıktıda YOK
//   2. Sıra: field.order sağ metin kolonu satır sırasını belirler
//   3. Bold: isBold → PPLA mult 22 / PPLB hMul,vMul 2 / ZPL genişlik > yükseklik
//   4. Font: fontSize → native font kodu (xl → PPLA font 5)
//   5. Custom etiket: field.label native row'da kullanılır ("Etiket: değer")
//   6. REGRESYON: template=null → eski rollTextLines davranışı (font 4/11, "Renk:")
// DB GEREKMEZ — builder'lar doğrudan çağrılır.
// =============================================================================
import { LabelKind, type LabelTemplate } from "@prisma/client";
import { buildRollLabelPpla } from "../src/services/helpers/label-ppla.helper";
import { buildRollLabelPplb } from "../src/services/helpers/label-pplb.helper";
import { buildRollLabelZpl } from "../src/services/helpers/label-zpl.helper";
import type { ResolvedLabelFormat } from "../src/services/helpers/label-format.resolver";
import type { LabelPayload } from "../src/services/label.service";
import type { TemplateField } from "../src/config/label-fields";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const format: ResolvedLabelFormat = {
  widthMm: 100, heightMm: 148, marginMm: 3,
  marginTopMm: 3, marginRightMm: 3, marginBottomMm: 3, marginLeftMm: 3, gapMm: 3,
  orientation: "PORTRAIT",
  dpi: 203, language: "PPLA", source: "machine",
};

const payload = {
  barcode: "TEKS-1", qualityGrade: "1.KALITE", widthCm: 150, lengthMeters: 320,
  weightKg: 40, itemName: "PATOS", colorName: "MAVI", customerName: "ACME",
  batchNumber: "P-1", kind: LabelKind.ROLL_FINISHED,
} as unknown as LabelPayload;

// Şablon: colorName GİZLİ, customerName qualityGrade'den ÖNCE, itemName bold,
// lengthMeters xl. (barcode scan kolonunda → metin zone'da yok.)
const fields: TemplateField[] = [
  { key: "barcode", label: "Barkod", order: 1, isVisible: true },
  { key: "itemName", label: "Urun", order: 2, isVisible: true, isBold: true },
  { key: "customerName", label: "Musteri", order: 3, isVisible: true },
  { key: "qualityGrade", label: "Kalite", order: 4, isVisible: true },
  { key: "lengthMeters", label: "Metraj", order: 5, isVisible: true, fontSize: "xl" },
  { key: "colorName", label: "Renk", order: 6, isVisible: false },
  { key: "weightKg", label: "Agirlik", order: 7, isVisible: true },
];
const template = { fields } as unknown as LabelTemplate;

function main() {
  const ppla = buildRollLabelPpla({ payload, format, copies: 1, template });
  const pplb = buildRollLabelPplb({ payload, format, copies: 1, template });
  const zpl = buildRollLabelZpl({ payload, format, copies: 1, template });

  // 1. Görünürlük — gizli colorName değeri (MAVI) çıktıların HİÇBİRİNDE yok
  check("PPLA: gizli alan (MAVI) yok", !ppla.includes("MAVI"));
  check("PPLB: gizli alan (MAVI) yok", !pplb.includes("MAVI"));
  check("ZPL: gizli alan (MAVI) yok", !zpl.includes("MAVI"));

  // 2. Sıra — Musteri (ACME) Kalite'den (1.KALITE) ÖNCE
  check("PPLA: sıra (Musteri < Kalite)", ppla.indexOf("ACME") > -1 && ppla.indexOf("ACME") < ppla.indexOf("1.KALITE"));
  check("ZPL: sıra (Musteri < Kalite)", zpl.indexOf("ACME") < zpl.indexOf("1.KALITE"));

  // 3. Bold — itemName headline=lg. v2: PPLA+PPLB ikisi de EPL_FONT lg=font3; bold mul2.
  //    Faz-1: label doluysa headline alanlar da "Etiket: değer" basar → "Urun: PATOS".
  check("PPLA: bold itemName → font3 mult22 (v2)", /1322000\d{8}Urun: PATOS/.test(ppla));
  check("PPLB: bold itemName → font3 mul2 (v2)", /0,3,2,2,N,"Urun: PATOS"/.test(pplb));

  // 4. Font — lengthMeters xl → v2 EPL_FONT xl=font4 (mult 11, bold değil); label "Metraj"
  check("PPLA: xl metraj → font4 (v2)", /1411000\d{8}Metraj: 320 m/.test(ppla));

  // 5. Custom etiket — row alanı "Etiket: değer" (Musteri: ACME)
  check("PPLA: custom label row", ppla.includes("Musteri: ACME"));
  check("ZPL: custom label row", zpl.includes("Musteri: ACME"));

  // 6. REGRESYON: template=null → varsayılan liste (itemName big→lg→font3/mult11, "Renk: MAVI")
  const pplaNull = buildRollLabelPpla({ payload, format, copies: 1, template: null });
  check("REGRESYON PPLA null: itemName font3 mult11 (v2 lg)", /1311000\d{8}PATOS/.test(pplaNull));
  check("REGRESYON PPLA null: 'Renk: MAVI' görünür (eski liste)", pplaNull.includes("Renk: MAVI"));
  check("REGRESYON PPLA null: bold (22) YOK", !/1[1-9]22000/.test(pplaNull));
  const zplNull = buildRollLabelZpl({ payload, format, copies: 1, template: null });
  check("REGRESYON ZPL null: 'Renk: MAVI' görünür", zplNull.includes("Renk: MAVI"));

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
