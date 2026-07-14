// =============================================================================
// Test: CustomerService — BaseService CRUD (create/list/update/soft-delete)
// Çalıştır: npx tsx scripts/test_customer.ts
// Doğrulananlar (kod-format redesign SONRASI davranış):
//   1. create: müşteri kodu BACKEND-AUTHORITATIVE üretilir (MUS+GGAAYY+NNNN);
//      istemcinin gönderdiği `code` YOK SAYILIR (customer.service.ts nextCustomerCode).
//   2. create x2 aynı istemci kodu ile → farklı iki müşteri (farklı id + farklı
//      server-kodu). Kod istemciden gelmediği için "aktif duplicate kod" ARTIK
//      MÜMKÜN DEĞİL — reddetme yok, her create benzersiz kod alır.
//   3. findAll: search ile SERVER-üretilen kodu bul (searchFields code/name/taxNumber).
//   4. update: ad değiştir → DB'ye yansır.
//   5. softDelete: isActive=false (fiziksel DELETE değil).
//   6. softDelete sonrası aynı istemci kodu ile create → REACTIVATE DEĞİL: yeni
//      server-kodu üretildiğinden yeni satır açılır (eski pasif kayıt dokunulmaz).
// =============================================================================
import prisma from "../src/lib/prisma";
import { CustomerService } from "../src/services/customer.service";
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

// Server-üretilen kod kalıbı: MUS + GGAAYY(6) + NNNN(4).
const SERVER_CODE_RE = /^MUS\d{10}$/;

async function main() {
  const ts = Date.now();
  // İstemci kodu GÖNDERİLİR ama backend yok sayar — test bunu doğrular.
  const clientCode = `TEST-CUST-${ts}`;
  const createdIds: string[] = [];

  try {
    // 1) create — kod backend-authoritative üretilir, istemci `code` yok sayılır
    const created = await service.create(
      { code: clientCode, name: "TEST Müşteri A", taxNumber: "1234567890" },
      undefined,
    );
    const createdRec = created.data as { id: string; code: string; name: string; isActive: boolean } | null;
    check(
      "create → success + id + server-kod (MUS…), istemci kodu yok sayıldı",
      created.success === true &&
        !!createdRec?.id &&
        SERVER_CODE_RE.test(createdRec?.code ?? "") &&
        createdRec?.code !== clientCode,
      createdRec?.code,
    );
    const customerId = createdRec!.id;
    const serverCode = createdRec!.code;
    createdIds.push(customerId);

    // DB doğrulaması: aktif kayıt gerçekten yazıldı
    const dbAfterCreate = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { isActive: true, name: true },
    });
    check(
      "create DB'de aktif kayıt yarattı",
      dbAfterCreate?.isActive === true && dbAfterCreate?.name === "TEST Müşteri A",
    );

    // 2) aynı istemci kodu ile ikinci create → duplicate REDDETME YOK; kod
    //    istemciden gelmediği için yeni müşteri farklı server-kodu alır.
    const dup = await service.create(
      { code: clientCode, name: "TEST Müşteri DUP" },
      undefined,
    );
    const dupRec = dup.data as { id: string; code: string } | null;
    if (dupRec?.id) createdIds.push(dupRec.id);
    check(
      "aynı istemci kodu → farklı müşteri (server-kod benzersiz, duplicate yok)",
      dup.success === true &&
        !!dupRec?.id &&
        dupRec.id !== customerId &&
        dupRec.code !== serverCode &&
        SERVER_CODE_RE.test(dupRec?.code ?? ""),
      `${dupRec?.code} ≠ ${serverCode}`,
    );

    // 3) findAll — search ile kendi müşterini SERVER-kodu üzerinden bul
    const listed = await service.findAll(mockReq({ search: serverCode }));
    const rows = (listed.data ?? []) as Array<{ id: string }>;
    check(
      "findAll search (server-kod) ile TEST müşteriyi buldu",
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

    // 6) pasif kayıttan sonra aynı istemci kodu ile create → REACTIVATE DEĞİL.
    //    Backend yeni server-kodu ürettiği için reactivate-by-code tetiklenmez;
    //    yeni satır açılır, eski pasif kayıt dokunulmaz.
    const recreated = await service.create(
      { code: clientCode, name: "TEST Müşteri C" },
      undefined,
    );
    const reRec = recreated.data as { id: string; isActive: boolean; name: string } | null;
    if (reRec?.id) createdIds.push(reRec.id);
    check(
      "aynı istemci kodu ile tekrar create → YENİ satır (reactivate değil)",
      recreated.success === true &&
        !!reRec?.id &&
        reRec.id !== customerId &&
        reRec.isActive === true &&
        reRec.name === "TEST Müşteri C",
      `${reRec?.id} ≠ ${customerId}`,
    );
    // Eski pasif kayıt dokunulmadı: hâlâ tek başına ve pasif
    const oldStill = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { isActive: true, name: true },
    });
    check(
      "eski pasif kayıt dokunulmadı (isActive=false, adı korundu)",
      oldStill?.isActive === false && oldStill?.name === "TEST Müşteri B",
    );
  } finally {
    // Kendi yarattığını temizle (audit log SystemLog'da kalır — append-only).
    for (const id of createdIds) {
      await prisma.customer.delete({ where: { id } }).catch(() => {});
    }
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
