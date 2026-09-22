// =============================================================================
// Test: ihracat kodu YÖN KAPISI — snapshot doğarken (S6, 2026-09-23)
// Çalıştır: npx tsx scripts/test_export_code_snapshot_gate.ts
// Kural: ihracat kodu yalnız yurtdışı sevkiyatın belgesine girer; kapı RENDER'da değil
// snapshot'ın DOĞDUĞU yerde (`collectShipmentDocContent` → `header.exportCode`).
// Doğrulananlar:
//   1. İki kol — ESKİ yurtiçi snapshot (`exportCode` alanı yok) hâlâ kodu basar
//      (donmuş belge bayt bayt aynı) · YENİ yurtiçi snapshot (`exportCode: null`) basmaz ·
//      yeni yurtdışı snapshot basar · toggle (`sections.exportCode=false`) yine gizler.
//   2. Doğan içerik: yurtiçi sevkiyatın canlı içeriğinde `header.exportCode` null (cari kodu
//      dolu olsa da); yurtdışında şube kodu, boşsa cari kodu. Canlı önizleme de bu yoldan.
// Negatif sondalar (2026-09-23, geri alındı → 7/0): ① kapı render'a kondu → 1a (eski donmuş
//   belge değişti) + 1c ❌ · ② doğuşta kapı yok → 2a ❌ · ③ render doğuştaki alanı okumaz → 1b/1c ❌
// Kapsam dışı (ölçüldü): fason doğrudan sevk (`DirectShipment`) yön kolonu TAŞIMAZ, belgesi
// sabit DOMESTIC ⇒ kapı orada UYGULANMAZ, bugünkü davranış (kod yönden bağımsız) sürer.
// =============================================================================
import prisma from "../src/lib/prisma";
import type { PrintedDocSnapshot } from "../src/services/printed-document.service";
import { SAMPLE_PRINTED_DOCS } from "../src/services/document-render/sample-data";
import { renderShipmentDispatchHtml } from "../src/services/document-render/shipment-dispatch.html";
import { ShippingService } from "../src/services/shipping.service";
import { CustomerService } from "../src/services/customer.service";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

function snap(doc: Record<string, unknown>, sections?: Record<string, boolean>): PrintedDocSnapshot {
  return {
    schemaVersion: 1,
    frozenAt: "2026-07-16T00:00:00.000Z",
    company: { name: "TEST FİRMA", letterhead: { addressLine: "", phone: "", taxInfo: "" } },
    docConfigOverride: sections ? { sections } : null,
    doc,
  };
}
const withHeader = (patch: Record<string, unknown>) => {
  const d = SAMPLE_PRINTED_DOCS.SHIPMENT_DISPATCH as Record<string, unknown>;
  return { ...d, header: { ...(d.header as Record<string, unknown>), ...patch } };
};
const LINE = "İhracat Kodu:";

const TS = Date.now().toString(36);
const customers = new CustomerService({
  modelName: "customer",
  tableName: "CUSTOMER",
  searchFields: ["name"],
  codeSearchFields: ["code", "taxNumber", "exportCode"],
  defaultInclude: undefined,
  uniqueField: "code",
  nestedCreateFields: ["branches"],
});
const createdIds: string[] = [];
const shipmentIds: string[] = [];

async function main() {
  // 1) render — iki kol
  const eski = withHeader({ destination: "DOMESTIC" });
  delete (eski.header as Record<string, unknown>).exportCode;
  check("1a ESKİ yurtiçi snapshot (alan yok) → kod hâlâ basılır", renderShipmentDispatchHtml(snap(eski), {}).includes(LINE));
  check("1b YENİ yurtiçi snapshot (exportCode null) → kod basılmaz", !renderShipmentDispatchHtml(snap(withHeader({ destination: "DOMESTIC", exportCode: null })), {}).includes(LINE));
  const yeniDis = renderShipmentDispatchHtml(snap(withHeader({ destination: "EXPORT", exportCode: "EXP-X" })), {});
  check("1c YENİ yurtdışı snapshot → doğuştaki kod basılır", yeniDis.includes("EXP-X"));
  check("1d toggle kapalı → yurtdışında da gizli (istenirse basılır = mevcut bölüm ayarı)", !renderShipmentDispatchHtml(snap(withHeader({ destination: "EXPORT", exportCode: "EXP-X" }), { exportCode: false }), {}).includes(LINE));

  // 2) doğan içerik — canlı önizleme yolu (`collectShipmentDocContent`, requireDispatched:false)
  const cari = (await customers.create({ name: `TEST Belge Kod ${TS}` }, undefined)).data as { id: string };
  createdIds.push(cari.id);
  await prisma.customer.update({ where: { id: cari.id }, data: { exportCode: `EXP-C-${TS}` } });
  const sube = await prisma.customerBranch.create({ data: { customerId: cari.id, name: `TEST Belge Şube ${TS}`, code: `EXP-B-${TS}` }, select: { id: true } });
  const shipping = new ShippingService();
  const icerik = async (destination: "DOMESTIC" | "EXPORT", branchId: string | null) => {
    const sh = await prisma.shipment.create({
      data: { shipmentNo: `TEST-BK-${TS}-${shipmentIds.length}`, customerId: cari.id, branchId, status: "PLANNED", destination },
      select: { id: true },
    });
    shipmentIds.push(sh.id);
    const r = (await shipping.getDispatchReport(sh.id)).data as { header: Record<string, unknown> };
    return r.header;
  };
  const h1 = await icerik("DOMESTIC", null);
  check("2a yurtiçi → header.exportCode null (cari kodu dolu olsa da)", "exportCode" in h1 && h1.exportCode === null, JSON.stringify({ e: h1.exportCode, c: h1.customerExportCode }));
  const h2 = await icerik("EXPORT", null);
  check("2b yurtdışı, şubesiz → cari kodu", h2.exportCode === `EXP-C-${TS}`, String(h2.exportCode));
  const h3 = await icerik("EXPORT", sube.id);
  check("2c yurtdışı, şubeli → şube kodu önce", h3.exportCode === `EXP-B-${TS}`, String(h3.exportCode));
}

async function temizlik(): Promise<void> {
  await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
  await cleanupTestCustomers(createdIds);
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    try { await temizlik(); } catch (e) { console.error("❌ temizlik düştü:", e); fail++; }
    console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
