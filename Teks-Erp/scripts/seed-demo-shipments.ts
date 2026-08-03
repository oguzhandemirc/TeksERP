// =============================================================================
// DEMO VERİSİ — Sevkiyat detay ekranını elle test etmek için (TEMİZLİK YOK, kalıcı).
// Çalıştır: npx tsx scripts/seed-demo-shipments.ts   (Postgres localhost ayakta)
//
// Üretir:
//  - 1 BÜYÜK sevkiyat (~300 çuval × ~10 top ≈ 3000 top) → sanallaştırma + facet
//    (kumaş/renk/kalite) + arama testi; + ~40 iade (çuval kaynağıyla) + 2 sipariş.
//  - Birkaç KÜÇÜK sevkiyat (farklı kumaş/renk karışımı, EXPORT, PLANNED, iadeli) →
//    liste ekranı filtre çeşitliliği (patos/mavi/iade/hedef).
// Doğrudan prisma createMany ile (FK'lar tutarlı: roll.sackId+shipmentId = sack).
// =============================================================================
import prisma from "../src/lib/prisma";

const TAG = Date.now().toString(36).slice(-6); // kısa benzersiz etiket

const FABRICS = [
  { code: "PATOS", name: "Patos" },
  { code: "KADIFE", name: "Kadife" },
  { code: "SUET", name: "Süet" },
  { code: "GABARDIN", name: "Gabardin" },
  { code: "POPLIN", name: "Poplin" },
];
// Adlar "Fixture" önekli — gerekçe `prisma/seed-fixtures.ts` içinde (fabrikanın
// canlı verisiyle AD çakışması → §18 mükerrer kırmızısı). Kodlar çözüm anahtarı,
// onlara dokunma. Bu liste seed-fixtures ile aynı adları yazmalı; ayrışırsa
// hangisi en son koştuysa diğerinin adını ezer.
const COLORS = [
  { code: "MAVI", name: "Fixture Mavi", hex: "#2563eb" },
  { code: "KIRMIZI", name: "Fixture Kırmızı", hex: "#dc2626" },
  { code: "SIYAH", name: "Fixture Siyah", hex: "#111827" },
  { code: "BEYAZ", name: "Fixture Beyaz", hex: "#e5e7eb" },
  { code: "YESIL", name: "Fixture Yeşil", hex: "#16a34a" },
  { code: "LACIVERT", name: "Fixture Lacivert", hex: "#1e3a8a" },
];
const QUALITIES: (string | null)[] = ["1.KALITE", "1.KALITE", "2.KALITE", null];
const WIDTHS = [140, 150, 150, 160, 180];

const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const rnd = (min: number, max: number) => Math.round((min + Math.random() * (max - min)) * 10) / 10;

