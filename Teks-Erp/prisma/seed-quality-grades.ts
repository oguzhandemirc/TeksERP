// =============================================================================
// TeksERP - Quality Grade Seed
// =============================================================================
// Varsayılan kalite derecelerini idempotent şekilde yükler.
// Çalıştırma: npx ts-node --project prisma/tsconfig.json prisma/seed-quality-grades.ts

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DEFAULTS = [
  { code: "1.KALITE", name: "1. Kalite",       color: "#10b981", sortOrder: 10, targetStatus: "WAREHOUSE" as const },
  { code: "A1",       name: "A1 (Alt Kalite)", color: "#f59e0b", sortOrder: 20, targetStatus: "A1_STOCK" as const },
  { code: "A2",       name: "A2 (2. Kalite)",  color: "#f97316", sortOrder: 30, targetStatus: "A1_STOCK" as const },
  { code: "FIRE",     name: "Fire",            color: "#ef4444", sortOrder: 40, targetStatus: "SCRAP" as const },
];

async function main() {
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
