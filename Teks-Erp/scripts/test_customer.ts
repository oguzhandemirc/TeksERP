// =============================================================================
// Test: CustomerService — BaseService CRUD (create/list/update/soft-delete/reactivate)
// Çalıştır: npx tsx scripts/test_customer.ts
// Doğrulananlar:
//   1. create: yeni kod → success + id döner, DB'de aktif kayıt oluşur
//   2. create: aynı koda sahip AKTİF kayıt → AppError.badRequest 400 "aktif kayıt zaten var"
//   3. findAll: search ile kendi TEST- müşterini bul (searchFields code/name/taxNumber)
//   4. update: ad değiştir → DB'ye yansır
//   5. softDelete: isActive=false (fiziksel DELETE değil)
//   6. create (pasif kodla tekrar): reactivate → AYNI id geri döner + isActive=true
// =============================================================================
import prisma from "../src/lib/prisma";
import { CustomerService } from "../src/services/customer.service";
import { AppError } from "../src/utils/app-error";
import type { Request } from "express";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

// findAll yalnız req.query okur (parseQueryParams/isCursorRequested) — minimal mock yeter.
function mockReq(query: Record<string, unknown>): Request {
  return { query } as unknown as Request;
}

// Route config'iyle birebir (customer.routes.ts).
const service = new CustomerService({
  modelName: "customer",
  tableName: "CUSTOMER",
  searchFields: ["code", "name", "taxNumber"],
  defaultInclude: undefined,
  uniqueField: "code",
});

async function main() {
  const ts = Date.now();
  const code = `TEST-CUST-${ts}`;
  let customerId = "";

  try {
    // 1) create — yeni kod
    const created = await service.create(
      { code, name: "TEST Müşteri A", taxNumber: "1234567890" },
      undefined,
    );
    const createdRec = created.data as { id: string; code: string; name: string; isActive: boolean } | null;
    check(
      "create yeni kod → success + id",
      created.success === true && !!createdRec?.id && createdRec.code === code,
      createdRec?.id,
    );
    customerId = createdRec!.id;

    // DB doğrulaması: aktif kayıt gerçekten yazıldı
    const dbAfterCreate = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { isActive: true, name: true },
    });
    check(
      "create DB'de aktif kayıt yarattı",
      dbAfterCreate?.isActive === true && dbAfterCreate?.name === "TEST Müşteri A",
    );

    // 2) aktif duplicate kod → AppError.badRequest 400
    try {
      await service.create({ code, name: "TEST Müşteri DUP" }, undefined);
      check("aktif duplicate kod → 400 hata", false, "hata bekleniyordu, başarılı döndü");
    } catch (e) {
      const isAppErr = e instanceof AppError;
      const msg = e instanceof Error ? e.message : String(e);
      check(
        "aktif duplicate kod → AppError 400 'aktif kayıt zaten var'",
        isAppErr && (e as AppError).statusCode === 400 && msg.includes("aktif kayıt zaten var"),
        msg,
      );
    }

    // 3) findAll — search ile kendi müşterini bul (searchFields code/name/taxNumber)
    const listed = await service.findAll(mockReq({ search: code }));
    const rows = (listed.data ?? []) as Array<{ id: string }>;
    check(
      "findAll search ile TEST müşteriyi buldu",
      Array.isArray(rows) && rows.some((r) => r.id === customerId),
      `bulunan=${rows.length}`,
    );

    // 4) update — ad değiştir
    const updated = await service.update(customerId, { name: "TEST Müşteri B" }, undefined);
    const updRec = updated.data as { name: string } | null;
    check("update ad değiştirdi", updated.success === true && updRec?.name === "TEST Müşteri B");
    const dbAfterUpdate = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { name: true },
    });
    check("update DB'ye yansıdı", dbAfterUpdate?.name === "TEST Müşteri B");

    // 5) softDelete — isActive=false (fiziksel DELETE değil)
    const deleted = await service.softDelete(customerId, undefined);
    check("softDelete success döner", deleted.success === true);
    const dbAfterDelete = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { isActive: true },
    });
    check(
      "softDelete: kayıt DURUYOR + isActive=false (hard delete değil)",
      dbAfterDelete !== null && dbAfterDelete.isActive === false,
    );

    // 6) pasif kodu tekrar create → reactivate (aynı id geri döner)
    const reactivated = await service.create(
      { code, name: "TEST Müşteri C" },
      undefined,
    );
    const reRec = reactivated.data as { id: string; isActive: boolean; name: string } | null;
    check(
      "pasif kodla create → reactivate (AYNI id)",
      reactivated.success === true && reRec?.id === customerId,
      `${reRec?.id} === ${customerId}`,
    );
    check(
      "reactivate sonrası isActive=true + yeni ad yazıldı",
      reRec?.isActive === true && reRec?.name === "TEST Müşteri C",
    );
    // İkinci bir kayıt YARATILMADIĞINI doğrula (tek satır, aynı id)
    const allWithCode = await prisma.customer.findMany({
      where: { code },
      select: { id: true },
    });
    check(
      "reactivate yeni satır AÇMADI (tek kayıt)",
      allWithCode.length === 1 && allWithCode[0].id === customerId,
      `satır=${allWithCode.length}`,
    );
  } finally {
    // Kendi yarattığını temizle (audit log SystemLog'da kalır — append-only).
    if (customerId) {
      await prisma.customer.delete({ where: { id: customerId } }).catch(() => {});
    }
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
