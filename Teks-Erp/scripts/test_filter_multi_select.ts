// =============================================================================
// Test: ÇOKLU SEÇİM filtresi (CSV → Prisma `in`) bekçisi
// Çalıştır: npx tsx scripts/test_filter_multi_select.ts
// =============================================================================
// Electron FilterBar çoklu seçimi `filter[colorId]=a,b` (CSV) olarak yollar.
// Jenerik yol (`buildWhereClause`) CSV'yi zaten `{ in: [...] }`'e çevirir; AMA
// büyük liste servisleri filtreyi ELLE okur ve eskiden hepsi
// `typeof v === "string"` diyordu — **CSV de bir string'dir**.
//
// Ham geçirmenin İKİ arıza modu var ve ikisi de negatif sondayla ÖLÇÜLDÜ:
//
//   • **uuid kolon** (itemId/colorId/customerId/subcontractorId…) → Postgres
//     `invalid input syntax for type uuid` → Prisma **P2007**. HTTP yolunda
//     error middleware bunu **400** + *"Geçersiz veri formatı (örn. hatalı ID)"*
//     mesajına çevirir; ⚠️ bu bekçi servisi DOĞRUDAN çağırdığı için middleware
//     devrede değil ve ham `PrismaClientKnownRequestError` görülür — sahadaki
//     karşılığının 400 olduğunu unutma. (Sonda: §2'nin ilk çoklu sorgusu P2007.)
//   • **`currentStationId`** → UUID regex'i Prisma'dan ÖNCE çalıştığı için CSV
//     elenir ve filtre **sessizce DÜŞER**: hata yok, log yok, liste filtresizmiş
//     gibi döner. Boş listeden kötüsü — YANLIŞ liste. (Sonda: iki istasyon
//     seçilince 2 yerine **6 satır**.) §3 bunu ayrıca kilitler.
//
// (Üçüncü mod — uuid olmayan string kolonda sessiz 0 satır — `foldType`
// emsalidir ve kendi bekçisinde: test_roll_fold_and_reason.ts §2.)
//
// Tek kaynak `utils/query-parser.readIdCondition`. Elle okunan HER id filtresi
// oradan geçmeli; yeni bir liste yüzeyi eklerken bu bekçiye de satır ekle.
//
// Fixture kendi verisini üretir (ortam verisine bağımlı DEĞİL) ve finally'de siler.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { readIdCondition, readFilterList } from "../src/utils/query-parser";
import { InventoryService } from "../src/services/inventory.service";
import { OrderService } from "../src/services/order.service";
import { KartelaService } from "../src/services/kartela.service";
import { ProductionBalanceService } from "../src/services/production-balance.service";
import type { Request } from "express";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const inventory = new InventoryService();
const kartela = new KartelaService();
const balance = new ProductionBalanceService();
const orders = new OrderService({
  modelName: "order",
  tableName: "ORDER",
  nestedCreateFields: ["lines"],
});

const fakeReq = (query: Record<string, unknown>) => ({ query }) as unknown as Request;

interface RollPage {
  data: Array<{ id: string; itemId: string; colorId: string | null }>;
}
interface OrderPage {
  data: Array<{ id: string }>;
}

