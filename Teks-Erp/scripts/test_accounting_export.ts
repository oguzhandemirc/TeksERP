// =============================================================================
// Test: Muhasebe Excel dökümü (accounting-export.service)
// Çalıştır: npx tsx scripts/test_accounting_export.ts
// Kurulum: 1 müşteri (vergi no'lu), 2 ürün (A/B), 1 renk, 1 DISPATCHED sevkiyat
//   (EXPORT, 2 çuval). Sevk ANINDA 5 top / 155m:
//     Çuval-1: 2 top (A, renkli, 150cm, 35'er m, 65,8kg) + iade edilen top (A, 150cm, 10m)
//     Çuval-2: 1 top (A, 150cm, 35m) + 1 top (B, ensiz, 40m, 40kg)
//   Sonra 10m'lik top İADE alınır → sevkiyattan KOPARILIR (aşağıdaki nota bak) →
//   canlı çuval içeriği 4 top / 145m'e düşer, brüt geri-ekleme onu 5/155'e döndürür.
// Doğrulananlar:
//   1. shipments: tek satır, çuval/top/metre/kg/vergi no/yön doğru (BRÜT)
//   2. detail: ürün+renk+en grubu (A=4 top/115m brüt, B=1 top/40m)
//   3. byCustomer: müşteri icmali (1 sevk, 155m brüt, 105,8kg)
//   4. byProduct: ürün icmali (A 115m brüt, B 40m)
//   5. returns + returnMeters (iade A, 10m)
//   6. totals tutarlı; filtre (filter[customerId]) scope eder
// =============================================================================
import type { Request } from "express";
import prisma from "../src/lib/prisma";
import { buildDispatchAccountingExport } from "../src/services/accounting-export.service";
import { AppError } from "../src/utils/app-error";

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

interface ExportData {
  shipments: Array<{
    shipmentNo: string;
    taxNumber: string;
    destination: string;
    sackCount: number;
    rollCount: number;
    totalMeters: number;
    totalKg: number;
  }>;
  detail: Array<{ shipmentNo: string; itemName: string; colorName: string; width: number | null; rollCount: number; meters: number }>;
  byCustomer: Array<{ customerName: string; shipmentCount: number; rollCount: number; sackCount: number; totalMeters: number; totalKg: number }>;
  byProduct: Array<{ itemName: string; rollCount: number; totalMeters: number }>;
  returns: Array<{ itemName: string; customerName: string; fromShipmentNo: string; meters: number; reason: string }>;
  totals: { shipmentCount: number; sackCount: number; rollCount: number; totalMeters: number; totalKg: number; returnMeters: number };
  range: { mode?: string; selectedCount?: number; from?: string | null; to?: string | null };
}

