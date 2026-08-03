// =============================================================================
// Test: Fatura işareti (muhasebe) — işaretle / düzelt / kaldır + statü guard'ı
// Çalıştır: npx tsx scripts/test_shipment_invoice.ts
//
// ERP fatura KESMEZ; `Shipment.invoiceNo/invoicedAt` yalnız dış muhasebe
// programındaki belgenin izidir. Kilitlenen sözleşmeler:
//   1) DISPATCHED sevkiyat işaretlenir; no + tarih + kim yazılır.
//   2) Tarih verilmezse "şimdi" damgalanır.
//   3) PLANNED sevkiyat REDDEDİLİR (malı çıkmamışa fatura kesilmez) — 400.
//   4) `invoiceNo: null` işareti kaldırır ve TARİHİ DE temizler
//      ("numarasız ama faturalı" ara durum yok).
//   5) `invoiced` filtresi listeyi doğru ayırır (true/false).
//   6) Fasondan doğrudan sevk (DirectShipment) aynı sözleşmeyi taşır.
//   7) Her değişiklik audit'e düşer.
//   8) Fatura işareti sevkiyat RAKAMLARINA dokunmaz (metraj/adet aynı kalır).
// =============================================================================
import type { Request } from "express";
import prisma from "../src/lib/prisma";
import { shippingService } from "../src/services/shipping.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}
async function expectError(label: string, fn: () => Promise<unknown>, wantFragment: string) {
  try {
    await fn();
    check(label, false, "hata BEKLENİYORDU, çağrı başarılı döndü");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(label, msg.includes(wantFragment), msg);
  }
}

interface ListRow {
  id: string;
  shipmentNo: string;
  invoiceNo: string | null;
  invoicedAt: string | Date | null;
  totalMeters: number;
  _count: { rolls: number };
}
const fakeReq = (query: Record<string, string>) => ({ query }) as unknown as Request;

