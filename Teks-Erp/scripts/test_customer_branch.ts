// =============================================================================
// TEST: CustomerBranchService — create/update/deactivate/findByCustomer +
// M-26 açık-siparişli şube deactivate guard'ı. F262.
// Koşum: npx tsx scripts/test_customer_branch.ts
// =============================================================================
import prisma from "../src/lib/prisma";
import { CustomerBranchService } from "../src/services/customer-branch.service";
import { AppError } from "../src/utils/app-error";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
const svc = new CustomerBranchService();
const stamp = Date.now().toString(36);
const hasStatus = (e: unknown, s: number) => e instanceof AppError && e.statusCode === s;

async function main(): Promise<void> {
  const customer = await prisma.customer.create({ data: { code: `TEST-CB-${stamp}`, name: "CB Test Müşteri", type: "CUSTOMER" } });
  let branchId = "";
  try {
    // 1) create başarılı
    const r = await svc.create(customer.id, { name: "Merkez Depo", code: "MRK" }, undefined);
    branchId = (r.data as { id: string }).id;
    check("create → şube oluştu", !!branchId);

    // 2) olmayan müşteri → 404
    let nf: unknown; try { await svc.create("00000000-0000-0000-0000-000000000000", { name: "X" }, undefined); } catch (e) { nf = e; }
    check("olmayan müşteri → 404", hasStatus(nf, 404));

    // 3) default liste aktif şubeyi içerir
    const l1 = (await svc.findByCustomer(customer.id)).data as { id: string }[];
    check("aktif liste şubeyi içerir", l1.some((b) => b.id === branchId));

    // 4) deactivate → soft (isActive=false, fiziksel DELETE yok)
    await svc.deactivate(branchId, undefined);
    const row = await prisma.customerBranch.findUnique({ where: { id: branchId }, select: { isActive: true } });
    check("deactivate → isActive=false, kayıt duruyor", row?.isActive === false);

    // 5) pasif şube default listede yok, includeInactive ile var
    const l2 = (await svc.findByCustomer(customer.id)).data as { id: string }[];
    check("pasif şube default listede yok", !l2.some((b) => b.id === branchId));
    const l3 = (await svc.findByCustomer(customer.id, { includeInactive: true })).data as { id: string }[];
    check("includeInactive → pasif şube görünür", l3.some((b) => b.id === branchId));

    // 6) idempotent deactivate
    const again = await svc.deactivate(branchId, undefined);
    check("tekrar deactivate → 'zaten pasif'", (again.message ?? "").includes("zaten pasif"));

    // 7) M-26: açık siparişli şube deactivate → 409 + sipariş no listelenir
    const b2 = (await svc.create(customer.id, { name: "Şube 2" }, undefined)).data as { id: string };
    const ord = await prisma.order.create({ data: { orderNumber: `TEST-CBORD-${stamp}`, customerId: customer.id, branchId: b2.id, status: "APPROVED" } });
    let blocked: unknown; try { await svc.deactivate(b2.id, undefined); } catch (e) { blocked = e; }
    check("açık siparişli şube deactivate → 409", hasStatus(blocked, 409));
    check("409 mesajı sipariş no listeler", blocked instanceof AppError && blocked.message.includes(ord.orderNumber));
    await prisma.order.delete({ where: { id: ord.id } });
    await prisma.customerBranch.delete({ where: { id: b2.id } });
  } finally {
    await prisma.order.deleteMany({ where: { customerId: customer.id } });
    await prisma.customerBranch.deleteMany({ where: { customerId: customer.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
