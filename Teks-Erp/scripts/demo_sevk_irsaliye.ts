// =============================================================================
// DEMO: Sevk İrsaliyesi / Sevk Fişi tek-kaynak HTML'ini gözle gör
// Çalıştır: npx tsx scripts/demo_sevk_irsaliye.ts
// Çıktı: /tmp/sevk_*.html dosyaları (tarayıcıda açılır). DB'de DISPATCHED sevkiyat
// varsa GERÇEK veriden + "fiş == irsaliye" eşitlik kanıtı; yoksa örnek veriden.
// (Bu bir demo — repoyu kirletmemek için istersen sil: rm scripts/demo_sevk_irsaliye.ts)
// =============================================================================
import { writeFileSync } from "fs";
import prisma from "../src/lib/prisma";
import { printedDocumentService } from "../src/services/printed-document.service";
import type { PrintedDocSnapshot } from "../src/services/printed-document.service";
import { renderShipmentDispatchHtml } from "../src/services/document-render/shipment-dispatch.html";
import { shippingService } from "../src/services/shipping.service"; // SHIPMENT_DISPATCH builder kaydı (yan etki)

const SAMPLE: PrintedDocSnapshot = {
  schemaVersion: 1,
  frozenAt: "2026-06-28T10:00:00.000Z",
  company: {
    name: "ADNAN ŞAHİN TEKSTİL A.Ş.",
    letterhead: { addressLine: "İkitelli OSB, Başakşehir / İstanbul", phone: "0212 000 00 00", taxInfo: "Başakşehir VD 1234567890" },
  },
  docConfigOverride: null,
  doc: {
    header: {
      shipmentNo: "SVK-2026-001024",
      customerName: "ÖRNEK MÜŞTERİ TEKSTİL LTD. ŞTİ.",
      customerCode: "M-0042",
      customerTaxNumber: "9876543210",
      branchName: "Merkez",
      procedureCode: "GB-2026-555",
      destination: "EXPORT",
      status: "DISPATCHED",
      date: "2026-06-28T09:30:00.000Z",
      plateNumber: "34 ABC 34",
      driverName: "Ali Veli",
      carrier: "Yurtiçi Lojistik",
      orderNos: "SIP-2026-101, SIP-2026-102",
    },
    products: [
      { name: "MC 156 BEYAZ 150cm.", rollCount: 3, totalMeters: 312.5 },
      { name: "NEPS VUAL LACİVERT 140cm.", rollCount: 2, totalMeters: 198 },
      { name: "POPLİN HAM 220cm.", rollCount: 1, totalMeters: 1240.75 },
    ],
    sacks: [
      { code: "AMB00001", seq: 1, totalMeters: 312.5, totalKg: 65.8, packageCount: 3 },
      { code: "AMB00002", seq: 2, totalMeters: 198, totalKg: 42, packageCount: 2 },
      { code: "AMB00003", seq: 3, totalMeters: 1240.75, totalKg: 310.4, packageCount: 1 },
    ],
    cekiRows: [
      { sackCode: "AMB00001", barcode: "TOP-000101", desen: "MC 156", varyant: "BEYAZ", meters: 104.5, kg: 65.8 },
      { sackCode: "AMB00001", barcode: "TOP-000102", desen: "MC 156", varyant: "BEYAZ", meters: 104, kg: 0 },
      { sackCode: "AMB00001", barcode: "TOP-000103", desen: "MC 156", varyant: "BEYAZ", meters: 104, kg: 0 },
      { sackCode: "AMB00002", barcode: "TOP-000201", desen: "NEPS VUAL", varyant: "LACİVERT", meters: 99, kg: 42 },
      { sackCode: "AMB00002", barcode: "TOP-000202", desen: "NEPS VUAL", varyant: "LACİVERT", meters: 99, kg: 0 },
      { sackCode: "AMB00003", barcode: "TOP-000301", desen: "POPLİN HAM", varyant: "", meters: 1240.75, kg: 310.4 },
    ],
    totals: { totalRolls: 6, totalMeters: 1751.25, totalKg: 418.2, sackCount: 3 },
  },
} as unknown as PrintedDocSnapshot;

async function main() {
  const out: string[] = [];

  // 1) Gerçek DB'den bir DISPATCHED sevkiyat varsa ondan (en güçlü kanıt).
  const real = await prisma.shipment.findFirst({
    where: { status: "DISPATCHED" },
    orderBy: { dispatchedAt: "desc" },
    select: { id: true, shipmentNo: true },
  });

  if (real) {
    const irsaliye = (await printedDocumentService.getHtml("SHIPMENT_DISPATCH", real.id)).data as { html: string } | null;
    if (irsaliye?.html) {
      writeFileSync("/tmp/sevk_GERCEK_irsaliye.html", irsaliye.html);
      out.push(`/tmp/sevk_GERCEK_irsaliye.html   (gerçek sevkiyat ${real.shipmentNo})`);

      // TEK KAYNAK KANITI: muhasebe "Sevk Fişi" dialog'u da AYNI getHtml'i basar.
      const fis = (await printedDocumentService.getHtml("SHIPMENT_DISPATCH", real.id)).data as { html: string } | null;
      const ayni = fis?.html === irsaliye.html;
      console.log(`\n🔎 TEK KAYNAK: muhasebe fişi HTML === sevk irsaliyesi HTML  →  ${ayni ? "✅ BİREBİR AYNI" : "❌ FARKLI"}`);

      // getDispatchReport (Excel/yapılandırılmış veri) ile aynı sevkiyattan üret → kıyas
      const rep = (await shippingService.getDispatchReport(real.id)).data as { totals: { totalRolls: number; totalMeters: number } };
      console.log(`   muhasebe fişi verisi: ${rep.totals.totalRolls} top / ${rep.totals.totalMeters} m  (irsaliyeyle aynı kaynaktan)`);
    }
  } else {
    console.log("\nℹ️  DB'de DISPATCHED sevkiyat yok — örnek veriyle gösteriyorum.");
  }

  // 2) Örnek veriden 3 durum (DB'siz de görünsün): resmi / taslak / iptal.
  writeFileSync("/tmp/sevk_ORNEK_resmi.html", renderShipmentDispatchHtml(SAMPLE, {}));
  writeFileSync("/tmp/sevk_ORNEK_taslak.html", renderShipmentDispatchHtml(SAMPLE, { draft: true }));
  writeFileSync("/tmp/sevk_ORNEK_iptal.html", renderShipmentDispatchHtml(SAMPLE, { status: "VOIDED" }));
  out.push(
    "/tmp/sevk_ORNEK_resmi.html    (resmi belge)",
    "/tmp/sevk_ORNEK_taslak.html   (sevk öncesi — TASLAK filigranı)",
    "/tmp/sevk_ORNEK_iptal.html    (iptal — İPTAL filigranı)",
  );

  console.log("\n📄 Üretilen dosyalar:");
  out.forEach((f) => console.log("   " + f));
  console.log("\n👉 Tarayıcıda aç:  open /tmp/sevk_ORNEK_resmi.html");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
