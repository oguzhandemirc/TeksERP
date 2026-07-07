// =============================================================================
// Test: etiket format çözümü (resolveLabelFormat) öncelik zinciri — Etiket Stüdyosu v2
// Çalıştır: npx tsx scripts/test_label_format_resolver.ts
// Doğrulananlar: explicit peripheralId (cihaz medyası) > machineId (makineye-bağlı
// LABEL_PRINTER cihaz medyası) > sistem-default (label.defaultMedia) > kod-fallback.
// Medya artık CİHAZDA (labelWidthMm/labelHeightMm/labelDpi/labelGapMm); ayrı "Boyutlar"
// (LabelFormatProfile) kataloğu EMEKLİ. Orientation w≥h → LANDSCAPE. Dil bu katmanda
// HEP RASTER_HTML (yalnız cihaz languageOverride'ından biner).
// =============================================================================
import prisma from "../src/lib/prisma";
import { resolveLabelFormat } from "../src/services/helpers/label-format.resolver";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

async function main() {
  const ts = Date.now();
  const station = await prisma.station.create({
    data: { code: `TST-RES-ST-${ts}`, name: "TEST RES İST", type: "INTERNAL" },
    select: { id: true },
  });
  const machine = await prisma.machine.create({
    data: { stationId: station.id, code: `TST-RES-M-${ts}`, name: "TEST RES MAK" },
    select: { id: true },
  });
  // Makineye-bağlı yazıcı: medya CİHAZDA (110×160, 203dpi, gap 3).
  const printer = await prisma.peripheralDevice.create({
    data: {
      code: `RES-PRN-${ts}`, name: "TEST RES YAZICI", kind: "LABEL_PRINTER",
      connectionType: "NETWORK_TCP", machineId: machine.id,
      languageOverride: "PPLA", address: "10.0.0.9",
      labelWidthMm: 110, labelHeightMm: 160, labelDpi: 203, labelGapMm: 3,
    },
    select: { id: true },
  });
  // Medyasız (labelWidthMm null) ikinci bir aktif yazıcı — çözümü etkilememeli
  // (fromPeripheralMedia null döner → zincir sistem-default'a düşer). Test için
  // ayrı makineye bağla ki 1. yazıcıyı gölgelemesin.

  try {
    // 1) explicit peripheralId → cihaz medyası (110×160), source explicit
    const r1 = await resolveLabelFormat({ peripheralId: printer.id });
    check("explicit peripheralId → cihaz medyası", r1.widthMm === 110 && r1.heightMm === 160 && r1.source === "explicit");
    check("explicit → dpi cihazdan (203)", r1.dpi === 203, String(r1.dpi));
    check("explicit → orientation w≥h LANDSCAPE mı? (110<160 → PORTRAIT)", r1.orientation === "PORTRAIT", r1.orientation);
    check("explicit → dil RASTER_HTML (yalnız cihazdan biner)", r1.language === "RASTER_HTML", r1.language);

    // 2) machineId → makineye-bağlı cihazın medyası (110×160), source machine
    const r2 = await resolveLabelFormat({ machineId: machine.id });
    check("machineId → makine yazıcısı medyası", r2.widthMm === 110 && r2.heightMm === 160 && r2.source === "machine");

    // 3) cihaz medyası boşalınca → machineId sistem-default'a düşer
    await prisma.peripheralDevice.update({
      where: { id: printer.id },
      data: { labelWidthMm: null, labelHeightMm: null, labelDpi: null, labelGapMm: null },
    });
    const r3 = await resolveLabelFormat({ machineId: machine.id });
    check("cihaz medyası yok → sistem-default'a düşer", r3.source === "system-default", r3.source);
    check("sistem-default → geçerli geometri (width>0)", r3.widthMm > 0 && r3.marginMm >= 0);

    // 4) explicit peripheralId ama medyasız → yine sistem-default (explicit medya yoksa atlanır)
    const r4 = await resolveLabelFormat({ peripheralId: printer.id });
    check("medyasız explicit cihaz → sistem-default", r4.source === "system-default", r4.source);

    // 5) opts yok → sistem-default (seed'li label.defaultMedia) veya kod-fallback
    const r5 = await resolveLabelFormat();
    check("opts yok → system-default/code-fallback", r5.source === "system-default" || r5.source === "code-fallback", r5.source);
    check("opts yok → orientation w/h'den türer", r5.orientation === (r5.widthMm >= r5.heightMm ? "LANDSCAPE" : "PORTRAIT"));
  } finally {
    await prisma.peripheralDevice.deleteMany({ where: { id: printer.id } });
    await prisma.machine.deleteMany({ where: { id: machine.id } });
    await prisma.station.deleteMany({ where: { id: station.id } });
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
