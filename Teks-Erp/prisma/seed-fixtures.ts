// =============================================================================
// TeksERP — Dev/Test İş Fixture Seed'i (idempotent)
// =============================================================================
// Base `npm run seed` TEMİZ FABRİKA kurar (müşteri/renk/ürün YOK — üretimde
// fabrika kendi ekler). Test scriptleri ve `seed-shipping-scenario.ts` ise
// business-key ile çözdükleri iş fixture'larının (PATOS ürünü, MAVI renk,
// MUS-001 müşterisi, IST şubesi...) hazır olmasını bekler. Bu dosya YALNIZ o
// dev/test iş verisini üretir — production seed'ini kirletmemek için ayrıdır.
//
// Çalıştır:  npm run seed:fixtures   (önce `npm run seed` çalışmış olmalı)
//        ya: npx tsx prisma/seed-fixtures.ts
//
// Idempotent: unique `code` üzerinden upsert; şubeler (customerId, code) ile
// kontrol edilir. Tekrar çalıştırmak güvenlidir.
// =============================================================================

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
// Oturumu UTC-ye sabitler — adapter-pg timestamptz-i UTC varsayar (bkz. src/lib/pg-session.ts).
import { PG_SESSION_OPTIONS } from "../src/lib/pg-session";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: PG_SESSION_OPTIONS });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * Birleştirilmiş (tombstone, `mergedIntoId` dolu) ana veriyi DİRİLTME (2026-08-21).
 * `upsert` kodla bulduğu satıra `isActive: true` yazıyordu — dev DB'de MUS-002
 * "Moda Tekstil" birleştirilip pasife alınmıştı, fixture onu yeniden aktif yapıyor
 * ve DB seddinin (nameFold UNIQUE, tombstone hariç) dışında tuttuğu kaydı canlı
 * sanıyordu. Tombstone varsa ATLA ve söyle; yoksa eski upsert. Taze/CI DB'de
 * tombstone yoktur — davranış değişmez.
 */
type MergeAware = { findUnique(args: { where: { code: string }; select: { id: true; mergedIntoId: true } }): Promise<{ id: string; mergedIntoId: string | null } | null> };
async function isMergedTombstone(delegate: MergeAware, code: string, label: string): Promise<boolean> {
  const row = await delegate.findUnique({ where: { code }, select: { id: true, mergedIntoId: true } });
  if (row?.mergedIntoId) {
    console.log(`⏭️  ${label} ${code}: birleştirilmiş (tombstone) — fixture DİRİLTMEZ, atlandı`);
    return true;
  }
  return false;
}

