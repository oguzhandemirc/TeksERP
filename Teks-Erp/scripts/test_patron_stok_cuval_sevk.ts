// =============================================================================
// BEKÇİ — PATRON STOK KALEM · ÇUVAL DEPOSU · SEVKİYAT İÇERİĞİ (D5, 2026-11-20)
// =============================================================================
//   §1 `stok-kalem` — toplamlar karnenin ham/bitmiş rakamı; Σ kalem.top = toplamTop = top dizisi; her topun kalem
//      anahtarı kalem listesinde ve kalem başına top sayısı tutar; çuvaldaki top RAFTA DEĞİL
//   §2 `cuval-deposu` — havuz çuvalı hayaletsiz sayılır; PLANNED sevkiyattaki çuval SEVKE_ATANDI; sevk edilmiş çuval YOK;
//      özet = Σ çuval = Σ cari kovası
//   §3 `sevkiyat-icerigi` — özet = `getShipmentById` BRÜT özeti; iade topu kendi çuvalında `iade`; birim tavanı ≤ 100
// ⭐ NEGATİF SONDA (2026-11-20): `snapshot-sack-depot` kapsamı `resolveScopeOr(undefined, true)` (sevk edilmiş dahil)
//    yapıldı → §2c ❌ (sevk edilmiş çuval anlıkta); geri alındı → yeşil.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım.
// =============================================================================
import { RollStatus, ShipmentStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { RECORD_PROJECTIONS } from "../src/cloud-sync/projections";
import { buildRecords } from "../src/cloud-sync/record-builder";
import { buildSnapshots } from "../src/cloud-sync/snapshots";
import { getStockScorecard } from "../src/services/reports/stock-scorecard.report.service";
import { shippingService } from "../src/services/shipping.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const TAG = `TEST-PSC-${process.pid}`;
type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const a = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const n = (v: unknown): number => Number(v ?? NaN);

async function snapshot(name: string): Promise<Obj> {
  const built = await buildSnapshots({ now: new Date(), productionOn: true, financeOn: false, cadences: new Set(), extra: new Set([name]) });
  return o(built.find((s) => s.projection === name)?.data);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== PATRON STOK · ÇUVAL · SEVKİYAT İÇERİĞİ BEKÇİSİ ===\n");
  // İadeyi teslim alan: bekçinin kendi kullanıcısı (sert silinmez, sonda pasife alınır).
  const user = await prisma.user.create({ data: { username: `${TAG}-iade`.toLowerCase(), fullName: `${TAG} iade`, passwordHash: "x", isActive: true }, select: { id: true } });
  const ids = { item: "", color: "", customer: "", rolls: [] as string[], sacks: [] as string[], shipments: [] as string[], ret: "" };
  try {
    ids.item = (await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} Kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;
    ids.color = (await prisma.color.create({ data: { code: `${TAG}-R`, name: `${TAG} Renk` }, select: { id: true } })).id;
    ids.customer = (await prisma.customer.create({ data: { code: `${TAG}-C`, name: `${TAG} Müşteri` }, select: { id: true } })).id;
    const roll = async (k: string, status: RollStatus, qty: number, extra: Obj = {}) => {
      const r = await prisma.roll.create({
        data: { barcode: `${TAG}-${k}`, itemId: ids.item, colorId: ids.color, status, currentQty: qty, initialQty: qty, width: 150, entrySource: "SUPPLIER_RECEIPT", ...extra },
        select: { id: true },
      });
      ids.rolls.push(r.id);
      return r.id;
    };
    const sack = async (k: string, extra: Obj = {}) => {
      const s = await prisma.sack.create({ data: { sackNo: `${TAG}-${k}`, customerId: ids.customer, ...extra }, select: { id: true } });
      ids.sacks.push(s.id);
      return s.id;
    };
    const shipment = async (k: string, status: ShipmentStatus) => {
      const s = await prisma.shipment.create({ data: { shipmentNo: `${TAG}-${k}`, customerId: ids.customer, status, ...(status === "DISPATCHED" ? { dispatchedAt: new Date() } : {}) }, select: { id: true } });
      ids.shipments.push(s.id);
      return s.id;
    };

    // Raf: 1 ham (STOCK) + 2 bitmiş (WAREHOUSE); çuvalda bitmiş + hayalet; PLANNED ve DISPATCHED sevkiyat çuvalları.
    const rawRoll = await roll("HAM", RollStatus.STOCK, 80);
    const fin1 = await roll("B1", RollStatus.WAREHOUSE, 50);
    const fin2 = await roll("B2", RollStatus.WAREHOUSE, 30.5);
    const poolSack = await sack("SK-HAVUZ");
    const sackedRoll = await roll("SKT", RollStatus.WAREHOUSE, 40, { sackId: poolSack });
    await roll("HAYALET", RollStatus.AT_SUBCONTRACTOR, 25, { sackId: poolSack });
    const planned = await shipment("SV-P", ShipmentStatus.PLANNED);
    const plannedSack = await sack("SK-PLAN", { shipmentId: planned, seq: 1 });
    await roll("PL", RollStatus.WAREHOUSE, 20, { sackId: plannedSack, shipmentId: planned });
    const sent = await shipment("SV-D", ShipmentStatus.DISPATCHED);
    const sentSack = await sack("SK-SEVK", { shipmentId: sent, seq: 1, weightKg: 12.5 });
    await roll("S1", RollStatus.SHIPPED, 60, { sackId: sentSack, shipmentId: sent });
    // İade: top sevkiyattan kopar (createReturn gibi), RollReturn prevSackId ile çuvalını taşır.
    const retRoll = await roll("S2", RollStatus.WAREHOUSE, 15);
    ids.ret = (await prisma.rollReturn.create({
      data: { rollId: retRoll, fromShipmentId: sent, prevSackId: sentSack, customerId: ids.customer, itemId: ids.item, colorId: ids.color, width: 150, qty: 15, reasonText: "bekçi", receivedById: user.id },
      select: { id: true },
    })).id;

    console.log("── §1 stok-kalem ──");
    const sk = await snapshot("stok-kalem");
    const card = (await getStockScorecard()).summary;
    const ham = o(sk.ham);
    const bit = o(sk.bitmis);
    check("§1a toplamlar karnenin ham/bitmiş adet + metresi", n(ham.toplamTop) === card.rawCount && n(bit.toplamTop) === card.finishedCount && n(ham.toplamMetre) === card.rawQty && n(bit.toplamMetre) === card.finishedQty,
      `ham ${ham.toplamTop}/${card.rawCount} bitmiş ${bit.toplamTop}/${card.finishedCount}`);
    for (const [label, sec] of [["ham", ham], ["bitmiş", bit]] as const) {
      const kalemler = a(sec.kalemler);
      const toplar = a(sec.toplar);
      const sum = kalemler.reduce((x, k) => x + n(k.top), 0);
      check(`§1b ${label}: Σ kalem.top = toplamTop = top dizisi`, sec.toplarKirpildi === false && sum === n(sec.toplamTop) && toplar.length === sum, `${sum}/${sec.toplamTop}/${toplar.length}`);
      const per = new Map<string, number>();
      for (const t of toplar) per.set(String(t.kalem), (per.get(String(t.kalem)) ?? 0) + 1);
      check(`§1c ${label}: her topun kalemi listede, kalem başına sayı tutar`, kalemler.every((k) => per.get(String(k.anahtar)) === n(k.top)) && [...per.keys()].every((key) => kalemler.some((k) => k.anahtar === key)));
    }
    const hamIds = new Set(a(ham.toplar).map((t) => t.id));
    const bitIds = new Set(a(bit.toplar).map((t) => t.id));
    const fin1Top = a(bit.toplar).find((t) => t.id === fin1);
    check("§1d fikstür: ham top hamda, bitmişler bitmişte (gün 0), çuvaldaki top rafta değil",
      hamIds.has(rawRoll) && bitIds.has(fin1) && bitIds.has(fin2) && !bitIds.has(sackedRoll) && fin1Top?.gun === 0 && fin1Top?.topNo === `${TAG}-B1`, JSON.stringify(fin1Top));

    console.log("\n── §2 cuval-deposu ──");
    const cd = await snapshot("cuval-deposu");
    const cuvallar = a(cd.cuvallar);
    const poolRow = cuvallar.find((c) => c.id === poolSack);
    check("§2a havuz çuvalı hayaletsiz: 1 top 40 m, top dizisi yalnız duran top", poolRow?.top === 1 && poolRow?.metre === 40 && poolRow?.durum === "DEPODA"
      && a(poolRow?.toplar).length === 1 && a(poolRow?.toplar)[0]?.id === sackedRoll, JSON.stringify(poolRow && { top: poolRow.top, metre: poolRow.metre }));
    const planRow = cuvallar.find((c) => c.id === plannedSack);
    check("§2b PLANNED sevkiyattaki çuval SEVKE_ATANDI + sevk no", planRow?.durum === "SEVKE_ATANDI" && planRow?.sevkiyatNo === `${TAG}-SV-P`);
    check("§2c sevk edilmiş çuval anlıkta YOK", !cuvallar.some((c) => c.id === sentSack));
    const oz = o(cd.ozet);
    const sumTop = cuvallar.reduce((x, c) => x + n(c.top), 0);
    const sumCari = a(cd.cariler).reduce((x, c) => x + n(c.cuval), 0);
    check("§2d özet = Σ çuval = Σ cari kovası", cd.kirpildi === false && n(oz.cuval) === cuvallar.length && n(oz.top) === sumTop && sumCari === cuvallar.length
      && n(oz.sevkeAtanan) === cuvallar.filter((c) => c.durum === "SEVKE_ATANDI").length, `${oz.cuval}/${cuvallar.length} top ${oz.top}/${sumTop}`);

    console.log("\n── §3 sevkiyat-icerigi ──");
    const p = RECORD_PROJECTIONS.find((x) => x.name === "sevkiyat-icerigi");
    check("§3a katalog: OLGU, kök shipments, birim tavanı ≤ 100", p?.role === "OLGU" && p.root.table === "shipments" && (p.unitRoots ?? Infinity) <= 100);
    const built = p ? await buildRecords(p, [sent], Date.now()) : null;
    const row = built ? o([...built.rows.values()].flat().find((r) => r.id === sent)) : {};
    const svc = o(o((await shippingService.getShipmentById(sent)).data).summary);
    const ozet = o(row.ozet);
    check("§3b özet = getShipmentById BRÜT özeti (iade dahil 2 top 75 m)", n(ozet.top) === n(svc.rollCount) && n(ozet.metre) === n(svc.totalMeters) && n(ozet.top) === 2 && n(ozet.metre) === 75
      && n(ozet.iadeTop) === 1 && n(ozet.tartiliCuval) === 1, JSON.stringify(ozet));
    const c1 = a(row.cuvallar).find((c) => c.id === sentSack);
    const retTop = a(c1?.toplar).find((t) => t.id === retRoll);
    check("§3c iade topu kendi çuvalında `iade`; çuval 2 top 75 m", retTop?.iade === true && n(c1?.top) === 2 && n(c1?.metre) === 75 && a(row.cuvalsizToplar).length === 0, JSON.stringify(c1 && { top: c1.top, metre: c1.metre }));
  } finally {
    if (ids.ret) await prisma.rollReturn.delete({ where: { id: ids.ret } }).catch(() => {});
    if (ids.rolls.length) await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    if (ids.sacks.length) await prisma.sack.deleteMany({ where: { id: { in: ids.sacks } } });
    if (ids.shipments.length) await prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } });
    if (ids.color) await prisma.color.delete({ where: { id: ids.color } }).catch(() => {});
    if (ids.item) await prisma.item.delete({ where: { id: ids.item } }).catch(() => {});
    if (ids.customer) await prisma.customer.delete({ where: { id: ids.customer } }).catch(() => {});
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } }).catch(() => {});
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error("HATA:", e);
  process.exitCode = 1;
  await pool.end().catch(() => {});
});
