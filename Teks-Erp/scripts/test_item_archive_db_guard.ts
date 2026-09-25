// =============================================================================
// TeksERP - Ürün arşivinin DB SEDDİ (URUN-YASAM-DONGUSU.md §7, S5)
// =============================================================================
// D1 (Pasif kartta canlı referans olamaz) uygulama kapısında sağlanıyor; bu bekçi
// kapıyı ATLAYAN yolun (ham Prisma yazımı) DB'de durduğunu ölçer:
//   §1 tetikleyicinin ölü top kümesi TS `DEAD_ROLL_STATUSES` ile birebir aynı
//   §2 top: canlı INSERT ✖ · ölü INSERT ✔ (tarihçe) · ⭐ ölü→canlı DİRİLME ✖ (1e (b)) ·
//      canlı topu Pasif karta taşımak ✖
//   §3 kalem: açık siparişe açık kalem ✖ · iptal kalem ✔ · kapalı sipariş ✔ · iptal geri alma ✖
//   §4 birleştirme + geri alma ürün kartında sedde takılmıyor (mezar taşı ÖNCE kalkar)
//   §5 uygulama katmanı: dirilme `assertRollsRevivable` ile DB'ye gitmeden aynı mesajla durur
//   §6 hata 23514 → error.middleware CHECK eşlemesi kısıt adını ve çıkış yolu mesajını bulur
// =============================================================================
import { ItemLifecycleStatus, OrderStatus, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin } from "./fixture-test-user";
import { itemService } from "../src/routes/item.routes";
import { DEAD_ROLL_STATUSES } from "../src/services/helpers/live-ref-where.helper";
import { MasterDataMergeService } from "../src/services/master-data-merge.service";
import { MasterDataUnmergeService } from "../src/services/master-data-unmerge.service";
import { checkConstraintMessage, extractCheckConstraint } from "../src/middlewares/error.middleware";
import { ROLL_ON_ARCHIVED_ITEM_MESSAGE } from "../src/constants/item-archive-messages";
import { InventoryService } from "../src/services/inventory.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
/** "OK" ya da yakalanan CHECK kısıt adı (23514), başka hata ise "ERR:…". */
async function sedOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "OK";
  } catch (e) {
    const c = extractCheckConstraint(e);
    return c !== null ? c : `ERR:${(e as Error).message.slice(0, 80)}`;
  }
}

const T = `TST-DS-${Date.now().toString().slice(-7)}`;
const itemIds: string[] = [];
const rollIds: string[] = [];
const orderIds: string[] = [];
let customerId = "";
let seq = 0;

async function mkItem(tag: string): Promise<string> {
  const r = await itemService.create({ name: `${T} ${tag}`, itemType: "FABRIC", unit: "MT" });
  const id = (r.data as { id: string }).id;
  itemIds.push(id);
  return id;
}
const rollData = (itemId: string, status: RollStatus) => ({
  barcode: `${T}R${++seq}`.slice(0, 30),
  itemId,
  initialQty: 40,
  currentQty: 40,
  status,
});

