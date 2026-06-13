// =============================================================================
// Test: Saha #5 — çuval kodu AMB%05d otomatik üretimi
// Çalıştır: npx tsx scripts/test_sack_amb_code.ts
// Doğrulananlar:
//   1. manualCode verilmeden addSack → AMB%05d formatında otomatik kod
//   2. Ardışık çuvallar ardışık AMB numarası alır (global sıra)
//   3. Elle verilen kod aynen korunur (override)
//   4. seq sevkiyat-içi 1'den sayar (AMB global, seq yerel)
// =============================================================================
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

async function main() {
  const ts = Date.now();
  const svc = new ShippingService();

  const customer = await prisma.customer.create({
    data: { code: `TST-AMB-${ts}`, name: "Test Müşteri AMB" },
    select: { id: true },
  });
  const shipment = await prisma.shipment.create({
    data: {
      shipmentNo: `TEST-AMB-${ts}`,
      customerId: customer.id,
      status: "PREPARING",
    },
    select: { id: true },
  });

  try {
    const s1 = (await svc.addSack({ shipmentId: shipment.id })).data as {
      id: string;
      seq: number;
      manualCode: string | null;
    };
    check(
      "İlk çuval AMB%05d kodu aldı",
      /^AMB\d{5}$/.test(s1.manualCode ?? ""),
      s1.manualCode ?? "null",
    );

    const s2 = (await svc.addSack({ shipmentId: shipment.id })).data as {
      id: string;
      seq: number;
      manualCode: string | null;
    };
    const n1 = parseInt((s1.manualCode ?? "AMB00000").slice(3), 10);
    const n2 = parseInt((s2.manualCode ?? "AMB00000").slice(3), 10);
    check("İkinci çuval ardışık AMB numarası aldı", n2 === n1 + 1, `${s1.manualCode} → ${s2.manualCode}`);
    check("seq sevkiyat-içi sayıyor (1, 2)", s1.seq === 1 && s2.seq === 2);

    const s3 = (await svc.addSack({ shipmentId: shipment.id, manualCode: "OZEL-KOD-7" })).data as {
      manualCode: string | null;
    };
    check("Elle verilen kod korundu (override)", s3.manualCode === "OZEL-KOD-7");
  } finally {
    await prisma.sack.deleteMany({ where: { shipmentId: shipment.id } });
    await prisma.shipment.delete({ where: { id: shipment.id } }).catch(() => {});
    await prisma.customer.delete({ where: { id: customer.id } }).catch(() => {});
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
