// =============================================================================
// BEKÇİ — İADE STOK DEFTERİNE BAĞLI (ileri satır statülü + BAĞLI ters kayıt)
// Çalıştır: npx tsx scripts/run-all-tests.ts stock_ledger_return
// =============================================================================
// NEDEN: `createReturn` eski (konum) kapıdan statüsüz bir `RETURN` satırı
// yazıyordu ve `cancelReturn` HİÇ satır yazmıyordu. İkisi birlikte şu deliği
// üretiyordu: mal rafa girmiş sayılıyor, iade geri alınınca defter girişi
// DURUYOR ⇒ Σ sessizce şişiyor. "Ters yolu olmayan ileri yol" sınıfı.
//
// ⚠️ FİKSTÜR GERÇEK YAZMA YOLUNDAN GEÇER (`returnService.createReturn` /
// `cancelReturn`) — kendi kurduğu dünyayı doğrulayan bekçi yeşil kalırken hatayı
// göremez (ölçüldü 2026-09-12: kör fikstürle 7/0, gerçek yolda 3/6).
//
// ÖLÇÜLENLER
//   §1 İleri satır STATÜLÜ: `from = {∅, SHIPPED}` · `to = {depo, appliedStatus}`
//   §2 ⭐ Sebep kodu + belge bağı (`rollReturnId`) yazıldı
//   §3 ⭐ İptal BAĞLI ters satır yazdı (`reversesMovementId` → ileri satır)
//   §4 ⭐ Storno ≠ iade: sevkin `SHIPMENT` satırına DOKUNULMADI
//   §5 ⭐ Σ kapanıyor: iade + iptal net SIFIR
//   §6 ⭐ FİRE hedefli iade (stok dışı) satır YAZMAZ; iptali de satırsız (simetri)
//   §7 ⭐ Çift iptal ikinci ters satır yazmaz (DB unique)
//
// NEGATİF SONDALAR (ölçüldü 2026-09-13 — her biri beklenen kontrolü kırmızıya çevirdi)
//   · `cancelReturn`un ters blogu silindi        → §3 · §5 (net=0) · §7
//   · ileri satır BAĞ yerine TİPLE bulundu       → §3 · §4 (sevk satırı terslendi!) · §5 · §6b
//   · stok kümesi guard'ı silindi                → ÇÖKME (bkz. aşağı)
//
// ⚠️ ÖRTÜŞEN SED ŞERHİ: §6a'nın koruduğu guard (`WAREHOUSE_STOCK_STATUSES.includes`)
// kaldırıldığında bekçi §6a'da DEĞİL, `assertEndShape`in "stok dışı uç depo taşımaz"
// kuralında ÇÖKEREK kırmızı verir — iki sed aynı girdiyi yakalıyor. §6a yine gerçek
// bir ağdır (uç denetimi bir gün gevşerse tutan tek şey odur) ama BUGÜN ilk ağ değil;
// sondanın kırmızısı etiketli bir başarısızlık değil bir çökmedir. "Kırmızı verdi"
// ile "bu kontrol yakaladı" aynı şey değil.
// =============================================================================
import { Prisma, RollStatus, RollEntrySource, ShipmentStatus, WarehouseEventType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { returnService } from "../src/services/return.service";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";
import { WAREHOUSE_STOCK_STATUSES } from "../src/services/helpers/warehouse-stock.helper";
import { fixtureWarehouseId } from "./fixture-warehouse";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const TAG = `TEST-SLR-${Date.now()}`;
const rollIds: string[] = [];
const returnIds: string[] = [];
let shipmentId = "";
let itemId = "";

async function satirlar(rollId: string) {
  return prisma.warehouseMovement.findMany({
    where: { rollId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, eventType: true, qty: true, reasonCode: true,
      fromWarehouseId: true, toWarehouseId: true, fromStatus: true, toStatus: true,
      rollReturnId: true, shipmentId: true, reversesMovementId: true,
    },
  });
}

async function main(): Promise<void> {
  console.log("=== İade stok defteri bekçisi ===\n");

  const whId = await fixtureWarehouseId();
  const customer = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true } });
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!customer || !admin) throw new Error("Fikstür eksik (customer/admin) — önce npm run seed.");
  const gFire = await prisma.qualityGrade.findUnique({
    where: { code: "FIRE" }, select: { id: true, returnTargetStatus: true, isActive: true },
  });

  itemId = (await prisma.item.create({
    data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true },
  })).id;

  const shipment = await prisma.shipment.create({
    data: {
      shipmentNo: `${TAG}-SVK`, customerId: customer.id,
      status: ShipmentStatus.DISPATCHED, dispatchedAt: new Date(),
    },
    select: { id: true },
  });
  shipmentId = shipment.id;

  // Sevk edilmiş top: deposunu KORUR (sevk `warehouseId`yi temizlemiyor) ve
  // geçmiş bir `SHIPMENT` satırı taşır — §4 ona dokunulmadığını ölçüyor.
  const mkShipped = async (suffix: string): Promise<string> => {
    const r = await prisma.roll.create({
      data: {
        barcode: `${TAG}-${suffix}`, itemId, initialQty: 100, currentQty: 100,
        width: 150, status: RollStatus.SHIPPED, warehouseId: whId,
        entrySource: RollEntrySource.SUPPLIER_RECEIPT, shipmentId: shipment.id,
      },
      select: { id: true },
    });
    rollIds.push(r.id);
    // Sevkin defter satırı (statülü, yeni kapı biçiminde) — iade onu DEĞİŞTİRMEMELİ.
    await prisma.warehouseMovement.create({
      data: {
        rollId: r.id, eventType: WarehouseEventType.SHIPMENT, qty: 100,
        fromWarehouseId: whId, fromStatus: RollStatus.WAREHOUSE,
        toWarehouseId: null, toStatus: RollStatus.SHIPPED,
        reasonCode: "SHIPMENT_DISPATCH", shipmentId: shipment.id,
      },
    });
    return r.id;
  };

  // ── §1/§2 — İLERİ SATIR ───────────────────────────────────────────────────
  const r1 = await mkShipped("A");
  const ret1 = await returnService.createReturn(
    { rollId: r1, reasonText: `${TAG} hatalı mal` }, admin.id,
  );
  const ret1Id = (ret1.data as { ids?: string[]; id?: string }).ids?.[0]
    ?? (ret1.data as { id: string }).id;
  returnIds.push(ret1Id);

  const s1 = await satirlar(r1);
  const ileri = s1.find((x) => x.eventType === WarehouseEventType.RETURN);
  check(
    "§1 ⭐ İleri satır STATÜLÜ: from = {∅, SHIPPED} · to = {depo, WAREHOUSE}",
    ileri !== undefined && ileri.fromStatus === RollStatus.SHIPPED && ileri.fromWarehouseId === null &&
      ileri.toStatus === RollStatus.WAREHOUSE && ileri.toWarehouseId === whId,
    ileri ? `from=${String(ileri.fromStatus)}/${String(ileri.fromWarehouseId)} to=${String(ileri.toStatus)}/${ileri.toWarehouseId === whId}` : "RETURN satırı YOK",
  );
  check(
    "§2 ⭐ Sebep kodu ve belge bağı yazıldı",
    ileri?.reasonCode === STOCK_MOVE_REASON.CUSTOMER_RETURN && ileri?.rollReturnId === ret1Id,
    `sebep=${String(ileri?.reasonCode)} bağ=${String(ileri?.rollReturnId === ret1Id)}`,
  );

  // ── §3/§4/§5 — TERS KAYIT ─────────────────────────────────────────────────
  const sevkSatiriOnce = s1.find((x) => x.eventType === WarehouseEventType.SHIPMENT);
  await returnService.cancelReturn(ret1Id, `${TAG} yanlış kabul`, admin.id);
  const s1Sonra = await satirlar(r1);
  const ters = s1Sonra.find((x) => x.reversesMovementId === ileri?.id);
  check(
    "§3 ⭐ İptal BAĞLI ters satır yazdı (bağ ileri satıra, uçlar aynalı)",
    ters !== undefined && ters.reasonCode === STOCK_MOVE_REASON.RETURN_CANCEL &&
      ters.fromWarehouseId === whId && ters.fromStatus === RollStatus.WAREHOUSE &&
      ters.toWarehouseId === null && ters.toStatus === RollStatus.SHIPPED,
    ters ? `sebep=${String(ters.reasonCode)} from=${String(ters.fromStatus)} to=${String(ters.toStatus)}` : "ters satır YOK",
  );
  const sevkSatiriSonra = s1Sonra.find((x) => x.id === sevkSatiriOnce?.id);
  check(
    "§4 ⭐ Storno ≠ iade: sevkin SHIPMENT satırı DEĞİŞMEDİ ve terslenmedi",
    sevkSatiriSonra !== undefined &&
      sevkSatiriSonra.toStatus === sevkSatiriOnce?.toStatus &&
      Number(sevkSatiriSonra.qty) === Number(sevkSatiriOnce?.qty) &&
      !s1Sonra.some((x) => x.reversesMovementId === sevkSatiriOnce?.id),
    `terslenmiş=${s1Sonra.some((x) => x.reversesMovementId === sevkSatiriOnce?.id)}`,
  );
  // Σ: depoya giren − depodan çıkan, YALNIZ stok kümesi uçları sayılır (D4/D5).
  const net = s1Sonra.reduce((acc, x) => {
    const girdi = x.toWarehouseId === whId && x.toStatus !== null && WAREHOUSE_STOCK_STATUSES.includes(x.toStatus);
    const cikti = x.fromWarehouseId === whId && x.fromStatus !== null && WAREHOUSE_STOCK_STATUSES.includes(x.fromStatus);
    return acc + (girdi ? Number(x.qty) : 0) - (cikti ? Number(x.qty) : 0);
  }, 0);
  check(
    "§5 ⭐ Σ kapanıyor: sevk çıkışı + iade girişi + iptal çıkışı = −100 (mal müşteride)",
    net === -100,
    `net=${net}`,
  );

  // ── §7 — ÇİFT İPTAL ───────────────────────────────────────────────────────
  let ikinciIptalReddedildi = false;
  try {
    await returnService.cancelReturn(ret1Id, `${TAG} ikinci`, admin.id);
  } catch { ikinciIptalReddedildi = true; }
  const tersSayisi = (await satirlar(r1)).filter((x) => x.reversesMovementId === ileri?.id).length;
  check(
    "§7 ⭐ Çift iptal ikinci ters satır YAZMADI",
    ikinciIptalReddedildi && tersSayisi === 1,
    `reddedildi=${ikinciIptalReddedildi} ters=${tersSayisi}`,
  );

  // ── §6 — FİRE HEDEFLİ İADE: stok dışından stok dışına, satır YOK ──────────
  if (gFire?.isActive && gFire.returnTargetStatus === RollStatus.SCRAP) {
    const prev = await prisma.systemSetting.findUnique({
      where: { key: "return.gradingEnabled" }, select: { value: true },
    });
    await prisma.systemSetting.upsert({
      where: { key: "return.gradingEnabled" },
      update: { value: true },
      create: { key: "return.gradingEnabled", value: true, description: `${TAG} geçici` },
    });
    try {
      const r2 = await mkShipped("B");
      const ret2 = await returnService.createReturn(
        { rollId: r2, reasonText: `${TAG} fire`, qualityGradeId: gFire.id }, admin.id,
      );
      const ret2Id = (ret2.data as { ids?: string[]; id?: string }).ids?.[0]
        ?? (ret2.data as { id: string }).id;
      returnIds.push(ret2Id);
      const s2 = await satirlar(r2);
      check(
        "§6a ⭐ FİRE hedefli iade RETURN satırı YAZMADI (stok dışından stok dışına)",
        s2.filter((x) => x.eventType === WarehouseEventType.RETURN).length === 0,
        `RETURN satırı=${s2.filter((x) => x.eventType === WarehouseEventType.RETURN).length}`,
      );
      await returnService.cancelReturn(ret2Id, `${TAG} fire iptal`, admin.id);
      const s2Sonra = await satirlar(r2);
      check(
        "§6b ⭐ İleri satırı olmayan iadenin iptali de SATIRSIZ (simetri)",
        s2Sonra.filter((x) => x.reasonCode === STOCK_MOVE_REASON.RETURN_CANCEL).length === 0,
        `ters satır=${s2Sonra.filter((x) => x.reasonCode === STOCK_MOVE_REASON.RETURN_CANCEL).length}`,
      );
    } finally {
      if (prev) {
        await prisma.systemSetting.update({
          where: { key: "return.gradingEnabled" },
          data: { value: prev.value as Prisma.InputJsonValue },
        });
      } else {
        await prisma.systemSetting.delete({ where: { key: "return.gradingEnabled" } });
      }
    }
  } else {
    console.log("   ℹ️ §6 ATLANDI: FIRE kalitesi yok ya da iade rafı SCRAP değil (körlük zemini).");
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    if (rollIds.length) {
      // Ters satırlar ÖNCE: `reversesMovementId` FK'sı RESTRICT.
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds }, reversesMovementId: { not: null } } });
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    }
    if (returnIds.length) {
      await prisma.printedDocument.deleteMany({ where: { sourceId: { in: returnIds } } });
      await prisma.rollReturn.deleteMany({ where: { id: { in: returnIds } } });
    }
    if (rollIds.length) await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    if (shipmentId) {
      await prisma.shipmentEvent.deleteMany({ where: { shipmentId } });
      await prisma.shipment.deleteMany({ where: { id: shipmentId } });
    }
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    console.log("(test verisi temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main()
  .catch((e) => { console.error("💥 ÇÖKTÜ:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); await pool.end(); process.exit(fail > 0 ? 1 : 0); });
