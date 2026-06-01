// =============================================================================
// Üretim (Windows servis) için Prisma yapılandırması — DÜZ JS.
// =============================================================================
// Kaynak repo `prisma.config.ts` (TypeScript) kullanır; üretim sunucusunda
// ts-node bulunmadığı için build.ps1 bu JS dosyasını payload'a `prisma.config.js`
// olarak kopyalar. Prisma CLI önce .ts'i arar — payload'da .ts olmadığından bu
// .js kullanılır ve hiçbir TS yükleyiciye ihtiyaç kalmaz.
//
// Datasource URL ortamdan (DATABASE_URL) gelir; manage.ps1 migrate/seed öncesi
// bu değişkeni set eder, backend servisi ise NSSM env üzerinden alır.
// =============================================================================
require("dotenv/config");
const { defineConfig } = require("prisma/config");

module.exports = defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
