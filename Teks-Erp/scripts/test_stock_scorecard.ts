// =============================================================================
// Test: STOK & ÖLÜ STOK KARNESİ
// Çalıştır: npx tsx scripts/test_stock_scorecard.ts
// =============================================================================
// DÖRT KRİTİK KURAL:
//   1. ÖLÜ STOK = ESKİ **VE** SİPARİŞSİZ. İkisinden biri tek başına sorun
//      değildir; raporun tüm değeri KESİŞİMDE. Fixture üç durumu birden kurar:
//      eski+siparişli · yeni+siparişsiz · eski+siparişsiz (yalnız sonuncusu ölü).
//   2. ÇIPASIZ TOP (statusChangedAt = NULL) yaş kovalarına DAĞITILMAZ ama
//      metrajı toplam stoğa GİRER ve ayrıca sayılır. "Yaşı bilinmiyor" ile
//      "yeni" farklı şeylerdir; ikincisine yuvarlamak ölü stoğu gizlerdi.
//   3. SEVKE/ÇUVALA GİRMİŞ TOP RAF DEĞİLDİR — çıkmak üzere olan malı ölü stok
//      saymak, tam da harekete geçmiş envanteri suçlamak olurdu.
//   4. TALEP TANIMI `production-balance` ile aynı: Σ(quantity − shippedQty),
//      CANCELLED/COMPLETED dışı siparişlerden.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { getStockScorecard } from "../src/services/reports/stock-scorecard.report.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const TAG = `TEST-STK-${Date.now()}`;
const DAY = 86_400_000;
const OLD = new Date(Date.now() - 200 * DAY); // eşiğin (90 gün) çok üstünde
const NEW = new Date(Date.now() - 2 * DAY);

const ids = {
  rolls: [] as string[], lines: [] as string[], orders: [] as string[],
  items: [] as string[], shipments: [] as string[],
};

