// Prisma yapılandırması — `.env` bu dosyanın yanından okunur (çalışma dizininden bağımsız).
// Migration GÖÇ rolüyle koşar (`GOC_DATABASE_URL`: tabloların sahibi); sunucu bu rolle BAĞLANMAZ —
// uygulama ve eşitleme rolleri ayrı URL'lerdir (RLS'i atlayamazlar, `scripts/db-rolleri.ts`).
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

loadEnv({ path: path.join(__dirname, ".env"), quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env["GOC_DATABASE_URL"] },
});
