// =============================================================================
// BEKÇİ — TOP DOĞUŞU YALNIZ STOK KÜMESİNE GİRERKEN SATIR YAZAR
// Çalıştır: npx tsx scripts/run-all-tests.ts stock_ledger_entry
// =============================================================================
// NEDEN: doğuş yolu (`createInitialEntry`) ENTRY satırını KOŞULSUZ yazıyordu ve
// satır statüsüzdü. İki ayrı kusur:
//
//   ① STATÜSÜZ satır: ölçüldü (fabrika kopyası) `warehouse_movements`ın 358
//      ENTRY satırının 358'i statüsüz — **65.832 m**, yani statüsüz kümenin
//      %49'u ve metrajın %83'ü tek yoldan geliyor. Statüsüz satırın ucu
//      kurulamaz, dolayısıyla TERSLENEMEZ ve depo×statü kırılımına girmez.
//   ② KOŞULSUZ yazım: `forcedStatus` ile üretime (`IN_PRODUCTION`) ya da fasona
//      (`AT_SUBCONTRACTOR`) doğan top RAFTA DEĞİLDİR; ona giriş satırı yazmak
//      depoya girmemiş malı depoda göstermek olur. Fabrika kopyasında bu
//      sınıftan **129 top** var (46 + 83). Bu, "koşulsuz yaz" kalıbının ÜÇÜNCÜ
//      kopyasıydı — ilk ikisi fason dönüşü (`cb1d0304`) ve iptal (`3c15208c`).
//
// Kırmızı taban ölçüldü (kod yazılmadan ÖNCE): **0 geçti / 3 başarısız**
//   §1 satır=1 toStatus=null sebep=null · §2 satır=1 eventType=ENTRY ·
//   §3 statü=STOCK satır=1 toStatus=null
//
// ÖLÇÜLENLER
//   §1 Stok kümesine doğan top STATÜLÜ giriş satırı yazar (toStatus + sebep)
//   §2 ⭐ STOK DIŞINA doğan top (forcedStatus) satır YAZMAZ
//   §3 Renksiz top STOCK doğar ve STATÜLÜ satır yazar (sezgisel yol da stokta)
//   §4 Körlük zemini: fikstür gerçekten iki satır üretti
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

const TAG = `TEST-SLE-${Date.now()}`;
const rollIds: string[] = [];
let itemId = "";
let colorId = "";

async function satirlar(rollId: string) {
  return prisma.warehouseMovement.findMany({
    where: { rollId },
    select: {
      eventType: true, qty: true, toWarehouseId: true, fromWarehouseId: true,
      toStatus: true, fromStatus: true, reasonCode: true,
    },
  });
}

async function main(): Promise<void> {
  console.log("\n=== Top doğuşu: stok defteri ===\n");
  const svc = new InventoryService();
  itemId = (await prisma.item.create({ data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;
  colorId = (await prisma.color.create({ data: { code: TAG, name: `${TAG} renk` }, select: { id: true } })).id;

  // ── §1 — renkli giriş → WAREHOUSE (stok kümesi içinde) ────────────────────
  const r1 = await svc.createInitialEntry({ itemId, initialQty: 120, colorId }, undefined, undefined, false, {});
  const id1 = (r1.data as { id: string }).id;
  rollIds.push(id1);
  const s1 = await satirlar(id1);
  check(
    "§1 Stok kümesine doğan topun satırı STATÜLÜ (toStatus + sebep kodu dolu)",
    s1.length === 1 && s1[0]?.eventType === WarehouseEventType.ENTRY &&
      s1[0]?.toStatus === RollStatus.WAREHOUSE && s1[0]?.fromWarehouseId === null &&
      s1[0]?.reasonCode === STOCK_MOVE_REASON.ENTRY_RECEIPT && Number(s1[0]?.qty) === 120,
    `satır=${s1.length} toStatus=${String(s1[0]?.toStatus)} sebep=${String(s1[0]?.reasonCode)}`,
  );

  // ── §2 — STOK DIŞINA doğan top ────────────────────────────────────────────
  // Fason dönüşü ara adımı ve üretime doğan top bu yolu kullanıyor.
  const r2 = await svc.createInitialEntry({ itemId, initialQty: 90 }, undefined, undefined, false, {
    forcedStatus: RollStatus.IN_PRODUCTION,
  });
  const id2 = (r2.data as { id: string }).id;
  rollIds.push(id2);
  const s2 = await satirlar(id2);
  check(
    "§2 ⭐ STOK DIŞINA doğan top satır YAZMAZ (depoya girmemiş mal depoda görünmez)",
    s2.length === 0,
    `satır=${s2.length} eventType=${String(s2[0]?.eventType)}`,
  );

  // ── §3 — renksiz giriş → STOCK ────────────────────────────────────────────
  const r3 = await svc.createInitialEntry({ itemId, initialQty: 60 }, undefined, undefined, false, {});
  const id3 = (r3.data as { id: string }).id;
  rollIds.push(id3);
  const s3 = await satirlar(id3);
  const canli3 = await prisma.roll.findUnique({ where: { id: id3 }, select: { status: true } });
  check(
    "§3 Renksiz top STOCK doğar ve STATÜLÜ satır yazar",
    canli3?.status === RollStatus.STOCK && s3.length === 1 && s3[0]?.toStatus === RollStatus.STOCK,
    `statü=${String(canli3?.status)} satır=${s3.length} toStatus=${String(s3[0]?.toStatus)}`,
  );

  // ── §4 Körlük zemini ──────────────────────────────────────────────────────
  const toplam = await prisma.warehouseMovement.count({ where: { rollId: { in: rollIds } } });
  check("§4 Körlük zemini: üç doğuştan İKİSİ satır üretti", toplam === 2, `n=${toplam}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    if (rollIds.length) {
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.systemLog.deleteMany({ where: { recordId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (colorId) await prisma.color.deleteMany({ where: { id: colorId } });
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    console.log("(test verisi temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main()
  .catch((e) => { console.error("💥 ÇÖKTÜ:", e instanceof Error ? e.message : e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); await pool.end(); process.exit(fail > 0 ? 1 : 0); });
