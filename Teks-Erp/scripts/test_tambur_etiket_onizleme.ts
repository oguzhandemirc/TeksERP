// =============================================================================
// Bekçi: Tambur canlı etiket önizlemesi (`POST /tambur/label-preview`) — 2026-11-10
// Çalıştır: npx tsx scripts/test_tambur_etiket_onizleme.ts   (DB'siz)
// =============================================================================
//   §1 applyTamburDraft: taslak metre/kg/en/kalite çocuğa; boş metre = kalanı kes; ana barkod BASILMAZ
//   §2 composeCanvasElements: metin HTML render'ı ile AYNI (fmt biçimi dahil) · showIf taslak kaliteden ·
//      barkod yer tutucu · alan elemanı bind taşır, sabit metin taşımaz
//   §3 uç sözleşmesi: izin preview-fields ile aynı, route prisma import etmez, servis YAZMAZ
// Negatif sonda (ölçüldü 2026-11-10): composeCanvasElements `elementText` yerine `fieldDisplayValue`
// kullanınca §2 fmt kırmızı; applyTamburDraft barkodu korursa §1 kırmızı.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LabelElement } from "../src/config/label-elements";
import { buildCanvasLabelHtml } from "../src/services/helpers/label-canvas-html.helper";
import { applyTamburDraft, composeCanvasElements } from "../src/services/tambur/label-preview-compose";
import type { LabelPayload } from "../src/types/label.types";
import { FORMAT, PAYLOAD } from "./lib/etiket-musteri-kodu-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const PARENT = { ...PAYLOAD, lengthMeters: 170, weightKg: 25, widthCm: 300, qualityGrade: "1.KALITE" } as unknown as LabelPayload;

// GK ihracat etiketi biçimi (yds / mt / kg yan yana) + kaliteye koşullu damga.
const ELEMENTS = [
  { id: "l", type: "line", x: 2, y: 1.5, wMm: 96, hMm: 1.2 },
  { id: "t", type: "text", x: 3, y: 4.5, hMm: 2.6, bold: true, text: "DESING" },
  { id: "v", type: "field", x: 23.6, y: 4.5, hMm: 2.6, bind: "itemName", textCase: "upper" },
  { id: "yds", type: "field", x: 97, y: 4, hMm: 4.4, bind: "lengthMeters", align: "right", fmt: { to: "yd", unit: "yds", decimals: 2 } },
  { id: "mt", type: "field", x: 97, y: 11, hMm: 4.4, bind: "lengthMeters", align: "right", fmt: { unit: "mt", padInt: 2, decimals: 2 } },
  { id: "kg", type: "field", x: 97, y: 18, hMm: 4.4, bind: "weightKg", align: "right", fmt: { unit: "kg", decimals: 2 } },
  { id: "q2", type: "text", x: 3, y: 30, hMm: 3, text: "2. KALITE", showIf: { field: "qualityGrade", op: "in", values: ["2.KALITE"] } },
  { id: "bc", type: "code128", x: 3, y: 28, hMm: 12, human: true },
] as unknown as LabelElement[];

