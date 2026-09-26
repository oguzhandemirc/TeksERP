// =============================================================================
// TEST: KARTELA OLAY DEFTERİ — GERÇEK servis yolları (K2)
// Çalıştır: npx tsx scripts/test_swatch_event_paths.ts
// =============================================================================
// Tasarım: docs/design/KARTELA-HAREKET-DEFTERI.md §5.2. Fikstür GERÇEK yollardan geçer
// (kartela sevki + kabulü, çuval, sevkiyat, sevk, geri alma, düşüm, kabul iptali) ve her
// adımdan sonra kartelanın durumu ile olay satırı ölçülür:
//   §1 kabul → BORN · §2 okutma → SACKED · §3 çuvallar arası taşıma → UNSACKED + SACKED
//   tek grup · §4 çuvaldan çıkar → UNSACKED · §5 seçerek ekle → SACKED · §6 çuvalı dağıt →
//   UNSACKED · §7 dolu çuvalı sil → UNSACKED, çuval no satırda donar · §8 sevkiyat kur/çuval
//   çıkar/ekle → SHIPMENT_ADDED/REMOVED · §9 sevk → SHIPPED · §10 geri al + kapat →
//   SHIP_UNDONE (SHIPPED'a bağlı) + SHIPMENT_REMOVED · §11 onaysız anında sevk → iki satır
//   tek tx · §12 PLANNED iptal → SHIPMENT_REMOVED · §13 düşüm/storno → REDUCED /
//   REDUCTION_REVERSED (bağlı) · §14 kabul iptali → VOIDED (BORN'a bağlı) · §15 zincir:
//   her satırın from'u öncekinin to'su, son to = kartelanın durumu · §16 kanal/aktör.
// =============================================================================

import prisma from "../src/lib/prisma";
import { RollStatus, SwatchStatus } from "@prisma/client";
import { kartelaService } from "../src/services/kartela.service";
import { shippingService } from "../src/services/shipping.service";
import { ensureTestKartela } from "./fixture-subcontractor";
import { ensureTestAdmin } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { firstGrade } from "./fixture-quality-grade";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

const TS = Date.now().toString().slice(-7);
const CONF_KEY = "shipping.confirmationEnabled";
let oncekiOnay: { value: unknown } | null | undefined;

let ADMIN = "", FIRM = "", CUSTOMER = "", ITEM = "";
const rollIds: string[] = [];
const sackIds: string[] = [];
const shipmentIds: string[] = [];

