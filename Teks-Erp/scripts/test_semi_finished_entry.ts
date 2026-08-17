// =============================================================================
// Test: Dışarıdan alınan YARI MAMÜL girişi (2026-08-17, madde 9)
// Çalıştır: npx tsx scripts/test_semi_finished_entry.ts
// =============================================================================
// Korunan invariant: yarı mamül RENKLİ gelir ama BİTMİŞ DEĞİLDİR.
//
// KK1 yolunda statü renkten çıkarılıyor:
//     colorId != null ? WAREHOUSE : STOCK
// Yarı mamül tanımı gereği renkli olduğu için bu sezgi onu doğrudan BİTMİŞ
// DEPO'ya düşürür — mal üretime hiç girmez, operatör onu ham stokta arar ve
// bulamaz. Bu yüzden çağrı statüyü AÇIKÇA zorlar (`forcedStatus: STOCK`) ve
// kaynağı ayrı işaretler (`entrySource: SEMI_FINISHED`).
//
// Bu bekçi ikisini de ölçer; biri düşerse sessiz bir stok kayması olur.
// =============================================================================
import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { RollEntrySource, RollStatus } from "@prisma/client";

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

async function main(): Promise<void> {
  const ts = Date.now();
  const svc = new InventoryService();
  const rollIds: string[] = [];
  let itemId = "";
  let colorId = "";

  try {
    const item = await prisma.item.create({
      data: { code: `TEST-SEMI-ITM-${ts}`, name: "TEST SEMI KUMAS", itemType: "FABRIC", unit: "MT" },
      select: { id: true },
    });
    itemId = item.id;
    const color = await prisma.color.create({
      data: { code: `TEST-SEMI-CLR-${ts}`, name: `TEST SEMI MAVI ${ts}` },
      select: { id: true },
    });
    colorId = color.id;

    // ── 1) Yarı mamül: RENKLİ ama HAM STOKTA ────────────────────────────────
    const semi = await svc.createInitialEntry(
      { itemId, colorId, initialQty: 1200 },
      undefined,
      null,
      false,
      {
        forcedEntrySource: RollEntrySource.SEMI_FINISHED,
        forcedStatus: RollStatus.STOCK,
      },
    );
    const semiRoll = semi.data as { id: string; status: string; entrySource: string; colorId: string | null };
    rollIds.push(semiRoll.id);
    check("yarı mamül topu oluştu", Boolean(semiRoll.id));
    check("rengi var (boyalı geldi)", semiRoll.colorId === colorId);
    check(
      "HAM STOK'a düştü (bitmiş depoya DEĞİL)",
      semiRoll.status === RollStatus.STOCK,
      `status=${semiRoll.status}`,
    );
    check(
      "giriş kaynağı SEMI_FINISHED",
      semiRoll.entrySource === RollEntrySource.SEMI_FINISHED,
      `entrySource=${semiRoll.entrySource}`,
    );

    // ── 2) KARŞILAŞTIRMA: aynı payload, bayraksız → BİTMİŞ DEPO ─────────────
    // Bu satır kararın gerekçesini KANITLAR: bayrak olmasaydı mal depoya
    // düşerdi. Fixture ayırt edici olmasaydı 1. kontrol vakumen yeşil kalırdı.
    const plain = await svc.createInitialEntry({ itemId, colorId, initialQty: 900 });
    const plainRoll = plain.data as { id: string; status: string; entrySource: string };
    rollIds.push(plainRoll.id);
    check(
      "bayraksız aynı giriş BİTMİŞ DEPO'ya düşüyor (sezgi hâlâ yürürlükte)",
      plainRoll.status === RollStatus.WAREHOUSE,
      `status=${plainRoll.status}`,
    );
    check(
      "bayraksız girişin kaynağı SEMI_FINISHED DEĞİL",
      plainRoll.entrySource !== RollEntrySource.SEMI_FINISHED,
      `entrySource=${plainRoll.entrySource}`,
    );

    // ── 3) Envanterde SÜZÜLEBİLİR (ayrı depo yerine ayrı işaret kararı) ─────
    const filtered = await prisma.roll.findMany({
      where: { entrySource: RollEntrySource.SEMI_FINISHED, id: { in: rollIds } },
      select: { id: true },
    });
    check("giriş türüne göre süzülüyor", filtered.length === 1 && filtered[0].id === semiRoll.id);

    // ── 4) Ham stok sayımına GİRİYOR (üretime aday) ─────────────────────────
    const inStock = await prisma.roll.count({
      where: { id: semiRoll.id, status: RollStatus.STOCK },
    });
    check("ham stok listesinde görünür (iş emrine bağlanabilir)", inStock === 1);
  } finally {
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    if (colorId) await prisma.color.deleteMany({ where: { id: colorId } });
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
