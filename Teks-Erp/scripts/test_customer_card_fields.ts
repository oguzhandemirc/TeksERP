// =============================================================================
// Test: CustomerService — müşteri kartı alanları ("her şube = ayrı müşteri", 2026-07)
// Çalıştır: npx tsx scripts/test_customer_card_fields.ts
// Doğrulananlar:
//   1. create: kart alanları (exportCode/address/city/district/country/
//      contactName/contactPhone/email/notes) trim'lenip yazılır.
//   2. create: boş/whitespace string → null; hiç gönderilmeyen alan → null.
//   3. update: alan set etme + null ile temizleme.
//   4. Geçersiz e-posta → 400 (Türkçe mesaj), kayıt sızmaz.
//   5. Sınır aşımı (exportCode 51 karakter) → alan-adlı 400, DB'ye ulaşmaz.
//   6. Metin olmayan tip → 400.
//   7. findAll search exportCode üzerinden müşteriyi bulur (route searchFields).
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

function mockReq(query: Record<string, unknown>): Request {
  return { query } as unknown as Request;
}

// Route config'iyle birebir (customer.routes.ts).
const service = new CustomerService({
  modelName: "customer",
  tableName: "CUSTOMER",
  searchFields: ["code", "name", "taxNumber", "exportCode"],
  defaultInclude: undefined,
  uniqueField: "code",
  nestedCreateFields: ["branches"],
});

const CARD_SELECT = {
  exportCode: true,
  address: true,
  city: true,
  district: true,
  country: true,
  contactName: true,
  contactPhone: true,
  email: true,
  notes: true,
} as const;

async function main() {
  const ts = Date.now();
  const exportCode = `TEST-EXP-${ts}`;
  const createdIds: string[] = [];

  try {
    // 1) create — kart alanları trim'lenip yazılır
    const created = await service.create(
      {
        name: "TEST Kart Alanlı",
        exportCode: `  ${exportCode}  `,
        address: " Sanayi Mah. 1. Cad. No:5 ",
        city: " İstanbul ",
        district: "Başakşehir",
        country: "Türkiye",
        contactName: "Ayşe Yılmaz",
        contactPhone: "0212 555 0000",
        email: "  ayse@ornek.com  ",
        notes: "İhracat müşterisi",
      },
      undefined,
    );
    const rec = created.data as { id: string } | null;
    createdIds.push(rec!.id);
    const db1 = await prisma.customer.findUnique({ where: { id: rec!.id }, select: CARD_SELECT });
    check(
      "create: kart alanları trim'lenip yazıldı",
      created.success === true &&
        db1?.exportCode === exportCode &&
        db1?.address === "Sanayi Mah. 1. Cad. No:5" &&
        db1?.city === "İstanbul" &&
        db1?.district === "Başakşehir" &&
        db1?.country === "Türkiye" &&
        db1?.contactName === "Ayşe Yılmaz" &&
        db1?.contactPhone === "0212 555 0000" &&
        db1?.email === "ayse@ornek.com" &&
        db1?.notes === "İhracat müşterisi",
    );

    // 2) boş/whitespace → null; gönderilmeyen → null
    const blank = await service.create(
      { name: "TEST Boş Kart", exportCode: "   ", email: "", city: "Bursa" },
      undefined,
    );
    const blankRec = blank.data as { id: string } | null;
    createdIds.push(blankRec!.id);
    const db2 = await prisma.customer.findUnique({ where: { id: blankRec!.id }, select: CARD_SELECT });
    check(
      "create: boş string → null, gönderilmeyen alan → null, dolu alan yazıldı",
      db2?.exportCode === null && db2?.email === null && db2?.address === null && db2?.city === "Bursa",
    );

    // 3) update — set + null ile temizleme
    await service.update(blankRec!.id, { exportCode: "EXP-UPD", city: null }, undefined);
    const db3 = await prisma.customer.findUnique({ where: { id: blankRec!.id }, select: CARD_SELECT });
    check("update: alan set edildi + null ile temizlendi", db3?.exportCode === "EXP-UPD" && db3?.city === null);

    // 4) geçersiz e-posta → 400, kayıt sızmaz
    let badEmail: unknown;
    try {
      await service.create({ name: "TEST Bozuk Eposta", email: "eposta-degil" }, undefined);
    } catch (e) { badEmail = e; }
    check(
      "geçersiz e-posta → 400 (Türkçe mesaj)",
      badEmail instanceof AppError && badEmail.statusCode === 400 && badEmail.message.includes("E-posta"),
    );
    const emailLeak = await prisma.customer.findFirst({ where: { name: "TEST Bozuk Eposta" } });
    check("geçersiz e-posta → müşteri sızmadı", emailLeak === null);

    // 5) sınır aşımı → alan-adlı 400 (Postgres P2000 değil)
    let tooLong: unknown;
    try {
      await service.create({ name: "TEST Uzun ExpKod", exportCode: "X".repeat(51) }, undefined);
    } catch (e) { tooLong = e; }
    check(
      "51 karakter exportCode → 400 (alan-adlı, DB'ye ulaşmadan)",
      tooLong instanceof AppError && tooLong.statusCode === 400 && tooLong.message.includes("50 karakter"),
    );

    // 6) metin olmayan tip → 400
    let notString: unknown;
    try {
      await service.create({ name: "TEST Sayı Telefon", contactPhone: 5551234 }, undefined);
    } catch (e) { notString = e; }
    check(
      "sayı contactPhone → 400 (metin olmalı)",
      notString instanceof AppError && notString.statusCode === 400 && notString.message.includes("metin"),
    );

    // 7) findAll search exportCode ile bulur
    const listed = await service.findAll(mockReq({ search: exportCode }));
    const rows = (listed.data ?? []) as Array<{ id: string }>;
    check(
      "findAll search (exportCode) müşteriyi buldu",
      Array.isArray(rows) && rows.some((r) => r.id === rec!.id),
      `bulunan=${rows.length}`,
    );
  } finally {
    for (const id of createdIds) {
      await prisma.customer.delete({ where: { id } }).catch(() => {});
    }
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
