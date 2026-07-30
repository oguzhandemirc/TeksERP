// =============================================================================
// pm2 — TeksERP backend üretim başlatıcısı
// =============================================================================
// 2026-07-30: Backend eskiden NSSM ile Windows servisi olarak koşuyordu
// (installer/windows/scripts/manage.ps1). O yol kaldırıldı; üretim artık pm2 ile
// ayağa kalkar. Kullanım (sunucuda, Teks-Erp\ klasöründe):
//
//     npm ci
//     npm run prisma:generate
//     npm run prisma:migrate          # migrate deploy
//     npm run build                   # dist\ üretir
//     pm2 start ecosystem.config.js
//     pm2 save                        # reboot'ta geri yüklenecek listeyi yaz
//
// ⚠ Log klasörü ÖNCEDEN var olmalı — pm2 out_file/error_file dizinini kendisi
// OLUŞTURMAZ, yoksa log yazamaz:
//     mkdir C:\ProgramData\TeksERP\logs
//
// Ayrıntı ve reboot kalıcılığı: docs/ops/DEPLOY-RUNBOOK.md
//
// ⚠ SIRLAR BU DOSYAYA YAZILMAZ. Bu dosya git'te tutulur; DATABASE_URL ve
// JWT_SECRET `.env`'de kalır (server.ts ilk satırda `dotenv/config` yükler, cwd
// altındaki .env okunur). Aşağıdaki `env` bloğu yalnız sır olmayan operasyonel
// değerleri taşır — eskiden NSSM'in AppEnvironmentExtra'sının yaptığı iş.
// =============================================================================

