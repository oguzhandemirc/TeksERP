// getCanvasPreview cihaz (peripheralId) → dil çözümü doğrulaması.
// Editör Test Baskısı'nda seçili Cihaz Kaydı yazıcısının dili (ör. Argox PPLB)
// gerçekten native dile çözülüyor mu; cihazsız çağrı eski RASTER_HTML davranışını
// koruyor mu? Server GEREKMEZ — servis + prisma doğrudan. `npx tsx scripts/...`.

import prisma from "../src/lib/prisma";
import { LabelTemplateService } from "../src/services/label-template.service";
import { PrinterLanguage, LabelKind } from "@prisma/client";
import type { CanvasLayout } from "../src/config/label-elements";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${label}`);
  ok ? pass++ : fail++;
}

// Minimal geçerli yerleşim — taranabilir alan (code128) zorunlu.
const layout: CanvasLayout = {
  v: 1,
  elements: [{ id: "bc", type: "code128", x: 3, y: 10, hMm: 9, human: true }],
};

const TEST_CODE = `TEST-CANVAS-PPLB-${process.pid}`;
let createdId: string | null = null;

async function main() {
  const svc = new LabelTemplateService();

  // Kendi PPLB LABEL_PRINTER cihazını yarat (taze DB'de de çalışsın; finally'de silinir).
  const pplbDevice = await prisma.peripheralDevice.create({
    data: {
      code: TEST_CODE,
      name: "TEST Argox PPLB (USB)",
      kind: "LABEL_PRINTER",
      connectionType: "USB",
      languageOverride: PrinterLanguage.PPLB,
      labelDpi: 203,
    },
    select: { id: true, name: true },
  });
  createdId = pplbDevice.id;
  check("fixture: PPLB LABEL_PRINTER cihazı yaratıldı", !!pplbDevice);
  console.log(`   → cihaz: ${pplbDevice.name} (${pplbDevice.id})`);

  const base = { kind: LabelKind.ROLL_FINISHED, widthMm: 100, heightMm: 58, elements: layout };

  // 1) Cihazlı: dil PPLB, mode native (html DEĞİL).
  const withDev = await svc.getCanvasPreview({ ...base, peripheralId: pplbDevice.id });
  check("cihazlı: dil = PPLB", withDev.data.language === PrinterLanguage.PPLB);
  check("cihazlı: mode native (html değil)", withDev.data.mode !== "html");
  check("cihazlı: native içerik dolu", withDev.data.native.length > 0);

  // 2) Cihazsız: eski davranış korunur → RASTER_HTML (regresyon güvencesi).
  const noDev = await svc.getCanvasPreview(base);
  check("cihazsız: dil = RASTER_HTML (eski davranış)", noDev.data.language === PrinterLanguage.RASTER_HTML);
  check("cihazsız: mode = html", noDev.data.mode === "html");

  // 3) Explicit language cihaz dilini EZER (öncelik: language > cihaz override).
  const forced = await svc.getCanvasPreview({ ...base, peripheralId: pplbDevice.id, language: PrinterLanguage.ZPL });
  check("explicit language cihazı ezer: dil = ZPL", forced.data.language === PrinterLanguage.ZPL);
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    // Test kendi yarattığını siler (fiziksel DELETE — kalıcı test cihazı bırakmayalım).
    if (createdId) {
      await prisma.peripheralDevice.delete({ where: { id: createdId } }).catch(() => {});
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
