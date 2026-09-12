// =============================================================================
// BEKÇİ — İPTAL STOKTAN ÇIKARIR, İPTALİ GERİ ALMA DEFTERE GERİ KOYAR
// Çalıştır: npx tsx scripts/run-all-tests.ts stock_ledger_cancel_restore
// =============================================================================
// NEDEN: ölçüldü (2026-09-12, fikstür DB'si, gerçek servis çağrıları):
//   softDelete → TEK satır: CANCEL, qty 75, from=depo, fromStatus=NULL,
//                toStatus=NULL, reasonCode=NULL   (eski kapı → STATÜSÜZ)
//   restoreCancelledRoll → YENİ SATIR YOK; top WAREHOUSE'a döner
// Yani defter "75 m çıktı" diyor, geri döndüğünü söyleyen satır YOK → stok
// EKSİK görünüyordu. Bu, aynı gün kapatılan reopen kusurunun AYNA görüntüsü
// (orada defter fazla/hayalet stok, burada eksik) ve tek sınıf: ileri yolu
// yazıp geri yolu yazmayan defter.
//
// İki kusur üst üste biniyordu ve düzeltmenin iki ayağı AYRILAMAZ: CANCEL satırı
// statüsüz olduğu için ters kayıt yazacak UÇ yoktu — önce iptal çıkışı
// `postStockMove`a taşındı (statülü satır), sonra geri alma tx'e alınıp BAĞLI
// ters kayıt yazdı. (Bu yol daha önce transaction bile açmıyordu.)
//
// ÖLÇÜLENLER
//   §1 İptal STATÜLÜ çıkış satırı yazar (fromStatus + sebep kodu dolu)
//   §2 ⭐ İptal sonrası net = −METRAJ (mal stoktan düştü)
//   §3 Geri alma BAĞLI ters satır yazar (yön aynalanmış, metraj ileri satırdan)
//   §4 ⭐ Geri alma sonrası net = 0 (mal rafa döndü)
//   §5 ⭐ Geri alma ileri satırı NE SİLER NE DEĞİŞTİRİR (iki satır yan yana)
//   §6 ⭐ 0 metrajlı top: satır YAZILMAZ ama iptal GERÇEKLEŞİR (fabrikada 52 top)
//   §7 ⭐ STOK DIŞI top (IN_PRODUCTION) iptalinde satır YAZILMAZ — o mal zaten
//      stokta değildi; eski kapı burada da koşulsuz yazıyordu
//   §8 Körlük zemini: fikstür gerçekten satır üretti
// =============================================================================
import { RollStatus, WarehouseEventType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const TAG = `TEST-SLCR-${Date.now()}`;
const rollIds: string[] = [];
let itemId = "";

async function satirlar(rollId: string) {
  return prisma.warehouseMovement.findMany({
    where: { rollId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, eventType: true, qty: true,
      fromWarehouseId: true, toWarehouseId: true, fromStatus: true, toStatus: true,
      reasonCode: true, reversesMovementId: true,
    },
  });
}

/** Defter etkisi: giriş ucu +, çıkış ucu −. */
function net(rows: Awaited<ReturnType<typeof satirlar>>): number {
  return rows.reduce((a, r) => {
    const q = Number(r.qty);
    return a + (r.toWarehouseId ? q : 0) - (r.fromWarehouseId ? q : 0);
  }, 0);
}

async function main(): Promise<void> {
  console.log("\n=== İptal / iptali geri alma: stok defteri ===\n");
  const svc = new InventoryService();
  const wh = await prisma.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } });
  if (!wh) throw new Error("Varsayılan depo yok (ensureDefaultWarehouse koşmamış)");
  itemId = (await prisma.item.create({ data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;

  const mk = async (suffix: string, qty: number, status: RollStatus): Promise<string> => {
    const r = await prisma.roll.create({
      data: {
        barcode: `${TAG}-${suffix}`, itemId, initialQty: qty === 0 ? 75 : qty, currentQty: qty,
        status, warehouseId: wh.id, entrySource: "SUPPLIER_RECEIPT",
      },
      select: { id: true },
    });
    rollIds.push(r.id);
    return r.id;
  };

  // ── §1 + §2 — iptal ───────────────────────────────────────────────────────
  const rA = await mk("A", 75, RollStatus.WAREHOUSE);
  await svc.softDelete(rA, undefined, { reason: `${TAG} bekçi iptali` });
  const iptalSonrasi = await satirlar(rA);
  const cikis = iptalSonrasi[0];
  check(
    "§1 İptal STATÜLÜ çıkış satırı yazdı (fromStatus + sebep kodu dolu)",
    iptalSonrasi.length === 1 && cikis?.fromWarehouseId === wh.id && cikis?.toWarehouseId === null &&
      cikis?.fromStatus === RollStatus.WAREHOUSE && cikis?.reasonCode === STOCK_MOVE_REASON.ROLL_CANCEL &&
      cikis?.eventType === WarehouseEventType.CANCEL,
    `satır=${iptalSonrasi.length} statü=${String(cikis?.fromStatus)} sebep=${String(cikis?.reasonCode)}`,
  );
  check("§2 ⭐ İptal sonrası net = −METRAJ", net(iptalSonrasi) === -75, `net=${net(iptalSonrasi)}`);

  // ── §3..§5 — iptali geri alma ─────────────────────────────────────────────
  await svc.restoreCancelledRoll(rA, undefined, { reason: `${TAG} geri alma` });
  const geriSonrasi = await satirlar(rA);
  const ters = geriSonrasi.find((r) => r.reversesMovementId !== null);
  check(
    "§3 Geri alma BAĞLI ters satır yazdı (yön aynalanmış, metraj ileri satırdan)",
    geriSonrasi.length === 2 && ters?.reversesMovementId === cikis?.id &&
      ters?.toWarehouseId === wh.id && ters?.fromWarehouseId === null &&
      ters?.toStatus === RollStatus.WAREHOUSE && Number(ters?.qty) === 75 &&
      ters?.reasonCode === STOCK_MOVE_REASON.CANCEL_RESTORE,
    `satır=${geriSonrasi.length} bağ=${ters?.reversesMovementId === cikis?.id} sebep=${String(ters?.reasonCode)}`,
  );
  check("§4 ⭐ Geri alma sonrası net = 0 (mal rafa döndü)", net(geriSonrasi) === 0, `net=${net(geriSonrasi)}`);
  const ileriHalaAyni = geriSonrasi.find((r) => r.id === cikis?.id);
  check(
    "§5 ⭐ İleri satır NE SİLİNDİ NE DEĞİŞTİ (iki satır yan yana duruyor)",
    !!ileriHalaAyni && ileriHalaAyni.reversesMovementId === null &&
      Number(ileriHalaAyni.qty) === 75 && ileriHalaAyni.fromStatus === RollStatus.WAREHOUSE,
    `ileri=${!!ileriHalaAyni}`,
  );
  const canli = await prisma.roll.findUnique({ where: { id: rA }, select: { status: true } });
  check("§5b Top WAREHOUSE'a döndü", canli?.status === RollStatus.WAREHOUSE, String(canli?.status));

  // ── §6 — 0 metrajlı top ───────────────────────────────────────────────────
  // `onZeroQty: "skip"` doktriniyle tutarlı: taşınacak mal yok, satır da yok.
  // İptal MÜMKÜN olmalı (fabrika kopyasında 0 metrajlı 52 iptal topu var).
  const rB = await mk("B", 0, RollStatus.WAREHOUSE);
  await svc.softDelete(rB, undefined, { reason: `${TAG} sıfır metraj` });
  const sifirIptal = await satirlar(rB);
  const rBcanli = await prisma.roll.findUnique({ where: { id: rB }, select: { status: true } });
  check(
    "§6 ⭐ 0 metrajlı top: satır YAZILMADI ama iptal GERÇEKLEŞTİ",
    sifirIptal.length === 0 && rBcanli?.status === RollStatus.CANCELLED,
    `satır=${sifirIptal.length} statü=${String(rBcanli?.status)}`,
  );

  // ── §7 — STOK DIŞI top ────────────────────────────────────────────────────
  // `IN_PRODUCTION` top iptal edilirken stoktan bir şey DÜŞMEZ: o mal zaten
  // üretimde, rafta değil. Eski kapı burada da koşulsuz satır yazıyordu.
  const rC = await mk("C", 60, RollStatus.IN_PRODUCTION);
  await svc.softDelete(rC, undefined, { reason: `${TAG} uretimde iptal` });
  const uretimIptal = await satirlar(rC);
  check(
    "§7 ⭐ STOK DIŞI (IN_PRODUCTION) top iptalinde satır YAZILMADI",
    uretimIptal.length === 0,
    `satır=${uretimIptal.length}`,
  );

  // ── §8 Körlük zemini ──────────────────────────────────────────────────────
  const toplam = await prisma.warehouseMovement.count({ where: { rollId: { in: rollIds } } });
  check("§8 Körlük zemini: fikstür iki satır üretti (1 ileri + 1 ters)", toplam === 2, `n=${toplam}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    if (rollIds.length) {
      // Ters satırlar ÖNCE: `reversesMovementId` FK'sı RESTRICT.
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds }, reversesMovementId: { not: null } } });
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.systemLog.deleteMany({ where: { recordId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    console.log("(test verisi temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main()
  .catch((e) => { console.error("💥 ÇÖKTÜ:", e instanceof Error ? e.message : e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); await pool.end(); process.exit(fail > 0 ? 1 : 0); });
