// =============================================================================
// TEST: SubcontractorManagementService — create/reactivate-replace + update
// (categoryIds M:N replace + soft-remove + duplicate guard). F261.
// Koşum: npx tsx scripts/test_subcontractor_management.ts
// =============================================================================
import prisma from "../src/lib/prisma";
import { SubcontractorManagementService } from "../src/services/subcontractor-management.service";
import { AppError } from "../src/utils/app-error";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
const svc = new SubcontractorManagementService();
const stamp = Date.now().toString(36);
const CODE = `TEST-SUBMGMT-${stamp}`;
const is400 = (e: unknown) => e instanceof AppError && e.statusCode === 400;
async function catSet(id: string): Promise<Set<string>> {
  const rows = await prisma.subcontractorToCategory.findMany({ where: { subcontractorId: id }, select: { categoryId: true } });
  return new Set(rows.map((r) => r.categoryId));
}
const eqSet = (a: Set<string>, ids: string[]) => a.size === ids.length && ids.every((x) => a.has(x));

async function main(): Promise<void> {
  const c1 = await prisma.subcontractorCategory.create({ data: { code: `TEST-CAT1-${stamp}`, name: "T Boyahane" } });
  const c2 = await prisma.subcontractorCategory.create({ data: { code: `TEST-CAT2-${stamp}`, name: "T Zımpara" } });
  const c3 = await prisma.subcontractorCategory.create({ data: { code: `TEST-CAT3-${stamp}`, name: "T Yıkama" } });
  let subId = "";
  try {
    // 1) create + tam küme bağla
    const r1 = await svc.create({ code: CODE, name: "Test Fason", categoryIds: [c1.id, c2.id] }, undefined);
    subId = (r1.data as { id: string }).id;
    check("create → {c1,c2} tam bağ", eqSet(await catSet(subId), [c1.id, c2.id]));

    // 2) aktif duplicate code → 400
    let dup: unknown; try { await svc.create({ code: CODE, name: "X", categoryIds: [] }, undefined); } catch (e) { dup = e; }
    check("aktif duplicate code → 400", is400(dup));

    // 3) soft-remove (isActive=false, fiziksel DELETE yok)
    await svc.remove(subId, undefined);
    const gone = await prisma.subcontractor.findUnique({ where: { id: subId }, select: { isActive: true } });
    check("soft-remove → isActive=false, kayıt duruyor", gone?.isActive === false);

    // 4) reactivate → REPLACE (c1 düşer, c3 gelir, aynı id)
    const r2 = await svc.create({ code: CODE, name: "Test Fason 2", categoryIds: [c2.id, c3.id] }, undefined);
    check("reactivate aynı id", (r2.data as { id: string }).id === subId);
    check("reactivate → isActive=true", (r2.data as { isActive: boolean }).isActive === true);
    check("reactivate → REPLACE {c2,c3} (fazla/eksik yok)", eqSet(await catSet(subId), [c2.id, c3.id]));

    // 5) reactivate boş liste → tüm bağ silinir (SESSİZ DÜŞME kilidi)
    await svc.remove(subId, undefined);
    await svc.create({ code: CODE, name: "Test Fason 3", categoryIds: [] }, undefined);
    check("reactivate boş liste → bağ SIFIR", (await catSet(subId)).size === 0);

    // 6) update: replace / undefined no-op / [] wipe
    await svc.update(subId, { categoryIds: [c1.id] }, undefined);
    check("update([c1]) → {c1}", eqSet(await catSet(subId), [c1.id]));
    await svc.update(subId, { name: "yeni ad" }, undefined);
    check("update(categoryIds undefined) → bağ değişmez", eqSet(await catSet(subId), [c1.id]));
    await svc.update(subId, { categoryIds: [] }, undefined);
    check("update([]) → bağ SIFIR", (await catSet(subId)).size === 0);
  } finally {
    if (subId) {
      await prisma.subcontractorToCategory.deleteMany({ where: { subcontractorId: subId } });
      await prisma.subcontractor.deleteMany({ where: { id: subId } });
    }
    await prisma.subcontractorCategory.deleteMany({ where: { id: { in: [c1.id, c2.id, c3.id] } } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
