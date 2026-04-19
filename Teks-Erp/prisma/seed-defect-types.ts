// One-off idempotent seed for the DefectType catalog.
// Run with: npx ts-node prisma/seed-defect-types.ts
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const DEFECT_TYPES = [
  { code: "LEKE", name: "Leke", severity: "MAJOR", description: "Boya/kir lekesi" },
  { code: "YIRTIK", name: "Yırtık", severity: "CRITICAL", description: "Kumaşta yırtık veya delik" },
  { code: "ATKI_ATLAMA", name: "Atkı Atlaması", severity: "MAJOR", description: "Atkı ipliğinde atlama" },
  { code: "COZGU_ATLAMA", name: "Çözgü Atlaması", severity: "MAJOR", description: "Çözgü ipliğinde atlama" },
  { code: "RENK_FARKI", name: "Renk Farkı", severity: "MINOR", description: "Top içi veya toplar arası renk farkı" },
  { code: "KALIN_ATKI", name: "Kalın Atkı", severity: "MINOR" },
  { code: "INCE_ATKI", name: "İnce Atkı", severity: "MINOR" },
  { code: "BUZULME", name: "Büzülme", severity: "MAJOR", description: "Boyahane sonrası büzülme" },
  { code: "EGIK_ATKI", name: "Eğik Atkı", severity: "MINOR" },
  { code: "IPLIK_KOPUKLUGU", name: "İplik Kopukluğu", severity: "MAJOR" },
];

async function main() {
  for (const dt of DEFECT_TYPES) {
    await prisma.defectType.upsert({
      where: { code: dt.code },
      update: {},
      create: dt,
    });
    console.log(`Upserted: ${dt.code} — ${dt.name}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
