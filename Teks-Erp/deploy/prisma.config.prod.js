// =============================================================================
// Üretim için Prisma yapılandırması — DÜZ JS (ts-node'suz sunucu için)
// =============================================================================
// Repo kökündeki `prisma.config.ts` TypeScript'tir ve yüklenmesi için `ts-node`
// gerekir — o ise **devDependency**. Sunucuda bağımlılıklar `npm ci --omit=dev`
// ile kurulduysa `prisma migrate deploy` config'i yükleyemez ve patlar.
//
// KULLANIM (yalnız devDependencies KURULMAYAN sunucuda gerekir):
//     copy deploy\prisma.config.prod.js prisma.config.js
// Prisma CLI önce .ts'i arar; sunucuda .ts'i yükleyemediğinde bu .js devreye girer.
// devDependencies kuruluysa bu dosyaya İHTİYAÇ YOKTUR — kopyalamayın, aksi halde
// hangi config'in okunduğu belirsizleşir.
//
// Datasource URL ortamdan (DATABASE_URL) gelir — pm2 ortamı veya .env.
// Not: `migrations.seed` BİLİNÇLİ olarak yok — üretimde seed koşmaz.
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
