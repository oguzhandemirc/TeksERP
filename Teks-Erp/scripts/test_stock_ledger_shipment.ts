// =============================================================================
// BEKÇİ — SEVK ve SEVK STORNOSU stok defterine ne yazar?
// Çalıştır: npx tsx scripts/run-all-tests.ts stock_ledger_shipment
// =============================================================================
// NEDEN VAR: sevk yolu stok defterine `writeWarehouseMovements` ile STATÜSÜZ satır
// yazıyordu (yalnız `fromWarehouseId`), yani defter "mal çıktı" diyordu ama "hangi
// durumdan" diyemiyordu — Σ'nın stok-kümesi uçlu okuması o satırı tanım gereği
// dışarıda bırakıyordu. Taşıma (K) sırasında ölçüldü: GERÇEK `performDispatchTx`
// yolunu koşturup stok defteri satırına bakan bekçi **YOKTU** —
//   `test_shipment_undo_dispatch`  → `warehouseMovement` geçişi 0 (onun `toStatus`u
//                                    SEVKİYAT OLAY log'u, defter değil)
//   `test_dispatch_report_gross` · `test_shipment_scope_lock` · `…direct_ship` → 0
//   `test_stock_ledger_return`     → SHIPPED topu ve SHIPMENT satırını ELLE kuruyor
// ⇒ yedi bekçi yeşildi ve yedisi de "regresyon yok" diyordu, "kapsandı" demiyordu.
// Bu dosya o boşluğu kapatır: fikstür GERÇEK servisi koşturur.
//
// ÖLÇÜLENLER
//   §1 ⭐ İleri satır STATÜLÜ: from = {depo, WAREHOUSE} · to = {∅, SHIPPED} ·
//      reasonCode SHIPMENT_DISPATCH · belge bağı (shipmentId)
//   §2 ⭐ Topun `warehouseId`i KORUNUR ama defterin `to` ucu NULL — İKİSİ BİLEREK
//      FARKLI (biri "en son hangi depodaydı" izi, öteki K1 uç şekli)
//   §3 ⭐ Storno ters satırı BAĞLI doğar (`reversesMovementId` → ileri satır), uçlar aynalı
//   §4 ⭐ Σ kapanıyor: sevk çıkışı + storno girişi = 0 (mal rafa döndü)
//   §5 ⭐ İleri satır NE SİLİNDİ NE DEĞİŞTİ (defter append-only)
//   §6 ⭐ `preShipStatus` NULL topa yeni ileri satır YAZILMAZ — yüklem bir SÜZGEÇ
//      değil KANIT koşulu (çıkış ucunun statüsü uydurulamaz)
//   §7 ⭐ SESSİZ ATLAMA YOK: stok kümesi DIŞI statüden sevk 4xx ile REDDEDİLİR.
//      ⚠️ Reddeden kapı ÖLÇÜLDÜ: hayalet-top iddiası (400), stok defteri kapısı DEĞİL
//      — defterin §64 kontrolü bu yolda SON ÇARE ağı. Asıl iddia: eski kapının
//      `hasWarehouseEnd` süzgeci geri GELMEDİ (K6).
//   §8 POZİTİF KONTROL: fikstür gerçekten sevk etti (sevkiyat DISPATCHED, top SHIPPED)
// =============================================================================
import { ItemType, ItemUnit, RollStatus, ShipmentStatus, WarehouseEventType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { shippingService } from "../src/services/shipping.service";
import { AppError } from "../src/utils/app-error";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const TAG = `TEST-SLS-${Date.now()}`;
const rollIds: string[] = [];
const sackIds: string[] = [];
const shipmentIds: string[] = [];
const customerIds: string[] = [];
const itemIds: string[] = [];
let ADMIN = "";
let WH = "";

function errOf(e: unknown): { status?: number; message: string } {
  if (e instanceof AppError) return { status: e.statusCode, message: e.message };
  return { message: (e as Error).message };
}

/** PLANNED sevkiyat + tartılmış çuval + verilen statüde toplar. */
async function sevkiyatKur(
  etiket: string,
  itemId: string,
  toplar: Array<{ qty: number; status: RollStatus }>,
): Promise<{ shipmentId: string; rollIds: string[] }> {
  const customer = await prisma.customer.create({
    data: { name: `${TAG}-${etiket} Müşteri`, code: `${TAG}-${etiket}` },
    select: { id: true },
  });
  customerIds.push(customer.id);
  const shipment = await prisma.shipment.create({
    data: {
      shipmentNo: `${TAG}-${etiket}`,
      customerId: customer.id,
      status: ShipmentStatus.PLANNED,
    },
    select: { id: true },
  });
  shipmentIds.push(shipment.id);
  // ⚠️ `weightKg` ZORUNLU: `dispatchShipment` → `assertWeighed` tartısız çuvalı reddeder.
  const sack = await prisma.sack.create({
    data: { sackNo: `${TAG}-${etiket}-C1`, customerId: customer.id, shipmentId: shipment.id, seq: 1, weightKg: 50 },
    select: { id: true },
  });
  sackIds.push(sack.id);
  const ids: string[] = [];
  for (const [i, t] of toplar.entries()) {
    const r = await prisma.roll.create({
      data: {
        barcode: `${TAG}-${etiket}-R${i}`,
        itemId,
        initialQty: t.qty,
        currentQty: t.qty,
        status: t.status,
        // Sevk `warehouseId`yi TEMİZLEMEZ — §2 tam bunu ölçüyor.
        warehouseId: WH,
        qualityGrade: "1.KALITE",
        shipmentId: shipment.id,
        sackId: sack.id,
      },
      select: { id: true },
    });
    ids.push(r.id);
    rollIds.push(r.id);
  }
  return { shipmentId: shipment.id, rollIds: ids };
}

const defter = (rollId: string) =>
  prisma.warehouseMovement.findMany({
    where: { rollId },
    select: {
      id: true, eventType: true, qty: true, reasonCode: true, shipmentId: true,
      fromWarehouseId: true, fromStatus: true, toWarehouseId: true, toStatus: true,
      reversesMovementId: true, createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

async function main(): Promise<void> {
  ADMIN = (await ensureTestAdmin()).id;
  WH = await fixtureWarehouseId();
  const item = await prisma.item.create({
    data: { code: `${TAG}-KM`, name: `${TAG} Kumaş`, itemType: ItemType.FABRIC, unit: ItemUnit.MT },
    select: { id: true },
  });
  itemIds.push(item.id);

  // ═══ §1–§5 · §8 — sevk ve storno ═══
  const a = await sevkiyatKur("A", item.id, [{ qty: 100, status: RollStatus.WAREHOUSE }]);
  const r1 = a.rollIds[0] as string;
  await shippingService.dispatchShipment(a.shipmentId, { plateNumber: "34 TEST 01" }, ADMIN);

  const sevkiyatA = await prisma.shipment.findUniqueOrThrow({ where: { id: a.shipmentId }, select: { status: true } });
  const topA = await prisma.roll.findUniqueOrThrow({ where: { id: r1 }, select: { status: true, warehouseId: true, preShipStatus: true } });
  check(
    "§8 POZİTİF KONTROL: fikstür gerçekten sevk etti (sevkiyat DISPATCHED, top SHIPPED)",
    sevkiyatA.status === ShipmentStatus.DISPATCHED && topA.status === RollStatus.SHIPPED,
    `${sevkiyatA.status} / ${topA.status}`,
  );

  const d1 = await defter(r1);
  const ileri = d1.find((x) => x.eventType === WarehouseEventType.SHIPMENT);
  check(
    "§1 ⭐ İleri satır STATÜLÜ: from = {depo, WAREHOUSE} · to = {∅, SHIPPED} · sebep + belge bağı",
    ileri !== undefined &&
      ileri.fromWarehouseId === WH &&
      ileri.fromStatus === RollStatus.WAREHOUSE &&
      ileri.toWarehouseId === null &&
      ileri.toStatus === RollStatus.SHIPPED &&
      ileri.reasonCode === STOCK_MOVE_REASON.SHIPMENT_DISPATCH &&
      ileri.shipmentId === a.shipmentId,
    JSON.stringify(ileri),
  );
  check(
    "§2 ⭐ Topun deposu KORUNDU ama defterin giriş ucu NULL (ikisi bilerek farklı)",
    topA.warehouseId === WH && ileri?.toWarehouseId === null,
    `top.warehouseId=${topA.warehouseId} · satır.to=${String(ileri?.toWarehouseId)}`,
  );

  await shippingService.undoDispatch(a.shipmentId, "bekçi stornosu", ADMIN);
  const d1s = await defter(r1);
  const ters = d1s.find((x) => x.eventType === WarehouseEventType.SHIPMENT_REVERSAL);
  check(
    "§3 ⭐ Storno ters satırı BAĞLI doğdu (reversesMovementId → ileri satır) ve uçlar aynalı",
    ters !== undefined &&
      ters.reversesMovementId === ileri?.id &&
      ters.fromStatus === RollStatus.SHIPPED &&
      ters.fromWarehouseId === null &&
      ters.toStatus === RollStatus.WAREHOUSE &&
      ters.toWarehouseId === WH,
    JSON.stringify(ters),
  );
  const net = d1s.reduce((t, x) => {
    const q = Number(x.qty);
    return t + (x.toWarehouseId ? q : 0) - (x.fromWarehouseId ? q : 0);
  }, 0);
  check("§4 ⭐ Σ kapanıyor: sevk çıkışı + storno girişi = 0 (mal rafa döndü)", Math.abs(net) < 0.001, `net=${net}`);
  const ileriSonra = d1s.find((x) => x.id === ileri?.id);
  check(
    "§5 ⭐ İleri satır NE SİLİNDİ NE DEĞİŞTİ (defter append-only)",
    ileriSonra !== undefined &&
      ileriSonra.fromStatus === ileri?.fromStatus &&
      ileriSonra.toStatus === ileri?.toStatus &&
      Number(ileriSonra.qty) === Number(ileri?.qty),
    JSON.stringify(ileriSonra),
  );

  // ═══ §6 — KANIT KOŞULU: preShipStatus NULL ⇒ yeni ileri satır YAZILMAZ ═══
  // Bu karardan ÖNCE sevk edilmiş top: statüsü SHIPPED, `preShipStatus` NULL.
  // Sevkiyat yine DISPATCHED edilir ama o topun satırı İKİNCİ kez yazılmaz —
  // çıkış ucunun statüsü hiçbir yerden türetilemez ve UYDURULMAZ.
  const b = await sevkiyatKur("B", item.id, [
    { qty: 40, status: RollStatus.WAREHOUSE },
    { qty: 60, status: RollStatus.SHIPPED },
  ]);
  const [bYeni, bEski] = b.rollIds as [string, string];
  await prisma.roll.update({ where: { id: bEski }, data: { preShipStatus: null } });
  await shippingService.dispatchShipment(b.shipmentId, { plateNumber: "34 TEST 02" }, ADMIN);
  const dEski = await defter(bEski);
  const dYeni = await defter(bYeni);
  check(
    "§6 ⭐ preShipStatus NULL topa ileri satır YAZILMADI (kanıt koşulu, süzgeç değil)",
    dEski.filter((x) => x.eventType === WarehouseEventType.SHIPMENT).length === 0,
    `eski top satırı=${dEski.length}`,
  );
  check(
    "§6b Aynı sevkiyatın kanıtlı topu satırını ALDI (körlük zemini: sevk gerçekten yazdı)",
    dYeni.filter((x) => x.eventType === WarehouseEventType.SHIPMENT).length === 1,
    `yeni top satırı=${dYeni.length}`,
  );

  // ═══ §7 — FAIL-CLOSED: stok kümesi DIŞI statüden sevk ═══
  // `preShipStatus` stok kümesinde değilse satırın İKİ ucu da stok dışı olur
  // (from = IN_PRODUCTION, to = SHIPPED) ⇒ kapı FIRLATIR. Eski kapı bu satırı
  // `hasWarehouseEnd` süzgecinde SESSİZCE atlıyordu; K6 bunu yasaklıyor.
  const c = await sevkiyatKur("C", item.id, [{ qty: 25, status: RollStatus.IN_PRODUCTION }]);
  let hata: { status?: number; message: string } | null = null;
  try {
    await shippingService.dispatchShipment(c.shipmentId, { plateNumber: "34 TEST 03" }, ADMIN);
  } catch (e) {
    hata = errOf(e);
  }
  const cSevkiyat = await prisma.shipment.findUniqueOrThrow({ where: { id: c.shipmentId }, select: { status: true } });
  const cDefter = await defter(c.rollIds[0] as string);
  // ⚠️ HANGİ KAPI REDDEDİYOR — ölçüldü, varsayılmadı (2026-09-13): bu senaryoyu
  // stok defteri kapısı DEĞİL, ondan ÖNCEKİ hayalet-top iddiası reddediyor
  // ("çuvalda kayıtlı ama fiziksel olarak binada olmayan top var", 400). Yani
  // defterin §64 mekanik kontrolü (iki ucu da stok dışı satır yazılamaz) bu yolda
  // SON ÇARE ağıdır, birincil kapı değil — ve buna ulaşılamıyor olması iyi haber.
  // Kalem bu yüzden "hangi kodla" değil "SESSİZCE ATLAMADI" diye ölçüyor: asıl
  // iddia eski kapının `hasWarehouseEnd` süzgecinin geri GELMEMESİ (K6).
  check(
    "§7 ⭐ Stok kümesi DIŞI statüden sevk SESSİZCE ATLANMADI — reddedildi (4xx)",
    hata !== null && (hata.status === 400 || hata.status === 409),
    hata ? `${hata.status} ${hata.message.slice(0, 90)}` : "FIRLATMADI — satır sessizce atlanmış olabilir",
  );
  check(
    "§7b Fırlatma tx'i geri sardı: sevkiyat PLANNED kaldı, defter satırı yok",
    cSevkiyat.status === ShipmentStatus.PLANNED && cDefter.length === 0,
    `${cSevkiyat.status} · satır=${cDefter.length}`,
  );
}

async function cleanup(): Promise<void> {
  // ⚠️ FK SIRASI: ters satırlar (self-FK `Restrict`) → hareketler → toplar.
  // Küme BAĞDAN bulunur: ters satır `shipmentId` taşısa da önce çocuk silinmeli.
  if (rollIds.length) {
    await prisma.warehouseMovement.deleteMany({ where: { reversesMovement: { rollId: { in: rollIds } } } }).catch(() => {});
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
  }
  if (sackIds.length) await prisma.sack.deleteMany({ where: { id: { in: sackIds } } }).catch(() => {});
  if (shipmentIds.length) {
    await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } }).catch(() => {});
    await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } }).catch(() => {});
  }
  if (customerIds.length) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } }).catch(() => {});
  if (itemIds.length) await prisma.item.deleteMany({ where: { id: { in: itemIds } } }).catch(() => {});
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