async function main(): Promise<void> {
  const ts = Date.now();
  const tag = `TEST-MULTI-${ts}`;

  // ── Fixture ────────────────────────────────────────────────────────────────
  const mkItem = (n: number) =>
    prisma.item.create({
      data: { code: `${tag}-I${n}`, name: `${tag} Kumaş ${n}`, itemType: "FABRIC" },
      select: { id: true },
    });
  const mkColor = (n: number) =>
    prisma.color.create({
      data: { code: `${tag}-C${n}`, name: `${tag} Renk ${n}` },
      select: { id: true },
    });

  // itemD YALNIZ §3'teki iş emrinin hedefi — `work_orders_stockprod_targetItem`
  // CHECK'i STOCK_PRODUCTION'da targetItemId ister. Bilerek A/B/C'den AYRI bir
  // ürün: WO "üretimde" havuzuna girdiği için A/B/C üzerinden koşan §6 denge
  // sayımını kirletirdi.
  const [itemA, itemB, itemC, itemD] = await Promise.all([
    mkItem(1),
    mkItem(2),
    mkItem(3),
    mkItem(4),
  ]);
  const [colX, colY, colZ] = await Promise.all([mkColor(1), mkColor(2), mkColor(3)]);

  const rollIds: string[] = [];
  const mkRoll = async (
    label: string,
    itemId: string,
    colorId: string | null,
    extra: Record<string, unknown> = {},
  ) => {
    const r = await prisma.roll.create({
      data: {
        barcode: `${tag}-R-${label}`,
        itemId,
        colorId,
        status: "WAREHOUSE",
        initialQty: 100,
        currentQty: 100,
        entrySource: "SUPPLIER_RECEIPT",
        ...extra,
      },
      select: { id: true },
    });
    rollIds.push(r.id);
    return r.id;
  };

  // Ortak liste sorgusu — sekme varsayılanları devre dışı (status=ALL), yalnız
  // bu fixture'ın topları görülsün diye itemId taban filtresi verilir.
  const listRolls = async (extraFilters: Record<string, string>) => {
    const res = (await inventory.findAllRolls(
      fakeReq({
        "filter[status]": "ALL",
        pageSize: "100",
        ...extraFilters,
      }),
    )) as unknown as RollPage;
    return res.data.filter((r) => rollIds.includes(r.id));
  };

  const stationIds: string[] = [];
  const woIds: string[] = [];
  const stepIds: string[] = [];
  const customerIds: string[] = [];
  const orderIds: string[] = [];
  const subIds: string[] = [];
  const dispatchIds: string[] = [];
  const swatchIds: string[] = [];

  try {
    // ── 1) SAF SÖZLEŞME — readIdCondition / readFilterList ────────────────────
    console.log("\n[1] readIdCondition sözleşmesi (saf)");
    check("boş → null (filtre uygulanmaz)", readIdCondition(undefined) === null);
    check("boş string → null", readIdCondition("") === null);
    check("yalnız virgül/boşluk → null", readIdCondition(" , , ") === null);
    check("tek değer → DÜZ eşitlik (where şekli korunur)", readIdCondition("a") === "a");
    check(
      "iki değer → { in: [a,b] }",
      JSON.stringify(readIdCondition("a,b")) === JSON.stringify({ in: ["a", "b"] }),
      JSON.stringify(readIdCondition("a,b")),
    );
    check(
      "boşluklar kırpılır",
      JSON.stringify(readIdCondition(" a , b ")) === JSON.stringify({ in: ["a", "b"] }),
    );
    check(
      "dizi biçimi (tekrarlı query anahtarı) aynı sonucu verir",
      JSON.stringify(readIdCondition(["a", "b"])) === JSON.stringify({ in: ["a", "b"] }),
    );
    check(
      "tek elemanlı dizi de DÜZ eşitlik",
      readIdCondition(["a"]) === "a",
    );
    check("readFilterList boşları eler", readFilterList("a,,b, ").length === 2);

    // ── 2) ENVANTER — itemId / colorId ────────────────────────────────────────
    console.log("\n[2] Envanter: kumaş + renk çoklu seçimi");
    const rA = await mkRoll("A", itemA.id, colX.id);
    const rB = await mkRoll("B", itemB.id, colY.id);
    const rC = await mkRoll("C", itemC.id, colZ.id);

    const oneItem = await listRolls({ "filter[itemId]": itemA.id });
    check("tek kumaş — davranış değişmedi", oneItem.length === 1 && oneItem[0]?.id === rA, `${oneItem.length} satır`);

    const twoItems = await listRolls({ "filter[itemId]": `${itemA.id},${itemB.id}` });
    check(
      "iki kumaş → İKİSİ de gelir (sessiz 0-satır YOK)",
      twoItems.length === 2 && twoItems.every((r) => r.id === rA || r.id === rB),
      `${twoItems.length} satır`,
    );
    check("seçilmeyen kumaş DIŞARIDA", !twoItems.some((r) => r.id === rC));

    const twoColors = await listRolls({ "filter[colorId]": `${colX.id},${colY.id}` });
    check(
      "iki renk → İKİSİ de gelir",
      twoColors.length === 2 && !twoColors.some((r) => r.id === rC),
      `${twoColors.length} satır`,
    );

    // Kumaş ∈ {A,B} VE renk ∈ {Y,Z} → yalnız B (kesişim; iki filtre AND kalmalı).
    const crossed = await listRolls({
      "filter[itemId]": `${itemA.id},${itemB.id}`,
      "filter[colorId]": `${colY.id},${colZ.id}`,
    });
    check(
      "kumaş ∩ renk — iki çoklu filtre AND'lenir (OR'a dönüşmez)",
      crossed.length === 1 && crossed[0]?.id === rB,
      `${crossed.length} satır`,
    );

    // İstatistik aynı where'i paylaşıyor — liste doğruyken sayaç sıfır kalmamalı.
    const stats = (await inventory.getRollStats(
      fakeReq({ "filter[status]": "ALL", "filter[itemId]": `${itemA.id},${itemB.id}` }),
    )) as unknown as { data?: { totalCount?: number } };
    check(
      "/rolls/stats aynı where'i paylaşıyor — sayaç sıfırlanmadı",
      (stats.data?.totalCount ?? 0) >= 2,
      `totalCount=${stats.data?.totalCount}`,
    );

    // ── 3) ENVANTER — currentStationId (SESSİZ DÜŞME, en tehlikelisi) ─────────
    console.log("\n[3] Envanter: istasyon çoklu — filtre sessizce DÜŞMEMELİ");
    for (let i = 1; i <= 3; i++) {
      const s = await prisma.station.create({
        data: { code: `${tag}-S${i}`, name: `${tag} İstasyon ${i}`, type: "INTERNAL" },
        select: { id: true },
      });
      stationIds.push(s.id);
    }
    const wo = await prisma.workOrder.create({
      data: {
        workOrderNumber: `${tag}-WO`,
        type: "STOCK_PRODUCTION",
        targetItemId: itemD.id,
        steps: {
          create: stationIds.map((stationId, i) => ({ stationId, stepSequence: i + 1 })),
        },
      },
      select: { id: true, steps: { select: { id: true, stationId: true } } },
    });
    woIds.push(wo.id);
    stepIds.push(...wo.steps.map((s) => s.id));

    const stationRolls: string[] = [];
    for (const [i, step] of wo.steps.entries()) {
      stationRolls.push(
        await mkRoll(`ST${i}`, itemA.id, null, {
          status: "IN_PRODUCTION",
          currentStepId: step.id,
        }),
      );
    }

    const oneStation = await listRolls({ "filter[currentStationId]": stationIds[0] as string });
    check(
      "tek istasyon — davranış değişmedi",
      oneStation.length === 1 && oneStation[0]?.id === stationRolls[0],
      `${oneStation.length} satır`,
    );

    const twoStations = await listRolls({
      "filter[currentStationId]": `${stationIds[0]},${stationIds[1]}`,
    });
    check(
      "iki istasyon → tam 2 satır",
      twoStations.length === 2,
      `${twoStations.length} satır`,
    );
    // ASIL İDDİA: eski kod burada filtreyi düşürüp 3. istasyonun topunu da
    // döndürürdü. "Boş liste" değil "yanlış liste" — bu yüzden ayrı kontrol.
    check(
      "3. istasyonun topu SIZMADI (filtre sessizce düşmedi)",
      !twoStations.some((r) => r.id === stationRolls[2]),
    );
    // Geçersiz UUID'ler ayıklanır ama geçerli olan yaşar (kısmi bozuk girdi).
    const mixed = await listRolls({
      "filter[currentStationId]": `${stationIds[0]},not-a-uuid`,
    });
    check(
      "bozuk UUID elenir, geçerli olan filtrelemeye devam eder",
      mixed.length === 1 && mixed[0]?.id === stationRolls[0],
      `${mixed.length} satır`,
    );

    // ── 4) SİPARİŞ — kalem içi kumaş/renk çoklu ───────────────────────────────
    console.log("\n[4] Sipariş: kalem kumaş/renk çoklu (extraWhere)");
    const cust = await prisma.customer.create({
      data: { code: `${tag}-CU`, name: `${tag} Müşteri` },
      select: { id: true },
    });
    customerIds.push(cust.id);
    const mkOrder = async (n: number, itemId: string, colorId: string | null) => {
      const o = await prisma.order.create({
        data: {
          orderNumber: `${tag}-O${n}`,
          customerId: cust.id,
          lines: { create: [{ itemId, colorId, quantity: 10 }] },
        },
        select: { id: true },
      });
      orderIds.push(o.id);
      return o.id;
    };
    const oA = await mkOrder(1, itemA.id, colX.id);
    const oB = await mkOrder(2, itemB.id, colY.id);
    const oC = await mkOrder(3, itemC.id, colZ.id);

    const listOrders = async (extra: Record<string, string>) => {
      const res = (await orders.findAll(
        fakeReq({ "filter[customerId]": cust.id, pageSize: "100", ...extra }),
      )) as unknown as OrderPage;
      return res.data.filter((o) => orderIds.includes(o.id));
    };

    const ordOne = await listOrders({ "filter[itemId]": itemA.id });
    check("tek kumaş — davranış değişmedi", ordOne.length === 1 && ordOne[0]?.id === oA, `${ordOne.length}`);

    const ordTwo = await listOrders({ "filter[itemId]": `${itemA.id},${itemB.id}` });
    check(
      "iki kumaş → İKİSİ de gelir",
      ordTwo.length === 2 && !ordTwo.some((o) => o.id === oC),
      `${ordTwo.length} sipariş`,
    );

    // itemId ∈ {A,B} + colorId ∈ {Y,Z} AYNI kalemde eşleşmeli → yalnız B.
    const ordCross = await listOrders({
      "filter[itemId]": `${itemA.id},${itemB.id}`,
      "filter[colorId]": `${colY.id},${colZ.id}`,
    });
    check(
      "kumaş+renk AYNI kalemde eşleşir (çoklu seçimde de tek `some` bloğu)",
      ordCross.length === 1 && ordCross[0]?.id === oB,
      `${ordCross.length} sipariş`,
    );

    // ── 5) KARTELA — firma listesi + stok kırılımı ────────────────────────────
    console.log("\n[5] Kartela: firma çoklu + stok kumaş/renk çoklu");
    for (let i = 1; i <= 3; i++) {
      const s = await prisma.subcontractor.create({
        data: { code: `${tag}-F${i}`, name: `${tag} Firma ${i}` },
        select: { id: true },
      });
      subIds.push(s.id);
      const d = await prisma.kartelaDispatch.create({
        data: { dispatchNo: `${tag}-KD${i}`, subcontractorId: s.id },
        select: { id: true },
      });
      dispatchIds.push(d.id);
    }

    const listDisp = async (sub: string) => {
      const res = (await kartela.listDispatches({
        subcontractorId: sub,
        pageSize: 100,
      })) as unknown as { data: Array<{ id: string }> };
      return res.data.filter((d) => dispatchIds.includes(d.id));
    };
    const dispOne = await listDisp(subIds[0] as string);
    check("tek firma — davranış değişmedi", dispOne.length === 1, `${dispOne.length}`);
    const dispTwo = await listDisp(`${subIds[0]},${subIds[1]}`);
    check(
      "iki firma → İKİSİ de gelir",
      dispTwo.length === 2 && !dispTwo.some((d) => d.id === dispatchIds[2]),
      `${dispTwo.length} sevk`,
    );

    // Kartela stoğu (groupBy) — kumaş/renk çoklu.
    for (const [i, pair] of [
      [itemA.id, colX.id],
      [itemB.id, colY.id],
      [itemC.id, colZ.id],
    ].entries()) {
      const sw = await prisma.swatch.create({
        data: {
          cardNumber: `${tag}-SW${i}`,
          barcode: `${tag}-SWB${i}`,
          itemId: pair[0] as string,
          colorId: pair[1] as string,
        },
        select: { id: true },
      });
      swatchIds.push(sw.id);
    }
    const stockOf = async (itemCsv: string) => {
      const res = await kartela.getStock({ itemId: itemCsv });
      return (res.data ?? []).filter((g) =>
        [itemA.id, itemB.id, itemC.id].includes(g.itemId),
      );
    };
    const stockOne = await stockOf(itemA.id);
    check("stok — tek kumaş davranışı değişmedi", stockOne.length === 1, `${stockOne.length} grup`);
    const stockTwo = await stockOf(`${itemA.id},${itemB.id}`);
    check(
      "stok — iki kumaş → İKİ grup (sessiz '0 çeşit' YOK)",
      stockTwo.length === 2 && !stockTwo.some((g) => g.itemId === itemC.id),
      `${stockTwo.length} grup`,
    );

    // ── 6) ÜRÜN DENGESİ — itemId çoklu ────────────────────────────────────────
    console.log("\n[6] Ürün Dengesi: kumaş çoklu");
    const balanceOf = async (itemCsv: string) => {
      const res = await balance.getBalance({ itemId: itemCsv });
      return (res.data ?? []).filter((g) =>
        [itemA.id, itemB.id, itemC.id].includes(g.itemId),
      );
    };
    const balOne = await balanceOf(itemA.id);
    check("tek kumaş — davranış değişmedi", balOne.length === 1, `${balOne.length} grup`);
    const balTwo = await balanceOf(`${itemA.id},${itemB.id}`);
    check(
      "iki kumaş → İKİ grup",
      balTwo.length === 2 && !balTwo.some((g) => g.itemId === itemC.id),
      `${balTwo.length} grup`,
    );
  } finally {
    // Bağımlılık sırası: yaprak → kök.
    await prisma.swatch.deleteMany({ where: { id: { in: swatchIds } } });
    await prisma.kartelaDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.subcontractor.deleteMany({ where: { id: { in: subIds } } });
    await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.workOrderStep.deleteMany({ where: { id: { in: stepIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    await prisma.station.deleteMany({ where: { id: { in: stationIds } } });
    await prisma.color.deleteMany({
      where: { id: { in: [colX.id, colY.id, colZ.id] } },
    });
    await prisma.item.deleteMany({
      where: { id: { in: [itemA.id, itemB.id, itemC.id, itemD.id] } },
    });
    console.log(`\n(temizlendi — ${tag} fixture'ları silindi)`);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
