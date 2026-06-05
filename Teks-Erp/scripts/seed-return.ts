// One-off: canlı DB'ye İADE özelliği için yeni permission'ları + iade nedenlerini ekle
// (veri SİLMEDEN, idempotent). Fresh kurulumlarda prisma/seed.ts zaten içeriyor.
// Çalıştır: npx ts-node scripts/seed-return.ts
import prisma from "../src/lib/prisma";

const NEW_PERMS = [
  { code: "return:read", module: "LOGISTICS", category: "web" as const, description: "İade takibi raporu görüntüleme" },
  { code: "return:write", module: "LOGISTICS", category: "web" as const, description: "İade alma + iade nedeni kataloğu CRUD" },
  { code: "mobile:iade", module: "MOBILE", category: "mobile" as const, description: "İade girişi ekranı" },
];

const REASONS = [
  { code: "YANLIS_URUN", name: "Yanlış Ürün", color: "#f59e0b", sortOrder: 10 },
  { code: "YANLIS_RENK_EN", name: "Yanlış Renk/En", color: "#f59e0b", sortOrder: 20 },
  { code: "HASARLI", name: "Hasarlı", color: "#ef4444", sortOrder: 30 },
  { code: "FAZLA_SEVK", name: "Fazla Sevkiyat", color: "#3b82f6", sortOrder: 40 },
  { code: "MUSTERI_VAZGECTI", name: "Müşteri Vazgeçti", color: "#6b7280", sortOrder: 50 },
  { code: "DIGER", name: "Diğer", color: "#6b7280", sortOrder: 60 },
];

(async () => {
  // 1. Permission'lar (upsert by code) + admin'e ata
  const created = [];
  for (const p of NEW_PERMS) {
    const perm = await prisma.permission.upsert({
      where: { code: p.code },
      create: p,
      update: { description: p.description, module: p.module },
    });
    created.push(perm);
  }
  console.log(`✅ ${created.length} permission upsert edildi:`, created.map((p) => p.code).join(", "));

  const admin = await prisma.user.findUnique({ where: { username: "admin" }, select: { id: true } });
  if (admin) {
    const res = await prisma.userPermission.createMany({
      data: created.map((perm) => ({ userId: admin.id, permissionId: perm.id, grantedById: admin.id })),
      skipDuplicates: true,
    });
    console.log(`✅ Admin'e ${res.count} yeni yetki atandı (zaten varsa atlandı)`);
  } else {
    console.warn("⚠️  admin kullanıcısı bulunamadı — yetki ataması atlandı");
  }

  // 2. İade nedenleri (createMany skipDuplicates — code unique)
  const r = await prisma.returnReason.createMany({ data: REASONS, skipDuplicates: true });
  console.log(`✅ ${r.count} iade nedeni eklendi (zaten varsa atlandı)`);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
