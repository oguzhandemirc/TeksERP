// =============================================================================
// Test: Sevkiyat LİSTESİ filtreleri + sıralama + eşleşme rozeti (listShipments)
// Çalıştır: npx tsx scripts/test_shipment_filters.ts
// Kurulum: 2 müşteri; ürün A(patos)+B, renk X(mavi)+Y.
//   S1 = A/X topu (tek çuval, tek top)
//   S2 = B/Y topu
//   S3 = A/Y topu + B/X topu (ayrı toplar; TEK TOP eşleşmesi ayrımının çekirdeği)
//   createShipment onay kapalı → DISPATCHED (değilse zorla dispatch).
// Doğrulananlar:
//   A) filter[itemId]=A       → S1 + S3 (S2 gelmez)
//   B) filter[colorId]=X      → S1 + S3 (S3'te B/X)
//   C) filter[itemId]=A & colorId=X (TEK TOP) → yalnız S1; S3 GELMEZ (A ve X ayrı toplarda)
//   D) Eşleşme rozeti: itemId=A ile S1.matchRollCount=1, S3.matchRollCount=1;
//      filtre yokken matchRollCount alanı HİÇ yok (undefined)
//   E) filter[hasReturns]=true → yalnız iade taşıyan sevk
//   F) filter[destination]=EXPORT → yalnız EXPORT sevk
//   G) sortBy=shipmentNo sortOrder=asc → artan shipmentNo (createdAt desc default'tan farklı)
//   H) cursor limit=1 → 3 sevkiyat tekrar/atlama olmadan sayfalanır
//   I) müşteri izolasyonu: yabancı müşteri filtresi 0 satır
// =============================================================================
import type { Request } from "express";
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";
import { ReturnService } from "../src/services/return.service";

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

interface Row {
  kind: "SHIPMENT" | "DIRECT";
  id: string;
  shipmentNo: string;
  status: string;
  matchRollCount?: number;
}
interface ListResp {
  success: boolean;
  data: Row[];
  pagination?: { nextCursor: string | null; hasMore: boolean; limit: number };
}

// Salt-okuma liste ucu Express Request bekler — minimal query taşıyıcı (HTTP yok).
const mkReq = (query: Record<string, string>): Request => ({ query } as unknown as Request);

