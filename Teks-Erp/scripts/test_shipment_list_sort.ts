// =============================================================================
// Test: Sevkiyat listesi `dispatchedAt` sıralaması + union keyset sayfalama
// Çalıştır: npx tsx scripts/test_shipment_list_sort.ts
//
// Muhasebe ekranı "Sevk Tarihi" kolonunu basıyordu ama listeyi `createdAt`'e göre
// diziyordu (2026-08-02 denetimi): pazartesi kurulup cuma sevk edilen sevkiyat,
// çarşamba kurulup çarşamba sevk edilenin ÜSTÜNDE çıkıyordu. `dispatchedAt`
// eskiden SORTABLE dışındaydı çünkü PLANNED'da NULL ve union keyset'i bozuyordu.
//
// Kilitlenen sözleşmeler:
//   1) `sortBy=dispatchedAt` gerçekten sevk tarihine göre sıralar — createdAt
//      sırası BİLİNÇLİ olarak TERS kurulur, ikisi karışırsa test kırmızı verir.
//   2) NULL (PLANNED) satırlar YÖNDEN BAĞIMSIZ olarak SONDA (nulls-last) — hem
//      desc hem asc'de.
//   3) Union'ın iki tarafı doğru alanla sıralanır: Shipment.dispatchedAt ≙
//      DirectShipment.shippedAt (adlar farklı; aynı `where`i paylaşmak hatalıydı).
//   4) Keyset sayfalama limit=1 ile sayfa sayfa gezildiğinde TAM ve TEKRARSIZ
//      küme verir (union merge + cursor'ın asıl kırılma noktası).
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

interface ListRow {
  id: string;
  shipmentNo: string;
  kind: "SHIPMENT" | "DIRECT";
  dispatchedAt: string | Date | null;
}
interface CursorRes {
  data: ListRow[];
  pagination: { nextCursor: string | null; hasMore: boolean };
}
const fakeReq = (query: Record<string, string>) => ({ query }) as unknown as Request;

const DAY = 86_400_000;

