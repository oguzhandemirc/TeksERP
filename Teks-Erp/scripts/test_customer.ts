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
import { AppError } from "../src/utils/app-error";
import type { Request } from "express";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";

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
  searchFields: ["name"],
  codeSearchFields: ["code", "taxNumber"],
  defaultInclude: undefined,
  uniqueField: "code",
  nestedCreateFields: ["branches"], // tek-adım müşteri+şube (route ile birebir)
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

    // =========================================================================
    // İç-içe (TEK-ADIM) şube oluşturma — POST /api/customers body'de branches[]
    // müşteri + sevk noktaları ATOMİK (Prisma nested-create) doğar.
    // =========================================================================

    // 7) create + branches[] → müşteri + 2 şube atomik, doğru müşteriye bağlı
    const withBranches = await service.create(
      {
        name: "TEST İnline Şubeli",
        branches: [
          { name: "  Merkez Depo  ", city: "İstanbul", contactPhone: "0212 555 0000", code: "MRK" },
          { name: "Ankara Şubesi", city: "Ankara" },
        ],
      },
      undefined,
    );
    const wbRec = withBranches.data as { id: string } | null;
    if (wbRec?.id) createdIds.push(wbRec.id);
    const createdBranches = await prisma.customerBranch.findMany({
      where: { customerId: wbRec!.id },
      orderBy: { name: "asc" },
    });
    check(
      "create + branches[] → müşteri oluştu ve 2 şube bağlandı",
      withBranches.success === true && !!wbRec?.id && createdBranches.length === 2,
      `şube=${createdBranches.length}`,
    );
    const merkez = createdBranches.find((b) => b.name === "Merkez Depo");
    check(
      "inline şube: ad trim'lendi, alanlar yazıldı, isActive default true",
      !!merkez &&
        merkez.city === "İstanbul" &&
        merkez.code === "MRK" &&
        merkez.contactPhone === "0212 555 0000" &&
        merkez.isActive === true &&
        merkez.customerId === wbRec!.id,
    );
    const ankara = createdBranches.find((b) => b.name === "Ankara Şubesi");
    check(
      "inline şube: gönderilmeyen opsiyonel alanlar null",
      !!ankara && ankara.address === null && ankara.contactName === null && ankara.code === null,
    );

    // 8) boş branches[] → müşteri oluşur, 0 şube (hata yok)
    const emptyBr = await service.create(
      { name: "TEST Boş Şube Dizisi", branches: [] },
      undefined,
    );
    const ebRec = emptyBr.data as { id: string } | null;
    if (ebRec?.id) createdIds.push(ebRec.id);
    const ebCount = await prisma.customerBranch.count({ where: { customerId: ebRec!.id } });
    check("boş branches[] → müşteri var, 0 şube", emptyBr.success === true && ebCount === 0);

    // 9) adı boş şube → 400 + o müşteri HİÇ oluşmadı (validasyon create ÖNCESİ = atomik)
    let badBranch: unknown;
    try {
      await service.create(
        { name: "TEST Bozuk Şube", branches: [{ name: "OK" }, { name: "   " }] },
        undefined,
      );
    } catch (e) {
      badBranch = e;
    }
    check(
      "adı boş şube → 400 (badRequest)",
      badBranch instanceof AppError && badBranch.statusCode === 400,
    );
    const leaked = await prisma.customer.findFirst({ where: { name: "TEST Bozuk Şube" } });
    check("geçersiz şube → müşteri sızmadı (atomik, create'e hiç girilmedi)", leaked === null);

    // 10) mass-assignment guard: şubeye enjekte edilen id/customerId/bilinmeyen alan
    //     yazılmaz — yalnız beyaz-listeli skalerler nested-create'e gider.
    const injected = await service.create(
      {
        name: "TEST Enjekte Şube",
        branches: [
          {
            name: "Enjekte",
            id: "11111111-1111-1111-1111-111111111111",
            customerId: "22222222-2222-2222-2222-222222222222",
            bogusField: "x",
          } as Record<string, unknown>,
        ],
      },
      undefined,
    );
    const injRec = injected.data as { id: string } | null;
    if (injRec?.id) createdIds.push(injRec.id);
    const injBranch = await prisma.customerBranch.findFirst({ where: { customerId: injRec!.id } });
    check(
      "mass-assignment: enjekte id/customerId yok sayıldı, şube doğru müşteriye bağlı",
      !!injBranch &&
        injBranch.id !== "11111111-1111-1111-1111-111111111111" &&
        injBranch.customerId === injRec!.id,
    );

    // 11) azami 50 şube sınırı aşımı → 400
    let tooMany: unknown;
    try {
      await service.create(
        { name: "TEST Çok Şube", branches: Array.from({ length: 51 }, (_, i) => ({ name: `Ş${i}` })) },
        undefined,
      );
    } catch (e) {
      tooMany = e;
    }
    check("51 şube → 400 (azami 50)", tooMany instanceof AppError && tooMany.statusCode === 400);

    // 12) 100 karakteri aşan şube adı → net alan-adlı 400 (Postgres P2000/DB-abort
    //     DEĞİL); sınır DB kolonu VARCHAR(100) ile birebir. Müşteri de sızmamalı.
    let longName: unknown;
    try {
      await service.create(
        { name: "TEST Uzun Şube Adı", branches: [{ name: "A".repeat(101) }] },
        undefined,
      );
    } catch (e) {
      longName = e;
    }
    check(
      "101 karakter şube adı → 400 (DB'ye ulaşmadan, alan-adlı mesaj)",
      longName instanceof AppError &&
        longName.statusCode === 400 &&
        longName.message.includes("100 karakter"),
    );
    const longLeak = await prisma.customer.findFirst({ where: { name: "TEST Uzun Şube Adı" } });
    check("uzun-ad reddi → müşteri sızmadı", longLeak === null);
  } finally {
    // Kendi yarattığını temizle (audit log SystemLog'da kalır — append-only). Z-A: kart hesabıyla doğar —
    // hesap karttan önce; hata YUTULMAZ (kalıntı = kırmızı, sonraki paketi vergi-no seddiyle düşürüyordu).
    await cleanupTestCustomers(createdIds);
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