async function main(): Promise<void> {
  console.log("\n=== Stok & Ölü Stok bekçisi ===\n");

  const customer = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!customer) { console.log("❌ Ön koşul yok"); fail++; return; }

  // ⚠️ TEMEL ÖLÇÜM: ölü stok sayacı TÜM depoyu kapsıyor, yalnız fixture'ımızı
  // değil. Mutlak bir eşikle kontrol etmek gevşek kalıyordu — "siparişsizlik
  // aranmıyor" sondası o hâliyle YEŞİL geçiyordu (ölçüldü). Doğrusu FARKI
  // ölçmek: fixture'ın ölü stoğa katkısı tam olarak 300 m olmalı.
  const baseline = (await getStockScorecard()).summary.deadQty;

  // Kendi kumaşlarımız: komşu stok/sipariş verisi hesaba karışmasın.
  const mkItem = async (suffix: string) => {
    const i = await prisma.item.create({
      data: { code: `${TAG}-${suffix}`, name: `Stok testi ${suffix}`, itemType: "FABRIC" },
      select: { id: true, name: true },
    });
    ids.items.push(i.id);
    return i;
  };
  const itmCovered = await mkItem("COVERED");   // eski AMA siparişli
  const itmDead = await mkItem("DEAD");         // eski VE siparişsiz
  const itmFresh = await mkItem("FRESH");       // yeni ve siparişsiz
  const itmUnaged = await mkItem("UNAGED");     // çıpasız
  const itmShipped = await mkItem("SHIPPED");   // sevke okutulmuş

  const mkRoll = async (o: {
    itemId: string; qty: number; changedAt: Date | null;
    status?: "WAREHOUSE" | "STOCK"; shipmentId?: string | null;
    /** Ham ↔ yarı mamul ayrımı STATÜDEN değil giriş kaynağından çıkar. */
    entrySource?: "SUPPLIER_RECEIPT" | "SEMI_FINISHED";
  }) => {
    const r = await prisma.roll.create({
      data: {
        itemId: o.itemId, initialQty: o.qty, currentQty: o.qty,
        status: o.status ?? "WAREHOUSE", entrySource: o.entrySource ?? "SUPPLIER_RECEIPT",
        barcode: `${TAG}-R${ids.rolls.length}`, shipmentId: o.shipmentId ?? null,
      },
      select: { id: true },
    });
    ids.rolls.push(r.id);
    // ⚠️ Trigger INSERT'te `statusChangedAt`'i now() ile doldurur → yaşı geriye
    // almak için HAM SQL ile ezilir (Prisma update de trigger'a takılmaz çünkü
    // status değişmiyor, ama ham SQL `updatedAt`'e de dokunmaz).
    if (o.changedAt === null) {
      await prisma.$executeRaw`UPDATE rolls SET "statusChangedAt" = NULL WHERE id = ${r.id}::uuid`;
    } else {
      await prisma.$executeRaw`UPDATE rolls SET "statusChangedAt" = ${o.changedAt} WHERE id = ${r.id}::uuid`;
    }
    return r.id;
  };

  const mkOrder = async (itemId: string, qty: number, shipped: number) => {
    const o = await prisma.order.create({
      data: { orderNumber: `${TAG}-O${ids.orders.length}`, customerId: customer.id, status: "APPROVED" },
      select: { id: true },
    });
    ids.orders.push(o.id);
    const l = await prisma.orderLine.create({
      data: { orderId: o.id, itemId, quantity: qty, shippedQty: shipped },
      select: { id: true },
    });
    ids.lines.push(l.id);
  };

  // ── FIXTURE ────────────────────────────────────────────────────────────────
  await mkRoll({ itemId: itmCovered.id, qty: 100, changedAt: OLD });
  await mkOrder(itmCovered.id, 100, 0);                     // talep 100 → siparişsiz 0
  await mkRoll({ itemId: itmDead.id, qty: 300, changedAt: OLD });   // ÖLÜ: eski + siparişsiz
  await mkRoll({ itemId: itmFresh.id, qty: 200, changedAt: NEW });  // yeni + siparişsiz → ölü DEĞİL
  await mkRoll({ itemId: itmUnaged.id, qty: 70, changedAt: null }); // çıpasız
  const ship = await prisma.shipment.create({
    data: { shipmentNo: `${TAG}-S`, customerId: customer.id, status: "PLANNED" },
    select: { id: true },
  });
  ids.shipments.push(ship.id);
  await mkRoll({ itemId: itmShipped.id, qty: 999, changedAt: OLD, shipmentId: ship.id });
  await mkRoll({ itemId: itmDead.id, qty: 40, changedAt: NEW, status: "STOCK" }); // HAM stok
  // Aynı statüde ama DIŞARIDAN ALINAN yarı mamul — "Ham" rakamına GİRMEMELİ.
  await mkRoll({
    itemId: itmDead.id, qty: 55, changedAt: NEW, status: "STOCK",
    entrySource: "SEMI_FINISHED",
  });

  const sc = await getStockScorecard();
  const row = (id: string) => sc.byItem.find((r) => r.key === id);

  // ── 1) ÖLÜ STOK = ESKİ VE SİPARİŞSİZ ──────────────────────────────────────
  console.log("── 1) Ölü stok: eski VE siparişsiz kesişimi ──");
  check("siparişli eski top siparişsiz sayılmaz", row(itmCovered.id)?.uncoveredQty === 0,
    `gelen: ${row(itmCovered.id)?.uncoveredQty}`);
  check("siparişsiz eski top siparişsiz sayılır", row(itmDead.id)?.uncoveredQty === 300,
    `gelen: ${row(itmDead.id)?.uncoveredQty}`);
  check("YENİ siparişsiz top da siparişsizdir", row(itmFresh.id)?.uncoveredQty === 200,
    `gelen: ${row(itmFresh.id)?.uncoveredQty}`);
  // Ölü stok yalnız KESİŞİM: 300 (eski+siparişsiz). 200 yeni, 100 siparişli.
  const deadDelta = Math.round((sc.summary.deadQty - baseline) * 10) / 10;
  check(
    "fixture'ın ölü stoğa katkısı TAM 300 m",
    deadDelta === 300,
    `gelen: +${deadDelta} — yalnızca ESKİYE baksaydı +400 (siparişli 100 de girerdi), ` +
      "yalnızca SİPARİŞSİZE baksaydı +500 (yeni 200 de girerdi)",
  );

  // ── 2) ÇIPASIZ TOP ────────────────────────────────────────────────────────
  console.log("\n── 2) Yaşı bilinmeyen top gizlenmez ──");
  check("çıpasız top sayılıyor", sc.summary.unagedCount >= 1, `gelen: ${sc.summary.unagedCount}`);
  check("çıpasız metraj ayrıca raporlanıyor", sc.summary.unagedQty >= 70, `gelen: ${sc.summary.unagedQty}`);
  const ageSum = Math.round(sc.byAge.reduce((a, r) => a + r.qty, 0) * 10) / 10;
  check(
    "yaş kovaları çıpasızı İÇERMEZ ama toplam stok onu İÇERİR",
    Math.abs(sc.summary.finishedQty - (ageSum + sc.summary.unagedQty)) < 0.05,
    `kovalar ${ageSum} + çıpasız ${sc.summary.unagedQty} = ${sc.summary.finishedQty}`,
  );
  check("çıpasız top kumaş kırılımında var", row(itmUnaged.id)?.qty === 70, `gelen: ${row(itmUnaged.id)?.qty}`);

  // ── 3) SEVKE OKUTULMUŞ TOP RAF DEĞİL ──────────────────────────────────────
  console.log("\n── 3) Sevkiyata bağlı top raf sayılmaz ──");
  check("sevke okutulmuş 999 m stokta yok", row(itmShipped.id) === undefined,
    `gelen: ${JSON.stringify(row(itmShipped.id))}`);

  // ── 4) HAM ↔ BİTMİŞ AYRIMI ────────────────────────────────────────────────
  console.log("\n── 4) Ham stok ile bitmiş depo ayrı ──");
  check("ham stok (40 m) bitmiş depoya karışmadı",
    row(itmDead.id)?.qty === 300, `gelen: ${row(itmDead.id)?.qty}`);
  check("ham stok ayrı sayaçta", sc.summary.rawQty >= 40, `gelen: ${sc.summary.rawQty}`);
  // ── Ham ↔ yarı mamul ayrımı (2026-08-26) ────────────────────────────────────
  // Envanter ekranı ikisini ayrı sekmelerde gösteriyor; rapor birleşik saysaydı
  // aynı soruya iki farklı rakam veren iki yüzey doğardı.
  check("yarı mamul ayrı sayaçta", sc.summary.semiQty >= 55, `gelen: ${sc.summary.semiQty}`);
  // ⚠️ Mutlak eşik KULLANILMAZ: bu test paylaşımlı/dolu bir DB'ye karşı koşuyor
  // ve `rawQty` fabrikanın gerçek stoğunu da içeriyor. Ölçülen şey rakamın
  // BÜYÜKLÜĞÜ değil, iki kovanın DB'deki gerçek ayrımla birebir tutması.
  const sumStock = async (semi: boolean) => {
    const agg = await prisma.roll.aggregate({
      where: {
        status: "STOCK",
        shipmentId: null,
        sackId: null,
        entrySource: semi ? "SEMI_FINISHED" : { not: "SEMI_FINISHED" },
      },
      _sum: { currentQty: true },
      _count: true,
    });
    return { qty: Number(agg._sum.currentQty ?? 0), count: agg._count };
  };
  const dbRaw = await sumStock(false);
  const dbSemi = await sumStock(true);
  check(
    "HAM rakamı = DB'deki ham stok (yarı mamul sızmıyor)",
    Math.abs(sc.summary.rawQty - dbRaw.qty) < 0.5 && sc.summary.rawCount === dbRaw.count,
    `rapor=${sc.summary.rawQty}/${sc.summary.rawCount} db=${dbRaw.qty}/${dbRaw.count}`,
  );
  check(
    "YARI MAMUL rakamı = DB'deki yarı mamul stoğu",
    Math.abs(sc.summary.semiQty - dbSemi.qty) < 0.5 && sc.summary.semiCount === dbSemi.count,
    `rapor=${sc.summary.semiQty}/${sc.summary.semiCount} db=${dbSemi.qty}/${dbSemi.count}`,
  );
  check("yarı mamul top sayısı ayrı", sc.summary.semiCount >= 1, `gelen: ${sc.summary.semiCount}`);

  // ── 5) TALEP TANIMI ───────────────────────────────────────────────────────
  console.log("\n── 5) Talep = quantity − shippedQty ──");
  await mkOrder(itmFresh.id, 200, 200); // tamamı sevk edilmiş → açık talep 0
  const sc2 = await getStockScorecard();
  check(
    "tamamı sevk edilmiş sipariş talep YARATMAZ",
    sc2.byItem.find((r) => r.key === itmFresh.id)?.uncoveredQty === 200,
    `gelen: ${sc2.byItem.find((r) => r.key === itmFresh.id)?.uncoveredQty}`,
  );
  await mkOrder(itmFresh.id, 500, 300); // açık talep 200 → siparişsiz 0
  const sc3 = await getStockScorecard();
  check(
    "kısmi sevkte kalan miktar talep sayılır",
    sc3.byItem.find((r) => r.key === itmFresh.id)?.uncoveredQty === 0,
    `gelen: ${sc3.byItem.find((r) => r.key === itmFresh.id)?.uncoveredQty}`,
  );
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => {
    if (ids.rolls.length) await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    if (ids.lines.length) await prisma.orderLine.deleteMany({ where: { id: { in: ids.lines } } });
    if (ids.orders.length) await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
    if (ids.shipments.length) await prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } });
    if (ids.items.length) await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