async function main(): Promise<void> {
  const admin = await ensureTestAdmin();
  customerId = (await prisma.customer.create({ data: { code: `${T}C`.slice(0, 32), name: `${T} MUSTERI` }, select: { id: true } })).id;

  console.log("=== 1) Ölü küme TS ↔ tetikleyici ===");
  const def = await prisma.$queryRawUnsafe<Array<{ d: string }>>(`SELECT pg_get_functiondef('rolls_archived_item_guard'::regproc) AS d`);
  const m = /NEW\.status IN \(([^)]+)\)/.exec(def[0]?.d ?? "");
  const sqlDead = new Set((m?.[1] ?? "").split(",").map((x) => x.trim().replace(/'/g, "")).filter(Boolean));
  const tsDead = new Set(DEAD_ROLL_STATUSES as string[]);
  check("tetikleyicinin ölü kümesi TS DEAD_ROLL_STATUSES ile aynı", sqlDead.size === tsDead.size && [...tsDead].every((x) => sqlDead.has(x)), [...sqlDead].join(","));

  console.log("\n=== 2) Top (ham yazım — uygulama kapısı atlanıyor) ===");
  const A = await mkItem("PASIF");
  const B = await mkItem("AKTIF");
  await itemService.transitionLifecycle(A, ItemLifecycleStatus.ARCHIVED, null, admin.id);
  check("Pasif karta CANLI top INSERT → sed", (await sedOf(() => prisma.roll.create({ data: rollData(A, RollStatus.WAREHOUSE) }))) === "rolls_item_not_archived");
  const dead = await prisma.roll.create({ data: rollData(A, RollStatus.CANCELLED), select: { id: true } });
  rollIds.push(dead.id);
  check("Pasif karta ÖLÜ top INSERT → geçer (tarihçe)", true);
  check("⭐ Pasif karttaki ölü topun DİRİLMESİ (CANCELLED → WAREHOUSE) → sed", (await sedOf(() => prisma.roll.update({ where: { id: dead.id }, data: { status: RollStatus.WAREHOUSE } }))) === "rolls_item_not_archived");
  const live = await prisma.roll.create({ data: rollData(B, RollStatus.WAREHOUSE), select: { id: true } });
  rollIds.push(live.id);
  check("canlı topu Pasif karta taşımak (itemId) → sed", (await sedOf(() => prisma.roll.update({ where: { id: live.id }, data: { itemId: A } }))) === "rolls_item_not_archived");
  check("Aktif kartta canlı top durum değişimi → geçer (körlük zemini)", (await sedOf(() => prisma.roll.update({ where: { id: live.id }, data: { status: RollStatus.STOCK } }))) === "OK");

  console.log("\n=== 3) Sipariş kalemi ===");
  const open = await prisma.order.create({ data: { orderNumber: `${T}-S1`, customerId, status: OrderStatus.PENDING }, select: { id: true } });
  const closed = await prisma.order.create({ data: { orderNumber: `${T}-S2`, customerId, status: OrderStatus.COMPLETED }, select: { id: true } });
  orderIds.push(open.id, closed.id);
  check("açık siparişe Pasif kartın açık kalemi → sed", (await sedOf(() => prisma.orderLine.create({ data: { orderId: open.id, itemId: A, quantity: 10 } }))) === "order_lines_item_not_archived");
  const cancelled = await prisma.orderLine.create({ data: { orderId: open.id, itemId: A, quantity: 10, cancelledAt: new Date() }, select: { id: true } });
  check("iptal edilmiş kalem → geçer (tarihçe)", true);
  check("kapalı siparişe kalem → geçer", (await sedOf(() => prisma.orderLine.create({ data: { orderId: closed.id, itemId: A, quantity: 10 } }))) === "OK");
  check("⭐ iptal geri alma (cancelledAt → null) → sed", (await sedOf(() => prisma.orderLine.update({ where: { id: cancelled.id }, data: { cancelledAt: null } }))) === "order_lines_item_not_archived");

  console.log("\n=== 4) Birleştirme + geri alma sedde takılmıyor ===");
  const S = await mkItem("HEDEF");
  const K = await mkItem("KAYNAK");
  const kr = await prisma.roll.create({ data: rollData(K, RollStatus.WAREHOUSE), select: { id: true } });
  rollIds.push(kr.id);
  const pv = await MasterDataMergeService.preview("item", S, [K]);
  const ack = pv.conflicts.filter((c) => c.count > 0).length;
  await MasterDataMergeService.merge("item", { survivorId: S, sourceIds: [K], reason: "bekçi sed birleştirme", acknowledgedConflicts: ack, userId: admin.id });
  const moved = await prisma.roll.findUniqueOrThrow({ where: { id: kr.id }, select: { itemId: true } });
  check("birleştirme: canlı top hedefe taşındı (sed hedefi Aktif görür)", moved.itemId === S);
  const op = await prisma.mergeOperation.findFirstOrThrow({ where: { survivorId: S }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const rv = await sedOf(() => MasterDataUnmergeService.revert(op.id, { reason: "bekçi sed geri alma", userId: admin.id }));
  const back = await prisma.roll.findUniqueOrThrow({ where: { id: kr.id }, select: { itemId: true } });
  const ks = await prisma.item.findUniqueOrThrow({ where: { id: K }, select: { lifecycleStatus: true } });
  check("⭐ geri alma sedde takılmadı (mezar taşı satır dönüşünden ÖNCE kalktı)", rv === "OK" && back.itemId === K && ks.lifecycleStatus === "ACTIVE", `${rv} · ${ks.lifecycleStatus}`);

  console.log("\n=== 5) Uygulama katmanı: dirilme DB'ye gitmeden çıkış yolunu söyler ===");
  const inv = new InventoryService();
  const pc = await prisma.roll.create({ data: { ...rollData(A, RollStatus.CANCELLED), preCancelStatus: RollStatus.WAREHOUSE }, select: { id: true } });
  rollIds.push(pc.id);
  let appMsg = "";
  let appCode = "";
  try {
    await inv.restoreCancelledRoll(pc.id, admin.id);
    appMsg = "GEÇTİ";
  } catch (e) {
    appMsg = (e as Error).message;
    appCode = String((e as { details?: { code?: string } }).details?.code ?? "");
  }
  check("⭐ Pasif kartta iptal geri alma → 409 ITEM_INACTIVE + çıkış yolu mesajı (DB'ye gitmeden)", appCode === "ITEM_INACTIVE" && appMsg === ROLL_ON_ARCHIVED_ITEM_MESSAGE, appMsg);
  await itemService.transitionLifecycle(A, ItemLifecycleStatus.PHASE_OUT, null, admin.id);
  const ok5 = await sedOf(() => inv.restoreCancelledRoll(pc.id, admin.id));
  check("çıkış yolu: kart 'Tükenene kadar'a alınınca geri alma çalışır (E sınıfı)", ok5 === "OK", ok5);

  console.log("\n=== 6) Hata eşlemesi ===");
  const msg = checkConstraintMessage("rolls_item_not_archived");
  check("rolls_item_not_archived → çıkış yolunu söyleyen Türkçe mesaj", msg === ROLL_ON_ARCHIVED_ITEM_MESSAGE, msg ?? "eşleme yok");
}

async function temizle(): Promise<void> {
  const del = async (fn: () => Promise<unknown>) => fn().catch((e) => console.error("temizlik:", (e as Error).message.slice(0, 120)));
  const ops = await prisma.mergeOperation.findMany({ where: { OR: [{ survivorId: { in: itemIds } }, { sources: { some: { sourceId: { in: itemIds } } } }] }, select: { id: true } });
  const opIds = ops.map((o) => o.id);
  if (opIds.length) {
    await del(() => prisma.mergeOperationRef.deleteMany({ where: { operationId: { in: opIds } } }));
    await del(() => prisma.mergeOperationSource.deleteMany({ where: { operationId: { in: opIds } } }));
    await del(() => prisma.mergeOperation.deleteMany({ where: { id: { in: opIds } } }));
  }
  await del(() => prisma.duplicateReview.deleteMany({ where: { OR: [{ aId: { in: itemIds } }, { bId: { in: itemIds } }] } }));
  await del(() => prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } }));
  await del(() => prisma.order.deleteMany({ where: { id: { in: orderIds } } }));
  await del(() => prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } }));
  await del(() => prisma.roll.deleteMany({ where: { itemId: { in: itemIds } } }));
  await del(() => prisma.systemLog.deleteMany({ where: { recordId: { in: itemIds } } }));
  await del(() => prisma.item.updateMany({ where: { id: { in: itemIds } }, data: { mergedIntoId: null } }));
  await del(() => prisma.item.deleteMany({ where: { id: { in: itemIds } } }));
  if (customerId) {
    await del(() => prisma.cariAccount.deleteMany({ where: { customerId } }));
    await del(() => prisma.customer.deleteMany({ where: { id: customerId } }));
  }
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await temizle();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
