import prisma from "/Users/oad/Documents/projeler/AdnanSahin/Teks-Erp/src/lib/prisma";
(async () => {
  const g = await prisma.$queryRaw<Array<{ c: number; n: bigint }>>`
    SELECT c, COUNT(*)::bigint AS n FROM (
      SELECT "shipmentId", COUNT(*)::int AS c FROM sacks
      WHERE "shipmentId" IS NOT NULL GROUP BY "shipmentId") t GROUP BY c ORDER BY c DESC LIMIT 5`;
  console.log("Sevkiyat başına çuval (gerçek fabrika verisi):");
  for (const r of g) console.log(`  ${r.c} çuval → ${r.n} sevkiyat`);
  const d = await prisma.$queryRaw<Array<{ m: number; avg: number }>>`
    SELECT MAX(c)::int AS m, ROUND(AVG(c),1)::float AS avg FROM (
      SELECT COUNT(*)::int c FROM sacks WHERE "shipmentId" IS NOT NULL GROUP BY "shipmentId") t`;
  console.log(`  EN BÜYÜK: ${d[0]?.m} çuval · ortalama ${d[0]?.avg}`);
  await prisma.$disconnect();
})();
