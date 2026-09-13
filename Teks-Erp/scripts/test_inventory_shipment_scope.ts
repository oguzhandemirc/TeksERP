// =============================================================================
// TEST: Envanter "sevkiyat kapsamı" filtresi (serbest / çuvallanmış).
// Çalıştır: npx tsx scripts/test_inventory_shipment_scope.ts
//
// DÜZELTME BAĞLAMI (çuval havuzu modeli): Bir top bir ÇUVALA konmuş ama henüz
// SEVKİYATA atanmamışsa (sackId dolu, shipmentId null) fiziksel olarak çuvaldadır
// → "serbest" DEĞİLDİR. Eski filtre yalnız shipmentId'ye bakıyordu; çuvaldaki-
// sevksiz topu "serbest" sayıyordu. Yeni: free = sackId null VE shipmentId null;
// committed = sackId dolu VEYA shipmentId dolu.
//
// Doğrulananlar:
//   1. buildRollWhere('free')      → { shipmentId:null, sackId:null } (where şekli)
//   2. buildRollWhere('committed') → AND içinde OR[sackId!=null, shipmentId!=null]
//   3. DB: 'free' filtresi çuvaldaki-sevksiz topu DIŞLAR, gerçek serbesti içerir
//   4. DB: 'committed' filtresi çuvaldaki-sevksiz topu İÇERİR, serbesti dışlar
//   5. DB: "Çuvalda" sekmesi (rollScope=IN_SACK) çuvaldakini İÇERİR, serbesti dışlar
//   6. model sayaçları: çuvaldaki-sevksiz top 'pool', gerçek serbest 'free'
// =============================================================================
import { RollStatus, RollEntrySource } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { ShippingService } from "../src/services/shipping.service";
import type { QueryParams } from "../src/types/api.types";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const inv = new InventoryService();
const ship = new ShippingService();
// buildRollWhere private — teste özel erişim (çağıran prod yolu findAllRolls ile aynı).
// ⚠️ `fireCodes` ÇAĞIRANDAN gelir (2026-09-13, karar ①): fire kümesi artık
// katalogdan çözülüyor ve metoda parametre olarak giriyor. Bu erişim `as
// unknown as` ile tip kapısını atladığı için imza değişikliğini DERLEYİCİ
// GÖREMEZ — parametre atlanırsa hata çalışma zamanında çıkar (ve çıktı).
const buildWhere = (
  filters: Record<string, unknown>,
  fireCodes: readonly string[] = [],
): Record<string, unknown> =>
  (
    inv as unknown as {
      buildRollWhere: (p: QueryParams, f: readonly string[]) => Record<string, unknown>;
    }
  ).buildRollWhere(
    {
      filters: filters as QueryParams["filters"],
      page: 1, pageSize: 50, sortBy: "createdAt", sortOrder: "desc",
    } as QueryParams,
    fireCodes,
  );

const W = 7734; // izole spec — başka test topu bu ende olmasın
const createdRolls: string[] = [];
const createdSacks: string[] = [];