async function main(): Promise<void> {
  console.log("\n[§1] applyTamburDraft");
  const d = applyTamburDraft(PARENT, { lengthMeters: 7, weightKg: 1.42, widthCm: 280, qualityGrade: "2.KALITE" });
  check("§1 taslak metre çocuğa", d.lengthMeters === 7);
  check("§1 taslak kg çocuğa", d.weightKg === 1.42);
  check("§1 taslak en çocuğa", d.widthCm === 280);
  check("§1 taslak kalite kodu", d.qualityGrade === "2.KALITE");
  check("§1 ana topun barkodu basılmaz", d.barcode === "", JSON.stringify(d.barcode));
  const e = applyTamburDraft(PARENT, {});
  check("§1 boş metre = kalanı kes (ana kalan)", e.lengthMeters === 170);
  check("§1 tartılmamış çocukta kg yok (ana kg sızmaz)", e.weightKg === null);
  check("§1 boş en = kaynak en", e.widthCm === 300);
  check("§1 kalitesiz taslak boş kod", e.qualityGrade === "");

  console.log("\n[§2] composeCanvasElements ↔ HTML render");
  const els = composeCanvasElements(ELEMENTS, d, { language: "RASTER_HTML", heightMm: 58, dpi: 203 });
  const html = buildCanvasLabelHtml({ payload: d, format: FORMAT, copies: 1, layout: { v: 1, elements: ELEMENTS }, barcodeSvg: "", qrSvg: "" });
  const texts = els.filter((x): x is Extract<typeof x, { type: "text" }> => x.type === "text");
  check("§2 yds biçimi", texts.some((t) => t.text === "7,66 yds"), texts.map((t) => t.text).join(" | "));
  check("§2 mt biçimi (sıfır dolgu)", texts.some((t) => t.text === "07,00 mt"));
  check("§2 kg biçimi", texts.some((t) => t.text === "1,42 kg"));
  check("§2 harf dönüşümü", texts.some((t) => t.bind === "itemName" && t.text === "PERDE TUL"));
  const missing = texts.filter((t) => !html.includes(t.text));
  check("§2 her metin HTML render'ında birebir var", missing.length === 0, missing.map((t) => t.text).join(", "));
  check("§2 showIf taslak kaliteden (2. kalite damgası görünür)", texts.some((t) => t.text === "2. KALITE"));
  const e1 = composeCanvasElements(ELEMENTS, applyTamburDraft(PARENT, { qualityGrade: "1.KALITE" }), { language: "RASTER_HTML", heightMm: 58, dpi: 203 });
  check("§2 showIf 1. kalitede gizli", !e1.some((x) => x.type === "text" && x.text === "2. KALITE"));
  const bc = els.find((x) => x.type === "code128");
  check("§2 barkod yer tutucu (value null)", !!bc && bc.type === "code128" && bc.value === null);
  check("§2 sabit metin bind taşımaz", texts.some((t) => t.text === "DESING" && t.bind === null));
  check("§2 alan elemanı bind taşır", texts.filter((t) => t.bind === "lengthMeters").length === 2);
  check("§2 sağa hizalama korunur", texts.some((t) => t.bind === "weightKg" && t.align === "right"));
  check("§2 çizgi elemanı geçer", els.some((x) => x.type === "line"));
  const noKg = composeCanvasElements(ELEMENTS, applyTamburDraft(PARENT, {}), { language: "RASTER_HTML", heightMm: 58, dpi: 203 });
  check("§2 kg yoksa kg elemanı çizilmez", !noKg.some((x) => x.type === "text" && x.bind === "weightKg"));

  console.log("\n[§3] uç sözleşmesi");
  const routes = readFileSync(join(__dirname, "../src/routes/tambur.routes.ts"), "utf8");
  const block = routes.slice(routes.indexOf('"/label-preview",'), routes.indexOf('"/label-preview",') + 200);
  check("§3 uç var", routes.includes('"/label-preview",'));
  check("§3 izin preview-fields ile aynı", block.includes('requireAnyPermission("quality:read", "mobile:tambur")'), block.slice(0, 120));
  check("§3 route prisma import etmez", !/from "\.\.\/lib\/prisma"/.test(routes));
  const svc = readFileSync(join(__dirname, "../src/services/tambur/label-preview.ts"), "utf8");
  const pure = readFileSync(join(__dirname, "../src/services/tambur/label-preview-compose.ts"), "utf8");
  check("§3 servis yazmaz (create/update/delete/upsert yok)", !/\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(/.test(svc + pure));
  check("§3 metin baskı fonksiyonundan (elementText)", /elementText\(el, payload\)/.test(pure));
  check("§3 servis saf kompozisyonu çağırır", /composeCanvasElements\(/.test(svc) && /applyTamburDraft\(/.test(svc));
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(() => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
  });