async function main() {
  console.log("🌱 TeksERP — dev/test iş fixture seed'i...\n");

  // ---------------------------------------------------------------------------
  // ÜRÜNLER (kumaş) — test scriptlerinin aradığı kodlar
  // ---------------------------------------------------------------------------
  // Not: test'ler item.name === "PATOS" (kod = ad) bekliyor (fiş/muhasebe ad formatı).
  const items = [
    { code: "PATOS", name: "PATOS" },
    { code: "POLAR", name: "POLAR" },
    { code: "SUET", name: "SUET" },
    { code: "KRINKLE", name: "KRINKLE" },
  ];
  for (const it of items) {
    if (await isMergedTombstone(prisma.item, it.code, "ürün")) continue;
    await prisma.item.upsert({
      where: { code: it.code },
      update: { name: it.name, itemType: "FABRIC", unit: "MT", isActive: true },
      create: { code: it.code, name: it.name, itemType: "FABRIC", unit: "MT" },
    });
  }
  console.log(`✅ ${items.length} ürün (PATOS/POLAR/SUET/KRINKLE)`);

  // ---------------------------------------------------------------------------
  // RENKLER
  // ---------------------------------------------------------------------------
  // ⚠️ ADLAR "Fixture" ÖNEKLİ — testler bu renkleri KODLA çözer (`code: "MAVI"`),
  // ada göre değil. Önek, dev veritabanı fabrikanın canlı yedeğiyle çalışırken
  // gerçek master-data ile AD ÇAKIŞMASINI önler: fabrikada zaten "BEYAZ" adlı bir
  // renk var ve düz "Beyaz" fixture'ı `test_consistency` §18'i (aktif master-data
  // ad mükerreri) kalıcı kırmızıya çeviriyordu. Kodları DEĞİŞTİRME — çözüm anahtarı
  // onlar. Aynı adlar `scripts/seed-demo-shipments.ts`'te de kullanılıyor; orayı da
  // birlikte güncelle, yoksa demo seed'i bu adları geri ezer.
  const colors = [
    { code: "MAVI", name: "Fixture Mavi", hex: "#2563eb", sortOrder: 10 },
    { code: "BEYAZ", name: "Fixture Beyaz", hex: "#f8fafc", sortOrder: 20 },
    { code: "SIYAH", name: "Fixture Siyah", hex: "#111827", sortOrder: 30 },
    { code: "LACIVERT", name: "Fixture Lacivert", hex: "#1e3a8a", sortOrder: 40 },
  ];
  for (const c of colors) {
    if (await isMergedTombstone(prisma.color, c.code, "renk")) continue;
    await prisma.color.upsert({
      where: { code: c.code },
      update: { name: c.name, hex: c.hex, sortOrder: c.sortOrder, isActive: true },
      create: c,
    });
  }
  console.log(`✅ ${colors.length} renk (MAVI/BEYAZ/SIYAH/LACIVERT)`);

  // ---------------------------------------------------------------------------
  // ÖZELLİKLER — base seed KURSUN/ZIMPARALI üretir; test'ler ek olarak
  // ANTIBAKTERIYEL bekliyor (base seed'den "demo özellik" olarak çıkarılmış).
  // ---------------------------------------------------------------------------
  const props = [
    { code: "ANTIBAKTERIYEL", name: "Antibakteriyel", category: "Kimyasal", color: "#22c55e", sortOrder: 30 },
  ];
  for (const pr of props) {
    await prisma.fabricProperty.upsert({
      where: { code: pr.code },
      update: { name: pr.name, category: pr.category, color: pr.color, sortOrder: pr.sortOrder, isActive: true },
      create: pr,
    });
  }
  console.log(`✅ ${props.length} özellik (ANTIBAKTERIYEL)`);

  // ---------------------------------------------------------------------------
  // MÜŞTERİLER + ŞUBELER — senaryo seed'i MUS-001=arda (IST/ANK),
  // MUS-002=moda (IZM) bekliyor. Bekçiler bunları KODLA çözer (12 dosya), adla değil.
  //
  // ⚠️ AD DA DAMGALI ([TD-16]) — 2026-09-06'da ölçüldü: fabrikanın 2026-09-05
  // yedeği restore edilip `seed:fixtures` koşulduğunda "Moda Tekstil" fabrikanın
  // GERÇEK "MODA TEKSTİL" müşterisiyle (MUS1707260010, 2026-07-17) `nameFold`
  // seddine çarpıp UniqueConstraintViolation veriyordu. Yani reponun kendi zorunlu
  // provası (restore → migrate deploy → bekçiler) bu adımda kırılıyordu.
  // Çakışma öngörülebilirdi: `name-normalize.helper.ts:73` zaten "canlı veride
  // 'Moda Tekstil' + 'MODA TEKSTİL'" diye ölçüm taşıyor. Damgasız fixture adı,
  // fabrikanın yarın açacağı bir müşteriyle de çarpar.
  // ---------------------------------------------------------------------------
  const customers = [
    {
      code: "MUS-001",
      name: "FIXTURE Arda Tekstil",
      branches: [
        { code: "IST", name: "İstanbul Şubesi", city: "İstanbul" },
        { code: "ANK", name: "Ankara Şubesi", city: "Ankara" },
      ],
    },
    {
      code: "MUS-002",
      name: "FIXTURE Moda Tekstil",
      branches: [{ code: "IZM", name: "İzmir Şubesi", city: "İzmir" }],
    },
  ];
  let branchCount = 0;
  for (const cu of customers) {
    if (await isMergedTombstone(prisma.customer, cu.code, "müşteri")) continue;
    const customer = await prisma.customer.upsert({
      where: { code: cu.code },
      update: { name: cu.name, isActive: true },
      create: { code: cu.code, name: cu.name },
    });
    for (const br of cu.branches) {
      const existing = await prisma.customerBranch.findFirst({
        where: { customerId: customer.id, code: br.code },
        select: { id: true },
      });
      if (existing) {
        await prisma.customerBranch.update({
          where: { id: existing.id },
          data: { name: br.name, city: br.city, isActive: true },
        });
      } else {
        await prisma.customerBranch.create({
          data: { customerId: customer.id, code: br.code, name: br.name, city: br.city },
        });
      }
      branchCount++;
    }
  }
  console.log(`✅ ${customers.length} müşteri (MUS-001/MUS-002) + ${branchCount} şube (IST/ANK/IZM)`);

  console.log("\n🎉 Dev/test fixture seed tamamlandı.");
}

main()
  .catch((e) => {
    console.error("❌ Fixture seed hatası:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
