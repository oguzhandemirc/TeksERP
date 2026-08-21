// =============================================================================
// DÜZELTME — İş emri tipi bağı yansıtsın (STOK ama siparişe bağlı → SİPARİŞE ÖZEL)
// =============================================================================
// Çalıştır (ÖNİZLEME — hiçbir şey yazmaz):
//   npx tsx scripts/fix_workorder_type_from_links.ts
// Uygula:
//   npx tsx scripts/fix_workorder_type_from_links.ts --apply
//
// DRY-RUN VARSAYILAN (kök CLAUDE.md: toplu veri düzeltmesi yapan script dry-run
// başlar ve `--apply` öncesi etkilenecek HER kaydı somut listeler).
//
// -----------------------------------------------------------------------------
// NEDEN (2026-08-21 saha hatası)
// -----------------------------------------------------------------------------
// `POST /work-orders/:id/order-links` (workorder-link.service.linkOrderLines)
// pivot satırını yazıyor ama `WorkOrder.type`'a dokunmuyordu. Sahada iş emri
// önce stok için açılıp (tip STOCK_PRODUCTION) sonra "Sipariş Bağla" ile
// siparişe bağlanınca: detay paneli siparişi gösteriyor, iş emri LİSTESİ /
// künye / refakat kartı hâlâ "Stok" basıyordu. 2026-08-21 10:33 yedeğinde 13
// iş emri bu durumdaydı (hepsi IN_PROGRESS, hepsi "önce aç sonra bağla").
//
// Servis 2026-08-21'den itibaren bağ eklerken tipi aynı tx'te çevirir; bu
// script YALNIZ geçmişte oluşmuş tutarsız satırları onarır.
//
// -----------------------------------------------------------------------------
// KAPSAM / GÜVENLİK
// -----------------------------------------------------------------------------
//  • Yalnız `type = STOCK_PRODUCTION` VE en az bir `work_order_to_order_lines`
//    satırı olan iş emirleri. Tersi (ORDER_PRODUCTION ama bağsız) DOKUNULMAZ —
//    o durum ayrı bir karardır (sipariş iptalinde CONVERT_TO_STOCK zaten var).
//  • CANCELLED / SUPERSEDED iş emirleri DIŞARIDA — servis de (`assertPlanEditable`)
//    o planlara dokunmaz; tarihsel kayıt olduğu gibi kalır.
//  • İdempotent: ikinci koşumda etkilenen satır 0'dır.
//  • Her yazım audit'e düşer (`event: TYPE_DERIVED_FROM_LINKS`, kaynak bu dosya)
//    — "bu tip kim tarafından, neden değişti" sorusu sonradan cevaplanabilsin.
//  • `updatedAt` Prisma tarafından tazelenir (iş emri listesi createdAt ile
//    sıralanır, sıra oynamaz).
// =============================================================================

import prisma, { pool } from "../src/lib/prisma";
import { WorkOrderStatus, WorkOrderType } from "@prisma/client";
import { AuditService } from "../src/services/audit.service";
import { FACTORY_TIMEZONE } from "../src/constants/time";

const APPLY = process.argv.includes("--apply");

/** Listede fabrika saati (operatör UTC okumaz). */
const fmt = (d: Date | undefined | null): string =>
  d ? d.toLocaleString("tr-TR", { timeZone: FACTORY_TIMEZONE, dateStyle: "short", timeStyle: "short" }) : "—";

async function main(): Promise<void> {
  console.log(
    APPLY
      ? "⚠️  --apply: değişiklikler YAZILACAK"
      : "ÖNİZLEME (dry-run) — hiçbir şey yazılmaz; uygulamak için --apply",
  );

  const candidates = await prisma.workOrder.findMany({
    where: {
      type: WorkOrderType.STOCK_PRODUCTION,
      status: { notIn: [WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] },
      orderLinks: { some: {} },
    },
    select: {
      id: true,
      workOrderNumber: true,
      status: true,
      createdAt: true,
      orderLinks: {
        select: {
          createdAt: true,
          orderLine: { select: { order: { select: { orderNumber: true } } } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (candidates.length === 0) {
    console.log("✅ Tutarsız iş emri yok (STOK tipli ama siparişe bağlı satır bulunamadı).");
    return;
  }

  console.log(`\n${candidates.length} iş emri STOK tipli ama siparişe bağlı:\n`);
  console.log(
    ["İş Emri", "Durum", "Açılış", "İlk bağ", "Siparişler"].join("\t"),
  );
  for (const wo of candidates) {
    const orders = [
      ...new Set(wo.orderLinks.map((l) => l.orderLine.order.orderNumber)),
    ].join(",");
    console.log(
      [wo.workOrderNumber, wo.status, fmt(wo.createdAt), fmt(wo.orderLinks[0]?.createdAt), orders].join("\t"),
    );
  }

  if (!APPLY) {
    console.log(
      `\nÖNİZLEME bitti — ${candidates.length} iş emri ORDER_PRODUCTION'a çevrilecek. Yazmak için --apply.`,
    );
    return;
  }

  let updated = 0;
  for (const wo of candidates) {
    // Atomik: bu arada başka bir yol tipi çevirdiyse (servis artık çeviriyor)
    // ikinci kez yazmayız ve audit'e de düşmez.
    const res = await prisma.workOrder.updateMany({
      where: { id: wo.id, type: WorkOrderType.STOCK_PRODUCTION },
      data: { type: WorkOrderType.ORDER_PRODUCTION },
    });
    if (res.count === 0) continue;
    updated++;
    await AuditService.log({
      userId: undefined, // script koşumu — kullanıcı yok; kaynak newData.source'ta
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: wo.id,
      oldData: { type: WorkOrderType.STOCK_PRODUCTION },
      newData: {
        event: "TYPE_DERIVED_FROM_LINKS",
        type: WorkOrderType.ORDER_PRODUCTION,
        source: "scripts/fix_workorder_type_from_links.ts",
        linkedOrders: [...new Set(wo.orderLinks.map((l) => l.orderLine.order.orderNumber))],
      },
    });
    console.log(`  ✔ ${wo.workOrderNumber} → ORDER_PRODUCTION`);
  }
  console.log(`\n✅ ${updated}/${candidates.length} iş emri güncellendi.`);
}

main()
  .catch((err) => {
    console.error("❌ Hata:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
