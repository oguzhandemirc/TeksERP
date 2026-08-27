// =============================================================================
// YARI MAMUL AYRIMI — kalan yüzeyler (2026-08-27)
// =============================================================================
// 2026-08-26'da envanter sekmesi ayrıldı; ayrımı takip ETMEYEN yüzeyler
// gerekçeleriyle listelendi. Kullanıcı hepsini kapsama aldı. Gerekçe ÖLÇÜMDÜ:
// prod'da bugün 0 yarı mamul kaydı var → akış başlamadan ÖNCE kapatılırsa
// sapmalar hiç görünmeden çözülür; sonradan yapılsaydı fabrika önce yanlış
// rakamı görür, düzeltince rakam kayardı.
//
// ⚠️ BU DOSYANIN ÖLÇTÜĞÜ ASIL ŞEY: ayrım GÖSTERİMDE, ARZDA DEĞİL.
// Yarı mamul rafta duran, üretime sokulabilir maldır — arzdan düşmek olmayan
// bir "kumaş tedarik et" açığı uydururdu. Sektör karşılığı: SAP'de HALB ayrı
// stok TÜRÜdür (ayrı raporlanır) ama MRP/ATP'de arza girer.
// §2 ve §4 tam olarak bunu kilitler; düşürülürse kırmızı verirler.
// =============================================================================

import { RollStatus, RollEntrySource } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { OrderService } from "../src/services/order.service";
import { InventoryService } from "../src/services/inventory.service";
import {
  ProductionBalanceService,
  type BalanceGroup,
} from "../src/services/production-balance.service";

const orderSvc = new OrderService({ modelName: "order", tableName: "ORDER" });
const balanceSvc = new ProductionBalanceService();
const invSvc = new InventoryService();

