// =============================================================================
// Test: Çuval yorumu (Sack.notes) — iç serbest not
// Çalıştır: npx tsx scripts/test_sack_notes.ts
//
// Doğrulananlar:
//   1. Yorum yazılır ve aynen okunur
//   2. Boş string / yalnız whitespace → NULL (temizlenir)
//   3. null gönderilirse → NULL
//   4. Baş/son whitespace kırpılır
//   5. 600 karakter → 500'e kırpılır (DB VarChar(500) → P2000 YOK)
//   6. Olmayan çuval → 404 (hem yazma hem okuma)
//   7. ⭐ REGRESYON: içerik değişince (top okut/çıkar) yorum KORUNUR —
//      markSackContentChangedTx yalnız kg/tartı izini sıfırlar, yoruma dokunmaz
//   8. ⭐ T2: PLANNED sevkiyata atanmış çuvala yorum YAZILABİLİR (409 DEĞİL)
//   9. ⭐ T2: DISPATCHED (sevk edilmiş) çuvala da yorum YAZILABİLİR
//  10. Audit satırı düşer (SACK / UPDATE / kind=SACK_NOTES)
// =============================================================================

// ⭐ NEGATİF SONDA (2026-09-06, ölçüldü): `markSackContentChangedTx` gövdesi koşulsuz `return`e çevrildi (içerik
//    değişince kg sıfırlama + `labelDirty` damgası öldü) -> 1 kontrol KIRMIZI.
//    Geri alındığında yeşil.
import { RollStatus, RollEntrySource, ShipmentStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";
import { AppError } from "../src/utils/app-error";

const ship = new ShippingService();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
async function expectErr(label: string, fn: () => Promise<unknown>, status: number): Promise<void> {
  let code: number | null = null;
  try { await fn(); } catch (e) { code = e instanceof AppError ? e.statusCode : -1; }
  check(label, code === status, `beklenen ${status}, gelen ${code ?? "(hata YOK)"}`);
}

/** DB'deki gerçek değer — servis yanıtına değil kolona bakar. */
const notesOf = async (sackId: string): Promise<string | null> =>
  (await prisma.sack.findUnique({ where: { id: sackId }, select: { notes: true } }))!.notes;

async function main(): Promise<void> {
  const ts = Date.now();
  // Fixture: seed master-data'sı business-key ile çözülür (hardcoded UUID YASAK).
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true }, orderBy: { code: "asc" } });
  if (!item) throw new Error("Seed Item bulunamadı — önce `npm run seed`");

  const customer = await prisma.customer.create({
    data: { code: `TST-SNOTE-${ts}`, name: `YORUM TEST MÜŞTERİ ${ts}` },
    select: { id: true },
  });

  const rollIds: string[] = [];
  const sackIds: string[] = [];
  let shipmentId: string | null = null;

  const makeRoll = async (qty: number, width: number): Promise<string> => {
    const r = await prisma.roll.create({
      data: {
        barcode: `TST-SNOTE-${ts}-${Math.floor(Math.random() * 1e9)}`,
        itemId: item.id, colorId: null, width,
        initialQty: qty, currentQty: qty,
        status: RollStatus.WAREHOUSE, qualityGrade: "1.KALITE",
        entrySource: RollEntrySource.SUPPLIER_RECEIPT,
      },
      select: { id: true, barcode: true },
    });
    rollIds.push(r.id);
    return r.barcode!;
  };

  try {
    const opened = await ship.openSack({ customerId: customer.id });
    const sackId = (opened.data as { id: string }).id;
    sackIds.push(sackId);

    // 1) yaz + oku
    const w1 = await ship.setSackNotes(sackId, "Ölçü şüpheli, tekrar tartılacak", undefined);
    check("1a) setSackNotes yanıtı notu döner", (w1.data as { notes: string | null }).notes === "Ölçü şüpheli, tekrar tartılacak");
    const r1 = await ship.getSackNotes(sackId);
    check("1b) getSackNotes aynen okur", r1.data.notes === "Ölçü şüpheli, tekrar tartılacak");
    check("1c) DB kolonu doğru", (await notesOf(sackId)) === "Ölçü şüpheli, tekrar tartılacak");

    // 2) boş string + whitespace → NULL
    await ship.setSackNotes(sackId, "", undefined);
    check("2a) boş string → NULL", (await notesOf(sackId)) === null);
    await ship.setSackNotes(sackId, "Geri yaz", undefined);
    await ship.setSackNotes(sackId, "   \n\t  ", undefined);
    check("2b) yalnız whitespace → NULL", (await notesOf(sackId)) === null);

    // 3) null → NULL
    await ship.setSackNotes(sackId, "Yine yaz", undefined);
    await ship.setSackNotes(sackId, null, undefined);
    check("3) null → NULL", (await notesOf(sackId)) === null);

    // 4) trim
    await ship.setSackNotes(sackId, "  kenarları boşluklu  ", undefined);
    check("4) baş/son whitespace kırpılır", (await notesOf(sackId)) === "kenarları boşluklu");

    // 5) 600 karakter → 500'e kırpılır (P2000 atmadan)
    const long = "A".repeat(600);
    await ship.setSackNotes(sackId, long, undefined);
    const trimmed = await notesOf(sackId);
    check("5) 600 karakter → 500'e kırpıldı, P2000 yok", trimmed !== null && trimmed.length === 500, `uzunluk ${trimmed?.length}`);

    // 6) olmayan çuval → 404
    const ghost = "00000000-0000-4000-8000-000000000000";
    await expectErr("6a) olmayan çuvala yazma → 404", () => ship.setSackNotes(ghost, "x", undefined), 404);
    await expectErr("6b) olmayan çuvalı okuma → 404", () => ship.getSackNotes(ghost), 404);

    // 7) ⭐ REGRESYON: içerik değişince yorum korunur (markSackContentChangedTx yoruma dokunmaz)
    await ship.setSackNotes(sackId, "İçerik değişse de kalmalı", undefined);
    await ship.weighSack({ sackId, weightKg: 42.5 }, undefined);
    const bc = await makeRoll(100, 141);
    await ship.scanIntoSack({ sackId, barcode: bc }, undefined);
    const afterScan = await prisma.sack.findUnique({ where: { id: sackId }, select: { notes: true, weightKg: true, weighedAt: true } });
    check("7a) top okutunca kg SIFIRLANDI (mevcut davranış)", afterScan?.weightKg === null && afterScan?.weighedAt === null);
    check("7b) ⭐ top okutunca yorum KORUNDU", afterScan?.notes === "İçerik değişse de kalmalı");

    const rollId = (await prisma.roll.findUnique({ where: { barcode: bc }, select: { id: true } }))!.id;
    await ship.removeRollFromSack({ rollId }, undefined);
    check("7c) ⭐ top çıkarınca yorum KORUNDU", (await notesOf(sackId)) === "İçerik değişse de kalmalı");

    // 8) ⭐ T2: PLANNED sevkiyata atanmış çuvala yorum yazılabilir
    const bc2 = await makeRoll(80, 142);
    await ship.scanIntoSack({ sackId, barcode: bc2 }, undefined);
    const shipment = await prisma.shipment.create({
      data: { shipmentNo: `TST-SNOTE-S-${ts}`, customerId: customer.id, status: ShipmentStatus.PLANNED },
      select: { id: true },
    });
    shipmentId = shipment.id;
    await prisma.sack.update({ where: { id: sackId }, data: { shipmentId: shipment.id, seq: 1 } });

    // Kontrol grubu: ölçüm/içerik guard'ı BU durumda 409 atmalı (guard hâlâ çalışıyor).
    await expectErr("8a) kontrol: sevkiyattaki çuvalın TARTISI → 409 (guard duruyor)", () => ship.weighSack({ sackId, weightKg: 9 }, undefined), 409);
    const w8 = await ship.setSackNotes(sackId, "PLANNED sevkiyatta yazıldı", undefined);
    check("8b) ⭐ PLANNED sevkiyattaki çuvala yorum YAZILDI (409 değil)", (w8.data as { notes: string | null }).notes === "PLANNED sevkiyatta yazıldı");
    check("8c) DB'ye işlendi", (await notesOf(sackId)) === "PLANNED sevkiyatta yazıldı");

    // 9) ⭐ T2: DISPATCHED çuvala da yazılabilir
    await prisma.shipment.update({ where: { id: shipment.id }, data: { status: ShipmentStatus.DISPATCHED, dispatchedAt: new Date() } });
    await ship.setSackNotes(sackId, "Sevk sonrası müşteri şikayeti", undefined);
    check("9) ⭐ DISPATCHED çuvala yorum YAZILDI", (await notesOf(sackId)) === "Sevk sonrası müşteri şikayeti");

    // 10) audit izi
    const audit = await prisma.systemLog.findFirst({
      where: { tableName: "SACK", recordId: sackId, action: "UPDATE" },
      orderBy: { createdAt: "desc" },
      select: { newData: true },
    });
    const nd = audit?.newData as { kind?: string; notes?: string } | null;
    check("10) audit satırı düştü (kind=SACK_NOTES)", nd?.kind === "SACK_NOTES" && nd?.notes === "Sevk sonrası müşteri şikayeti", JSON.stringify(nd));
  } finally {
    // Cleanup — test kendi yarattığını siler. Sıra: sack↔shipment bağını çöz, sonra sil.
    if (sackIds.length) await prisma.sack.updateMany({ where: { id: { in: sackIds } }, data: { shipmentId: null, seq: null } });
    if (rollIds.length) await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null, shipmentId: null } });
    if (rollIds.length) await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    if (rollIds.length) await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    if (rollIds.length) await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    if (sackIds.length) await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
    if (shipmentId) await prisma.shipment.deleteMany({ where: { id: shipmentId } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
