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
//     mkdir C:\Etkili-Yazilim\logs
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
      name: "tekserp-backend",
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
      out_file: "C:/Etkili-Yazilim/logs/backend-out.log",
      error_file: "C:/Etkili-Yazilim/logs/backend-err.log",
      time: true,

      env: {
        NODE_ENV: "production",
        APP_ENV: "production",
        PORT: "4000",
        // 0.0.0.0 = fabrika ağındaki tabletler/istemciler erişebilsin.
        HOST: "0.0.0.0",

        // --- Servis keşfi (jobs/mdns-advertiser.job.ts)
        //
        // Sunucu kendini ağa `_teks-erp._tcp` olarak ilan eder → yeni kurulan
        // Electron paneli IP yazmadan bulur. VARSAYILAN AÇIK; kapatmak için
        // burada "false" yaz (HOST/PORT ile aynı sınıf taşıma ayarı olduğu için
        // feature-flag değil env).
        //
        // ⚠ UDP 5353 GELEN kuralı olmadan ilan fabrika ağında görünmez
        // (docs/ops/DEPLOY-RUNBOOK.md firewall bölümü). Ayrıca Windows'ta o portu
        // Apple Bonjour Service / Adobe tutuyor olabilir — o durumda ilan sessizce
        // kapanır ve keşif yalnız istemcinin alt ağ taramasıyla çalışır.
        // Gerçekten çalışıp çalışmadığı TEK yerden ölçülür:
        //   GET /api/admin/health → discovery.mdns.reason === "ok"
        // DISCOVERY_MDNS_ENABLED: "false",

        // --- Yedekleme (services/backup.service.ts + jobs/backup-scheduler.ts)
        //
        // ⚠ SAHADAKİ SUNUCUDA (SAHINSRV) GECE YEDEĞİNİ BACKEND ALMIYOR.
        // Bağımsız bir Windows Görev Zamanlayıcı görevi alıyor:
        //   TeksERP-DB-Backup → C:\Etkili-Yazilim\yedekle.ps1, her gece 02:00,
        //   C:\Etkili-Yazilim\backups, 30 gün saklama.
        // Bunun bilinçli üstünlüğü: backend ÇÖKMÜŞ ya da KAPALIYKEN bile yedek
        // alınır. Bu yüzden orada scheduler KAPATILIR — ikisi birden açık kalırsa
        // her gece İKİ dump alınır (çift disk, çift I/O).
        // Panelin elle yedek / önizleme / kopya özellikleri kapalıyken de çalışır.
        BACKUP_SCHEDULE_ENABLED: "false",

        // BACKUP_DIR TANIMSIZSA panel yedekleri göremez ve elle yedek alınamaz.
        // Sahadaki değer: C:/Etkili-Yazilim/backups
        BACKUP_DIR: "C:/Etkili-Yazilim/backups",

        // Saklama GÜN bazlı (varsayılan 30) — sahadaki `yedekle.ps1` politikasıyla
        // AYNI olmalı. Eskiden "en yeni 14 dosya"ydı; aynı klasöre/aynı `tekserp_*`
        // desenine yazdığı için 30 günlük geçmişi 14 dosyaya indirip ~16 günü
        // SESSİZCE silerdi. Yaşına bakılmaksızın en yeni 3 dosya her zaman korunur.
        BACKUP_RETENTION_DAYS: "30",
        // Offsite ikinci kopya (NAS/UNC/harici disk). BOŞ BIRAKILIRSA tüm yedekler
        // DB ile aynı diskte kalır (tek disk arızası = veri + yedek gider).
        // Yerel ikinci hedef (ağ paylaşımı / ikinci disk). Boş = kapalı.
        // ⚠️ Bu ayar YALNIZ backend'in KENDİ aldığı yedeklere uygulanır
        // (panelden elle alınanlar). Sahada gece yedeğini harici görev aldığı
        // için gerçek felaket koruması aşağıdaki rclone süpürücüsüdür.
        BACKUP_OFFSITE_DIR: "",

        // ── OFFSITE SÜPÜRÜCÜ (rclone) — denetim 2026-08-10, F-OPS-VER-003 ────
        // Yedek klasörüne DÜŞEN her dosyayı, kim almış olursa olsun, saatte bir
        // uzak hedefe kopyalar. `copy` kullanır (`sync` DEĞİL): yereldeki silme
        // ya da şifrelenme uzağa YANSIMAZ — fidye yazılımına karşı asıl koruma
        // budur. Bu yoldan uzaktan hiçbir şey silinmez.
        //
        // Kurulum (sunucuda bir kerelik):
        //   1) rclone.org/downloads → rclone.exe'yi C:/Etkili-Yazilim/rclone/ altına koy
        //   2) rclone config → n → ad: gdrive → tür: drive → tarayıcıda Google girişi
        //   3) rclone lsd gdrive:  ile bağlantıyı doğrula
        //   4) HEDEFİ PANELDEN GİR: Sistem → Yedekler → "Offsite Yedek" kartı
        //      (Google girişini de oradaki sihirbaz yapar; 2-3 adımı atlar.)
        //
        // ⚠️ AŞAĞIDAKİ İKİ ENV ARTIK YALNIZ BAŞLANGIÇ DEĞERİDİR. Panelden
        // yapılan ayar `SystemSetting`e yazılır ve env'i EZER (`backup.hour`
        // emsali) — pm2 restart gerekmez. Kayıt bir kez oluştuktan sonra bu
        // satırı değiştirmek hiçbir şeyi değiştirmez; panelden bakın.
        BACKUP_RCLONE_REMOTE: "",
        BACKUP_RCLONE_BIN: "C:/Etkili-Yazilim/rclone/rclone.exe",
        // rclone yapılandırma dosyası (Drive token'ı burada durur). Boşsa
        // `<BACKUP_DIR>/../rclone.conf` kullanılır — yedek klasörünün İÇİNE
        // konmaz, orası buluta süpürülüyor.
        BACKUP_RCLONE_CONFIG: "",
        // Gece yedeğinin saati — YALNIZ FALLBACK. Yetkili kaynak artık panel:
        // Sistem → Yedekler → "Otomatik yedek saati" (SystemSetting `backup.hour`).
        // Öncelik: DB kaydı → bu env → 3. Panelden bir kez kaydedilirse bu değer
        // artık kullanılmaz; saat değişikliği pm2 restart GEREKTİRMEZ.
        BACKUP_HOUR: "3",
        // pg_dump / pg_restore konumu — Windows'ta PATH'te olmaz.
        // ⚠ Sunucudaki PostgreSQL'in MAJOR sürümüyle eşleşmeli; bu ikili
        // sunucudan ESKİ bir majorsa pg_dump çalışmayı reddeder. Gerçek yolu
        // teyit et: Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory
        // Sahadaki değer (PostgreSQL 16.9 native kurulum):
        PG_BIN_DIR: "C:/Etkili-Yazilim/pgsql/bin",

        // --- Kopyaya geri yükleme (Sistem → Veritabanı Geri Yükleme)
        // PGDATA_DIR: disk guard'ının ölçeceği birim. Verilmezse tablespace
        //   dizini → `SHOW data_directory` → cwd sırasıyla çözülür. PostgreSQL
        //   verisi backend'den FARKLI bir diskteyse bunu ayarlayın.
        // PG_MAINTENANCE_DB: CREATE/DROP/ALTER DATABASE'in çalıştırılacağı
        //   veritabanı (varsayılan `postgres`).
        // PG_RESTORE_JOBS: pg_restore paralelliği. Varsayılan 1 — canlı
        //   vardiyada diski boğmasın diye bilinçli olarak kapalı.
        // PGDATA_DIR: "C:/Etkili-Yazilim/pgdata",
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
