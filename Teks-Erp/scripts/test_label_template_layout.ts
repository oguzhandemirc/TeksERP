// =============================================================================
// Test: şablon-başına yerleşim (satır aralığı + QR boyutu) — 3 native dil generator
// null → dile-özel varsayılan (byte-compat); dolu → değer yansır + makul aralık clamp.
// Çalıştır: npx tsx scripts/test_label_template_layout.ts
// =============================================================================
import { buildRollLabelPpla } from "../src/services/helpers/label-ppla.helper";
import { buildRollLabelPplb } from "../src/services/helpers/label-pplb.helper";
import { buildRollLabelZpl } from "../src/services/helpers/label-zpl.helper";
import { renderPplbToSvg } from "../src/services/helpers/native-preview";
import { qrFootprintDots } from "../src/services/helpers/native-label.shared";
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

// --- 4. lineStepMm = satırlar arası EK boşluk (v2). Adım = fontYük×çarpan + boşluk
//        → asla çakışmaz. İlk satır lengthMeters=headline→lg→font3 (EPL_FONT.lg.h=20). ---
const stepBig = buildRollLabelPplb({ ...base, template: tpl({ lineStepMm: 12 }) });
const rowsBig = [...stepBig.matchAll(/A\d+,(\d+),0,/g)].map((m) => Number(m[1]));
const stepDef = buildRollLabelPplb({ ...base, template: null });
const rowsDef = [...stepDef.matchAll(/A\d+,(\d+),0,/g)].map((m) => Number(m[1]));
const dot12 = Math.round((12 * 203) / 25.4); // 12mm → dot
const lgH = 20; // EPL_FONT.lg.h — ilk satır font yüksekliği
check("PPLB lineStepMm 12 (ek boşluk) → adım = fontYük(20)+12mm", rowsBig.length >= 2 && rowsBig[1] - rowsBig[0] === lgH + dot12, `fark=${rowsBig[1] - rowsBig[0]} beklenen=${lgH + dot12}`);
check("PPLB null → adım daha küçük (varsayılan boşluk < 12mm ek)", rowsDef.length >= 2 && rowsDef[1] - rowsDef[0] < rowsBig[1] - rowsBig[0]);

// --- 5. v2 ROBUSTLUK: tüm alanlar xl+bold → dikey ÇAKIŞMA YOK (otomatik adım) ---
const xlTpl = {
  kind: "ROLL_RAW", rawCode: null, qrScale: null, lineStepMm: null,
  fields: [
    { key: "itemName", label: "", order: 1, isVisible: true, fontSize: "xl", isBold: true },
    { key: "lengthMeters", label: "Uzunluk", order: 2, isVisible: true, fontSize: "xl", isBold: true },
    { key: "weightKg", label: "Agirlik", order: 3, isVisible: true, fontSize: "xl", isBold: true },
    { key: "customerName", label: "Musteri", order: 4, isVisible: true, fontSize: "lg", isBold: true },
  ],
} as unknown as LabelTemplate;
const extreme = buildRollLabelPplb({ ...base, template: xlTpl });
const FH: Record<string, number> = { "1": 12, "2": 16, "3": 20, "4": 24, "5": 48 };
const rows = [...extreme.matchAll(/A\d+,(\d+),0,(\d),(\d),(\d),N/g)].map((m) => ({ y: +m[1], h: FH[m[2]] * +m[4] }));
let overlap = false;
for (let i = 0; i < rows.length - 1; i++) if (rows[i].y + rows[i].h > rows[i + 1].y) overlap = true;
check("v2: tüm alanlar xl+bold → dikey çakışma YOK", rows.length >= 2 && !overlap);

// --- 6. WYSIWYG: önizleme QR görsel boyutu = generator ayak izi (aynı model) ---
const previewSvg = renderPplbToSvg(buildRollLabelPplb({ ...base, template: tpl({ qrScale: 6 }) })) ?? "";
const qrImgW = Number((previewSvg.match(/<image[^>]*width="(\d+)"/) || [])[1]);
const expectFootprint = qrFootprintDots(payload.barcode.length, 6);
check("v2 WYSIWYG: önizleme QR boyutu = ayak izi (bwip viewBox değil)", qrImgW === expectFootprint, `önizleme=${qrImgW} ayakizi=${expectFootprint}`);

// --- 7. QR büyütünce metin kolonu sağa kayar (çakışma önlenir) ---
const tX = (s: number) => Number((buildRollLabelPplb({ ...base, template: tpl({ qrScale: s }) }).match(/A(\d+),/) || [])[1]);
check("v2: qrScale büyüdükçe textX sağa kayar (QR'ı geçer)", tX(8) > tX(3));

// --- 8. Sağ dikey metraj bandı (ekstra) — ters (R) döndürülmüş değer TEK BAŞINA (LO yok) ---
const bannerTpl = { kind: "ROLL_RAW", rawCode: null, qrScale: null, lineStepMm: null, lengthBanner: true } as unknown as LabelTemplate;
const withBanner = buildRollLabelPplb({ ...base, template: bannerTpl });
const noBanner = buildRollLabelPplb({ ...base, template: null });
check("bant: döndürülmüş ters değer (A rot1 R, sadece metraj)", /A\d+,\d+,1,\d,\d,\d,R,"320"/.test(withBanner));
check("bant: LO KULLANILMAZ (LO+R = beyaz-kutu XOR bug'ı)", !/LO\d+/.test(withBanner));
check("bant kapalı (null) → döndürülmüş ters yok", !/A\d+,\d+,1,\d,\d,\d,R,/.test(noBanner));
// İçerik banda girmez: alt barkod (B x=left) bandın (A x=right) SOLUNDA
const bannerAx = withBanner.match(/A(\d+),\d+,1,\d,\d,\d,R,/);
const bcXm = withBanner.match(/\nB(\d+),/) ?? withBanner.match(/^B(\d+),/m);
check("bant: alt barkod bandın SOLUNDA (çakışma yok)", Boolean(bannerAx && bcXm) && Number(bcXm![1]) < Number(bannerAx![1]));
// SWATCH'ta metraj yok → bant çıkmaz
const swBanner = buildRollLabelPplb({ payload: { ...payload, kind: "SWATCH" } as unknown as LabelPayload, format, copies: 1, template: bannerTpl });
check("bant: SWATCH'ta (metraj yok) bant çıkmaz", !/A\d+,\d+,1,\d,\d,\d,R,/.test(swBanner));

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
