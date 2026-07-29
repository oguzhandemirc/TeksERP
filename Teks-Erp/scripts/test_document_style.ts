// =============================================================================
// Belge stil katmanı + logo testi (Faz 1 — belge kişiselleştirme)
// =============================================================================
// Kapsam:
//   1) sanitizeDocumentsConfig: style/showLogo/logoPosition alanlarını korur+clamp'ler
//   2) resolveDocStyle: varsayılanlar + clamp
//   3) 4 belge renderer'ı: pageSize/margin/fontScale/tablo stili CSS'e yansır
//   4) Logo: setDocumentsLogo → renderSampleHtml'de <img class="doc-logo">;
//      kaldırınca basılmaz; kütüphane append-only (eski hash yaşar)
// Çalıştır: npx tsx scripts/test_document_style.ts
// =============================================================================

import prisma from "../src/lib/prisma";
import { PrintedDocType } from "@prisma/client";
import { printedDocumentService } from "../src/services/printed-document.service";
// Builder kayıtları side-effect ile yüklenir (registerPrintedDocBuilder çağrıları).
import "../src/services/shipping.service";
import "../src/services/subcontractor.service";
import "../src/services/kartela.service";
import "../src/services/return.service";
import {
  systemSettingService,
  readDocumentsLogo,
  type DocumentConfig,
} from "../src/services/system-setting.service";
import { resolveDocStyle, sanitizeDocStyleConfig } from "../src/services/document-render/doc-style";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// 1x1 kırmızı PNG (67 byte) — geçerli data-url.
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const STYLE_CFG: DocumentConfig = {
  style: {
    pageSize: "A5",
    margins: { top: 12, right: 12, bottom: 12, left: 12 },
    fontScale: 1.2,
    fontWeight: "bold",
    tableDensity: "compact",
    tableStyle: "zebra",
  },
};

async function main(): Promise<void> {
  // ── 1) sanitize ──────────────────────────────────────────────────────────
  const sane = sanitizeDocStyleConfig({
    pageSize: "A5",
    margins: { top: 99, left: -3, right: "x" },
    fontScale: 9,
    fontWeight: "bold",
    tableDensity: "hatalı",
    tableStyle: "zebra",
    bilinmeyen: true,
  });
  check("sanitize: pageSize/A5 korunur", sane?.pageSize === "A5");
  check("sanitize: margin clamp (99→40, -3→0)", sane?.margins?.top === 40 && sane?.margins?.left === 0);
  check("sanitize: tip uymayan margin atılır", sane?.margins?.right === undefined);
  check("sanitize: fontScale clamp (9→1.4)", sane?.fontScale === 1.4);
  check("sanitize: geçersiz tableDensity atılır", sane?.tableDensity === undefined);
  check("sanitize: bilinmeyen alan sızmaz", !("bilinmeyen" in (sane ?? {})));
  check("sanitize: boş obje → undefined", sanitizeDocStyleConfig({}) === undefined);

  // ── 2) resolve ───────────────────────────────────────────────────────────
  const r0 = resolveDocStyle(undefined, { marginMm: 9 });
  check("resolve: eski snapshot (style yok) → A4/9mm/ölçek1", r0.pageSize === "A4" && r0.margins.top === 9 && r0.fontScale === 1 && r0.tableStyle === "grid");
  const r1 = resolveDocStyle(STYLE_CFG.style, { marginMm: 9 });
  check("resolve: A5/12mm/1.2/bold(+100)/compact/zebra", r1.pageSize === "A5" && r1.margins.top === 12 && r1.fontScale === 1.2 && r1.weightDelta === 100 && r1.tableDensity === "compact" && r1.tableStyle === "zebra");

  // ── 3) 4 renderer'da stil CSS'i ─────────────────────────────────────────
  for (const docType of Object.values(PrintedDocType)) {
    const html = await printedDocumentService.renderSampleHtml(docType, STYLE_CFG);
    check(`${docType}: @page A5 + 12mm margin`, html.includes("size: A5") && html.includes("margin: 12mm 12mm 12mm 12mm"));
    // body 11px × 1.2 = 13.2px (scaleDocCss)
    check(`${docType}: fontScale uygulanmış (13.2px)`, html.includes("font-size: 13.2px"));
    check(`${docType}: zebra kuralı basılmış`, html.includes(":nth-child(even)"));
  }
  // Stil YOKKEN görünüm değişmemeli (geriye uyum).
  const plainHtml = await printedDocumentService.renderSampleHtml(PrintedDocType.SHIPMENT_DISPATCH, null);
  check("stilsiz: A4 + 9mm default korunur", plainHtml.includes("size: A4") && plainHtml.includes("margin: 9mm 9mm 9mm 9mm"));
  check("stilsiz: 11px taban korunur", plainHtml.includes("font-size: 11px"));

  // ── 4) logo ──────────────────────────────────────────────────────────────
  // set() audit için kullanıcı ister — seed admin'i business-key ile çöz.
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!admin) throw new Error("Seed admin kullanıcısı yok — önce npm run seed");
  const uid = admin.id;
  const before = await readDocumentsLogo();
  try {
    await systemSettingService.setDocumentsLogo(TINY_PNG, uid);
    const withLogo = await printedDocumentService.renderSampleHtml(PrintedDocType.SHIPMENT_DISPATCH, null);
    check("logo: yüklenince belgede basılır", withLogo.includes('class="doc-logo"'));
    const posRight = await printedDocumentService.renderSampleHtml(PrintedDocType.SHIPMENT_DISPATCH, { logoPosition: "right" });
    check("logo: sağ konum da basılır", posRight.includes('class="doc-logo"'));
    const hidden = await printedDocumentService.renderSampleHtml(PrintedDocType.SHIPMENT_DISPATCH, { showLogo: false });
    check("logo: showLogo=false → basılmaz", !hidden.includes('class="doc-logo"'));

    const lib = await readDocumentsLogo();
    check("logo: current hash set", Boolean(lib.current && lib.items[lib.current] === TINY_PNG));

    await systemSettingService.setDocumentsLogo(null, uid);
    const removed = await printedDocumentService.renderSampleHtml(PrintedDocType.SHIPMENT_DISPATCH, null);
    check("logo: kaldırınca basılmaz", !removed.includes('class="doc-logo"'));
    const libAfter = await readDocumentsLogo();
    check("logo: kütüphane append-only (hash yaşar)", Boolean(lib.current && libAfter.items[lib.current!] === TINY_PNG));

    // Geçersiz girişler.
    let rejected = false;
    try {
      await systemSettingService.setDocumentsLogo("data:text/html;base64,PGI+", uid);
    } catch {
      rejected = true;
    }
    check("logo: image-dışı data-url reddedilir", rejected);
    rejected = false;
    try {
      await systemSettingService.setDocumentsLogo(`data:image/png;base64,${"A".repeat(200_001)}`, uid);
    } catch {
      rejected = true;
    }
    check("logo: boyut sınırı aşımı reddedilir", rejected);
  } finally {
    // Orijinal current'ı geri koy (items append-only — hash varsa geçerli).
    if (before.current && before.items[before.current]) {
      await systemSettingService.setDocumentsLogo(before.items[before.current], uid);
    } else {
      await systemSettingService.setDocumentsLogo(null, uid);
    }
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main()
  .catch((err) => {
    console.error("Test hata:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
