// Idempotent: mobile:hizli-is-emri iznini + "Mobil — Hızlı İş Emri" template'ini
// canlı DB'ye ekler ve admin kullanıcısına bağlar (re-seed gerektirmeden).
// Çalıştırma: npx ts-node scripts/sync-quick-wo-permission.ts
import prisma from "../src/lib/prisma";

const TEMPLATE_CODES = [
  "mobile:hizli-is-emri",
  "workorder:read", "workorder:write",
  "roll:read",
  "item:read", "property:read", "station:read",
  "subcontractor:read", "order:read", "customer:read",
  "label:print",
];

async function main() {
  // 1) Permission upsert
  const perm = await prisma.permission.upsert({
    where: { code: "mobile:hizli-is-emri" },
    update: {},
    create: {
      code: "mobile:hizli-is-emri",
      module: "MOBILE",
      category: "mobile",
      description: "Hızlı İş Emri ekranı (stok topu okut → WO başlat + WO yönetimi)",
    },
  });
  console.log(`✅ permission: ${perm.code}`);

  // 2) Template upsert (varsa item'larını eşitle)
  const codeToId = new Map(
    (await prisma.permission.findMany({ where: { code: { in: TEMPLATE_CODES } }, select: { id: true, code: true } }))
      .map((p) => [p.code, p.id]),
  );
  const missing = TEMPLATE_CODES.filter((c) => !codeToId.has(c));
  if (missing.length) console.warn(`⚠️  template'te eksik kodlar (DB'de yok): ${missing.join(", ")}`);

  let tpl = await prisma.permissionTemplate.findFirst({ where: { name: "Mobil — Hızlı İş Emri" }, select: { id: true } });
  if (!tpl) {
    tpl = await prisma.permissionTemplate.create({
      data: {
        name: "Mobil — Hızlı İş Emri",
        description: "Stok topu okut → iş emri başlat + iş emri yönetimi (masaüstü WO yetkileri)",
        permissions: { create: [...codeToId.values()].map((permissionId) => ({ permissionId })) },
      },
      select: { id: true },
    });
    console.log("✅ template oluşturuldu: Mobil — Hızlı İş Emri");
  } else {
    console.log("ℹ️  template zaten var: Mobil — Hızlı İş Emri");
  }

  // 3) Admin kullanıcısına mobile:hizli-is-emri bağla (mobilde test edebilsin)
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (admin) {
    await prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: admin.id, permissionId: perm.id } },
      update: {},
      create: { userId: admin.id, permissionId: perm.id, grantedById: admin.id },
    });
    // ⚠️ TOKEN TAZELEME ŞART (BULGU-T2-012): yetkiler JWT'den okunur, DB'den
    // tazelenmez. `tokenVersion` artırılmazsa kullanıcı oturumunu kapatana
    // kadar YENİ yetkiyi KULLANAMAZ — panel ve DB "yetki var" derken uç 403
    // döner ve yönetici bunu teşhis edemez. Servis yolu (`permission-
    // management.service`) bunu atomik yapar; ham yazan her yol elle yapmalı.
    await prisma.user.update({ where: { id: admin.id }, data: { tokenVersion: { increment: 1 } } });
    console.log("✅ admin kullanıcısına bağlandı");
  } else {
    console.warn("⚠️  admin kullanıcısı bulunamadı");
  }
}

main()
  .catch((e) => { console.error("SYNC HATASI:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
