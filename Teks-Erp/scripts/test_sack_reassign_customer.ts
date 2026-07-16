// =============================================================================
// Test: Depodaki çuvalın MÜŞTERİSİNİ değiştir (reassignSackCustomer)
// Çalıştır: npx tsx scripts/test_sack_reassign_customer.ts
// Doğrulananlar:
//   1. Müşterisiz açılan çuval → müşteri A atanır
//   2. Müşteri A + şubesi (A1) atanır
//   3. Yanlış şube (A1 müşteri B'ye ait değil) → 400
//   4. Müşteri B + şubesi (B1) atanır (eski A/A1 temizlenir)
//   5. Müşterisiz'e (null) çekilir → customerId & branchId null
//   6. Şube var ama müşteri yok → 400
//   7. GUARD: çuval bir sevkiyata atanmışsa (shipmentId!=null) → 409
// =============================================================================
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";
import { AppError } from "../src/utils/app-error";

const shipping = new ShippingService();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectErr(label: string, fn: () => Promise<unknown>, status: number): Promise<void> {
  let code: number | null = null;
  try { await fn(); } catch (e) { code = e instanceof AppError ? e.statusCode : -1; }
  check(label, code === status, `beklenen ${status}, gelen ${code ?? "(hata YOK)"}`);
}
const cid = (r: { data: unknown }) => (r.data as { customerId: string | null; branchId: string | null });

async function main(): Promise<void> {
  const ts = Date.now();
  const custA = await prisma.customer.create({ data: { code: `TST-RSA-A-${ts}`, name: "MÜŞTERİ A" }, select: { id: true } });
  const custB = await prisma.customer.create({ data: { code: `TST-RSA-B-${ts}`, name: "MÜŞTERİ B" }, select: { id: true } });
  const brA1 = await prisma.customerBranch.create({ data: { customerId: custA.id, code: "A1", name: "A Şube 1" }, select: { id: true } });
  const brB1 = await prisma.customerBranch.create({ data: { customerId: custB.id, code: "B1", name: "B Şube 1" }, select: { id: true } });

  // Müşterisiz depo çuvalı aç.
  const opened = await shipping.openSack({ customerId: null, branchId: null }, undefined);
  const sackId = (opened.data as { id: string }).id;

  let shipmentId: string | null = null;
  try {
    // 0) openSack yanıtı müşteri+şube ad/kodunu döner (Yeni Çuval dialog'u buna dayanır).
    const opened2 = await shipping.openSack({ customerId: custA.id, branchId: brA1.id }, undefined);
    const o2 = opened2.data as { id: string; customerName: string | null; branchName: string | null; branchCode: string | null };
    check("0) openSack: yanıt müşteri+şube ad/kod içerir", o2.customerName === "MÜŞTERİ A" && o2.branchName === "A Şube 1" && o2.branchCode === "A1", `${o2.customerName}/${o2.branchName}/${o2.branchCode}`);
    await prisma.sack.deleteMany({ where: { id: o2.id } });

    // 1) müşteri A ata
    let r = await shipping.reassignSackCustomer(sackId, { customerId: custA.id }, undefined);
    check("1) müşteri A atandı, şube yok", cid(r).customerId === custA.id && cid(r).branchId === null);

    // 2) müşteri A + şube A1
    r = await shipping.reassignSackCustomer(sackId, { customerId: custA.id, branchId: brA1.id }, undefined);
    check("2) müşteri A + şube A1", cid(r).customerId === custA.id && cid(r).branchId === brA1.id);

    // 3) yanlış şube (A1, müşteri B) → 400
    await expectErr("3) B + A1 (yanlış şube) → 400", () => shipping.reassignSackCustomer(sackId, { customerId: custB.id, branchId: brA1.id }, undefined), 400);
    // DB değişmedi mi? (hâlâ A/A1)
    const after3 = await prisma.sack.findUnique({ where: { id: sackId }, select: { customerId: true, branchId: true } });
    check("3b) reddedilen değişim DB'ye yazılmadı (hâlâ A/A1)", after3?.customerId === custA.id && after3?.branchId === brA1.id);

    // 4) müşteri B + şube B1 (eski A/A1 temizlenir)
    r = await shipping.reassignSackCustomer(sackId, { customerId: custB.id, branchId: brB1.id }, undefined);
    check("4) müşteri B + şube B1", cid(r).customerId === custB.id && cid(r).branchId === brB1.id);

    // 5) müşterisiz'e çek (null) → şube de temizlenir
    r = await shipping.reassignSackCustomer(sackId, { customerId: null, branchId: null }, undefined);
    check("5) müşterisiz (null) + şube null", cid(r).customerId === null && cid(r).branchId === null);

    // 6) şube var ama müşteri yok → 400
    await expectErr("6) şube var müşteri yok → 400", () => shipping.reassignSackCustomer(sackId, { customerId: null, branchId: brB1.id }, undefined), 400);

    // 7) GUARD: çuval bir sevkiyata atanmışsa → 409
    const shipment = await prisma.shipment.create({ data: { shipmentNo: `TST-RSA-S-${ts}`, customerId: custA.id, status: "PLANNED" }, select: { id: true } });
    shipmentId = shipment.id;
    await prisma.sack.update({ where: { id: sackId }, data: { shipmentId: shipment.id, customerId: custA.id } });
    await expectErr("7) sevkiyattaki çuval → 409", () => shipping.reassignSackCustomer(sackId, { customerId: custB.id }, undefined), 409);
    // Çuvalı geri depoya al (cleanup öncesi FK için).
    await prisma.sack.update({ where: { id: sackId }, data: { shipmentId: null } });
  } finally {
    await prisma.sack.deleteMany({ where: { id: sackId } });
    if (shipmentId) await prisma.shipment.deleteMany({ where: { id: shipmentId } });
    await prisma.customerBranch.deleteMany({ where: { id: { in: [brA1.id, brB1.id] } } });
    await prisma.customer.deleteMany({ where: { id: { in: [custA.id, custB.id] } } });
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