async function main() {
  const ts = Date.now();
  const customer = await prisma.customer.create({
    data: { code: `TST-SRT-${ts}`, name: `TEST SRT MÜŞTERİ ${ts}`, taxNumber: "4443332221" },
    select: { id: true },
  });

  // KURGU: createdAt sırası ile dispatchedAt sırası BİLİNÇLİ olarak TERS.
  // (createdAt'e göre sıralayan eski davranış bu testte kesin kırmızı verir.)
  //   A — en ESKİ oluşturma, en YENİ sevk
  //   B — orta
  //   C — en YENİ oluşturma, en ESKİ sevk
  //   P — PLANNED, dispatchedAt NULL (sonda olmalı)
  const base = new Date(ts);
  const mk = (suffix: string, createdOffsetDays: number, dispatchOffsetDays: number | null) =>
    prisma.shipment.create({
      data: {
        shipmentNo: `TEST-SRT-${suffix}-${ts}`,
        customerId: customer.id,
        status: dispatchOffsetDays === null ? "PLANNED" : "DISPATCHED",
        destination: "DOMESTIC",
        createdAt: new Date(base.getTime() - createdOffsetDays * DAY),
        ...(dispatchOffsetDays === null
          ? {}
          : { dispatchedAt: new Date(base.getTime() - dispatchOffsetDays * DAY) }),
      },
      select: { id: true, shipmentNo: true },
    });
  const shA = await mk("A", 30, 1); // eski kayıt, dün sevk
  const shB = await mk("B", 20, 5);
  const shC = await mk("C", 10, 9); // yeni kayıt, 9 gün önce sevk
  const shP = await mk("P", 15, null); // planlı → NULL

  // --- Fasondan doğrudan sevk: shippedAt = 3 gün önce (A ile B arasına düşmeli)
  const station = await prisma.station.create({
    data: { code: `TST-SRT-STN-${ts}`, name: "SRT İstasyon", type: "EXTERNAL" },
    select: { id: true },
  });
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `TEST-SRT-WO-${ts}`, status: "IN_PROGRESS" },
    select: { id: true },
  });
  const step = await prisma.workOrderStep.create({
    data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1 },
    select: { id: true },
  });
  const batch = await prisma.batch.create({
    data: { batchNumber: `TST-SRT-BATCH-${ts}`, workOrderId: wo.id },
    select: { id: true },
  });
  const sub = await prisma.subcontractor.create({
    data: { code: `TST-SRT-SUB-${ts}`, name: `SRT Fason ${ts}` },
    select: { id: true },
  });
  const dispatch = await prisma.subcontractorDispatch.create({
    data: {
      dispatchNo: `TST-SRT-SD-${ts}`,
      workOrderId: wo.id,
      batchId: batch.id,
      stepId: step.id,
      subcontractorId: sub.id,
    },
    select: { id: true },
  });
  const direct = await prisma.directShipment.create({
    data: {
      shipmentNo: `TST-SRT-DSK-${ts}`,
      dispatchId: dispatch.id,
      customerId: customer.id,
      reason: "test",
      totalQty: 30,
      rollCount: 1,
      // createdAt EN YENİ ama sevk 3 gün önce — union'ın yanlış alanla sıralanması
      // (createdAt/shippedAt karışması) buradan yakalanır.
      shippedAt: new Date(base.getTime() - 3 * DAY),
    },
    select: { id: true, shipmentNo: true },
  });

  const nos = (rows: ListRow[]) => rows.map((r) => r.shipmentNo.replace(`-${ts}`, ""));

  try {
    // ---------------------------------------------------------------------
    console.log("\n[1] sortBy=dispatchedAt desc — sevk tarihine göre, NULL sonda");
    const desc = (await shippingService.listShipments(
      fakeReq({ customerId: customer.id, sortBy: "dispatchedAt", sortOrder: "desc" }),
    )) as unknown as { data: ListRow[] };
    const descNos = nos(desc.data);
    check(
      "sıra: A(1g) → DSK(3g) → B(5g) → C(9g) → P(null)",
      JSON.stringify(descNos) ===
        JSON.stringify(["TEST-SRT-A", "TST-SRT-DSK", "TEST-SRT-B", "TEST-SRT-C", "TEST-SRT-P"]),
      descNos.join(" > "),
    );
    check("NULL (planlı) en sonda", descNos[descNos.length - 1] === "TEST-SRT-P");
    check(
      "doğrudan sevk union'da DOĞRU yere girdi (shippedAt ile)",
      descNos[1] === "TST-SRT-DSK",
      descNos[1],
    );

    // Eski davranışın (createdAt) verdiği sıra bundan FARKLI olmalı — testin
    // gerçekten bir şey ölçtüğünün kanıtı.
    const byCreated = (await shippingService.listShipments(
      fakeReq({ customerId: customer.id }),
    )) as unknown as { data: ListRow[] };
    check(
      "createdAt sırası dispatchedAt sırasından FARKLI (kurgu geçerli)",
      JSON.stringify(nos(byCreated.data)) !== JSON.stringify(descNos),
      nos(byCreated.data).join(" > "),
    );

    // ---------------------------------------------------------------------
    console.log("\n[2] asc — ters sıra ama NULL YİNE sonda");
    const asc = (await shippingService.listShipments(
      fakeReq({ customerId: customer.id, sortBy: "dispatchedAt", sortOrder: "asc" }),
    )) as unknown as { data: ListRow[] };
    const ascNos = nos(asc.data);
    check(
      "sıra: C → B → DSK → A → P",
      JSON.stringify(ascNos) ===
        JSON.stringify(["TEST-SRT-C", "TEST-SRT-B", "TST-SRT-DSK", "TEST-SRT-A", "TEST-SRT-P"]),
      ascNos.join(" > "),
    );
    check("asc'de de NULL sonda (yönden bağımsız)", ascNos[ascNos.length - 1] === "TEST-SRT-P");

    // ---------------------------------------------------------------------
    console.log("\n[3] Keyset sayfalama — limit=1 ile tam ve tekrarsız");
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 12; i++) {
      const page = (await shippingService.listShipments(
        fakeReq({
          customerId: customer.id,
          mode: "cursor",
          limit: "1",
          sortBy: "dispatchedAt",
          sortOrder: "desc",
          ...(cursor ? { cursor } : {}),
        }),
      )) as unknown as CursorRes;
      seen.push(...nos(page.data));
      cursor = page.pagination.nextCursor;
      if (!page.pagination.hasMore) break;
    }
    check("sayfalama 5 satırın tamamını getirdi", seen.length === 5, `${seen.length}: ${seen.join(" > ")}`);
    check("tekrar eden satır yok", new Set(seen).size === seen.length);
    check(
      "sayfalı sıra tek-seferlik sırayla AYNI",
      JSON.stringify(seen) === JSON.stringify(descNos),
      seen.join(" > "),
    );

    // ---------------------------------------------------------------------
    console.log("\n[4] Muhasebe kullanımı — status=DISPATCHED + dispatchedAt desc");
    const acc = (await shippingService.listShipments(
      fakeReq({
        customerId: customer.id,
        status: "DISPATCHED",
        sortBy: "dispatchedAt",
        sortOrder: "desc",
      }),
    )) as unknown as { data: ListRow[] };
    const accNos = nos(acc.data);
    check("planlı sevkiyat listede yok", !accNos.includes("TEST-SRT-P"), accNos.join(" > "));
    check(
      "kalan 4 satır sevk tarihine göre sıralı",
      JSON.stringify(accNos) ===
        JSON.stringify(["TEST-SRT-A", "TST-SRT-DSK", "TEST-SRT-B", "TEST-SRT-C"]),
      accNos.join(" > "),
    );
  } finally {
    await prisma.shipment.deleteMany({
      where: { id: { in: [shA.id, shB.id, shC.id, shP.id] } },
    });
    await prisma.directShipment.deleteMany({ where: { id: direct.id } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: dispatch.id } });
    await prisma.subcontractor.deleteMany({ where: { id: sub.id } });
    await prisma.batch.deleteMany({ where: { id: batch.id } });
    await prisma.workOrderStep.deleteMany({ where: { id: step.id } });
    await prisma.workOrder.deleteMany({ where: { id: wo.id } });
    await prisma.station.deleteMany({ where: { id: station.id } });
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
