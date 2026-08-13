// =============================================================================
// BEKÇİ — ÇUVAL-BÜTÜN DEPO TRANSFERİ (2026-08-14)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_warehouse_sack_transfer.ts
//
// NEDEN: Çuval bir DEPO NESNESİDİR ve içindeki toplarla BİRLİKTE taşınır.
// İki sessiz bozulma modu var, ikisi de sayım gününe kadar görünmez:
//   (a) toplar taşınır çuval kaydı eski depoda "kalır" → "bu depoda hangi
//       çuvallar" sorusu yalan söyler;
//   (b) çuval taşınır ama bir üye top atlanır → topun kaydı A deposunda,
//       fiziksel kendisi B'de.
//
// ÖLÇÜLENLER:
//   §1 Çuval transferi: çuval + TÜM üyeler hedefte, sackId KORUNUR (toplar
//      çuvaldan çıkmaz), defter satırları sackId İZİ taşır
//   §2 Damgasız (NULL konum) eski çuval transferde SAHİPLENİLİR (lazy adoption)
//   §3 Guard'lar: boş çuval → red · sevkiyata atanmış → red · başka depoda → red
//      · çuvaldaki topu TEK taşıma → red (çuval bütünlüğü) · çuval + üyesini
//      birlikte seçme → yol gösteren mesaj
//   §4 Karışık transfer (serbest top + çuval) tek belgede
//   §5 İptal: çuval + üyeler kaynağa döner; üye çuvaldan ÇIKARILDIYSA iptal 409
//   §6 openSack doğumda depo damgalar (yeni çuval NULL doğmaz)
// =============================================================================
import { RollStatus, WarehouseEventType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { warehouseTransferService } from "../src/services/warehouse-transfer.service";
import { shippingService } from "../src/services/shipping.service";
import { InventoryService } from "../src/services/inventory.service";

const inventory = new InventoryService();

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

const TAG = `TEST-SKT-${Date.now()}`;
const rollIds: string[] = [];
const sackIds: string[] = [];
const warehouseIds: string[] = [];
const transferIds: string[] = [];

async function makeRoll(warehouseId: string, qty: number, itemId: string, sackId?: string): Promise<string> {
  const res = await inventory.createInitialEntry({ itemId, initialQty: qty }, undefined, undefined, false, {
    warehouseId,
    forcedStatus: RollStatus.WAREHOUSE,
  });
  const id = (res.data as { id: string }).id;
  rollIds.push(id);
  if (sackId) await prisma.roll.update({ where: { id }, data: { sackId } });
  return id;
}

/** Fixture çuvalı — konumu AÇIKÇA verilir (NULL = damgasız eski çuval senaryosu). */
async function makeSack(no: string, warehouseId: string | null): Promise<string> {
  const sack = await prisma.sack.create({ data: { sackNo: `${TAG}-${no}`, warehouseId }, select: { id: true } });
  sackIds.push(sack.id);
  return sack.id;
}

async function expectError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

async function main(): Promise<void> {
  console.log("=== Çuval-bütün transfer bekçisi ===\n");

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item) throw new Error("Test verisi yetersiz — aktif Item yok.");

  const a = await prisma.warehouse.create({ data: { code: `${TAG}-A`, name: `${TAG} A` }, select: { id: true } });
  const b = await prisma.warehouse.create({ data: { code: `${TAG}-B`, name: `${TAG} B` }, select: { id: true } });
  warehouseIds.push(a.id, b.id);

  // ── §1 ÇUVAL TRANSFERİ ──────────────────────────────────────────────────
  const sack1 = await makeSack("S1", a.id);
  const m1 = await makeRoll(a.id, 40, item.id, sack1);
  const m2 = await makeRoll(a.id, 60, item.id, sack1);

  const res1 = await warehouseTransferService.create({ fromWarehouseId: a.id, toWarehouseId: b.id, rollIds: [], sackIds: [sack1] });
  const t1 = res1.data as { id: string };
  transferIds.push(t1.id);

  const sackAfter = await prisma.sack.findUniqueOrThrow({ where: { id: sack1 }, select: { warehouseId: true } });
  check("§1a Çuvalın KENDİSİ hedef depoda", sackAfter.warehouseId === b.id);
  const members = await prisma.roll.findMany({ where: { id: { in: [m1, m2] } }, select: { warehouseId: true, sackId: true } });
  check("§1b ⭐ TÜM üyeler hedefte", members.every((r) => r.warehouseId === b.id));
  check("§1c ⭐ Üyeler ÇUVALDA KALDI (sackId korundu)", members.every((r) => r.sackId === sack1));
  const moves1 = await prisma.warehouseMovement.findMany({
    where: { transferId: t1.id, eventType: WarehouseEventType.TRANSFER },
    select: { sackId: true, qty: true },
  });
  check("§1d Defterde 2 satır, ikisi de sackId İZİ taşıyor", moves1.length === 2 && moves1.every((m) => m.sackId === sack1));
  check(
    "§1e Metraj üye bazında (40+60)",
    moves1.reduce((s2, m) => s2 + Number(m.qty), 0) === 100,
  );

  // ── §3 GUARD'LAR ────────────────────────────────────────────────────────
  // Boş çuval
  const emptySack = await makeSack("BOS", b.id);
  const e1 = await expectError(() =>
    warehouseTransferService.create({ fromWarehouseId: b.id, toWarehouseId: a.id, rollIds: [], sackIds: [emptySack] }),
  );
  check("§3a Boş çuval REDDEDİLİR (yol gösteren mesajla)", /boş çuval taşınmaz/i.test(e1), e1.slice(0, 80));

  // Sevkiyata atanmış çuval — sahte shipment bağı yerine gerçek kolon
  const customer = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true } });
  if (customer) {
    const shp = await prisma.shipment.create({
      data: { shipmentNo: `${TAG}-SVK`, customerId: customer.id },
      select: { id: true },
    });
    const shippedSack = await makeSack("SVK", b.id);
    await makeRoll(b.id, 10, item.id, shippedSack);
    await prisma.sack.update({ where: { id: shippedSack }, data: { shipmentId: shp.id } });
    const e2 = await expectError(() =>
      warehouseTransferService.create({ fromWarehouseId: b.id, toWarehouseId: a.id, rollIds: [], sackIds: [shippedSack] }),
    );
    check("§3b Sevkiyata atanmış çuval REDDEDİLİR", /sevkiyata atanmış/i.test(e2), e2.slice(0, 80));
    await prisma.sack.update({ where: { id: shippedSack }, data: { shipmentId: null } });
    await prisma.shipment.delete({ where: { id: shp.id } });
  } else {
    console.log("   ⏭️  §3b atlandı — müşteri yok");
  }

  // Başka depoda görünen çuval
  const e3 = await expectError(() =>
    warehouseTransferService.create({ fromWarehouseId: a.id, toWarehouseId: b.id, rollIds: [], sackIds: [sack1] }),
  );
  check("§3c Kaynakta OLMAYAN çuval reddedilir", /bu depoda görünmüyor/i.test(e3), e3.slice(0, 80));

  // Çuvaldaki topu TEK taşıma — çuval bütünlüğü
  const e4 = await expectError(() =>
    warehouseTransferService.create({ fromWarehouseId: b.id, toWarehouseId: a.id, rollIds: [m1], sackIds: [] }),
  );
  check("§3d ⭐ Çuvaldaki top TEK taşınamaz (bütünlük)", /çuvalı bütün taşıyın/i.test(e4), e4.slice(0, 80));

  // Çuval + üyesini birlikte seçmek: yol gösteren mesaj
  const e5 = await expectError(() =>
    warehouseTransferService.create({ fromWarehouseId: b.id, toWarehouseId: a.id, rollIds: [m1], sackIds: [sack1] }),
  );
  check("§3e Çuval + üyesi birlikte seçilirse mesaj YOL GÖSTERİR", /zaten taşınacak/i.test(e5), e5.slice(0, 80));

  // ── §2 LAZY ADOPTION + §4 KARIŞIK TRANSFER ──────────────────────────────
  // Damgasız (2026-08-14 öncesi) çuval: warehouseId NULL, üyeleri A'da.
  const legacySack = await makeSack("ESKI", null);
  const l1 = await makeRoll(a.id, 25, item.id, legacySack);
  const loose = await makeRoll(a.id, 15, item.id);

  const res2 = await warehouseTransferService.create({
    fromWarehouseId: a.id,
    toWarehouseId: b.id,
    rollIds: [loose],
    sackIds: [legacySack],
  });
  const t2 = res2.data as { id: string };
  transferIds.push(t2.id);
  const legacyAfter = await prisma.sack.findUniqueOrThrow({ where: { id: legacySack }, select: { warehouseId: true } });
  check("§2a ⭐ Damgasız çuval transferde SAHİPLENİLDİ (NULL → hedef)", legacyAfter.warehouseId === b.id);
  const mixMoves = await prisma.warehouseMovement.findMany({
    where: { transferId: t2.id, eventType: WarehouseEventType.TRANSFER },
    select: { rollId: true, sackId: true },
  });
  check(
    "§4a Karışık transfer TEK belgede: serbest satır sackId'siz, üye satırı sackId'li",
    mixMoves.length === 2 &&
      mixMoves.find((m) => m.rollId === loose)?.sackId === null &&
      mixMoves.find((m) => m.rollId === l1)?.sackId === legacySack,
  );

  // ── §5 İPTAL ────────────────────────────────────────────────────────────
  await warehouseTransferService.cancel(t2.id, "bekçi");
  const backSack = await prisma.sack.findUniqueOrThrow({ where: { id: legacySack }, select: { warehouseId: true } });
  const backRolls = await prisma.roll.findMany({ where: { id: { in: [l1, loose] } }, select: { warehouseId: true, sackId: true } });
  check("§5a İptalde çuval KAYNAĞA döndü", backSack.warehouseId === a.id);
  check("§5b Üye + serbest toplar kaynağa döndü, üyelik korundu",
    backRolls.every((r) => r.warehouseId === a.id) && backRolls.some((r) => r.sackId === legacySack));

  // Üye çuvaldan ÇIKARILDIYSA iptal 409 — "aynı halde mi" guard'ının çuval ayağı.
  const sack3 = await makeSack("S3", a.id);
  const c1 = await makeRoll(a.id, 30, item.id, sack3);
  const res3 = await warehouseTransferService.create({ fromWarehouseId: a.id, toWarehouseId: b.id, rollIds: [], sackIds: [sack3] });
  const t3 = res3.data as { id: string };
  transferIds.push(t3.id);
  await prisma.roll.update({ where: { id: c1 }, data: { sackId: null } }); // top çuvaldan çıkarıldı
  const e6 = await expectError(() => warehouseTransferService.cancel(t3.id, "bekçi"));
  check("§5c ⭐ Üye çuvaldan çıkarılmışsa iptal 409", /işlem görmüş/i.test(e6), e6.slice(0, 80));

  // ── §6 DOĞUMDA DAMGA ────────────────────────────────────────────────────
  const born = await shippingService.openSack({ clientToken: undefined }, undefined);
  const bornSack = (born.data ?? born) as { id?: string; sackNo?: string };
  if (bornSack.id) {
    sackIds.push(bornSack.id);
    const row = await prisma.sack.findUniqueOrThrow({ where: { id: bornSack.id }, select: { warehouseId: true } });
    check("§6a openSack doğumda depo damgalıyor (NULL doğmaz)", row.warehouseId !== null, `warehouseId=${row.warehouseId?.slice(0, 8)}`);
  } else {
    check("§6a openSack doğumda depo damgalıyor", false, "openSack yanıtı çözülemedi");
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    // Sıra: hareketler → transferler → belgeler → toplar → çuvallar → depolar.
    if (transferIds.length > 0) {
      await prisma.warehouseMovement.deleteMany({ where: { transferId: { in: transferIds } } });
      await prisma.printedDocument.deleteMany({ where: { sourceId: { in: transferIds } } });
      await prisma.warehouseTransfer.deleteMany({ where: { id: { in: transferIds } } });
    }
    if (rollIds.length > 0) {
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (sackIds.length > 0) await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
    if (warehouseIds.length > 0) await prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