async function main() {
  const ts = Date.now();

  const someUser = await prisma.user.findFirst({ select: { id: true } });
  if (!someUser) throw new Error("Seed kullanıcı yok — önce npm run seed");

  // ⚠️ FIXTURE ADLARI ÇAKIŞAMAZ. Bu test master-data'yı `prisma.*.create` ile
  // DOĞRUDAN yazar — Item/ColorService'in ad-mükerrer guard'ı devreye girmez, yani
  // gerçekçi bir ad sessizce İKİNCİ AKTİF KAYIT doğurur. Eskiden "MC 156" /
  // "NEPS VUAL" / "BEYAZ-GÜMÜŞ" kullanılıyordu; fabrikanın canlı verisinde
  // `nepsvual` (aktif ürün) ve `RNK-260717-6696` "BEYAZ-GÜMÜŞ" (aktif renk) ZATEN
  // VAR → test koştuğu sürece `test_consistency` §18 mükerrer-ad bekçisi haklı
  // olarak kırmızıya döner, koşum çökerse artık kalıcı olur. Adlar artık `ts` ile
  // benzersiz; doğrulanan şey (ürün+renk+en gruplaması) aynen sınanır.
  const NAME_A = `TEST-AEX KUMAŞ A ${ts}`;
  const NAME_B = `TEST-AEX KUMAŞ B ${ts}`;
  const NAME_CUST = `TEST-AEX MÜŞTERİ ${ts}`;

  const customer = await prisma.customer.create({
    data: { code: `TST-AEX-${ts}`, name: NAME_CUST, taxNumber: "1234567890" },
    select: { id: true },
  });
  const itemA = await prisma.item.create({
    data: { code: `TST-AEX-A-${ts}`, name: NAME_A, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const itemB = await prisma.item.create({
    data: { code: `TST-AEX-B-${ts}`, name: NAME_B, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const color = await prisma.color.create({
    data: { code: `TST-AEX-C-${ts}`, name: `TEST-AEX RENK ${ts}` },
    select: { id: true },
  });
  const shipment = await prisma.shipment.create({
    data: {
      shipmentNo: `TEST-AEX-${ts}`,
      customerId: customer.id,
      status: "DISPATCHED",
      destination: "EXPORT",
      procedureCode: "GB-2026-999",
      dispatchedAt: new Date(),
    },
    select: { id: true },
  });
  const sack1 = await prisma.sack.create({
    data: { sackNo: `TEST-AEX-SK1-${ts}`, customerId: customer.id, shipmentId: shipment.id, seq: 1, weightKg: 65.8 },
    select: { id: true },
  });
  const sack2 = await prisma.sack.create({
    data: { sackNo: `TEST-AEX-SK2-${ts}`, customerId: customer.id, shipmentId: shipment.id, seq: 2, weightKg: 40 },
    select: { id: true },
  });
  const mkRoll = (n: number, itemId: string, colorId: string | null, sackId: string, qty: number, w: number | null) =>
    prisma.roll.create({
      data: {
        barcode: `TEST-AEX-R${n}-${ts}`,
        itemId,
        colorId,
        status: "SHIPPED",
        currentQty: qty,
        initialQty: qty,
        width: w,
        qualityGrade: "A",
        entrySource: "SUPPLIER_RECEIPT",
        shipmentId: shipment.id,
        sackId,
      },
      select: { id: true },
    });

  const r1 = await mkRoll(1, itemA.id, color.id, sack1.id, 35, 150);
  const r2 = await mkRoll(2, itemA.id, color.id, sack1.id, 35, 150);
  const r3 = await mkRoll(3, itemA.id, color.id, sack2.id, 35, 150);
  const r4 = await mkRoll(4, itemB.id, null, sack2.id, 40, null);
  // 5. top: sevk edildi, SONRA iade alındı. Ayrı bir top olması ŞART — iade
  // TAMAMEN TOP BAZLIDIR (`return.service.createReturn`: `qty = roll.currentQty`),
  // kısmi metraj iadesi diye bir şey yok.
  const r5 = await mkRoll(5, itemA.id, color.id, sack1.id, 10, 150);

  // ⚠️ İADE = TOPU SEVKİYATTAN KOPARIR. `createReturn` tx'i topu
  // `shipmentId: null, sackId: null, status: WAREHOUSE` yapar → iade edilen top
  // çuvalın CANLI içeriğinden düşer. Muhasebe dökümü bunu `RollReturn`'den geri
  // ekleyerek sevk anını (BRÜT) kurar.
  //
  // Bu iki satır fixture'ın en kritik parçasıdır: bunlar olmadan top hem çuvalda
  // (35+35+35+40+10=155) hem de geri-eklemede (+10) sayılırdı; toplam yine 155
  // çıktığı için test YEŞİL kalır ama artık HİÇBİR ŞEYİ ayırt etmez — geri-ekleme
  // "kopmuş topu geri getiriyor" mu yoksa "duran topu ikinci kez sayıyor" mu,
  // sonuçlar birebir aynı olur. Gerçek akışta üretilemeyen bir duruma göre
  // beklenti yazmak, testi sessizce kör bırakır.
  await prisma.roll.update({
    where: { id: r5.id },
    data: { status: "WAREHOUSE", shipmentId: null, sackId: null },
  });

  const ret = await prisma.rollReturn.create({
    data: {
      rollId: r5.id,
      fromShipmentId: shipment.id,
      customerId: customer.id,
      itemId: itemA.id,
      colorId: color.id,
      width: 150,
      qty: 10,
      reasonText: "Test iade",
      receivedById: someUser.id,
    },
    select: { id: true },
  });

  try {
    // 0) FIXTURE SEDDİ — brüt rakamın NEREDEN geldiğini sabitler.
    // Çuvalların CANLI içeriği iadeden sonra 4 top / 145m olmalı. Bu doğrulanmazsa
    // aşağıdaki "5 top / 155m" beklentisi iki bambaşka sebeple de sağlanabilirdi
    // (geri-ekleme çalıştı / iade edilen top hiç kopmadı ve iki kez sayıldı) ve
    // test hangisi olduğunu SÖYLEYEMEZDİ. Burası kırmızıysa sorun serviste değil,
    // fixture'ın gerçek `createReturn` davranışını taklit etmeyi bırakmasındadır.
    const live = await prisma.roll.aggregate({
      where: { shipmentId: shipment.id, sackId: { not: null } },
      _count: { _all: true },
      _sum: { currentQty: true },
    });
    check(
      "fixture: iade sonrası çuvalların CANLI içeriği 4 top / 145m (brüt geri-eklemeden ÖNCE)",
      live._count._all === 4 && Number(live._sum.currentQty ?? 0) === 145,
      `${live._count._all}/${Number(live._sum.currentQty ?? 0)}`
    );

    // filter[customerId] ile scope — gerçek query yolu (parseQueryParams).
    const req = { query: { "filter[customerId]": customer.id } } as unknown as Request;
    const res = await buildDispatchAccountingExport(req);
    const d = res.data as ExportData;

    // 1) shipments
    check("shipments: tek satır", d.shipments.length === 1, `${d.shipments.length}`);
    const s = d.shipments[0];
    // ⚠️ SEVK SATIRLARI BRÜT'TÜR — iade edilen 10m'lik top sevk rakamından
    // DÜŞÜLMEZ, `RollReturn` üzerinden geri eklenir. Fixture sevk anında 5 top /
    // 155m gönderir, sonra 1 top / 10m iade alınır (canlı içerik 4/145'e düşer,
    // yukarıdaki fixture seddi bunu kanıtlar). Net = 155 − 10 = 145'i muhasebeci
    // "sevk − iade" ile kendisi bulur. Eskiden satırlar net idi VE ayrıca iade
    // sayfası vardı → aynı metraj iki kez düşüyordu. Bu testi "145" beklemeye geri
    // çevirmek o çift-düşümü diriltir.
    check(
      "shipment BRÜT: 2 çuval / 5 top / 155m / 105,8kg",
      s?.sackCount === 2 && s?.rollCount === 5 && s?.totalMeters === 155 && Math.abs(s.totalKg - 105.8) < 0.001,
      `${s?.sackCount}/${s?.rollCount}/${s?.totalMeters}/${s?.totalKg}`
    );
    check("shipment: vergi no + yön", s?.taxNumber === "1234567890" && s?.destination === "EXPORT", `${s?.taxNumber}/${s?.destination}`);

    // 2) detail (ürün+renk+en grubu)
    const dA = d.detail.find((r) => r.itemName === NAME_A);
    const dB = d.detail.find((r) => r.itemName === NAME_B);
    check("detail BRÜT: kumaş A 4 top / 115m / 150cm", dA?.rollCount === 4 && dA?.meters === 115 && dA?.width === 150, `${dA?.rollCount}/${dA?.meters}/${dA?.width}`);
    check("detail: kumaş B 1 top / 40m / ensiz", dB?.rollCount === 1 && dB?.meters === 40 && dB?.width === null);

    // 3) byCustomer
    check("byCustomer: tek müşteri", d.byCustomer.length === 1);
    const c = d.byCustomer[0];
    check(
      "byCustomer BRÜT: 1 sevk / 5 top / 2 çuval / 155m / 105,8kg",
      c?.shipmentCount === 1 && c?.rollCount === 5 && c?.sackCount === 2 && c?.totalMeters === 155 && Math.abs(c.totalKg - 105.8) < 0.001
    );

    // 4) byProduct
    const pA = d.byProduct.find((p) => p.itemName === NAME_A);
    const pB = d.byProduct.find((p) => p.itemName === NAME_B);
    check("byProduct BRÜT: kumaş A 115m / 4 top", pA?.totalMeters === 115 && pA?.rollCount === 4);
    check("byProduct: kumaş B 40m / 1 top", pB?.totalMeters === 40 && pB?.rollCount === 1);

    // 5) returns
    check("returns: 1 iade satırı", d.returns.length === 1, `${d.returns.length}`);
    const rr = d.returns[0];
    check(
      "return: ürün/müşteri/sevk/metre/neden",
      rr?.itemName === NAME_A && rr?.customerName === NAME_CUST && rr?.fromShipmentNo === `TEST-AEX-${ts}` && rr?.meters === 10 && rr?.reason === "Test iade"
    );

    // 6) totals
    // Brüt sevk + ayrı iade satırı → muhasebeci "155 − 10 = 145" ile net'i bulur.
    check(
      "totals BRÜT: 1 sevk / 2 çuval / 5 top / 155m / 105,8kg / iade 10m",
      d.totals.shipmentCount === 1 &&
        d.totals.sackCount === 2 &&
        d.totals.rollCount === 5 &&
        d.totals.totalMeters === 155 &&
        Math.abs(d.totals.totalKg - 105.8) < 0.001 &&
        d.totals.returnMeters === 10,
      `${d.totals.shipmentCount}/${d.totals.sackCount}/${d.totals.rollCount}/${d.totals.totalMeters}/${d.totals.totalKg}/${d.totals.returnMeters}`
    );

    // Toplam tutarlılık: shipments toplamı = byCustomer toplamı = byProduct metre
    const sumShipMeters = d.shipments.reduce((a, r) => a + r.totalMeters, 0);
    const sumCustMeters = d.byCustomer.reduce((a, r) => a + r.totalMeters, 0);
    const sumProdMeters = d.byProduct.reduce((a, r) => a + r.totalMeters, 0);
    check(
      "tutarlılık: shipments = byCustomer = byProduct metre",
      sumShipMeters === sumCustMeters && sumCustMeters === sumProdMeters && sumShipMeters === d.totals.totalMeters
    );

    // 7) SEÇİM (A) modu — ?ids= yalnız işaretli sevkleri döndürür + range.mode
    const selReq = { query: { ids: shipment.id } } as unknown as Request;
    const sd = (await buildDispatchAccountingExport(selReq)).data as ExportData;
    check(
      "selection: ids ile yalnız o sevk",
      sd.shipments.length === 1 && sd.shipments[0]?.shipmentNo === `TEST-AEX-${ts}`,
      `${sd.shipments.length}`
    );
    check("selection: range.mode=selection, count=1", sd.range?.mode === "selection" && sd.range?.selectedCount === 1);
    check("selection: iade fromShipmentId'e göre kapsanır", sd.returns.length === 1);

    // Olmayan (ama geçerli formatlı) id → 0 sevk (filtre gerçekten uygulanıyor)
    const emptyReq = { query: { ids: "00000000-0000-0000-0000-000000000000" } } as unknown as Request;
    const ed = (await buildDispatchAccountingExport(emptyReq)).data as ExportData;
    check("selection: olmayan id → 0 sevk", ed.shipments.length === 0);

    // Geçersiz (UUID olmayan) ids → 500 değil, açık 400
    let badIdsRejected = false;
    try {
      await buildDispatchAccountingExport({ query: { ids: "abc,not-a-uuid" } } as unknown as Request);
    } catch (e) {
      badIdsRejected = e instanceof AppError && e.statusCode === 400;
    }
    check("selection: geçersiz ids → 400 (500 değil)", badIdsRejected);
  } finally {
    await prisma.rollReturn.delete({ where: { id: ret.id } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: [r1.id, r2.id, r3.id, r4.id, r5.id] } } });
    await prisma.sack.deleteMany({ where: { shipmentId: shipment.id } });
    await prisma.shipment.delete({ where: { id: shipment.id } }).catch(() => {});
    await prisma.color.delete({ where: { id: color.id } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: { in: [itemA.id, itemB.id] } } });
    await prisma.customer.delete({ where: { id: customer.id } }).catch(() => {});
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