module.exports = {
  apps: [
    {
      name: "teks-erp-backend",
      // tsconfig: rootDir=./src, outDir=./dist → çıktı `dist/server.js`
      // (`dist/src/server.js` DEĞİL — yanlış yol pm2'yi hiç başlatmaz).
      script: "dist/server.js",
      // cwd load-bearing: app.ts `public/`, raster-font `assets/fonts/` ve sürüm
      // bilgisi için `package.json`'ı process.cwd()'e göre çözer. Ayrıca .env de
      // buradan okunur. Bu satır yanlışsa durum sayfası ve etiket fontu bozulur.
      cwd: __dirname,

      // -----------------------------------------------------------------------
      // TEK-PROCESS INVARIANT — pazarlık dışı (bkz. src/server.ts başındaki blok)
      // -----------------------------------------------------------------------
      // exec_mode CLUSTER OLAMAZ ve instances 1'den büyük OLAMAZ. presence sayımı,
      // feature-flag cache, archive-scheduler ve backup-scheduler process-local
      // durum tutar; 2. instance eklenince SESSİZCE bozulurlar (çift arşiv, çift
      // gece yedeği, parçalanmış presence). Ölçeklenmek gerekirse Redis + advisory
      // lock katmanı şart.
      exec_mode: "fork",
      instances: 1,

      // -----------------------------------------------------------------------
      // Graceful shutdown
      // -----------------------------------------------------------------------
      // Windows gerçek SIGTERM göndermez → pm2 IPC ile "shutdown" mesajı yollar;
      // server.ts bunu dinler (process.on("message")). Bu bayrak olmadan restart
      // prosesi hard-kill eder ve uçuştaki istekler kopar.
      shutdown_with_message: true,
      // server.ts kendi içinde 5sn'de zorla çıkar; pm2'ye biraz pay bırak.
      kill_timeout: 8000,
      // Boot'ta DB henüz hazır değilse hızlı restart döngüsüne girmesin.
      restart_delay: 4000,
      autorestart: true,
      max_restarts: 10,
      // Sızıntı olursa vardiya ortasında OOM ile ölmek yerine kontrollü restart.
      max_memory_restart: "1G",

      // -----------------------------------------------------------------------
      // Loglar
      // -----------------------------------------------------------------------
      // morgan 'combined' üretimde ANSI'siz yazar (app.ts F17) → dosya temiz kalır.
      // Rotasyonu pm2 kendisi YAPMAZ: pm2-logrotate modülü gerekir (runbook).
      out_file: "C:/ProgramData/TeksERP/logs/backend-out.log",
      error_file: "C:/ProgramData/TeksERP/logs/backend-err.log",
      time: true,

      env: {
        NODE_ENV: "production",
        APP_ENV: "production",
        PORT: "4000",
        // 0.0.0.0 = fabrika ağındaki tabletler/istemciler erişebilsin.
        HOST: "0.0.0.0",

        // --- Yedekleme (services/backup.service.ts + jobs/backup-scheduler.ts)
        // BACKUP_DIR TANIMSIZSA GECE YEDEĞİ ÇALIŞMAZ. Eskiden bu env NSSM servis
        // kaydından geliyordu; pm2'ye geçişte düştüğü fark edilmezse sistem
        // sessizce yedeksiz kalır — bu yüzden burada açıkça duruyor.
        BACKUP_DIR: "C:/ProgramData/TeksERP/backups",
        // Offsite ikinci kopya (NAS/UNC/harici disk). BOŞ BIRAKILIRSA tüm yedekler
        // DB ile aynı diskte kalır (tek disk arızası = veri + yedek gider).
        BACKUP_OFFSITE_DIR: "",
        // Gece yedeğinin saati — YALNIZ FALLBACK. Yetkili kaynak artık panel:
        // Sistem → Yedekler → "Otomatik yedek saati" (SystemSetting `backup.hour`).
        // Öncelik: DB kaydı → bu env → 3. Panelden bir kez kaydedilirse bu değer
        // artık kullanılmaz; saat değişikliği pm2 restart GEREKTİRMEZ.
        BACKUP_HOUR: "3",
        // pg_dump / pg_restore konumu — Windows'ta PATH'te olmaz.
        // ⚠ Sunucudaki PostgreSQL'in MAJOR sürümüyle eşleşmeli; bu ikili
        // sunucudan ESKİ bir majorsa pg_dump çalışmayı reddeder. Gerçek yolu
        // teyit et: Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory
        PG_BIN_DIR: "C:/Program Files/PostgreSQL/18/bin",

        // --- Kopyaya geri yükleme (Sistem → Veritabanı Geri Yükleme)
        // PGDATA_DIR: disk guard'ının ölçeceği birim. Verilmezse tablespace
        //   dizini → `SHOW data_directory` → cwd sırasıyla çözülür. PostgreSQL
        //   verisi backend'den FARKLI bir diskteyse bunu ayarlayın.
        // PG_MAINTENANCE_DB: CREATE/DROP/ALTER DATABASE'in çalıştırılacağı
        //   veritabanı (varsayılan `postgres`).
        // PG_RESTORE_JOBS: pg_restore paralelliği. Varsayılan 1 — canlı
        //   vardiyada diski boğmasın diye bilinçli olarak kapalı.
        // PGDATA_DIR: "C:/ProgramData/TeksERP/pgdata",
        // PG_MAINTENANCE_DB: "postgres",
        // PG_RESTORE_JOBS: "1",

        // --- Yedek için ayrı DB kullanıcısı (OPSİYONEL)
        // Yalnız DATABASE_URL'deki uygulama kullanıcısı tabloların sahibi/superuser
        // DEĞİLSE gerekir: aksi halde pg_dump "permission denied" verir ya da
        // nesne atlayıp SESSİZCE eksik yedek üretir. Eski installer bu işi
        // `postgres` ile yapıyordu. İkisi birlikte verilir; boşsa DATABASE_URL
        // kimlik bilgileri kullanılır.
        // BACKUP_PG_USER: "postgres",
        // BACKUP_PG_PASSWORD: "<postgres-şifresi>",   // ⚠ sır → .env'e koy, buraya DEĞİL
      },
    },
  ],
};
