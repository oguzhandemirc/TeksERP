// =============================================================================
// TeksERP - İş Verisi Temizleme Scripti
// =============================================================================
// Sistem verileri (kullanıcılar, roller, izinler, istasyonlar, makineler, rotalar)
// korunur. Sadece iş verileri (ürünler, müşteriler, siparişler, toplar vb.) silinir.
// Kullanım: npx ts-node prisma/clean-business-data.ts
// =============================================================================

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function cleanBusinessData() {
  console.log("🧹 İş verileri temizleniyor...\n");

  // Silme sırası önemli! (FK bağımlılıkları - alttan üste)
  const tables = [
    { name: "SystemLog",      label: "Sistem Logları",       fn: () => prisma.systemLog.deleteMany({}) },
    { name: "MachineLog",     label: "Makine Logları",       fn: () => prisma.machineLog.deleteMany({}) },
    { name: "CurrentAccount", label: "Cari Hesaplar",        fn: () => prisma.currentAccount.deleteMany({}) },
    { name: "ShipmentItem",   label: "Sevkiyat Kalemleri",   fn: () => prisma.shipmentItem.deleteMany({}) },
    { name: "Shipment",       label: "Sevkiyatlar",          fn: () => prisma.shipment.deleteMany({}) },
    { name: "OrderAllocation",label: "Tahsisler",            fn: () => prisma.orderAllocation.deleteMany({}) },
    { name: "RollError",      label: "Top Hataları",         fn: () => prisma.rollError.deleteMany({}) },
    { name: "Roll",           label: "Toplar",               fn: () => prisma.roll.deleteMany({}) },
    { name: "WorkOrderToOrderLine", label: "İş Emri-Sipariş Bağları", fn: () => prisma.workOrderToOrderLine.deleteMany({}) },
    { name: "WorkOrderStep",  label: "İş Emri Adımları",    fn: () => prisma.workOrderStep.deleteMany({}) },
    { name: "WorkOrder",      label: "İş Emirleri",          fn: () => prisma.workOrder.deleteMany({}) },
    { name: "OrderLine",      label: "Sipariş Kalemleri",    fn: () => prisma.orderLine.deleteMany({}) },
    { name: "Order",          label: "Siparişler",           fn: () => prisma.order.deleteMany({}) },
    { name: "Customer",       label: "Müşteriler/Fasonlar",  fn: () => prisma.customer.deleteMany({}) },
    { name: "Item",           label: "Ürünler (Stok Kartı)", fn: () => prisma.item.deleteMany({}) },
  ];

  for (const t of tables) {
    const result = await t.fn();
    console.log(`  🗑️  ${t.label.padEnd(25)} ${result.count} kayıt silindi`);
  }

  console.log("\n✅ İş verileri temizlendi!");
  console.log("ℹ️  Korunan veriler: Kullanıcılar, Roller, İzinler, İstasyonlar, Makineler, Rotalar");
}

cleanBusinessData()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (e) => {
    console.error("❌ Hata:", e);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
