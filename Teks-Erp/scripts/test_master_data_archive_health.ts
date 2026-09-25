// =============================================================================
// TeksERP - Ana veri arşiv sağlığı sayacı (URUN-YASAM-DONGUSU.md §10, S8)
// =============================================================================
// `/api/admin/health` → `masterDataArchive`: Pasif kayıtta canlı referans (beklenen 0) ve
// Tükenene kadar kartların durumu. Kapıyı ATLAYAN satır (ham SQL — tetikleyiciden önceki
// veri emsali) sayaca düşmeli:
//   §1 ürün: kart kapı dışından Pasif'e çekilir, canlı topu durur → item +1
//   §2 renk: pasif renkte canlı top → color +1 (spec yüklemi, ikinci tanım yok)
//   §1b sipariş yeniden açılma (DB seddinin bilinen sınırı): kapalı siparişte Pasif kartın
//       kalemi, sipariş açığa dönünce sayaca düşer
//   §3 Tükenene kadar: canlı topu olan kart "kayıt var", olmayan "Pasife hazır"
//   §4 önbellek: ilk okuma null (= ÖLÇÜLEMEDİ, 0 DEĞİL) + arkada ölçüm; sonra değer döner
// Sayımlar TABANA göre FARK olarak ölçülür (paylaşılan test DB'sinde başka artıklar olabilir).
// =============================================================================
import { ItemLifecycleStatus, OrderStatus, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { itemService } from "../src/routes/item.routes";
import {
  masterDataArchiveHealthSnapshot,
  measureMasterDataArchiveHealth,
} from "../src/services/helpers/master-data-health.helper";

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

const T = `TST-MH-${Date.now().toString().slice(-7)}`;
const itemIds: string[] = [];
const colorIds: string[] = [];
const orderIds: string[] = [];
let customerId = "";
let seq = 0;

async function mkItem(tag: string): Promise<string> {
  const r = await itemService.create({ name: `${T} ${tag}`, itemType: "FABRIC", unit: "MT" });
  const id = (r.data as { id: string }).id;
  itemIds.push(id);
  return id;
}
async function liveRoll(itemId: string, colorId: string | null = null): Promise<void> {
  await prisma.roll.create({
    data: { barcode: `${T}R${++seq}`.slice(0, 30), itemId, colorId, initialQty: 40, currentQty: 40, status: RollStatus.WAREHOUSE },
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log("=== 4a) Önbellek boşken: null = ÖLÇÜLEMEDİ ===");
  check("ilk okuma null (0 ile karıştırılmaz) ve arkada ölçüm başlar", masterDataArchiveHealthSnapshot() === null);

  const base = await measureMasterDataArchiveHealth();

  console.log("\n=== 1) Ürün: kapı dışından Pasif'e çekilen kart canlı topuyla ===");
  const A = await mkItem("PASIF-CANLI");
  await liveRoll(A);
  // Kapıyı atlayan yazım (tetikleyiciden önceki veri emsali): tetikleyici rolls'ta, items'ta değil.
  await prisma.$executeRawUnsafe(`UPDATE "items" SET "lifecycleStatus" = 'ARCHIVED', "isActive" = false WHERE id = $1::uuid`, A);

  console.log("\n=== 1b) Kapalı sipariş açığa döner (tetikleyici orders'ta değil) ===");
  const B = await mkItem("KAPALI-SIPARIS");
  customerId = (await prisma.customer.create({ data: { code: `${T}C`.slice(0, 32), name: `${T} MUSTERI` }, select: { id: true } })).id;
  const closed = await prisma.order.create({ data: { orderNumber: `${T}-S1`, customerId, status: OrderStatus.COMPLETED }, select: { id: true } });
  orderIds.push(closed.id);
  await prisma.orderLine.create({ data: { orderId: closed.id, itemId: B, quantity: 10, unit: "KG" } });
  await itemService.transitionLifecycle(B, ItemLifecycleStatus.ARCHIVED, null);
  await prisma.order.update({ where: { id: closed.id }, data: { status: OrderStatus.PENDING } });

  console.log("\n=== 2) Renk: pasif renkte canlı top ===");
  const K = await mkItem("RENKLI");
  const color = await prisma.color.create({ data: { code: `${T}CL`.slice(0, 32), name: `${T} RENK`, isActive: false }, select: { id: true } });
  colorIds.push(color.id);
  await liveRoll(K, color.id);

  console.log("\n=== 3) Tükenene kadar kartlar ===");
  const P1 = await mkItem("TK-CANLI");
  await liveRoll(P1);
  await itemService.transitionLifecycle(P1, ItemLifecycleStatus.PHASE_OUT, null);
  const P2 = await mkItem("TK-HAZIR");
  await itemService.transitionLifecycle(P2, ItemLifecycleStatus.PHASE_OUT, null);

  const now = await measureMasterDataArchiveHealth();
  const d = (k: keyof typeof now.archivedWithLiveRefs) => now.archivedWithLiveRefs[k] - base.archivedWithLiveRefs[k];
  check("⭐ §1 + §1b kapı dışı Pasif kart (canlı top) ve açığa dönen siparişin kalemi → item sayacı +2", d("item") === 2, `Δ${d("item")}`);
  check("⭐ §2 pasif renkte canlı top → color sayacı +1 (spec yüklemi)", d("color") === 1, `Δ${d("color")}`);
  check("toplam = varlıkların toplamı", now.total === Object.values(now.archivedWithLiveRefs).reduce((a, b) => a + b, 0));
  check(
    "⭐ §3 Tükenene kadar: +2 kart, 1'i canlı kayıtlı, 1'i Pasife hazır",
    now.phaseOut.cards - base.phaseOut.cards === 2 &&
      now.phaseOut.withLiveRefs - base.phaseOut.withLiveRefs === 1 &&
      now.phaseOut.readyToArchive - base.phaseOut.readyToArchive === 1,
    JSON.stringify(now.phaseOut),
  );

  console.log("\n=== 4b) Önbellek dolunca değer döner ===");
  let snap = masterDataArchiveHealthSnapshot();
  for (let i = 0; i < 100 && snap === null; i++) {
    await sleep(100);
    snap = masterDataArchiveHealthSnapshot();
  }
  check("arkadaki ölçüm bitince snapshot dolu ve taze", snap !== null && snap.stale === false && typeof snap.total === "number");
}

async function temizle(): Promise<void> {
  const del = async (fn: () => Promise<unknown>) => fn().catch((e) => console.error("temizlik:", (e as Error).message.slice(0, 120)));
  await del(() => prisma.warehouseMovement.deleteMany({ where: { roll: { itemId: { in: itemIds } } } }));
  await del(() => prisma.roll.deleteMany({ where: { itemId: { in: itemIds } } }));
  await del(() => prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } }));
  await del(() => prisma.order.deleteMany({ where: { id: { in: orderIds } } }));
  await del(() => prisma.systemLog.deleteMany({ where: { recordId: { in: [...itemIds, ...colorIds] } } }));
  await del(() => prisma.item.deleteMany({ where: { id: { in: itemIds } } }));
  await del(() => prisma.color.deleteMany({ where: { id: { in: colorIds } } }));
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
