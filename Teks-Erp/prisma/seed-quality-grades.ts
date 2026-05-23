// =============================================================================
// TeksERP - Quality Grade Seed
// =============================================================================
// 3 sabit kalite sınıfı: 1. Kalite (depo), A1 (alt stok), Fire (hurda).
// Mobil KK1/Tambur ekranı buradan beslenir. UI'dan yönetilmez (Tanımlar kartı
// kaldırıldı) — ad/renk değişirse bu dosyayı düzenleyip yeniden çalıştır.
//
// Kullanım:
//   - Otomatik:   `npm run seed` (main seed.ts çağırır)
//   - Manuel:     `npx ts-node --project prisma/tsconfig.json prisma/seed-quality-grades.ts`

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const DEFAULTS = [
  { code: "1.KALITE", name: "1. Kalite",       color: "#10b981", sortOrder: 10, targetStatus: "WAREHOUSE" as const },
  { code: "A1",       name: "A1 (Alt Kalite)", color: "#f59e0b", sortOrder: 20, targetStatus: "A1_STOCK" as const },
  { code: "FIRE",     name: "Fire",            color: "#ef4444", sortOrder: 30, targetStatus: "SCRAP" as const },
];

export async function seedQualityGrades(prisma: PrismaClient): Promise<number> {
  for (const g of DEFAULTS) {
    await prisma.qualityGrade.upsert({
      where: { code: g.code },
      update: {
        name: g.name,
        color: g.color,
        sortOrder: g.sortOrder,
        targetStatus: g.targetStatus,
        isActive: true,
      },
      create: { ...g },
    });
    console.log(`  ✓ ${g.code} — ${g.name}`);
  }
  return DEFAULTS.length;
}

// Standalone çalıştırma (yalnız bu dosya direkt invoke edildiğinde).
if (require.main === module) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  seedQualityGrades(prisma)
    .then((n) => console.log(`✅ ${n} kalite sınıfı upsert edildi.`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
      await pool.end();
    });
}