async function makeWarehouseRoll(): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: `TEST-SCOPE-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
      itemId, colorId: null, width: W,
      initialQty: 50, currentQty: 50,
      status: RollStatus.WAREHOUSE, qualityGrade: "1.KALITE",
      entrySource: RollEntrySource.SUPPLIER_RECEIPT,
    },
    select: { id: true },
  });
  createdRolls.push(r.id);
  return r.id;
}

let itemId = "";
let customerId = "";

async function main(): Promise<void> {
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const cust = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item || !cust) throw new Error("Test verisi yetersiz (Item/Customer yok — npm run seed).");
  itemId = item.id; customerId = cust.id;

  // ── 1-2) WHERE ŞEKLİ (buildRollWhere) ──
  const wFree = buildWhere({ shipmentScope: "free" });
  check("1 free → shipmentId=null + sackId=null",
    wFree.shipmentId === null && wFree.sackId === null,
    JSON.stringify({ shipmentId: wFree.shipmentId, sackId: wFree.sackId }));

  const wCommitted = buildWhere({ shipmentScope: "committed" });
  const andArr = Array.isArray(wCommitted.AND) ? (wCommitted.AND as Record<string, unknown>[]) : [];
  const hasCommittedOr = andArr.some((c) => {
    const or = (c as { OR?: unknown[] }).OR;
    return Array.isArray(or)
      && or.some((o) => JSON.stringify(o) === JSON.stringify({ sackId: { not: null } }))
      && or.some((o) => JSON.stringify(o) === JSON.stringify({ shipmentId: { not: null } }));
  });
  check("2 committed → AND içinde OR[sackId!=null, shipmentId!=null]", hasCommittedOr);

  // ── Fixture: gerçek serbest + çuvaldaki-sevksiz top ──
  const freeRoll = await makeWarehouseRoll();
  const pooledRoll = await makeWarehouseRoll();
  const opened = (await ship.openSack({ customerId })) as { data: { id: string } };
  createdSacks.push(opened.data.id);
  // Çuvala doğrudan bağla (scanIntoSack yerine — saf filtre testi; barkod okutma akışı değil).
  await prisma.roll.update({ where: { id: pooledRoll }, data: { sackId: opened.data.id } });

  const pooledState = await prisma.roll.findUnique({ where: { id: pooledRoll }, select: { sackId: true, shipmentId: true, status: true } });
  check("kurulum: pooledRoll çuvalda + sevksiz + WAREHOUSE",
    pooledState?.sackId === opened.data.id && pooledState?.shipmentId === null && pooledState?.status === RollStatus.WAREHOUSE);

  // DB testleri üretim yolunu yansıtsın: FINISHED_STOCK sekmesi rollScope+status=ALL
  // gönderir (yoksa varsayılan `status=STOCK` WAREHOUSE toplarını eler).
  const wFreeDb = buildWhere({ rollScope: "FINISHED_STOCK", status: "ALL", shipmentScope: "free" });
  const wCommittedDb = buildWhere({ rollScope: "FINISHED_STOCK", status: "ALL", shipmentScope: "committed" });
  const idsOf = async (w: Record<string, unknown>): Promise<string[]> =>
    (await prisma.roll.findMany({ where: { AND: [w as object, { width: W }] }, select: { id: true } })).map((r) => r.id);

  // ── 3) 'free' filtresi çuvaldakini DIŞLAR, serbesti İÇERİR ──
  const freeIds = await idsOf(wFreeDb);
  check("3a free: gerçek serbest top DAHİL", freeIds.includes(freeRoll));
  check("3b free: çuvaldaki-sevksiz top HARİÇ", !freeIds.includes(pooledRoll));

  // ── 4) 'committed' filtresi çuvaldakini İÇERİR, serbesti DIŞLAR ──
  const committedIds = await idsOf(wCommittedDb);
  check("4a committed: çuvaldaki-sevksiz top DAHİL", committedIds.includes(pooledRoll));
  check("4b committed: gerçek serbest top HARİÇ", !committedIds.includes(freeRoll));

  // ── 5) "Çuvalda" sekmesi (rollScope=IN_SACK): çuvaldakini İÇERİR, serbesti DIŞLAR ──
  const wInSack = buildWhere({ rollScope: "IN_SACK", status: "ALL" });
  const inSackIds = await idsOf(wInSack);
  check("5a IN_SACK: çuvaldaki top DAHİL", inSackIds.includes(pooledRoll));
  check("5b IN_SACK: serbest top HARİÇ", !inSackIds.includes(freeRoll));

  // ── 6) model sayaçları (spec-izole): free=1 / pool=1 ──
  const freeCount = await prisma.roll.count({ where: { status: RollStatus.WAREHOUSE, shipmentId: null, sackId: null, width: W } });
  const poolCount = await prisma.roll.count({ where: { status: RollStatus.WAREHOUSE, shipmentId: null, sackId: { not: null }, width: W } });
  check("6a scope: bu spec'te free=1 (yalnız gerçek serbest)", freeCount === 1, `free=${freeCount}`);
  check("6b scope: bu spec'te pool=1 (çuvaldaki-sevksiz)", poolCount === 1, `pool=${poolCount}`);
}

async function cleanup(): Promise<void> {
  try {
    await prisma.roll.updateMany({ where: { id: { in: createdRolls } }, data: { sackId: null, shipmentId: null } });
    await prisma.sack.deleteMany({ where: { id: { in: createdSacks } } });
    await prisma.roll.deleteMany({ where: { id: { in: createdRolls } } });
  } catch (e) {
    console.error("Temizlik hatası:", e);
  }
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