async function main() {
  const ts = Date.now();
  const shipping = new ShippingService();
  const returns = new ReturnService();

  const admin =
    (await prisma.user.findUnique({ where: { username: "admin" }, select: { id: true } })) ??
    (await prisma.user.findFirst({ select: { id: true } }));
  if (!admin) throw new Error("Test için kullanıcı yok — seed çalıştırın.");
  const userId = admin.id;

  // ---- Fixture master data --------------------------------------------------
  const customer = await prisma.customer.create({
    data: { code: `TEST-SFL-${ts}`, name: `TEST SEVK FİLTRE MÜŞTERİSİ ${ts}` },
    select: { id: true },
  });
  const otherCustomer = await prisma.customer.create({
    data: { code: `TEST-SFL-X-${ts}`, name: `TEST SEVK FİLTRE YABANCI ${ts}` },
    select: { id: true },
  });
  const itemA = await prisma.item.create({
    data: { code: `TST-SFL-A-${ts}`, name: `TEST PATOS ${ts}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const itemB = await prisma.item.create({
    data: { code: `TST-SFL-B-${ts}`, name: `TEST ÜRÜN B ${ts}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const colorX = await prisma.color.create({
    data: { code: `TST-SFL-X-${ts}`, name: "TEST MAVI" },
    select: { id: true },
  });
  const colorY = await prisma.color.create({
    data: { code: `TST-SFL-Y-${ts}`, name: "TEST RENK Y" },
    select: { id: true },
  });
  const reason = await prisma.returnReason.create({
    data: { code: `TEST-SFL-RSN-${ts}`, name: "TEST İADE NEDENİ" },
    select: { id: true, name: true },
  });

  let rollSeq = 0;
  const mkRoll = (itemId: string, colorId: string, qty: number) =>
    prisma.roll.create({
      data: {
        barcode: `TEST-SFL-R${++rollSeq}-${ts}`,
        itemId,
        colorId,
        status: "WAREHOUSE",
        currentQty: qty,
        initialQty: qty,
        width: 150,
        qualityGrade: "1.KALITE",
        form: "TOP",
        entrySource: "SUPPLIER_RECEIPT",
      },
      select: { id: true, barcode: true },
    });

  // Bir sevkiyat kur (kendi çuvalı + toplar); onay açıksa zorla dispatch et.
  const mkShipment = async (
    rolls: Array<{ id: string; barcode: string | null }>,
  ): Promise<{ id: string; shipmentNo: string }> => {
    const openRes = (await shipping.openSack({ customerId: customer.id }, userId)) as {
      data: { id: string; sackNo: string };
    };
    const sackId = openRes.data.id;
    for (const r of rolls) await shipping.scanIntoSack({ sackId, barcode: r.barcode! }, userId);
    const res = (await shipping.createShipment(
      { sackIds: [sackId], customerId: customer.id, orderIds: [] },
      userId,
    )) as { data: { id: string; shipmentNo: string; status: string } };
    if (res.data.status !== "DISPATCHED") {
      await shipping.dispatchShipment(res.data.id, {}, userId);
    }
    return { id: res.data.id, shipmentNo: res.data.shipmentNo };
  };

  const rAX = await mkRoll(itemA.id, colorX.id, 100); // S1
  const rBY = await mkRoll(itemB.id, colorY.id, 50); //  S2
  const rAY = await mkRoll(itemA.id, colorY.id, 30); //  S3
  const rBX = await mkRoll(itemB.id, colorX.id, 20); //  S3
  const allRollIds = [rAX.id, rBY.id, rAY.id, rBX.id];

  const s1 = await mkShipment([rAX]);
  const s2 = await mkShipment([rBY]);
  const s3 = await mkShipment([rAY, rBX]);
  const shipIds = [s1.id, s2.id, s3.id];

  // Her list çağrısı bu müşteriye izole edilir (DB'deki diğer sevklerden ayrık).
  const base = { "filter[customerId]": customer.id };
  const list = async (extra: Record<string, string> = {}): Promise<ListResp> =>
    (await shipping.listShipments(mkReq({ ...base, ...extra }))) as ListResp;
  const idsOf = (r: ListResp) => new Set(r.data.map((x) => x.id));

  try {
    // ---- A) İçerik filtresi: itemId=A → S1 + S3 --------------------------
    const byItemA = await list({ "filter[itemId]": itemA.id });
    const setA = idsOf(byItemA);
    check(
      "filter[itemId]=A → S1 ve S3 gelir, S2 gelmez",
      setA.has(s1.id) && setA.has(s3.id) && !setA.has(s2.id) && setA.size === 2,
      `ids=${[...setA].length}`,
    );

    // ---- B) İçerik filtresi: colorId=X → S1 + S3 (S3'te B/X) -------------
    const byColorX = await list({ "filter[colorId]": colorX.id });
    const setX = idsOf(byColorX);
    check(
      "filter[colorId]=X → S1 ve S3 gelir, S2 gelmez",
      setX.has(s1.id) && setX.has(s3.id) && !setX.has(s2.id) && setX.size === 2,
      `ids=${[...setX].length}`,
    );

    // ---- C) TEK TOP: itemId=A & colorId=X → yalnız S1 -------------------
    const byAX = await list({ "filter[itemId]": itemA.id, "filter[colorId]": colorX.id });
    const setAX = idsOf(byAX);
    check(
      "filter[itemId]=A & colorId=X (TEK TOP) → yalnız S1; S3 GELMEZ",
      setAX.has(s1.id) && !setAX.has(s3.id) && !setAX.has(s2.id) && setAX.size === 1,
      `ids=${[...setAX].join(",")}`,
    );

    // ---- D) Eşleşme rozeti ----------------------------------------------
    const badgeRowS1 = byItemA.data.find((r) => r.id === s1.id);
    const badgeRowS3 = byItemA.data.find((r) => r.id === s3.id);
    check(
      "Rozet: itemId=A ile S1.matchRollCount=1, S3.matchRollCount=1",
      badgeRowS1?.matchRollCount === 1 && badgeRowS3?.matchRollCount === 1,
      `S1=${badgeRowS1?.matchRollCount} S3=${badgeRowS3?.matchRollCount}`,
    );
    const plain = await list();
    const plainS3 = plain.data.find((r) => r.id === s3.id);
    check(
      "Filtre yokken matchRollCount alanı HİÇ eklenmez (undefined)",
      !!plainS3 && !("matchRollCount" in plainS3),
      `has=${plainS3 ? "matchRollCount" in plainS3 : "row yok"}`,
    );

    // ---- I) Müşteri izolasyonu ------------------------------------------
    const foreign = (await shipping.listShipments(
      mkReq({ "filter[customerId]": otherCustomer.id }),
    )) as ListResp;
    check("Yabancı müşteri filtresi 0 satır", foreign.data.length === 0, `count=${foreign.data.length}`);

    // ---- G) Sıralama: shipmentNo asc ------------------------------------
    const asc = await list({ sortBy: "shipmentNo", sortOrder: "asc" });
    const ascMine = asc.data.filter((r) => shipIds.includes(r.id));
    const ascNos = ascMine.map((r) => r.shipmentNo);
    const sortedNos = [...ascNos].sort();
    check(
      "sortBy=shipmentNo asc → artan shipmentNo",
      ascNos.length === 3 && JSON.stringify(ascNos) === JSON.stringify(sortedNos),
      `sıra=${ascNos.join(",")}`,
    );
    const def = await list(); // createdAt desc default
    const defMine = def.data.filter((r) => shipIds.includes(r.id)).map((r) => r.id);
    check(
      "Default (createdAt desc) sıra asc shipmentNo'dan farklı",
      JSON.stringify(defMine) !== JSON.stringify(ascMine.map((r) => r.id)),
      `def=${defMine.join(",")}`,
    );

    // ---- H) Cursor limit=1 sayfalama ------------------------------------
    const seen: string[] = [];
    let cursor: string | null | undefined;
    let guard = 0;
    do {
      const q: Record<string, string> = { ...base, mode: "cursor", limit: "1" };
      if (cursor) q.cursor = cursor;
      const pageResp = (await shipping.listShipments(mkReq(q))) as ListResp;
      for (const r of pageResp.data) seen.push(r.id);
      cursor = pageResp.pagination?.nextCursor;
      guard++;
    } while (cursor && guard < 20);
    const seenSet = new Set(seen);
    check(
      "Cursor limit=1: 3 sevkiyat tekrar/atlama olmadan sayfalandı",
      seen.length === 3 && seenSet.size === 3 && shipIds.every((id) => seenSet.has(id)),
      `seen=${seen.length} unique=${seenSet.size}`,
    );

    // ---- F) Hedef filtresi: EXPORT --------------------------------------
    // S3'ü EXPORT yap (DISPATCHED → setDestination PLANNED ister; filtre testi için
    // doğrudan güncelle — sınanan şey filtre, setDestination değil).
    await prisma.shipment.update({ where: { id: s3.id }, data: { destination: "EXPORT" } });
    const exportOnly = await list({ "filter[destination]": "EXPORT" });
    const setExp = idsOf(exportOnly);
    check(
      "filter[destination]=EXPORT → yalnız S3",
      setExp.has(s3.id) && !setExp.has(s1.id) && !setExp.has(s2.id) && setExp.size === 1,
      `ids=${[...setExp].join(",")}`,
    );

    // ---- E) İade filtresi -----------------------------------------------
    // S2'nin topunu iade et → yalnız S2 iade taşır.
    await returns.createReturn({ rollId: rBY.id, reasonId: reason.id }, userId);
    const withReturns = await list({ "filter[hasReturns]": "true" });
    const setRet = idsOf(withReturns);
    check(
      "filter[hasReturns]=true → yalnız iade taşıyan S2",
      setRet.has(s2.id) && !setRet.has(s1.id) && !setRet.has(s3.id) && setRet.size === 1,
      `ids=${[...setRet].join(",")}`,
    );
  } finally {
    await prisma.rollReturn.deleteMany({ where: { rollId: { in: allRollIds } } }).catch(() => {});
    await prisma.roll.updateMany({ where: { id: { in: allRollIds } }, data: { shipmentId: null, sackId: null } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: allRollIds } } }).catch(() => {});
    await prisma.sack.deleteMany({ where: { shipmentId: { in: shipIds } } }).catch(() => {});
    for (const id of shipIds) await prisma.shipment.delete({ where: { id } }).catch(() => {});
    await prisma.returnReason.delete({ where: { id: reason.id } }).catch(() => {});
    await prisma.color.deleteMany({ where: { id: { in: [colorX.id, colorY.id] } } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: { in: [itemA.id, itemB.id] } } }).catch(() => {});
    await prisma.customer.delete({ where: { id: customer.id } }).catch(() => {});
    await prisma.customer.delete({ where: { id: otherCustomer.id } }).catch(() => {});
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
