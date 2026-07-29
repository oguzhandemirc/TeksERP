// =============================================================================
// Yeni belgeler testi — Fason Kabul / Kalite Sert. / Packing / Invoice / İade
// + Serbest Belge CRUD + render
// =============================================================================
// Çalıştır: npx tsx scripts/test_new_documents.ts
// =============================================================================

import prisma from "../src/lib/prisma";
import { PrintedDocType } from "@prisma/client";
import { printedDocumentService } from "../src/services/printed-document.service";
import "../src/services/shipping.service";
import "../src/services/subcontractor.service";
import "../src/services/kartela.service";
import "../src/services/return.service";
import { freeDocumentService } from "../src/services/free-document.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) { pass++; console.log(`✅ ${label}`); }
  else { fail++; console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function main(): Promise<void> {
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!admin) throw new Error("Seed admin yok — önce npm run seed");
  const uid = admin.id;

  // ── Örnek render içerik kontrolleri ──────────────────────────────────────
  const receipt = await printedDocumentService.renderSampleHtml(PrintedDocType.SUBCONTRACTOR_RECEIPT, null);
  check("Fason Kabul: başlık + makbuz no", receipt.includes("FASON KABUL MAKBUZU") && receipt.includes("SR-2606-000045"));
  check("Fason Kabul: uygulanan renk/apre", receipt.includes("Bej") && receipt.includes("Yanmazlık Apresi"));

  const cert = await printedDocumentService.renderSampleHtml(PrintedDocType.QUALITY_CERTIFICATE, null);
  check("Kalite Sert.: başlık + kalite dağılımı", cert.includes("KALİTE SERTİFİKASI") && cert.includes("KALİTE"));
  check("Kalite Sert.: beyan metni", cert.includes("beyan ederiz"));

  const ret = await printedDocumentService.renderSampleHtml(PrintedDocType.RETURN_DISPATCH, null);
  check("İade İrsaliyesi: başlık + iade no", ret.includes("İADE İRSALİYESİ") && ret.includes("IADE-"));
  check("İade İrsaliyesi: neden + teslim alan", ret.includes("Renk uyumsuzluğu") && ret.includes("Ayşe Kaya"));

  // ── Serbest Belge CRUD + render ──────────────────────────────────────────
  let freeId: string | null = null;
  try {
    const created = await freeDocumentService.create(
      { title: "TEST Teslim Tutanağı", recipient: "Örnek A.Ş.", body: "Bu bir test gövdesidir.\nİkinci satır.", config: { showLogo: false, stamps: { printedAt: true } } },
      uid,
    );
    const fd = created.data as { id: string; documentNo: string };
    freeId = fd.id;
    check("Serbest Belge: oluşturuldu + SB numarası", Boolean(fd.id) && fd.documentNo.startsWith("SB"));

    const html = (await freeDocumentService.renderHtml(fd.id, { printedBy: "admin" })).data.html;
    check("Serbest Belge: render başlık + muhatap + gövde", html.includes("TEST Teslim Tutanağı") && html.includes("Örnek A.Ş.") && html.includes("İkinci satır."));
    check("Serbest Belge: basım damgası (stamps.printedAt)", html.includes("Basım:"));

    // Güncelle → render değişir.
    await freeDocumentService.update(fd.id, { body: "Güncellenmiş gövde metni." }, uid);
    const html2 = (await freeDocumentService.renderHtml(fd.id)).data.html;
    check("Serbest Belge: güncelleme render'a yansır", html2.includes("Güncellenmiş gövde metni.") && !html2.includes("İkinci satır."));

    // Pasifleştir → aktif listeden düşer.
    await freeDocumentService.deactivate(fd.id, uid);
    const active = (await freeDocumentService.list(false)).data as { id: string }[];
    check("Serbest Belge: pasifleşince aktif listeden düşer", !active.some((d) => d.id === fd.id));
  } finally {
    if (freeId) await prisma.freeDocument.delete({ where: { id: freeId } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error("Test hata:", err); process.exit(1); }).finally(() => prisma.$disconnect());
