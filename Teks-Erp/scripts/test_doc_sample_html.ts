// =============================================================================
// TEST: Belge Şablonu "sample-html" önizleme yolları (entegrasyon, fixture'sız)
// Çalıştır: npx tsx scripts/test_doc_sample_html.ts
// =============================================================================
// renderSampleHtml her belge tipi için: (a) renderHtml REGISTRY'de kayıtlı mı,
// (b) örnek `doc` şekli renderer'la uyumlu mu, (c) docConfig override renderer'a
// akıyor mu, (d) TASLAK filigranı basılıyor mu — refakat kartında ek olarak (e)
// SUNUCU QR (bwip-js SVG) gömülüyor mu. DB'den yalnız firma/künye ayarını OKUR;
// kayıt/fixture YOK. (Builder kayıtları domain servis import yan etkisiyle olur.)
// =============================================================================

import prisma from "../src/lib/prisma";
import { PrintedDocType } from "@prisma/client";
import { printedDocumentService } from "../src/services/printed-document.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { DEFAULT_TRAVELER_CARD_CONFIG } from "../src/services/system-setting.service";
// Builder + renderHtml kayıtları SADECE bu servisler import edilince çalışır.
import "../src/services/shipping.service"; // SHIPMENT_DISPATCH
import "../src/services/subcontractor.service"; // SUBCONTRACTOR_DISPATCH + DIRECT_SHIP
import "../src/services/kartela.service"; // KARTELA_DISPATCH

let pass = 0,
  fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const CASES: { dt: PrintedDocType; title: string; no: string }[] = [
  { dt: PrintedDocType.SHIPMENT_DISPATCH, title: "SEVK İRSALİYESİ", no: "SVK-2026-0042" },
  { dt: PrintedDocType.SUBCONTRACTOR_DISPATCH, title: "KUMAŞ İRSALİYESİ", no: "FSN-2026-0231" },
  { dt: PrintedDocType.SUBCONTRACTOR_DIRECT_SHIP, title: "DOĞRUDAN SEVK İRSALİYESİ", no: "DSF-2026-0012" },
  { dt: PrintedDocType.KARTELA_DISPATCH, title: "KARTELA ÇEKİ LİSTESİ", no: "KRT-2026-0058" },
];

async function run(): Promise<void> {
  console.log("\n=== PrintedDoc sample-html (4 belge) ===");
  for (const c of CASES) {
    const html = await printedDocumentService.renderSampleHtml(c.dt, null);
    check(`${c.dt}: HTML üretti`, html.length > 500, `len=${html.length}`);
    check(`${c.dt}: başlık`, html.includes(c.title));
    check(`${c.dt}: örnek belge no`, html.includes(c.no));
    check(`${c.dt}: TASLAK filigranı`, html.includes("TASLAK"));
  }

  // Config override renderer'a akıyor mu (titleOverride örneği).
  const overridden = await printedDocumentService.renderSampleHtml(
    PrintedDocType.KARTELA_DISPATCH,
    { titleOverride: "ÖRNEK-TASLAK-FİŞ" },
  );
  check("config override → titleOverride uygulandı", overridden.includes("ÖRNEK-TASLAK-FİŞ"));
  const sectionOff = await printedDocumentService.renderSampleHtml(
    PrintedDocType.KARTELA_DISPATCH,
    { sections: { rollTable: false } },
  );
  check("config override → sections.rollTable=false gizledi", !sectionOff.includes("Gönderilen Toplar"));

  console.log("\n=== Refakat kartı sample-html (+ sunucu QR) ===");
  const cards = new TravelerCardService();
  const tHtml = await cards.renderSampleHtml(DEFAULT_TRAVELER_CARD_CONFIG);
  check("traveler: HTML üretti", tHtml.length > 500, `len=${tHtml.length}`);
  check("traveler: REFAKAT KARTI başlık", tHtml.includes("REFAKAT KARTI"));
  check("traveler: TASLAK filigranı", tHtml.includes("TASLAK"));
  check("traveler: GÖMÜLÜ SUNUCU QR (bwip svg)", tHtml.includes("<svg"));
  const tCfg = await cards.renderSampleHtml({ ...DEFAULT_TRAVELER_CARD_CONFIG, companyName: "Test Tekstil A.Ş." });
  check("traveler: config.companyName uygulandı", tCfg.includes("Test Tekstil A.Ş."));
  const tNoGrid = await cards.renderSampleHtml({ ...DEFAULT_TRAVELER_CARD_CONFIG, showOperationGrid: false });
  check("traveler: showOperationGrid=false gizledi", !tNoGrid.includes("OPERASYON KAYDI"));
}

async function main(): Promise<void> {
  try {
    await run();
  } finally {
    console.log("──────────────────────────────────────────");
    console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