async function main() {
  const ts = Date.now();
  const user = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!user) throw new Error("Seed kullanıcısı 'admin' yok — önce `npm run seed`.");

  const customer = await prisma.customer.create({
    data: { code: `TST-INV-${ts}`, name: "TEST INV MÜŞTERİ", taxNumber: "5556667778" },
    select: { id: true },
  });
  const item = await prisma.item.create({
    data: { code: `TST-INV-I-${ts}`, name: "INV KUMAŞ", itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const mkShipment = (suffix: string, status: "DISPATCHED" | "PLANNED") =>
    prisma.shipment.create({
      data: {
        shipmentNo: `TEST-INV-${suffix}-${ts}`,
        customerId: customer.id,
        status,
        destination: "DOMESTIC",
        ...(status === "DISPATCHED" ? { dispatchedAt: new Date() } : {}),
      },
      select: { id: true, shipmentNo: true },
    });
  const shipped = await mkShipment("D", "DISPATCHED");
  const planned = await mkShipment("P", "PLANNED");
  const sack = await prisma.sack.create({
    data: { sackNo: `TEST-INV-SK-${ts}`, customerId: customer.id, shipmentId: shipped.id, seq: 1, weightKg: 20 },
    select: { id: true },
  });
  const roll = await prisma.roll.create({
    data: {
      barcode: `TEST-INV-R-${ts}`,
      itemId: item.id,
      status: "SHIPPED",
      currentQty: 120,
      initialQty: 120,
      entrySource: "SUPPLIER_RECEIPT",
      shipmentId: shipped.id,
      sackId: sack.id,
    },
    select: { id: true },
  });

  // --- Fasondan doğrudan sevk zinciri (DirectShipment FK'ları zorunlu) --------
  const station = await prisma.station.create({
    data: { code: `TST-INV-STN-${ts}`, name: "INV İstasyon", type: "EXTERNAL" },
    select: { id: true },
  });
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `TEST-INV-WO-${ts}`, status: "IN_PROGRESS" },
    select: { id: true },
  });
  const step = await prisma.workOrderStep.create({
    data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1 },
    select: { id: true },
  });
  const batch = await prisma.batch.create({
    data: { batchNumber: `TST-INV-BATCH-${ts}`, workOrderId: wo.id },
    select: { id: true },
  });
  const sub = await prisma.subcontractor.create({
    data: { code: `TST-INV-SUB-${ts}`, name: "INV Fason" },
    select: { id: true },
  });
  const dispatch = await prisma.subcontractorDispatch.create({
    data: {
      dispatchNo: `TST-INV-SD-${ts}`,
      workOrderId: wo.id,
      batchId: batch.id,
      stepId: step.id,
      subcontractorId: sub.id,
    },
    select: { id: true },
  });
  const direct = await prisma.directShipment.create({
    data: {
      shipmentNo: `TST-INV-DSK-${ts}`,
      dispatchId: dispatch.id,
      customerId: customer.id,
      reason: "test",
      totalQty: 30,
      rollCount: 1,
    },
    select: { id: true, shipmentNo: true },
  });

  const rows = async (extra: Record<string, string> = {}): Promise<ListRow[]> => {
    const res = (await shippingService.listShipments(
      fakeReq({ customerId: customer.id, ...extra }),
    )) as unknown as { data: ListRow[] };
    return res.data;
  };
  const rowOf = async (no: string, extra: Record<string, string> = {}): Promise<ListRow | undefined> =>
    (await rows(extra)).find((r) => r.shipmentNo === no);

  try {
    // ---------------------------------------------------------------------
    console.log("\n[1] DISPATCHED sevkiyat işaretlenir");
    const beforeMeters = (await rowOf(shipped.shipmentNo))?.totalMeters;
    const t0 = Date.now();
    await shippingService.setShipmentInvoice(shipped.id, "FTR2026000118", null, user.id);
    const marked = await prisma.shipment.findUnique({
      where: { id: shipped.id },
      select: { invoiceNo: true, invoicedAt: true, invoicedById: true },
    });
    check("fatura no yazıldı", marked?.invoiceNo === "FTR2026000118", `${marked?.invoiceNo}`);
    check(
      "tarih verilmedi → 'şimdi' damgalandı",
      marked?.invoicedAt != null && marked.invoicedAt.getTime() >= t0 - 1000,
      `${marked?.invoicedAt?.toISOString()}`,
    );
    check("işaretleyen kullanıcı yazıldı", marked?.invoicedById === user.id);

    const listed = await rowOf(shipped.shipmentNo);
    check("liste fatura no'yu taşıyor", listed?.invoiceNo === "FTR2026000118", `${listed?.invoiceNo}`);
    check(
      "REGRESYON: fatura işareti metraja dokunmadı",
      listed?.totalMeters === beforeMeters,
      `${beforeMeters} → ${listed?.totalMeters}`,
    );

    // ---------------------------------------------------------------------
    console.log("\n[2] Açık tarihle düzeltme (yanlış no/tarih girilmiş olabilir)");
    const explicit = new Date("2026-07-15T09:30:00.000Z");
    await shippingService.setShipmentInvoice(shipped.id, "FTR2026000999", explicit, user.id);
    const fixed = await prisma.shipment.findUnique({
      where: { id: shipped.id },
      select: { invoiceNo: true, invoicedAt: true },
    });
    check("no güncellendi", fixed?.invoiceNo === "FTR2026000999", `${fixed?.invoiceNo}`);
    check(
      "verilen tarih birebir korundu",
      fixed?.invoicedAt?.getTime() === explicit.getTime(),
      `${fixed?.invoicedAt?.toISOString()}`,
    );

    // ---------------------------------------------------------------------
    console.log("\n[3] PLANNED sevkiyat REDDEDİLİR");
    await expectError(
      "planlı sevkiyat faturalandırılamaz",
      () => shippingService.setShipmentInvoice(planned.id, "FTR-X", null, user.id),
      "sevk edilmiş",
    );
    const untouched = await prisma.shipment.findUnique({
      where: { id: planned.id },
      select: { invoiceNo: true },
    });
    check("planlı sevkiyatın alanı boş kaldı", untouched?.invoiceNo === null);

    await expectError(
      "olmayan sevkiyat → 404 mesajı",
      () => shippingService.setShipmentInvoice(
        "00000000-0000-4000-8000-000000000000",
        "FTR-Y",
        null,
        user.id,
      ),
      "bulunamadı",
    );

    // ---------------------------------------------------------------------
    console.log("\n[4] `invoiced` filtresi");
    const onlyInvoiced = await rows({ "filter[invoiced]": "true" });
    check(
      "faturalandı filtresi yalnız işaretliyi getirir",
      onlyInvoiced.length === 1 && onlyInvoiced[0]?.shipmentNo === shipped.shipmentNo,
      `${onlyInvoiced.map((r) => r.shipmentNo).join(", ")}`,
    );
    const notInvoiced = await rows({ "filter[invoiced]": "false" });
    const notNos = notInvoiced.map((r) => r.shipmentNo);
    check("faturalanmamış filtresi işaretliyi DIŞLAR", !notNos.includes(shipped.shipmentNo));
    check("faturalanmamış filtresi planlıyı içerir", notNos.includes(planned.shipmentNo));
    check("faturalanmamış filtresi doğrudan sevki içerir", notNos.includes(direct.shipmentNo));

    // ---------------------------------------------------------------------
    console.log("\n[5] İşaret kaldırma — tarih de temizlenir");
    await shippingService.setShipmentInvoice(shipped.id, null, null, user.id);
    const cleared = await prisma.shipment.findUnique({
      where: { id: shipped.id },
      select: { invoiceNo: true, invoicedAt: true, invoicedById: true },
    });
    check("no temizlendi", cleared?.invoiceNo === null);
    check("tarih de temizlendi (yarım durum yok)", cleared?.invoicedAt === null);
    check("işaretleyen de temizlendi", cleared?.invoicedById === null);

    // Boş/whitespace string de kaldırma sayılır (UI boş input gönderebilir).
    await shippingService.setShipmentInvoice(shipped.id, "   ", null, user.id);
    const blanked = await prisma.shipment.findUnique({
      where: { id: shipped.id },
      select: { invoiceNo: true },
    });
    check("boşluk-only no da kaldırma sayılır", blanked?.invoiceNo === null);

    // ---------------------------------------------------------------------
    console.log("\n[6] Fasondan doğrudan sevk aynı sözleşmeyi taşır");
    await shippingService.setDirectShipmentInvoice(direct.id, "FTR-DIRECT-1", null, user.id);
    const dRow = await rowOf(direct.shipmentNo);
    check("doğrudan sevk listesi fatura no'yu taşıyor", dRow?.invoiceNo === "FTR-DIRECT-1", `${dRow?.invoiceNo}`);
    const onlyInvoiced2 = await rows({ "filter[invoiced]": "true" });
    check(
      "filtre doğrudan sevki de yakalar",
      onlyInvoiced2.some((r) => r.shipmentNo === direct.shipmentNo),
      `${onlyInvoiced2.map((r) => r.shipmentNo).join(", ")}`,
    );
    await expectError(
      "olmayan doğrudan sevk → 404",
      () => shippingService.setDirectShipmentInvoice(
        "00000000-0000-4000-8000-000000000001",
        "X",
        null,
        user.id,
      ),
      "bulunamadı",
    );

    // ---------------------------------------------------------------------
    console.log("\n[7] Audit izi");
    // Audit best-effort ve tx DIŞINDA yazılır → kısa bir yazım penceresi olabilir.
    await new Promise((r) => setTimeout(r, 250));
    const logs = await prisma.systemLog.findMany({
      where: { tableName: "SHIPMENT", recordId: shipped.id },
      select: { newData: true },
    });
    const invoiceLogs = logs.filter(
      (l) => (l.newData as { kind?: string } | null)?.kind === "INVOICE_MARK",
    );
    check("fatura işaretleri audit'e düştü", invoiceLogs.length >= 2, `${invoiceLogs.length} kayıt`);
    const directLogs = await prisma.systemLog.count({
      where: { tableName: "DIRECT_SHIPMENT", recordId: direct.id },
    });
    check("doğrudan sevk işareti de audit'e düştü", directLogs >= 1, `${directLogs} kayıt`);
  } finally {
    await prisma.systemLog.deleteMany({
      where: { recordId: { in: [shipped.id, planned.id, direct.id] } },
    });
    await prisma.roll.deleteMany({ where: { id: roll.id } });
    await prisma.sack.deleteMany({ where: { shipmentId: shipped.id } });
    await prisma.shipment.deleteMany({ where: { id: { in: [shipped.id, planned.id] } } });
    await prisma.directShipment.deleteMany({ where: { id: direct.id } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: dispatch.id } });
    await prisma.subcontractor.deleteMany({ where: { id: sub.id } });
    await prisma.batch.deleteMany({ where: { id: batch.id } });
    await prisma.workOrderStep.deleteMany({ where: { id: step.id } });
    await prisma.workOrder.deleteMany({ where: { id: wo.id } });
    await prisma.station.deleteMany({ where: { id: station.id } });
    await prisma.item.delete({ where: { id: item.id } }).catch(() => {});
    await prisma.customer.delete({ where: { id: customer.id } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
