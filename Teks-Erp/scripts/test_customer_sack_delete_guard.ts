// =============================================================================
// Test: Müşteri kalıcı silme guard'ı — bağlı çuval varsa bloklanmalı
// Çalıştır: npx tsx scripts/test_customer_sack_delete_guard.ts
// Gerekçe: 2026-07-15 sacks_customerId_fkey ON DELETE RESTRICT -> SET NULL'a
// düzeltildi (drift). Eskiden bu guard'ı P2003 (DB RESTRICT) örtük sağlıyordu;
// artık CustomerService.hardDelete'te EXPLICIT sack sayımı olmalı.
// =============================================================================
import prisma from "../src/lib/prisma";
import { CustomerService } from "../src/services/customer.service";
import { dailyCodePrefix, nextDailySeq } from "../src/utils/code-format";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const customerService = new CustomerService({
  modelName: "customer",
  tableName: "CUSTOMER",
  searchFields: ["name"],
  codeSearchFields: ["code"],
  uniqueField: "code",
});

async function main() {
  const ts = Date.now();
  const customer = await prisma.customer.create({
    data: { code: `TST-CSG-${ts}`, name: "TEST Çuval Guard Müşterisi" },
    select: { id: true },
  });

  const existingCodes = await prisma.sack.findMany({
    where: { sackNo: { startsWith: dailyCodePrefix("CV") } },
    select: { sackNo: true },
  });
  const seq = nextDailySeq(existingCodes.map((s) => s.sackNo), dailyCodePrefix("CV"));
  const sackNo = `${dailyCodePrefix("CV")}${String(seq).padStart(4, "0")}`;

  const sack = await prisma.sack.create({
    data: { sackNo, customerId: customer.id },
    select: { id: true },
  });

  try {
    // 1) Bağlı çuval varken hardDelete BLOKLANMALI (409, mesajda "çuval" geçmeli).
    let blocked = false;
    let message = "";
    try {
      await customerService.hardDelete(customer.id);
    } catch (e) {
      blocked = true;
      message = e instanceof Error ? e.message : String(e);
    }
    check("bağlı çuval varken hardDelete bloklandı", blocked, message);
    check("hata mesajı çuval sayısını içeriyor", message.includes("çuval"), message);

    // 2) Müşteri hâlâ DB'de (silinmedi).
    const stillThere = await prisma.customer.findUnique({ where: { id: customer.id }, select: { id: true } });
    check("müşteri hâlâ DB'de duruyor (silinmedi)", stillThere !== null);

    // 3) Çuvalın customerId'si hâlâ dolu (SET NULL'a düşmedi — çünkü delete hiç olmadı).
    const sackAfter = await prisma.sack.findUnique({ where: { id: sack.id }, select: { customerId: true } });
    check("çuvalın customerId'si korunuyor (silme engellendiği için)", sackAfter?.customerId === customer.id);

    // 4) Çuval kaldırılınca artık hardDelete BAŞARILI olmalı.
    await prisma.sack.delete({ where: { id: sack.id } });
    const result = await customerService.hardDelete(customer.id);
    check("çuval kaldırılınca hardDelete başarılı", result.success === true);
    const goneNow = await prisma.customer.findUnique({ where: { id: customer.id }, select: { id: true } });
    check("müşteri artık DB'de yok", goneNow === null);
  } finally {
    await prisma.sack.deleteMany({ where: { id: sack.id } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { id: customer.id } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
