// =============================================================================
// BEKÇİ — DEPOLAR ARASI TRANSFER
// =============================================================================
// Çalıştırma: npx tsx scripts/test_warehouse_transfer.ts
//
// NEDEN: Transfer, malın nerede olduğunu değiştiren TEK "taşıma" işlemidir.
// Yanlış çalışırsa envanter sessizce yanlış depoyu gösterir — sayım gününe
// kadar kimse fark etmez.
//
// ÖLÇÜLENLER:
//   A) Happy path: toplar hedef depoya geçti · DT belgesi · defterde TRANSFER
//   B) ⭐ ATOMİKLİK: uygun olmayan TEK top TÜM transferi düşürür ve UYGUN
//      toplar da taşınmaz (yarım transfer fiziksel dünyada karşılıksızdır)
//   C) Guard'lar SOMUT top söyler (barkod mesajda) — "3 top uygun değil" yetmez
//   D) Aynı depo → 400 · çuvaldaki top → red · başka depodaki top → red
//   E) İptal: toplar KAYNAK depoya döndü + TRANSFER_REVERSAL satırı
//   F) ⭐ Defter APPEND-ONLY: iptal TRANSFER satırını SİLMEZ (gitti + geri geldi)
//   G) İdempotency: aynı clientToken ikinci transfer yaratmaz
// =============================================================================
import { RollStatus, WarehouseEventType, WarehouseTransferStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { warehouseTransferService } from "../src/services/warehouse-transfer.service";
import { InventoryService } from "../src/services/inventory.service";
import { printedDocumentService } from "../src/services/printed-document.service";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";

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

const TAG = `TEST-TR-${Date.now()}`;
const rollIds: string[] = [];
const warehouseIds: string[] = [];
const transferIds: string[] = [];

async function makeRoll(warehouseId: string, qty: number, itemId: string): Promise<string> {
  const res = await inventory.createInitialEntry({ itemId, initialQty: qty }, undefined, undefined, false, {
    warehouseId,
    forcedStatus: RollStatus.WAREHOUSE,
  });
  const id = (res.data as { id: string }).id;
  rollIds.push(id);
  return id;
}

async function main(): Promise<void> {
  console.log("=== Depolar arası transfer bekçisi ===\n");

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item) throw new Error("Test verisi yetersiz — aktif Item yok.");

  const a = await prisma.warehouse.create({ data: { code: `${TAG}-A`, name: `${TAG} A Deposu` }, select: { id: true } });
  const b = await prisma.warehouse.create({ data: { code: `${TAG}-B`, name: `${TAG} B Deposu` }, select: { id: true } });
  warehouseIds.push(a.id, b.id);

  // ── A) Happy path ───────────────────────────────────────────────────────
  const r1 = await makeRoll(a.id, 100, item.id);
  const r2 = await makeRoll(a.id, 50, item.id);
  const res = await warehouseTransferService.create({ fromWarehouseId: a.id, toWarehouseId: b.id, rollIds: [r1, r2] });
  const detail = res.data as { id: string; transferNo: string; totals: { rollCount: number; totalQty: number } };
  transferIds.push(detail.id);

  check("A1) DT ön ekli belge doğdu", detail.transferNo.startsWith("DT"), detail.transferNo);
  check("A2) İki kalem", detail.totals.rollCount === 2 && detail.totals.totalQty === 150, `top=${detail.totals.rollCount} metraj=${detail.totals.totalQty}`);
  const moved = await prisma.roll.findMany({ where: { id: { in: [r1, r2] } }, select: { warehouseId: true } });
  check("A3) ⭐ Toplar HEDEF depoda", moved.every((m) => m.warehouseId === b.id));
  const trMoves = await prisma.warehouseMovement.findMany({
    where: { transferId: detail.id, eventType: WarehouseEventType.TRANSFER },
    select: { id: true, fromWarehouseId: true, toWarehouseId: true, qty: true, fromStatus: true, toStatus: true, reasonCode: true },
  });
  check("A4) Defterde iki TRANSFER satırı, yönleriyle", trMoves.length === 2 && trMoves.every((m) => m.fromWarehouseId === a.id && m.toWarehouseId === b.id));
  // ⚠️ TRANSFER İKİ UÇLU TEK OLAYDIR: `from` ve `to` DOLU ve FARKLI, İKİ UÇ DA
  // stok kümesinde, ve STATÜ İKİ UÇTA AYNI — taşımak malı hareket ettirir, DURUMUNU
  // değiştirmez. Sevk/fason TEK uçludur (bir uç ∅); o kalıbı buraya kopyalamak
  // sessiz bir yanlış olurdu, bu yüzden kalem statüleri AÇIKÇA ölçüyor.
  check(
    "A4b) ⭐ Satır STATÜLÜ ve statü İKİ UÇTA AYNI (iki uçlu olay) · reasonCode TRANSFER",
    trMoves.length === 2 &&
      trMoves.every(
        (m) =>
          m.fromStatus !== null &&
          m.fromStatus === m.toStatus &&
          m.reasonCode === STOCK_MOVE_REASON.TRANSFER,
      ),
    JSON.stringify(trMoves.map((m) => `${String(m.fromStatus)}→${String(m.toStatus)}/${String(m.reasonCode)}`)),
  );

  // ── A5-A7) Resmi belge: transfer tx'inde DONDU ve BASILABİLİYOR ─────────
  const frozen = await prisma.printedDocument.findFirst({
    where: { docType: "TRANSFER_DISPATCH", sourceId: detail.id },
    select: { version: true, status: true, documentNo: true },
  });
  check("A5) Transfer irsaliyesi tx içinde dondu", frozen?.version === 1 && frozen?.status === "ACTIVE", `no=${frozen?.documentNo}`);
  const html = (await printedDocumentService.getHtml("TRANSFER_DISPATCH" as never, detail.id)).data?.html ?? "";
  check(
    "A6) Belge HTML'i basıldı ve iki depoyu da yazıyor",
    html.includes("TRANSFER") && html.includes("A Deposu") && html.includes("B Deposu"),
    `uzunluk=${html.length}`,
  );
  check("A7) Taşınan toplar belgede", html.includes("TAŞINAN TOPLAR"));

  // ── B + C) Atomiklik + somut mesaj ──────────────────────────────────────
  const okRoll = await makeRoll(a.id, 70, item.id);
  const wrongRoll = await makeRoll(b.id, 30, item.id); // B'de duruyor, A'dan taşınamaz
  let atomicMsg = "";
  try {
    await warehouseTransferService.create({ fromWarehouseId: a.id, toWarehouseId: b.id, rollIds: [okRoll, wrongRoll] });
  } catch (e) {
    atomicMsg = (e as Error).message;
  }
  check("B1) Uygun olmayan top TÜM transferi düşürdü", atomicMsg.length > 0, atomicMsg.slice(0, 70));
  const okRow = await prisma.roll.findUnique({ where: { id: okRoll }, select: { warehouseId: true } });
  check("B2) ⭐ UYGUN top da taşınmadı (yarım transfer yok)", okRow?.warehouseId === a.id);
  const wrongBarcode = (await prisma.roll.findUnique({ where: { id: wrongRoll }, select: { barcode: true } }))?.barcode;
  check("C) Mesaj SOMUT topu söylüyor (barkod)", Boolean(wrongBarcode) && atomicMsg.includes(wrongBarcode!), `barkod=${wrongBarcode}`);

  // ── D) Aynı depo + çuvaldaki top ────────────────────────────────────────
  let sameMsg = "";
  try {
    await warehouseTransferService.create({ fromWarehouseId: a.id, toWarehouseId: a.id, rollIds: [okRoll] });
  } catch (e) {
    sameMsg = (e as Error).message;
  }
  check("D1) Aynı depo reddedildi", sameMsg.includes("aynı olamaz"), sameMsg.slice(0, 50));

  const sack = await prisma.sack.create({ data: { sackNo: `${TAG}-CV`, seq: 1 }, select: { id: true } });
  await prisma.roll.update({ where: { id: okRoll }, data: { sackId: sack.id } });
  let sackMsg = "";
  try {
    await warehouseTransferService.create({ fromWarehouseId: a.id, toWarehouseId: b.id, rollIds: [okRoll] });
  } catch (e) {
    sackMsg = (e as Error).message;
  }
  check("D2) Çuvaldaki top transfer edilemedi", sackMsg.includes("çuvalda"), sackMsg.slice(0, 60));
  await prisma.roll.update({ where: { id: okRoll }, data: { sackId: null } });
  await prisma.sack.delete({ where: { id: sack.id } });

  // ── E + F) İptal ────────────────────────────────────────────────────────
  await warehouseTransferService.cancel(detail.id, "TEST — bekçi iptali");
  const backRows = await prisma.roll.findMany({ where: { id: { in: [r1, r2] } }, select: { warehouseId: true } });
  check("E1) ⭐ Toplar KAYNAK depoya döndü", backRows.every((m) => m.warehouseId === a.id));
  const status = await prisma.warehouseTransfer.findUnique({ where: { id: detail.id }, select: { status: true } });
  check("E2) Transfer CANCELLED", status?.status === WarehouseTransferStatus.CANCELLED);
  const tersler = await prisma.warehouseMovement.findMany({
    where: { transferId: detail.id, eventType: WarehouseEventType.TRANSFER_REVERSAL },
    select: { fromWarehouseId: true, toWarehouseId: true, fromStatus: true, toStatus: true, reversesMovementId: true, reasonCode: true },
  });
  check("E3) TRANSFER_REVERSAL satırları yazıldı", tersler.length === 2, `satır=${tersler.length}`);
  // ⚠️ İKİ UÇLU OLAYDA "TERS" DEMEK UÇLARIN AYNALANMASIDIR (from↔to yer değiştirir),
  // sevkteki "tek uç boşalır" kalıbı DEĞİL. Ve satır BAĞLI doğar: bağsız olsaydı
  // çift iptal DB unique'ine çarpmaz ve "bu satır ters kayıt mı" cevapsız kalırdı.
  const ileriIds = new Set(trMoves.map((m) => m.id));
  check(
    "E3b) ⭐ Ters satır BAĞLI (reversesMovementId → ileri satır) ve uçlar AYNALI",
    tersler.length === 2 &&
      tersler.every(
        (t) =>
          t.reversesMovementId !== null &&
          ileriIds.has(t.reversesMovementId) &&
          t.fromWarehouseId === b.id &&
          t.toWarehouseId === a.id &&
          t.fromStatus !== null &&
          t.fromStatus === t.toStatus &&
          t.reasonCode === STOCK_MOVE_REASON.TRANSFER_CANCEL,
      ),
    JSON.stringify(tersler.map((t) => `${t.reversesMovementId ? "bağlı" : "BAĞSIZ"} ${String(t.fromStatus)}→${String(t.toStatus)}`)),
  );
  const voided = await prisma.printedDocument.findFirst({
    where: { docType: "TRANSFER_DISPATCH", sourceId: detail.id },
    orderBy: { version: "desc" },
    select: { status: true },
  });
  check("E4) Belge VOIDED (silinmedi — kâğıt sahada dolaşmış olabilir)", voided?.status === "VOIDED", `durum=${voided?.status}`);
  const stillThere = await prisma.warehouseMovement.count({ where: { transferId: detail.id, eventType: WarehouseEventType.TRANSFER } });
  check("F) ⭐ Defter APPEND-ONLY: TRANSFER satırları SİLİNMEDİ", stillThere === 2, `satır=${stillThere}`);

  // ── G) İdempotency ──────────────────────────────────────────────────────
  const token = randomUUID();
  const g1 = await warehouseTransferService.create({ fromWarehouseId: a.id, toWarehouseId: b.id, rollIds: [okRoll], clientToken: token });
  const g1Id = (g1.data as { id: string }).id;
  transferIds.push(g1Id);
  const g2 = await warehouseTransferService.create({ fromWarehouseId: a.id, toWarehouseId: b.id, rollIds: [okRoll], clientToken: token });
  check("G) Aynı clientToken ikinci transfer YARATMADI", (g2.data as { id: string }).id === g1Id);

  check("Körlük zemini: en az 4 top ve 2 transfer üretildi", rollIds.length >= 4 && transferIds.length >= 2);
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    try {
      if (rollIds.length) {
        await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      }
      if (transferIds.length) await prisma.warehouseTransfer.deleteMany({ where: { id: { in: transferIds } } });
      if (warehouseIds.length) await prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
    } catch (e) {
      console.warn("Temizlik uyarısı:", (e as Error).message.slice(0, 200));
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
