import prisma from "../src/lib/prisma";
(async () => {
  const s = await prisma.$queryRawUnsafe(`SELECT key, value, "updatedAt" FROM system_settings WHERE key LIKE 'kk1%'`);
  console.log("SETTING:", JSON.stringify(s, null, 1));
  const r: any[] = await prisma.$queryRawUnsafe(
    `SELECT barcode, LEFT("clientToken"::text,8) AS tok, "createdAt", "itemId"::text AS item, "initialQty"::text AS qty, "createdMachineId" IS NOT NULL AS m, "createdById" IS NOT NULL AS u
     FROM rolls WHERE "createdAt" > now() - interval '48 hours' ORDER BY "createdAt" DESC LIMIT 12`,
  );
  console.table(r.map(x => ({ barcode: x.barcode, tok: x.tok, at: new Date(x.createdAt).toISOString(), item: x.item.slice(0,8), qty: x.qty, m: x.m, u: x.u })));
  await prisma.$disconnect();
})();
