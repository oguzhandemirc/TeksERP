// DEMO FİKSTÜRÜ (R3-ANALIZ) — YALNIZ `tekserp_<ad>_test`. Kapı İLK iştir: Prisma ancak geçince yüklenir.
//   npx tsx scripts/fixture-rapor-demo.ts            → dünden geriye 28 günlük dokuma ayı (güçlü kanıt)
//   npx tsx scripts/fixture-rapor-demo.ts --kucuk    → 9 çözgü kaydı ("güvenilir değil")
//   --ay 2096-02 (pencere) · --sil (demo verisini kaldır)
import dotenv from "dotenv";
import { resolveEnvFilePath } from "../src/lib/hizmet-duzeni";
import { demoTargetBlock } from "./lib/demo-db-gate";

dotenv.config({ path: resolveEnvFilePath(process.env, process.cwd()) });
const block = demoTargetBlock(process.env.DATABASE_URL);
if (block) {
  console.error(`DEMO-KAPI: ${block}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { default: prisma, pool } = await import("../src/lib/prisma");
  const demo = await import("./lib/demo-rapor-veri");
  try {
    if (args.includes("--sil")) {
      await demo.removeDemo();
      console.log("Demo verisi kaldırıldı.");
      return;
    }
    const at = args.indexOf("--ay");
    const summary = await demo.writeDemo({ small: args.includes("--kucuk"), ...(at >= 0 ? { month: args[at + 1] } : {}) });
    console.log(JSON.stringify(summary));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error("HATA:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