async function main() {
  console.log(`\n▶ DEMO sevkiyat verisi üretiliyor (etiket: ${TAG})...\n`);

  const admin =
    (await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } })) ??
    (await prisma.user.findFirst({ select: { id: true } }));
  if (!admin) throw new Error("Kullanıcı yok — önce seed çalıştırın.");

  // Müşteri + şube (find-or-create).
  const customer = await prisma.customer.upsert({
    where: { code: "DEMO-MUS" },
    update: {},
    create: { code: "DEMO-MUS", name: "DEMO TEKSTİL A.Ş." },
    select: { id: true },
  });
  const branch =
    (await prisma.customerBranch.findFirst({ where: { customerId: customer.id }, select: { id: true } })) ??
    (await prisma.customerBranch.create({
      data: { customerId: customer.id, code: "MRK", name: "Merkez Şube", city: "Bursa" },
      select: { id: true },
    }));

  // Kumaş + renk (upsert by code → varsa reuse).
  const items = await Promise.all(
    FABRICS.map((f) =>
      prisma.item.upsert({
        where: { code: f.code },
        update: {},
        create: { code: f.code, name: f.name, itemType: "FABRIC", unit: "MT" },
        select: { id: true, code: true, name: true },
      }),
    ),
  );
  const colors = await Promise.all(
    COLORS.map((c) =>
      prisma.color.upsert({
        where: { code: c.code },
        update: {},
        create: { code: c.code, name: c.name, hex: c.hex },
        select: { id: true, code: true, name: true },
      }),
    ),
  );
  const patos = items.find((i) => i.code === "PATOS")!;
  const kadife = items.find((i) => i.code === "KADIFE")!;
  const suet = items.find((i) => i.code === "SUET")!;
  const mavi = colors.find((c) => c.code === "MAVI")!;

  // İade nedenleri (renkli rozet).
  const reasons = await Promise.all(
    [
      { code: "DEMO-BOYA", name: "Hatalı boya", color: "#dc2626" },
      { code: "DEMO-METRAJ", name: "Eksik metraj", color: "#d97706" },
      { code: "DEMO-LEKE", name: "Leke/kusur", color: "#7c3aed" },
    ].map((r) =>
      prisma.returnReason.upsert({
        where: { code: r.code },
        update: {},
        create: r,
        select: { id: true },
      }),
    ),
  );

  let shipCounter = 0;

  /** Bir DISPATCHED/PLANNED sevkiyat kurar: N çuval × ~R top, verilen kumaş/renk havuzundan. */
  async function makeShipment(opts: {
    label: string;
    sackCount: number;
    rollsPerSack: [number, number];
    itemPool: { id: string }[];
    colorPool: { id: string }[];
    planned?: boolean;
    destination?: "DOMESTIC" | "EXPORT";
    returnsCount?: number;
  }) {
    const idx = ++shipCounter;
    const now = new Date();
    const dispatchedAt = opts.planned ? null : now;
    const shipment = await prisma.shipment.create({
      data: {
        shipmentNo: `DEMO-SVK-${TAG}-${idx}`,
        customerId: customer.id,
        branchId: branch.id,
        status: opts.planned ? "PLANNED" : "DISPATCHED",
        destination: opts.destination ?? "DOMESTIC",
        dispatchedAt,
        dispatchedById: opts.planned ? null : admin!.id,
        plateNumber: `16 DEMO ${100 + idx}`,
        driverName: `Sürücü ${idx}`,
        carrier: "DEMO Nakliyat",
      },
      select: { id: true, shipmentNo: true },
    });

    // Çuvallar (createMany → sonra id'leri çek).
    await prisma.sack.createMany({
      data: Array.from({ length: opts.sackCount }, (_, i) => ({
        sackNo: `CV-${TAG}-${idx}-${String(i + 1).padStart(3, "0")}`,
        seq: i + 1,
        weightKg: rnd(14, 42),
        shipmentId: shipment.id,
        customerId: customer.id,
        branchId: branch.id,
      })),
    });
    const sacks = await prisma.sack.findMany({
      where: { shipmentId: shipment.id },
      orderBy: { seq: "asc" },
      select: { id: true, seq: true },
    });

    // Toplar (her çuvala R adet; kumaş/renk/kalite/en havuzdan rastgele).
    const rollStatus = opts.planned ? "WAREHOUSE" : "SHIPPED";
    type RollSeed = {
      barcode: string;
      itemId: string;
      colorId: string;
      status: "WAREHOUSE" | "SHIPPED";
      currentQty: number;
      initialQty: number;
      width: number;
      qualityGrade: string | null;
      form: "TOP";
      entrySource: "SUPPLIER_RECEIPT";
      sackId: string;
      shipmentId: string;
    };
    const rolls: RollSeed[] = [];
    let rn = 0;
    for (const s of sacks) {
      const count = Math.floor(rnd(opts.rollsPerSack[0], opts.rollsPerSack[1]));
      for (let k = 0; k < count; k++) {
        const qty = rnd(18, 85);
        rolls.push({
          barcode: `D-${TAG}-${idx}-${String(++rn).padStart(5, "0")}`,
          itemId: pick(opts.itemPool).id,
          colorId: pick(opts.colorPool).id,
          status: rollStatus,
          currentQty: qty,
          initialQty: qty,
          width: pick(WIDTHS),
          qualityGrade: pick(QUALITIES),
          form: "TOP",
          entrySource: "SUPPLIER_RECEIPT",
          sackId: s.id,
          shipmentId: shipment.id,
        });
      }
    }
    // Chunk'lı insert (param limiti + bellek için).
    for (let i = 0; i < rolls.length; i += 500) {
      await prisma.roll.createMany({ data: rolls.slice(i, i + 500) });
    }

    // İadeler: rastgele topları iade et (çuvaldan çıkar + RollReturn yaz).
    let returnedCount = 0;
    if (opts.returnsCount && opts.returnsCount > 0 && rollStatus === "SHIPPED") {
      const created = await prisma.roll.findMany({
        where: { shipmentId: shipment.id },
        select: { id: true, itemId: true, colorId: true, width: true, currentQty: true, qualityGrade: true, sackId: true },
      });
      // rastgele karıştır, ilk N'i iade et
      const shuffled = created.sort(() => Math.random() - 0.5).slice(0, Math.min(opts.returnsCount, created.length));
      if (shuffled.length) {
        await prisma.rollReturn.createMany({
          data: shuffled.map((r) => ({
            rollId: r.id,
            fromShipmentId: shipment.id,
            customerId: customer.id,
            itemId: r.itemId,
            colorId: r.colorId,
            width: r.width,
            qty: r.currentQty,
            reasonId: pick(reasons).id,
            receivedById: admin!.id,
            prevSackId: r.sackId,
            prevQualityGrade: r.qualityGrade,
            appliedStatus: "WAREHOUSE" as const,
          })),
        });
        // Top artık çuvalda değil: sevkiyattan/çuvaldan ayır, depoya dön.
        await prisma.roll.updateMany({
          where: { id: { in: shuffled.map((r) => r.id) } },
          data: { sackId: null, shipmentId: null, status: "WAREHOUSE" },
        });
        returnedCount = shuffled.length;
      }
    }

    const rollCount = await prisma.roll.count({ where: { shipmentId: shipment.id } });
    return { ...shipment, idx, sackCount: sacks.length, rollCount, returnedCount, sacks };
  }

  // ---- BÜYÜK sevkiyat: 300 çuval, tüm kumaş/renk, iadeli + siparişli ----------
  console.log("• Büyük sevkiyat kuruluyor (300 çuval, ~3000 top)... birkaç saniye sürebilir");
  const big = await makeShipment({
    label: "BÜYÜK",
    sackCount: 300,
    rollsPerSack: [8, 12],
    itemPool: items,
    colorPool: colors,
    returnsCount: 40,
  });

  // Siparişler: 2 sipariş + satır + ShipmentOrder + birkaç SackAllocation (Bu sevk metrajı).
  const order1 = await prisma.order.create({
    data: {
      orderNumber: `DEMO-ORD-${TAG}-1`,
      customerId: customer.id,
      branchId: branch.id,
      status: "PARTIAL_SHIPPED",
      deadline: new Date(Date.now() + 30 * 86400000),
      lines: {
        create: [
          { itemId: patos.id, colorId: mavi.id, width: 150, quantity: 600, shippedQty: 0 },
          { itemId: kadife.id, colorId: colors.find((c) => c.code === "SIYAH")!.id, width: 160, quantity: 400, shippedQty: 0 },
        ],
      },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  const order2 = await prisma.order.create({
    data: {
      orderNumber: `DEMO-ORD-${TAG}-2`,
      customerId: customer.id,
      branchId: branch.id,
      status: "PARTIAL_SHIPPED",
      deadline: new Date(Date.now() + 45 * 86400000),
      lines: { create: [{ itemId: suet.id, colorId: colors.find((c) => c.code === "YESIL")!.id, width: 140, quantity: 300, shippedQty: 0 }] },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  await prisma.shipmentOrder.createMany({
    data: [
      { shipmentId: big.id, orderId: order1.id, isActive: false },
      { shipmentId: big.id, orderId: order2.id, isActive: false },
    ],
  });
  // Tahsis: her satıra birkaç çuvaldan metraj düş → "Bu sevk" + shippedQty.
  const lineIds = [...order1.lines.map((l) => l.id), ...order2.lines.map((l) => l.id)];
  const allocSacks = big.sacks.slice(0, lineIds.length * 4);
  const allocs: { sackId: string; orderLineId: string; qty: number }[] = [];
  const shippedByLine = new Map<string, number>();
  allocSacks.forEach((s, i) => {
    const lineId = lineIds[i % lineIds.length];
    const qty = rnd(40, 90);
    allocs.push({ sackId: s.id, orderLineId: lineId, qty });
    shippedByLine.set(lineId, (shippedByLine.get(lineId) ?? 0) + qty);
  });
  await prisma.sackAllocation.createMany({ data: allocs });
  for (const [lineId, sum] of shippedByLine) {
    await prisma.orderLine.update({ where: { id: lineId }, data: { shippedQty: Math.round(sum * 1000) / 1000 } });
  }
  for (const oid of [order1.id, order2.id]) {
    const agg = await prisma.orderLine.aggregate({ where: { orderId: oid }, _sum: { shippedQty: true } });
    await prisma.order.update({ where: { id: oid }, data: { shippedQty: agg._sum.shippedQty ?? 0 } });
  }

  // ---- KÜÇÜK sevkiyatlar: liste çeşitliliği ----------------------------------
  console.log("• Küçük sevkiyatlar kuruluyor...");
  const patosMavi = { items: [patos], colors: [mavi, colors.find((c) => c.code === "LACIVERT")!] };
  const noPatos = { items: [kadife, suet], colors: colors };

  const small1 = await makeShipment({
    label: "Patos/Mavi ağırlıklı (EXPORT, iadeli)",
    sackCount: 18, rollsPerSack: [6, 10], itemPool: patosMavi.items, colorPool: patosMavi.colors,
    destination: "EXPORT", returnsCount: 4,
  });
  const small2 = await makeShipment({
    label: "Patossuz (Kadife/Süet)",
    sackCount: 10, rollsPerSack: [5, 9], itemPool: noPatos.items, colorPool: noPatos.colors,
  });
  const small3 = await makeShipment({
    label: "Karışık, PLANNED",
    sackCount: 25, rollsPerSack: [7, 11], itemPool: items, colorPool: colors, planned: true,
  });
  const small4 = await makeShipment({
    label: "Küçük, iadeli",
    sackCount: 6, rollsPerSack: [8, 12], itemPool: items, colorPool: colors, returnsCount: 5,
  });

  // ---- Özet -------------------------------------------------------------------
  const all = [big, small1, small2, small3, small4];
  console.log(`\n✅ DEMO verisi hazır (müşteri: DEMO TEKSTİL A.Ş.):\n`);
  for (const s of all) {
    console.log(
      `   ${s.shipmentNo}  —  ${s.sackCount} çuval · ${s.rollCount} top · ${s.returnedCount} iade`,
    );
  }
  console.log(`\n   Sipariş modalı için: ${big.shipmentNo} (2 sipariş, tahsisli)`);
  console.log(`\n👉 Electron → Operasyonlar → Sevkiyatlar → "DEMO" ara → bir satıra sağ tık → "Tam sayfa aç".`);
  console.log(`   Liste filtresi testi: Ürün=Patos veya Renk=Mavi seç, detaya girince çip otomatik gelir.`);
  console.log(`   Büyük sevkiyat (${big.shipmentNo}) sanallaştırma + facet + iade-çuval-kaynağı için idealdir.\n`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("❌ Hata:", e);
  await prisma.$disconnect();
  process.exit(1);
});
