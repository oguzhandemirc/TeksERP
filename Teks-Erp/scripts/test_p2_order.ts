// =============================================================================
// P2 order bucket testi — F148 (currency + deadline doğrulaması create/update
// simetrik; update tarafı ESKİDEN yoktu).  Koşum:
//   DATABASE_URL="...adnansahin_p2_test..." npx tsx scripts/test_p2_order.ts
// =============================================================================

import prisma from "../src/lib/prisma";
import { OrderService } from "../src/services/order.service";
import { AppError } from "../src/utils/app-error";
import { RollStatus } from "@prisma/client";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expect400(fn: () => Promise<unknown>): Promise<{ ok: boolean; msg: string }> {
  try { await fn(); return { ok: false, msg: "(hata atmadı)" }; }
  catch (e) {
    const ae = e instanceof AppError ? e : null;
    return { ok: ae?.statusCode === 400, msg: ae?.message ?? String(e) };
  }
}

const svc = new OrderService({
  modelName: "order",
  tableName: "ORDER",
  searchFields: [],
  codeSearchFields: ["orderNumber"],
  dateFields: ["createdAt", "deadline"],
  nestedCreateFields: ["lines"],
});

async function main(): Promise<void> {
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const customer = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item || !customer) throw new Error("item/customer fixture yok");
  const grade = await prisma.qualityGrade.findFirst({ select: { id: true, code: true } });
  const admin = await prisma.user.findFirst({ select: { id: true } });
  if (!grade || !admin) throw new Error("grade/user fixture yok");
  const createdOrderIds: string[] = [];
  const stamp = Date.now();
  let f143ItemId = "";
  let f143RollId = "";

  try {
    const validLine = { itemId: item.id, quantity: 100 };

    // --- F148 create: geçersiz currency → 400 ---
    const c1 = await expect400(() =>
      svc.create({ customerId: customer.id, currency: "XYZ", lines: [validLine] }));
    check("F148 create: geçersiz currency reddedildi", c1.ok && /para birimi/i.test(c1.msg), c1.msg);

    // --- F148 create: deadline < orderDate → 400 ---
    const c2 = await expect400(() =>
      svc.create({
        customerId: customer.id,
        orderDate: "2026-06-01T00:00:00.000Z",
        deadline: "2026-05-01T00:00:00.000Z",
        lines: [validLine],
      }));
    check("F148 create: deadline < orderDate reddedildi", c2.ok && /önce olamaz/i.test(c2.msg), c2.msg);

    // --- Geçerli order oluştur (update testleri için) ---
    const okCreate = await svc.create({
      customerId: customer.id,
      currency: "USD",
      orderDate: "2026-06-01T00:00:00.000Z",
      deadline: "2026-07-01T00:00:00.000Z",
      lines: [validLine],
    });
    const order = okCreate.data as { id: string };
    createdOrderIds.push(order.id);
    check("F148 create: geçerli currency/deadline ile oluştu", !!order.id);

    // --- F148 update: geçersiz currency → 400 (ESKİDEN doğrulanmıyordu) ---
    const u1 = await expect400(() => svc.update(order.id, { currency: "ABC" }));
    check("F148 update: geçersiz currency reddedildi", u1.ok && /para birimi/i.test(u1.msg), u1.msg);

    // --- F148 update: deadline mevcut orderDate'ten (2026-06-01) önce → 400 ---
    const u2 = await expect400(() => svc.update(order.id, { deadline: "2026-05-15T00:00:00.000Z" }));
    check("F148 update: deadline < mevcut orderDate reddedildi", u2.ok && /önce olamaz/i.test(u2.msg), u2.msg);

    // --- F148 update: geçerli deadline → başarılı ---
    let okUpdate = false;
    try { await svc.update(order.id, { deadline: "2026-08-01T00:00:00.000Z" }); okUpdate = true; }
    catch { okUpdate = false; }
    check("F148 update: geçerli deadline kabul edildi", okUpdate);

    // --- F143 (adversarial review fix): claim-first, create() DOĞRULAMASI fırlarsa
    //     toplar WAREHOUSE'da yetim KALMAMALI (validation claim'den ÖNCE koşar) ---
    const f143Item = await prisma.item.create({
      data: { code: `TEST-F143ITM-${stamp}`, name: `F143 Kumaş ${stamp}`, itemType: "FABRIC" },
      select: { id: true },
    });
    f143ItemId = f143Item.id;
    const f143Roll = await prisma.roll.create({
      data: {
        barcode: `TEST-F143RL-${stamp}`, itemId: f143Item.id, initialQty: 100, currentQty: 100,
        status: RollStatus.STOCK, qualityGrade: grade.code, qualityGradeId: grade.id,
        entrySource: "SUPPLIER_RECEIPT", createdById: admin.id,
      },
      select: { id: true },
    });
    f143RollId = f143Roll.id;
    // Ürünü PASİFLE → create() içindeki validateLineItems fırlatır (soft-delete guard).
    await prisma.item.update({ where: { id: f143Item.id }, data: { isActive: false, lifecycleStatus: "ARCHIVED" } });
    let f143Threw = false;
    try {
      await svc.quickOrderFromRolls({ customerId: customer.id, rollIds: [f143Roll.id] }, admin.id);
    } catch { f143Threw = true; }
    check("F143: create() doğrulaması fırlarsa quickOrder reddedilir", f143Threw);
    const rollAfter = await prisma.roll.findUniqueOrThrow({ where: { id: f143Roll.id }, select: { status: true } });
    check("F143: reddedilen top STOCK kaldı (WAREHOUSE'a yetim düşmedi)", rollAfter.status === RollStatus.STOCK, rollAfter.status);
  } finally {
    // Order + lines + audit cleanup (soft-delete kuralı test DB'de fiziksel temizlik serbest).
    for (const oid of createdOrderIds) {
      await prisma.orderLine.deleteMany({ where: { orderId: oid } }).catch(() => {});
      await prisma.order.deleteMany({ where: { id: oid } }).catch(() => {});
    }
    if (f143RollId) await prisma.roll.deleteMany({ where: { id: f143RollId } }).catch(() => {});
    if (f143ItemId) await prisma.item.deleteMany({ where: { id: f143ItemId } }).catch(() => {});
  }
}

main()
  .then(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("HATA:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