const rollIds: string[] = [];
const itemIds: string[] = [];
const colorIds: string[] = [];

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const ts = Date.now();
  try {
    const item = await prisma.item.create({
      data: { code: `TEST-SFS-ITM-${ts}`, name: `TEST SFS KUMAS ${ts}`, itemType: "FABRIC", unit: "MT" },
      select: { id: true },
    });
    itemIds.push(item.id);
    const color = await prisma.color.create({
      data: { code: `TEST-SFS-CLR-${ts}`, name: `TEST SFS MAVI ${ts}` },
      select: { id: true },
    });
    colorIds.push(color.id);

    const mkRoll = async (qty: number, semi: boolean, rollColorId: string | null) => {
      const r = await prisma.roll.create({
        data: {
          barcode: `TEST-SFS-${ts}-${rollIds.length}`,
          itemId: item.id,
          colorId: rollColorId,
          width: 150,
          initialQty: qty,
          currentQty: qty,
          status: RollStatus.STOCK,
          entrySource: semi ? RollEntrySource.SEMI_FINISHED : RollEntrySource.SUPPLIER_RECEIPT,
        },
        select: { id: true },
      });
      rollIds.push(r.id);
      return r.id;
    };

    // 200 m HAM (renksiz) + 300 m YARI MAMUL (renkli) — aynı kumaş.
    await mkRoll(200, false, null);
    await mkRoll(300, true, color.id);

    // ⚠️ Ürün Dengesi TALEPTEN doğar — sipariş kalemi olmayan bir spec listede
    // HİÇ görünmez (stok kendi başına satır üretmez). Bu yüzden fixture sırası
    // ters olamaz: önce talep, sonra ölçüm.
    //
    // Talep 400 m, HAM yalnız 200 m → §2'nin ayırt ediciliği buradan gelir:
    // yarı mamul arza girmezse açık 200 m çıkar (SAHTE), girerse 0 (DOĞRU).
    const customer = await prisma.customer.create({
      data: { code: `TSFS-${ts}`.slice(0, 32), name: `TEST SFS Müşteri ${ts}` },
      select: { id: true },
    });
    const order = await prisma.order.create({
      data: {
        orderNumber: `TSFS-ORD-${ts}`,
        customerId: customer.id,
        status: "APPROVED",
        lines: { create: [{ itemId: item.id, colorId: color.id, quantity: 400, width: 150 }] },
      },
      select: { id: true, lines: { select: { id: true } } },
    });

    const bal = await balanceSvc.getBalance({ itemId: item.id });
    const groups: BalanceGroup[] = bal.data ?? [];
    const grp = groups.find((g) => g.itemId === item.id && g.colorId === color.id);
    check("Ürün Dengesi grubu oluştu", Boolean(grp), `talep=${grp?.talep} grup=${groups.length}`);
    if (grp) {
      // ── §1 İki kova AYRI raporlanıyor ────────────────────────────────────
      check("HAM kovası yarı mamulü içermiyor", Number(grp.ham) === 200, `ham=${grp.ham}`);
      check("YARI MAMUL kovası ayrı", Number(grp.yariMamul) === 300, `yariMamul=${grp.yariMamul}`);
      // ── §2 ⚠️ ARZDAN DÜŞÜLMÜYOR — açık hesabı İKİSİNİ BİRDEN sayar ───────
      check(
        "AÇIK HESABI yarı mamulü ARZ sayar (sahte kumaş açığı üretmiyor)",
        Number(grp.malzemeAcigi) === 0,
        `uretilecek=${grp.uretilecek} ham=${grp.ham} yariMamul=${grp.yariMamul} acik=${grp.malzemeAcigi}`,
      );
    }

    // ── §3 Sipariş karşılama ipucu: iki kova ayrı ───────────────────────────
    const avail = await orderSvc.getSpecAvailability({
      itemId: item.id,
      colorId: color.id,
      width: 150,
    });
    check(
      "getSpecAvailability HAM kovası yarı mamulü içermiyor",
      avail.data?.freeStock === 200,
      `freeStock=${avail.data?.freeStock}`,
    );
    check(
      "getSpecAvailability YARI MAMUL kovası ayrı",
      avail.data?.freeSemiFinished === 300,
      `freeSemiFinished=${avail.data?.freeSemiFinished}`,
    );

    // ── §4 ⚠️ TOPLAM KORUNUYOR — ayırma metrajı YOK ETMEDİ ──────────────────
    // Ayrım sunumdur: iki kovanın toplamı, ayırmadan önceki tek rakama eşit
    // olmalı. Eşit değilse bir yerde metraj düşürülmüş demektir.
    check(
      "ham + yarı mamul = toplam serbest STOCK (hiçbir metraj kaybolmadı)",
      (avail.data?.freeStock ?? 0) + (avail.data?.freeSemiFinished ?? 0) === 500,
      `${avail.data?.freeStock} + ${avail.data?.freeSemiFinished}`,
    );

    // ── §5 Kalem bazlı karşılama da ayrı raporluyor ─────────────────────────
    const cov = await orderSvc.getCoverageForLines({ lineIds: [order.lines[0]!.id] });
    const row = (cov.data as { freeStock: unknown; freeSemiFinished: unknown }[] | undefined)?.[0];
    check(
      "getCoverageForLines iki kovayı ayrı döndürüyor",
      Number(row?.freeStock) === 200 && Number(row?.freeSemiFinished) === 300,
      `freeStock=${row?.freeStock} freeSemiFinished=${row?.freeSemiFinished}`,
    );

    await prisma.orderLine.deleteMany({ where: { orderId: order.id } });
    await prisma.order.deleteMany({ where: { id: order.id } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });

    // ── §6 İptal geri alma mesajı topun TÜRÜNÜ söylüyor ─────────────────────
    // Eski mesaj her STOCK topu için "ham stokta" diyordu — yarı mamul topu
    // Envanter'de "Yarı Mamul" sekmesinde durur, operatörü yanlış sekmede
    // arattırıyordu.
    const semiRollId = rollIds[1]!;
    await invSvc.softDelete(semiRollId, undefined, { reason: "TEST — sonda" });
    const restored = await invSvc.restoreCancelledRoll(semiRollId, undefined);
    check(
      "yarı mamul topunun geri alma mesajı 'ham stokta' DEMİYOR",
      !/ham stokta/i.test(restored.message ?? ""),
      restored.message,
    );
    check(
      "mesaj 'yarı mamul' diyor",
      /yarı mamul/i.test(restored.message ?? ""),
      restored.message,
    );
  } finally {
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    await prisma.color.deleteMany({ where: { id: { in: colorIds } } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
