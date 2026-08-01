// =============================================================================
// Test: uzman raw-code override motoru (applyRawCode + renderLabel + preview).
// Çalıştır: npx tsx scripts/test_label_rawcode.ts
// =============================================================================
import { PrinterLanguage } from "@prisma/client";
import { applyRawCode, readTemplateRawCode, buildRawCodePreview } from "../src/services/helpers/label-rawcode";
import { renderLabel, type LabelRenderInput } from "../src/services/helpers/label-renderer.registry";
import type { LabelPayload } from "../src/services/label.service";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const payload = {
  rollId: "x", barcode: "BC-123", status: "STOCK", qualityGrade: "1. Kalite",
  widthCm: 150, lengthMeters: 47.5, weightKg: 14, markedForKartela: false,
  itemCode: "PA", itemName: "Pamuk", itemNameDefault: "Pamuk", itemNameSource: "DEFAULT",
  colorCode: null, colorName: null, colorNameDefault: null, colorNameSource: null,
  customerName: "Demo A.S.", customerId: null, orderNumber: null, orderLineId: null,
  batchNumber: null, printedAt: new Date().toISOString(),
} as unknown as LabelPayload;

// 1) applyRawCode — ikame
// NEDEN 3. argüman: `applyRawCode` sonradan zorunlu `language` parametresi aldı
// (değer dile göre sanitize ediliyor: ZPL'de `^`/`~`, PPLB'de `"` ayıklanır).
// Test çağrıları 2 argümanda kaldığı için `language` runtime'da `undefined` oluyor
// ve sanitize `default` dalına düşüyordu — yani bu beş kontrol ZPL yolunu DEĞİL,
// dilsiz yolu ölçüyordu. (Aşağıdaki değerlerde `^`/`~` bulunmadığı için sonuçlar
// aynı çıkıyordu; bu yüzden kimse fark etmedi.) Dosyanın geri kalanı da ZPL
// varsayıyor (readTemplateRawCode + fmt.language) → tutarlı olan ZPL.
check("{{barcode}} ikame edilir", applyRawCode("^FD{{barcode}}^FS", payload, PrinterLanguage.ZPL) === "^FDBC-123^FS");
check("{{itemName}} ikame edilir", applyRawCode("[{{itemName}}]", payload, PrinterLanguage.ZPL) === "[Pamuk]");
check("{{lengthMeters}} formatlı (birim m)", applyRawCode("{{lengthMeters}}", payload, PrinterLanguage.ZPL) === "47,5 m", applyRawCode("{{lengthMeters}}", payload, PrinterLanguage.ZPL));
check("bilinmeyen {{foo}} → boş", applyRawCode("a{{foo}}b", payload, PrinterLanguage.ZPL) === "ab");
check("boşluklu {{ barcode }} de çalışır", applyRawCode("{{ barcode }}", payload, PrinterLanguage.ZPL) === "BC-123");

// 2) readTemplateRawCode
check("readTemplateRawCode ZPL döner", readTemplateRawCode({ ZPL: "^XA" }, PrinterLanguage.ZPL) === "^XA");
check("boş string → null", readTemplateRawCode({ ZPL: "  " }, PrinterLanguage.ZPL) === null);
check("yok → null", readTemplateRawCode(null, PrinterLanguage.ZPL) === null);

// 3) renderLabel — override varsa kendi kodu, yoksa otomatik üretim
// (renderLabel 2026-07 icon işiyle ASYNC oldu → await'li main içinde.)
const fmt = { widthMm: 100, heightMm: 58, marginMm: 3, gapMm: 2, dpi: 203, orientation: "LANDSCAPE", language: "ZPL" } as unknown as LabelRenderInput["format"];
const base: LabelRenderInput = { payload, template: null, barcodeSvg: "<svg/>", qrSvg: "<svg/>", copies: 1, format: fmt };

async function main() {
  const withOverride = await renderLabel(PrinterLanguage.ZPL, { ...base, template: { rawCode: { ZPL: "^XA{{barcode}}^XZ" } } as unknown as LabelRenderInput["template"] });
  // Native raw-code CRLF'e normalize edilir + sona CRLF eklenir (yazıcı basar) → trim ile karşılaştır.
  check("override → kendi ZPL kodu basılır", withOverride.content.trim() === "^XABC-123^XZ", JSON.stringify(withOverride.content));
  check("native override sonda CRLF ile biter", withOverride.content.endsWith("\r\n"));
  check("override dil = ZPL", withOverride.language === "ZPL");

  const noOverride = await renderLabel(PrinterLanguage.ZPL, { ...base, template: { rawCode: null } as unknown as LabelRenderInput["template"] });
  check("override yok → otomatik üretim (kendi kodu DEĞİL)", noOverride.content !== "^XABC-123^XZ" && noOverride.content.length > 0);

  // override yalnız o dil için: PPLA isteğinde ZPL override kullanılmaz
  const onlyZpl = await renderLabel(PrinterLanguage.PPLA, { ...base, template: { rawCode: { ZPL: "^XA{{barcode}}^XZ" } } as unknown as LabelRenderInput["template"] });
  check("ZPL override PPLA isteğini etkilemez", onlyZpl.content !== "^XABC-123^XZ");

  // 4) buildRawCodePreview
  const prev = buildRawCodePreview("ROLL_RAW" as never, PrinterLanguage.ZPL, "{{barcode}}");
  check("preview {{barcode}} → örnek barkod", prev.content.includes("T120726F0001"), prev.content);
  check("preview native contentType text/plain", prev.contentType.startsWith("text/plain"));
  const prevHtml = buildRawCodePreview("ROLL_RAW" as never, PrinterLanguage.RASTER_HTML, "<b>{{itemName}}</b>");
  check("preview HTML ikame + contentType", prevHtml.content === "<b>Cotton Lining 60s</b>" && prevHtml.contentType.startsWith("text/html"), prevHtml.content);

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("HATA:", e); process.exit(1); });
