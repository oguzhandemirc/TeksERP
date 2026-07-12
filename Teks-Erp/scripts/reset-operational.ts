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

import prisma from "../src/lib/prisma";

async function main() {
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
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
