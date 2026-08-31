// Operasyon verilerini sıfırla — master data (ürün, renk, müşteri, kullanıcı,
// istasyon, rota, fason firma, ayarlar) KORUNUR. Silinecekler:
//
//   Siparişler, iş emirleri, rulolar, adımlar, sevkiyatlar, çuvallar,
//   fason sevk/kabul, kartela sevk/kabul, kartelalar, refakat kartları,
//   manifesto, iade defterleri, sistem logları
//
// Çalıştır: npx ts-node scripts/reset-operational.ts
//
// !! GERİ ALINAMAZ — önce yedek al veya sadece test ortamında çalıştır.

import prisma, { pool } from "../src/lib/prisma";
import { assertGelistirmeVeritabani } from "./db-guard";

async function main() {
  // ⛔ İLK İFADE — sıra load-bearing (BULGU-T1-019). Kapı TRUNCATE'ten SONRA
  // çağrılsaydı hiçbir şey kazandırmazdı; eskiden tek koruma bir YORUM SATIRIYDI.
  const { apply } = assertGelistirmeVeritabani("reset-operational", { applyGerekli: true });

  // Ne kaybedileceğini ÖNCE göster. "N kayıt etkilenecek" gibi soyut sayı değil,
  // ekranların adıyla (kök CLAUDE.md: yıkıcı işlemde etkilenen kayıtları somut listele).
  const [top, ie, sip, sevk, kart, log] = await Promise.all([
    prisma.roll.count(),
    prisma.workOrder.count(),
    prisma.order.count(),
    prisma.shipment.count(),
    prisma.travelerCard.count(),
    prisma.systemLog.count(),
  ]);
  console.log("\nSilinecek:");
  console.log(`   ${top} top · ${ie} iş emri · ${sip} sipariş · ${sevk} sevkiyat`);
  console.log(`   ${kart} refakat kartı · ${log} sistem logu (arşiv dahil)`);
  console.log("   Ana veri (ürün/renk/müşteri/kullanıcı/istasyon/rota/ayar) KORUNUR.\n");

  if (!apply) return;

  console.log("⚠️  Operasyon verileri siliniyor… (master data korunur)\n");

  // Tek SQL ile: CASCADE → PostgreSQL tüm FK bağımlılık sırasını otomatik çözer.
  // Master veri tabloları (items, colors, customers vb.) bu tablolara FK bağı
  // BULUNDURMAZ (sadece referans alır); dolayısıyla CASCADE oraya ulaşmaz.
  await prisma.$executeRaw`
    TRUNCATE
      system_logs,
      system_log_archives,
      roll_properties,
      roll_errors,
      traveler_card_scans,
      roll_movements,
      roll_operations,
      work_order_target_properties,
      work_order_to_order_lines,
      order_line_required_properties,
      subcontractor_receipt_properties,
      subcontractor_receipt_items,
      subcontractor_dispatch_items,
      kartela_receipt_items,
      kartela_dispatch_items,
      sack_allocations,
      shipment_orders,
      roll_returns,
      traveler_cards,
      swatches,
      kartela_receipts,
      kartela_dispatches,
      subcontractor_receipts,
      subcontractor_dispatches,
      printed_documents,
      manifests,
      sacks,
      shipments,
      work_order_steps,
      rolls,
      batches,
      order_lines,
      work_orders,
      orders
    CASCADE
  `;

  console.log("✅ Tüm operasyon verileri silindi.");
  console.log("\nKorunan master data:");
  console.log(
    "  users, permissions, stations, machines, devices, routes, items, colors,"
  );
  console.log(
    "  fabric_properties, customers, customer_branches, subcontractors,"
  );
  console.log(
    "  quality_grades, return_reasons, defect_types, label_templates,"
  );
  console.log("  system_settings, customer_item_aliases, customer_color_aliases\n");
}

main()
  .catch((e) => {
    console.error("❌ Hata:", e.message);
    process.exitCode = 1;
  })
  // ⚠️ `$disconnect()` TEK BAŞINA YETMEZ: havuz `idleTimeoutMillis: 600_000` ile
  // kuruluyor → idle handle event loop'u 10 dk açık tutar ve betik "bitti ama
  // çıkmadı" durumunda kalır (kök CLAUDE.md'nin kayıtlı tuzağı; kuru koşum
  // eklenince birebir yaşandı). `pool.end()` şart.
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