const olaylar = (swatchId: string) =>
  prisma.swatchEvent.findMany({ where: { swatchId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const sonOlay = async (swatchId: string) => (await olaylar(swatchId)).at(-1);
const durum = async (id: string) => (await prisma.swatch.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
const acCuval = async (): Promise<{ id: string; sackNo: string }> => {
  const c = (await shippingService.openSack({ customerId: CUSTOMER }, ADMIN)).data as { id: string; sackNo: string };
  sackIds.push(c.id);
  return c;
};
const onayAyarla = (deger: boolean) =>
  prisma.systemSetting.upsert({ where: { key: CONF_KEY }, create: { key: CONF_KEY, value: deger }, update: { value: deger } });

async function kur(): Promise<{ receiptId: string; sw: Array<{ id: string; barcode: string }> }> {
  ADMIN = (await ensureTestAdmin()).id;
  FIRM = (await ensureTestKartela()).id;
  CUSTOMER = (await prisma.customer.create({ data: { code: `TEST-KEP-${TS}`, name: `Kartela Yol Test ${TS}` }, select: { id: true } })).id;
  ITEM = (await prisma.item.create({ data: { code: `TEST-KEP-IT-${TS}`, name: `Kartela Yol Ürün ${TS}`, itemType: "FABRIC" }, select: { id: true } })).id;
  const roll = await prisma.roll.create({
    data: {
      warehouseId: await fixtureWarehouseId(), barcode: `TEST-KEP-R-${TS}`, itemId: ITEM,
      initialQty: 50, currentQty: 50, qualityGrade: (await firstGrade()).code, width: 150, status: RollStatus.WAREHOUSE,
    },
    select: { id: true },
  });
  rollIds.push(roll.id);
  await kartelaService.dispatch({ subcontractorId: FIRM, rollIds: [roll.id] }, ADMIN);
  const rec = (await kartelaService.receive({ subcontractorId: FIRM, returns: [{ rollId: roll.id, count: 6 }] }, ADMIN)).data as { id: string };
  const sw = await prisma.swatch.findMany({ where: { parentReceiptId: rec.id }, orderBy: { cardNumber: "asc" }, select: { id: true, barcode: true } });
  return { receiptId: rec.id, sw };
}

async function main(): Promise<void> {
  console.log("=== Kartela olay defteri — gerçek yollar ===");
  try {
    oncekiOnay = await prisma.systemSetting.findUnique({ where: { key: CONF_KEY }, select: { value: true } });
    const { receiptId, sw } = await kur();
    const [s0, s1, s2] = sw;

    // §1
    const born = await prisma.swatchEvent.findMany({ where: { swatchId: { in: sw.map((s) => s.id) } } });
    check("§1 kabul: 6 kartela, her birine BORN (KARTELA_RECEIVE, kabule bağlı)",
      sw.length === 6 && born.length === 6 && born.every((e) => e.type === "BORN" && e.trigger === "KARTELA_RECEIVE" && e.receiptId === receiptId));

    // §2–§4 çuval
    const A = await acCuval(), B = await acCuval();
    await shippingService.scanIntoSack({ sackId: A.id, barcode: s0.barcode }, ADMIN);
    const e2 = await sonOlay(s0.id);
    check("§2 okutma → IN_SACK + SACKED (SACK_SCAN, çuval no satırda)",
      (await durum(s0.id)) === SwatchStatus.IN_SACK && e2?.type === "SACKED" && e2.trigger === "SACK_SCAN" && e2.sackNo === A.sackNo);
    await shippingService.scanIntoSack({ sackId: B.id, barcode: s0.barcode }, ADMIN);
    const son2 = (await olaylar(s0.id)).slice(-2);
    check("§3 çuvallar arası taşıma → UNSACKED(A) + SACKED(B), tek grup, SACK_MOVE",
      son2[0]?.type === "UNSACKED" && son2[0].sackId === A.id && son2[1]?.type === "SACKED" && son2[1].sackId === B.id
        && son2[0].groupId === son2[1].groupId && son2.every((e) => e.trigger === "SACK_MOVE"));
    await shippingService.removeSwatchFromSack({ swatchId: s0.id }, ADMIN);
    const e4 = await sonOlay(s0.id);
    check("§4 çuvaldan çıkar → IN_STOCK + UNSACKED(B)",
      (await durum(s0.id)) === SwatchStatus.IN_STOCK && e4?.type === "UNSACKED" && e4.sackNo === B.sackNo);

    // §5–§6
    const eklendi = (await shippingService.addKartelaToSack({ sackId: A.id, itemId: ITEM, colorId: null, count: 2 }, ADMIN)).data;
    const e5 = await prisma.swatchEvent.findMany({ where: { swatchId: { in: eklendi.swatchIds }, trigger: "KARTELA_SELECT_ADD" } });
    check("§5 seçerek ekle → iki SACKED, tek grup", e5.length === 2 && e5.every((e) => e.type === "SACKED" && e.sackId === A.id) && e5[0].groupId === e5[1].groupId);
    await shippingService.distributeSackContents({ sackId: A.id }, ADMIN);
    const e6 = await prisma.swatchEvent.findMany({ where: { swatchId: { in: eklendi.swatchIds }, trigger: "SACK_DISTRIBUTE" } });
    check("§6 çuvalı dağıt → iki UNSACKED, ikisi IN_STOCK",
      e6.length === 2 && e6.every((e) => e.type === "UNSACKED" && e.sackNo === A.sackNo)
        && (await prisma.swatch.count({ where: { id: { in: eklendi.swatchIds }, status: SwatchStatus.IN_STOCK } })) === 2);

    // §7 dolu çuvalı sil
    const C = await acCuval();
    await shippingService.scanIntoSack({ sackId: C.id, barcode: s1.barcode }, ADMIN);
    await shippingService.removeSack(C.id, ADMIN, true);
    const e7 = await sonOlay(s1.id);
    check("§7 dolu çuval silinir → UNSACKED, çuval satırı yok ama numarası olayda donuk",
      e7?.type === "UNSACKED" && e7.trigger === "SACK_REMOVE" && e7.sackNo === C.sackNo
        && (await prisma.sack.count({ where: { id: C.id } })) === 0 && (await durum(s1.id)) === SwatchStatus.IN_STOCK);

    // §8–§10 onaylı sevkiyat
    await onayAyarla(true);
    const D = await acCuval();
    await shippingService.scanIntoSack({ sackId: D.id, barcode: s2.barcode }, ADMIN);
    const shp = (await shippingService.createShipment({ sackIds: [D.id], customerId: CUSTOMER }, ADMIN)).data as { id: string; shipmentNo: string; status: string };
    shipmentIds.push(shp.id);
    const e8 = await sonOlay(s2.id);
    check("§8 sevkiyat kur (PLANNED) → IN_SHIPMENT + SHIPMENT_ADDED (sevkiyat + çuval no)",
      shp.status === "PLANNED" && (await durum(s2.id)) === SwatchStatus.IN_SHIPMENT
        && e8?.type === "SHIPMENT_ADDED" && e8.shipmentNo === shp.shipmentNo && e8.sackNo === D.sackNo);
    await shippingService.removeSackFromShipment(shp.id, D.id, ADMIN);
    const e8b = await sonOlay(s2.id);
    await shippingService.addSacksToShipment(shp.id, [D.id], ADMIN);
    const e8c = await sonOlay(s2.id);
    check("§8b çuval çıkar/ekle → SHIPMENT_REMOVED (IN_SACK) sonra SHIPMENT_ADDED (IN_SHIPMENT)",
      e8b?.type === "SHIPMENT_REMOVED" && e8b.toStatus === "IN_SACK" && e8c?.type === "SHIPMENT_ADDED" && e8c.id !== e8?.id);
    await shippingService.dispatchShipment(shp.id, {}, ADMIN);
    const shipped = await sonOlay(s2.id);
    check("§9 sevk → SHIPPED, sevkiyat no satırda", (await durum(s2.id)) === SwatchStatus.SHIPPED && shipped?.type === "SHIPPED" && shipped.shipmentNo === shp.shipmentNo);
    await shippingService.undoDispatch(shp.id, "bekçi: yanlış araç", ADMIN, { releaseSacks: true });
    const son10 = (await olaylar(s2.id)).slice(-2);
    check("§10 geri al + kapat → SHIP_UNDONE (SHIPPED'a bağlı, sebep) + SHIPMENT_REMOVED; kartela çuvalında",
      son10[0]?.type === "SHIP_UNDONE" && son10[0].reversesEventId === shipped?.id && son10[0].reason === "bekçi: yanlış araç"
        && son10[1]?.type === "SHIPMENT_REMOVED" && (await durum(s2.id)) === SwatchStatus.IN_SACK);
    const iptal = await prisma.shipment.findUniqueOrThrow({ where: { id: shp.id }, select: { status: true, cancelledById: true } });
    const iptalOlayi = await prisma.shipmentEvent.findFirst({ where: { shipmentId: shp.id, type: "CANCELLED" }, select: { createdById: true } });
    check("§10b geri al + kapat: sevkiyat iptal künyesinde ve CANCELLED olayında aktör dolu",
      iptal.status === "CANCELLED" && iptal.cancelledById === ADMIN && iptalOlayi?.createdById === ADMIN,
      `künye ${iptal.cancelledById ?? "BOŞ"} · olay ${iptalOlayi?.createdById ?? "BOŞ"}`);

    // §11–§12 onaysız anında sevk, geri al, PLANNED iptal
    await onayAyarla(false);
    const shp2 = (await shippingService.createShipment({ sackIds: [D.id], customerId: CUSTOMER }, ADMIN)).data as { id: string; status: string };
    shipmentIds.push(shp2.id);
    const son11 = (await olaylar(s2.id)).slice(-2);
    check("§11 onaysız sevk → SHIPMENT_ADDED + SHIPPED aynı eylemde, durum SHIPPED",
      shp2.status === "DISPATCHED" && son11[0]?.type === "SHIPMENT_ADDED" && son11[1]?.type === "SHIPPED" && (await durum(s2.id)) === SwatchStatus.SHIPPED);
    await shippingService.undoDispatch(shp2.id, "bekçi: storno", ADMIN);
    check("§11b geri al (kapatmadan) → SHIP_UNDONE, IN_SHIPMENT", (await sonOlay(s2.id))?.type === "SHIP_UNDONE" && (await durum(s2.id)) === SwatchStatus.IN_SHIPMENT);
    await shippingService.cancelShipment(shp2.id, ADMIN);
    const e12 = await sonOlay(s2.id);
    check("§12 PLANNED iptal → SHIPMENT_REMOVED (SHIPMENT_CANCEL), IN_SACK",
      e12?.type === "SHIPMENT_REMOVED" && e12.trigger === "SHIPMENT_CANCEL" && (await durum(s2.id)) === SwatchStatus.IN_SACK);
    await shippingService.distributeSackContents({ sackId: D.id }, ADMIN);

    // §13 düşüm + storno
    const red = await kartelaService.reduceStock({ itemId: ITEM, colorId: null, count: 1, reason: "bekçi: numune" }, ADMIN);
    const reduced = await prisma.swatchEvent.findFirstOrThrow({ where: { swatchId: { in: sw.map((s) => s.id) }, type: "REDUCED" } });
    check("§13 düşüm → REDUCED (sebep, düşüm belgesi satırda)", red.data.reduced === 1 && reduced.reason === "bekçi: numune" && !!reduced.reductionId);
    await kartelaService.reverseStockReduction(reduced.reductionId!, "bekçi: yanlış düşüm", ADMIN);
    const rev = await sonOlay(reduced.swatchId);
    check("§13b storno → REDUCTION_REVERSED, REDUCED'a bağlı, IN_STOCK",
      rev?.type === "REDUCTION_REVERSED" && rev.reversesEventId === reduced.id && (await durum(reduced.swatchId)) === SwatchStatus.IN_STOCK);

    // §14 kabul iptali
    await kartelaService.cancelReceipt(receiptId, "bekçi: kabul hatalı", ADMIN);
    const voided = await prisma.swatchEvent.findMany({ where: { swatchId: { in: sw.map((s) => s.id) }, type: "VOIDED" } });
    check("§14 kabul iptali → 6 VOIDED, her biri kendi BORN satırına bağlı",
      voided.length === 6 && voided.every((v) => born.some((b) => b.id === v.reversesEventId && b.swatchId === v.swatchId)));

    // §15 zincir
    const kopuk: string[] = [];
    for (const s of sw) {
      const ev = await olaylar(s.id);
      const d = await durum(s.id);
      ev.forEach((e, i) => { if (i > 0 && e.fromStatus !== ev[i - 1].toStatus) kopuk.push(`${s.barcode}#${i}`); });
      if (ev.at(-1)?.toStatus !== d) kopuk.push(`${s.barcode}: son ${ev.at(-1)?.toStatus} ≠ durum ${d}`);
    }
    check("§15 zincir: her satırın from'u öncekinin to'su, son to = kartelanın durumu", kopuk.length === 0, kopuk.join(" · "));

    // §16
    const hepsi = await prisma.swatchEvent.findMany({ where: { swatchId: { in: sw.map((s) => s.id) } } });
    check("§16 bağlamsız çağrı → kanal SYSTEM, aktör çağırandan",
      hepsi.every((e) => e.channel === "SYSTEM") && hepsi.every((e) => e.createdById === ADMIN),
      `${hepsi.length} satır${hepsi.filter((e) => e.createdById !== ADMIN).map((e) => ` · aktörsüz ${e.type}/${e.trigger}`).join("")}`);
  } finally {
    await temizle();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

async function temizle(): Promise<void> {
  if (oncekiOnay !== undefined) {
    if (oncekiOnay === null) await prisma.systemSetting.deleteMany({ where: { key: CONF_KEY } });
    else await prisma.systemSetting.update({ where: { key: CONF_KEY }, data: { value: oncekiOnay.value as never } });
  }
  if (ITEM) await prisma.swatchStockReductionItem.deleteMany({ where: { reduction: { itemId: ITEM } } });
  await prisma.swatch.deleteMany({ where: { parentRollId: { in: rollIds } } });
  await prisma.kartelaReceipt.deleteMany({ where: { items: { some: { consumedRollId: { in: rollIds } } } } });
  await prisma.kartelaDispatch.deleteMany({ where: { items: { some: { rollId: { in: rollIds } } } } });
  await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { shipmentId: null, sackId: null } });
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: shipmentIds } } });
  await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
  await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackIds } } });
  await prisma.sack.updateMany({ where: { id: { in: sackIds } }, data: { shipmentId: null, seq: null } });
  await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
  await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  if (ITEM) await prisma.swatchStockReduction.deleteMany({ where: { itemId: ITEM } });
  if (ITEM) await prisma.item.deleteMany({ where: { id: ITEM } });
  if (CUSTOMER) await prisma.customer.deleteMany({ where: { id: CUSTOMER } });
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await temizle().catch((err) => console.error("temizlik hatası:", err));
  await prisma.$disconnect();
  process.exit(1);
});
