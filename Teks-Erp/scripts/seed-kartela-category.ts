// One-off: canlı DB'ye KARTELA fason kategorisi + örnek "Kartela A.Ş." firması ekle.
// Çalıştır: npx ts-node scripts/seed-kartela-category.ts
import prisma from "../src/lib/prisma";
(async () => {
  const cat = await prisma.subcontractorCategory.upsert({
    where: { code: "KARTELA" },
    create: {
      code: "KARTELA",
      name: "Kartela",
      description: "Bitmiş top → kartela üretimi (kartela sevk/kabul firmaları)",
      appliesColor: false,
      appliesProperty: false,
    },
    update: { name: "Kartela" },
  });
  console.log("✅ KARTELA kategorisi:", cat.id);

  // Örnek firma (idempotent — code unique)
  const firm = await prisma.subcontractor.upsert({
    where: { code: "KARTELAAS" },
    create: { code: "KARTELAAS", name: "Kartela A.Ş.", phone: "+90 212 555 3030", address: "İstanbul / Zeytinburnu" },
    update: {},
  });
  // Kategori bağı (M:N, compound PK)
  await prisma.subcontractorToCategory.upsert({
    where: { subcontractorId_categoryId: { subcontractorId: firm.id, categoryId: cat.id } },
    create: { subcontractorId: firm.id, categoryId: cat.id },
    update: {},
  });
  console.log("✅ Örnek firma 'Kartela A.Ş.' KARTELA kategorisine bağlandı:", firm.id);

  const count = await prisma.subcontractor.count({ where: { categories: { some: { categoryId: cat.id } } } });
  console.log("KARTELA kategorisindeki firma sayısı:", count);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
