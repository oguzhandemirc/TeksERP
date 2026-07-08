// =============================================================================
// Test: çok-dilli native etiket (PPLB/ZPL üreteçleri + registry dispatch +
//       resolver dil davranışı: dil YALNIZ cihazdan, cihazsız → RASTER_HTML)
// Çalıştır: npx tsx scripts/test_label_native_languages.ts
// =============================================================================
import prisma from "../src/lib/prisma";
import { buildRollLabelPpla } from "../src/services/helpers/label-ppla.helper";
import { buildRollLabelPplb } from "../src/services/helpers/label-pplb.helper";
import { buildRollLabelZpl } from "../src/services/helpers/label-zpl.helper";
import { renderLabel } from "../src/services/helpers/label-renderer.registry";
import { resolveLabelFormat } from "../src/services/helpers/label-format.resolver";
import type { ResolvedLabelFormat } from "../src/services/helpers/label-format.resolver";
import type { LabelPayload } from "../src/services/label.service";

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
  barcode: "TEKS20260615XY99", qualityGrade: "1.KALITE", widthCm: 150,
  lengthMeters: 320, weightKg: 40, itemName: "PATOS", colorName: "MAVI",
  customerName: "ACME", batchNumber: "P-1",
} as unknown as LabelPayload;

async function main() {
  // --- PPLB (EPL2) ---
  const pplb = buildRollLabelPplb({ payload, format, copies: 2, template: null });
  check("PPLB: N (buffer temizle)", /^N/m.test(pplb));
  check("PPLB: q<genişlik> + Q<boy>", /q\d+/.test(pplb) && /Q\d+,\d+/.test(pplb));
  check("PPLB: A metin alanı + ürün", /A\d+,\d+,0,\d+,1,1,N,"PATOS"/.test(pplb));
  check("PPLB: B Code128 + barkod", /B\d+,\d+,0,1,/.test(pplb) && pplb.includes("TEKS20260615XY99"));
  check("PPLB: b QR", /b\d+,\d+,Q,/.test(pplb));
  check("PPLB: P2 (kopya)", pplb.includes("P2"));

  // --- ZPL ---
  const zpl = buildRollLabelZpl({ payload, format, copies: 3, template: null });
  check("ZPL: ^XA…^XZ frame", zpl.includes("^XA") && zpl.trimEnd().endsWith("^XZ"));
  check("ZPL: ^PW + ^LL", /\^PW\d+/.test(zpl) && /\^LL\d+/.test(zpl));
  check("ZPL: ^FO/^A0N metin + ürün", /\^FO\d+,\d+\^A0N,\d+,\d+\^FDPATOS\^FS/.test(zpl));
  check("ZPL: ^BCN Code128 + barkod", zpl.includes("^BCN") && zpl.includes("TEKS20260615XY99"));
  check("ZPL: ^BQN QR", zpl.includes("^BQN"));
  check("ZPL: ^PQ3 (kopya)", zpl.includes("^PQ3"));

  // --- registry dispatch ---
  const mk = (language: ResolvedLabelFormat["language"]) =>
    renderLabel(language, { payload, template: null, barcodeSvg: "", qrSvg: "", copies: 1, format: { ...format, language } });
  check("registry RASTER_HTML → html", mk("RASTER_HTML").content.includes("<!doctype html") && mk("RASTER_HTML").contentType.includes("text/html"));
  check("registry PPLA → STX L", mk("PPLA").content.includes("\x02L") && mk("PPLA").contentType.includes("text/plain"));
  check("registry PPLB → N/q", /^N/m.test(mk("PPLB").content));
  check("registry ZPL → ^XA", mk("ZPL").content.includes("^XA"));

  // --- sanitize: ZPL ^/~ ve PPLB " enjeksiyonu temizlenir ---
  const dirtyZpl = buildRollLabelZpl({ payload: { ...payload, itemName: "A^B~C" } as unknown as LabelPayload, format, copies: 1, template: null });
  check("ZPL sanitize: ^ ~ veriden ayıklandı", dirtyZpl.includes("A B C") && !dirtyZpl.includes("A^B~C"));
  const dirtyPplb = buildRollLabelPplb({ payload: { ...payload, itemName: 'A"B' } as unknown as LabelPayload, format, copies: 1, template: null });
  check("PPLB sanitize: \" veriden ayıklandı", !dirtyPplb.includes('"A"B"'));

  // --- Türkçe → ASCII katlama: latin1 kaybı + komut-baytı enjeksiyonu engellenir ---
  // (Ş latin1'de 0x5E '^' = ZPL öneki; İ→'0'. ASCII'ye katlanınca hem doğru hem güvenli.)
  const tr = { ...payload, itemName: "ÖRNEK İĞNE", colorName: "ŞAHİN MAVİ", customerName: "ÇĞÜ ışık" } as unknown as LabelPayload;
  const isAscii = (s: string) => /^[\x00-\x7f]*$/.test(s) && Buffer.from(s, "latin1").toString("latin1") === s;
  const trZpl = buildRollLabelZpl({ payload: tr, format, copies: 1, template: null });
  const trPpla = buildRollLabelPpla({ payload: tr, format, copies: 1, template: null });
  const trPplb = buildRollLabelPplb({ payload: tr, format, copies: 1, template: null });
  check("Türkçe→ASCII: ZPL saf ASCII (latin1-kayıpsız)", isAscii(trZpl));
  check("Türkçe→ASCII: PPLA saf ASCII", isAscii(trPpla));
  check("Türkçe→ASCII: PPLB saf ASCII", isAscii(trPplb));
  check("Türkçe map doğru (İĞNE→IGNE, ŞAHİN MAVİ→SAHIN MAVI, ÇĞÜ ışık→CGU isik)",
    trZpl.includes("ORNEK IGNE") && trZpl.includes("SAHIN MAVI") && trZpl.includes("CGU isik"));
  // Güvenlik: Ş→S katlandığı için latin1'de '^' (0x5E) üretmez → ZPL/PPLA komut frame'i
  // veriyle bozulamaz. isAscii zaten latin1-dışı/komut-baytı kalmadığını kanıtlar.
  check("güvenlik: PPLA çıktısı tek STX L ile başlar (veri frame bozmadı)", trPpla.indexOf("\x02L") === trPpla.lastIndexOf("\x02L"));

  // --- resolver dil davranışı: global ayar KALDIRILDI (2026-07) ---
  // Dil yalnız cihaz kaydından (languageOverride, routing katmanında) gelir;
  // cihaz bağlamı olmayan format çözümü RASTER_HTML döner → istemciler fail-closed.
  const r = await resolveLabelFormat();
  check("resolver (cihazsız) → RASTER_HTML (fail-closed)", r.language === "RASTER_HTML", r.language);
  const r2 = await resolveLabelFormat({ kind: "SWATCH" });
  check("resolver (cihazsız, SWATCH) → RASTER_HTML", r2.language === "RASTER_HTML");

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
