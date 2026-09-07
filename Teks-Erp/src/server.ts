import "dotenv/config"; // .env yükle — diğer tüm importlardan ÖNCE (JWT_SECRET vb. modül-load anında okunur)
import "./lib/zod-locale"; // Zod tr locale
import app from './app';
import prisma, { pool } from './lib/prisma';
import { getLanAddresses } from './lib/lan-addresses';
import { startInstallationIdentity } from './jobs/installation-identity.job';
import { startSuperadminAccount } from './jobs/superadmin.job';
import { startModuleProfileJob } from './jobs/module-profile.job';
import { refreshDiscoveryCache } from './services/discovery.service';
import { startMdnsAdvertiser, stopMdnsAdvertiser } from './jobs/mdns-advertiser.job';
import { startArchiveScheduler } from './jobs/archive-scheduler';
import { startBackupScheduler } from './jobs/backup-scheduler';
import { startOffsiteSweeper } from './jobs/offsite-sweeper';
import { startPermissionCatalogReconciler } from './jobs/permission-catalog.job';
import { startDefaultWarehouseReconciler } from './jobs/default-warehouse.job';
import { startExchangeRateScheduler } from './jobs/exchange-rate.job';
import { AuditService } from './services/audit.service';
import { flushLatencyNow } from './services/latency-persist.service';
import { assertBaseServiceGuards } from './services/base.service';
import { surecUyarilariniLogla } from './lib/process-warnings';
import { readWebHardeningConfig, isWebHardeningDeclared } from './middlewares/web-hardening';
import { readRemoteAccessConfig } from './middlewares/remote-access.middleware';
import { hata, uyari, bilgi, satir } from "./lib/logger";

const PORT = process.env.PORT || 4000;
// 0.0.0.0 = tüm ağ arayüzlerinden dinle (tablet/diğer cihazlar LAN üzerinden erişebilsin).
// HOST env ile override edilebilir (örn. sadece localhost'a kısıtlamak için 127.0.0.1).
const HOST = process.env.HOST || "0.0.0.0";

// =============================================================================
// TEK-PROCESS INVARIANT (load-bearing) — cluster/PM2-cluster/worker_threads YOK.
// Şu bellek-içi mekanizmalar buna BAĞLI ve 2. worker/replica eklenince SESSİZCE
// bozulur:
//   - presence (lib/presence.ts) → her process kendi Map'i (sayım parçalanır)
//   - feature-flag cache (system-setting.service.ts) → invalidate process-local
//   - archive-scheduler (jobs/archive-scheduler.ts) → lastRun check-then-act çift-arşiv
//   - backup-scheduler (jobs/backup-scheduler.ts) → aynı desen; 2. process aynı gece
//     ikinci bir pg_dump başlatır (in-process `running` bayrağı process-local)
// Yatay ölçeklenirse taşıma katmanı gerekir: presence/cache → Redis (pub/sub
// invalidation), scheduler → DB advisory lock veya ayrı tek worker. Bu varsayım
// LAN-only tek-sunucu kurulumda kasıtlıdır (ARCHITECTURE.md "Single-process").
//
// ⚠️ İKİ DİNLEYİCİ ≠ İKİ PROCESS (2026-09-01, uzaktan erişim). `REMOTE_PORT`
// verildiğinde AYNI `app` bir kez daha `listen` edilir (127.0.0.1). Bu invariantı
// BOZMAZ: yukarıdaki mekanizmaların hepsi PROCESS-local'dir (Map, cache, zamanlayıcı
// bayrağı) ve tek process içinde ikinci bir soket açmak onların hiçbirini
// çoğaltmaz. Bozulan şey ikinci bir NODE SÜRECİ olurdu — o hâlâ YASAK.
// =============================================================================

// Uzaktan erişim (Cloudflare Tunnel) dinleyicisi. `REMOTE_PORT` yoksa null.
const remoteAccess = readRemoteAccessConfig();

// Node süreç uyarıları YIĞIN İZİYLE log'a düşsün — Node'un kendi çıktısı
// "nereden geldiğini görmek için --trace-deprecation ile başlat" diyor ve o
// bayrak canlıda YENİDEN BAŞLATMA demek. Dinleyici erken kurulur ki açılış
// sırasındaki uyarılar da yakalansın. (bkz. lib/process-warnings.ts)
surecUyarilariniLogla();

// F29: BaseController mass-assignment koruması (sanitizeWriteData) Prisma DMMF'e
// bağlı — kaynağı çözülemezse fail-open olur. Boot'ta fail-CLOSED doğrula.
try {
    assertBaseServiceGuards();
} catch (err) {
    hata("boot", "BaseController koruma kapısı doğrulanamadı", err);
    process.exit(1);
}

/**
 * AUDIT DEĞİŞTİRİLEMEZLİK KORUMASI AÇIK MI (2026-08-19).
 *
 * Trigger her ortamda KURULUDUR ama koruma `teks.audit_guard` GUC'u ile açılır
 * ve o, migration'a DEĞİL ortama aittir (`ALTER DATABASE ... SET`, tıpkı
 * `statement_timeout` gibi). Bunun bedeli, unutulabilir bir ops adımıdır — ve
 * bu projede tam olarak bu sınıf adım bir kez unutuldu (2026-08-01 izin satırı,
 * teşhis saatler sürdü). Bu yüzden iki görünürlük yüzeyi var: açılışta bu uyarı
 * ve kalıcı olarak `/health` → `auditGuard`.
 *
 * ⚠️ Yalnız production'da uyarır: geliştirmede koruma BİLEREK kapalıdır (79 test
 * dosyası cleanup'ta audit satırı siler; `system_logs.userId → users` FK'sı
 * RESTRICT olduğu için mecburlar).
 */
async function warnIfAuditGuardDisabled(): Promise<void> {
    if (process.env.NODE_ENV !== "production") return;
    try {
        const rows = await prisma.$queryRaw<Array<{ guard: string | null }>>`
            SELECT coalesce(current_setting('teks.audit_guard', true), '') AS guard`;
        if (rows[0]?.guard !== "on") {
            uyari(
                "audit-guard",
                "⚠️ KORUMA KAPALI — audit kayıtları silinebilir/değiştirilebilir durumda.\n" +
                "             Açmak için (bir kez, sonra restart):\n" +
                "               ALTER DATABASE <db> SET teks.audit_guard = 'on';"
            );
        } else {
            bilgi("audit-guard", "koruma AÇIK — audit kayıtları salt-yazılır.");
        }
    } catch (err) {
        // Best-effort: bu kontrol yüzünden sunucu açılışı düşmez.
        uyari("audit-guard", "durum okunamadı", err);
    }
}

const server = app.listen(Number(PORT), HOST, () => {
    const lan = getLanAddresses();

    satir("");
    satir("========================================================");
    satir(`  TeksERP Backend ayakta  (port ${PORT}, host ${HOST})`);
    satir("--------------------------------------------------------");
    satir(`  Yerel  : http://localhost:${PORT}`);
    if (lan.length === 0) {
        satir("  Ağ     : (aktif LAN IPv4 adresi bulunamadı)");
    } else {
        for (const { iface, address } of lan) {
            satir(`  Ağ     : http://${address}:${PORT}   [${iface}]`);
        }
    }
    // ⚠️ Swagger satırı artık app.ts ile AYNI kaynaktan çözülür. Eskiden burada
    // düz `NODE_ENV !== "production"` yazıyordu; `SWAGGER_ENABLED=false` ile
    // kapatılan bir kurulumda banner var olmayan bir adresi duyururdu — küçük ama
    // teşhisi zaman yiyen bir yalan. Değişken yokken ifade birebir aynı sonucu verir.
    const hardening = readWebHardeningConfig();
    if (hardening.swaggerEnabled) {
        satir(`  Swagger: http://localhost:${PORT}/api-docs`);
    }
    // Sertleştirme yalnız BEYAN EDİLDİĞİNDE basılır — fabrika konsolu birebir
    // bugünkü gibi kalsın diye. Basıldığında da sessiz varsayım bırakmaz:
    // operatör hangi korumanın açık olduğunu tek bakışta görür (özellikle
    // "trust proxy" — yanlış ayarı ancak burada fark edilir).
    if (isWebHardeningDeclared()) {
        const rl = hardening.rateLimit;
        satir("--------------------------------------------------------");
        satir(`  Sertleştirme: trustProxy=${String(hardening.trustProxy ?? "(yok)")}`
            + ` · cors=${hardening.corsOrigins ? hardening.corsOrigins.join(",") : "(kısıtsız)"}`);
        satir(`                swagger=${hardening.swaggerEnabled ? "açık" : "kapalı"}`
            + ` · hsts=${hardening.httpsEnabled ? "açık" : "kapalı"}`
            + ` · girişKilidiKapsamı=${hardening.loginLockoutScope}`);
        satir(`                hızSınırı=${rl.enabled
            ? `açık (${rl.windowMs / 1000}sn · yazma ${rl.writeMax} · giriş ${rl.loginMax})`
            : "kapalı"}`);
    }
    if (remoteAccess.remotePort !== null) {
        satir("--------------------------------------------------------");
        satir(`  Uzaktan erişim: 127.0.0.1:${remoteAccess.remotePort} (cloudflared)`);
        if (remoteAccess.accessWallDisabled) {
            // ⚠️ Kapalı bir kimlik duvarı SESSİZ KALMAZ. Bu satır, "acaba Access
            // çalışıyor mu" sorusunun pm2 log'undan tek bakışta cevaplanabildiği
            // yerdir; aksi halde duvarın olmadığı bir kurulum, olduğu sanılan bir
            // kurulumdan ayırt edilemezdi.
            satir("                  Access: ⚠️ KAPALI (CF_ACCESS_ENABLED=false)");
            satir("                  → uzak girişi koruyan tek katman: parola + TOTP");
        } else {
            satir(`                  Access: ${remoteAccess.accessTeamDomain}`);
        }
    }
    satir("========================================================");
    satir("");

    startArchiveScheduler();
    startBackupScheduler();
    // ⚠️ AYRI ÇAĞRI — `startBackupScheduler` sahada erken döner
    // (BACKUP_SCHEDULE_ENABLED=false: gece yedeğini harici görev alıyor).
    // Süpürme oraya gömülseydi ihtiyaç duyulan tek ortamda hiç koşmazdı.
    startOffsiteSweeper();
    // İzin kataloğu uzlaştırması BOOT-TIME'dır çünkü tek alternatifi olan "elle SQL
    // / veri migration'ı yaz" adımı UNUTULABİLİR bir adımdır ve 2026-08-01'de fiilen
    // unutuldu (kurşun bypass ekranı canlıya çıktı, izin satırı olmadığı için Admin
    // dışı herkes 403 aldı, teşhis saatler sürdü). Burada koştuğunda denklem şu olur:
    // KODU DEPLOY ETMEK = KATALOGU GETİRMEK. Yalnız EKLER — hiçbir satırı silmez ya
    // da güncellemez, dolayısıyla kimsenin yetkisi sessizce düşmez. Best-effort:
    // başarısız olursa sunucuyu düşürmez, gürültülü loglar.
    startPermissionCatalogReconciler();
    // Kurulum kimliği — servis keşfinin "bu doğru sunucu mu" sorusunun cevabı.
    // İzin kataloğuyla aynı sınıf: ilk açılışta bir kez doğar, best-effort,
    // başarısız olsa bile sunucuyu düşürmez (yalnız keşif kimliksiz kalır).
    startInstallationIdentity();
    // SATICI (süperadmin) hesabı — bu satır hesap YARATMAZ (2026-09-03 P8: tek
    // doğuş yolu sunucuda elle koşulan `npm run superadmin:kur`). Yaptığı iş
    // "sistem hesabı var mı" kayıt defterini tazelemek: hesap YOKSA modül
    // anahtarı kapısı devre dışı kalır (emniyet supabı), yani bu satır olmadan
    // yeni bir kurulumda modülleri KİMSE açamazdı.
    startSuperadminAccount();
    // KURULUM PROFİLİ — taze kurulumda modül anahtarlarını `.env`deki
    // `TEKSERP_PROFIL` profilinden yazar. Mevcut kurulumda grandfathering
    // damgası (migration 20260902230000) EN AZ BİR anahtar getirdiği için job
    // "exists" der ve DOKUNMAZ — yüklem "7/7 satır" değil "hiç satır var mı"
    // (Dilim 1 kabul provası ölçtü: 7/7 arayan sürüm, fabrikada bilerek
    // yazılmamış `finance.enabled`i "eksik" sanıp profilden yazıyordu ve
    // `tam` profiliyle ön muhasebeyi sessizce açıyordu). Env verilmemişse
    // HİÇBİR ŞEY yazılmaz (yanlış profili kalıcı
    // damgalamamak için — bir kez yazıldı mı ikinci koşum dokunmaz).
    startModuleProfileJob();
    // Keşif ucunun bellek kopyası (firma adı + port). İstek yolunda DB'ye
    // gidilmediği için burada bir kez doldurulur; firma adı sonradan değişirse
    // bir sonraki restart'ta tazelenir (keşif için yeterli hassasiyet).
    void refreshDiscoveryCache(Number(PORT));
    // Servis ilanı — "ben buradayım". Her arızada sessizce kapanır (ilanın
    // kendisi de fail-open); istemcide alt ağ taraması yedeği var.
    void startMdnsAdvertiser({ port: Number(PORT) });
    void warnIfAuditGuardDisabled();
    // Varsayılan depo da aynı gerekçeyle boot-time uzlaştırılır (migration'a INSERT
    // gömmek uuid/adı taşa yazar). Bu satır olmadan `resolveTargetWarehouseId`
    // varsayılan bulamaz ve yeni toplar deposuz doğar.
    startDefaultWarehouseReconciler();
    // TCMB kur çekme: `finance.enabled` KAPALIYKEN tam no-op (dış HTTP denemesi
    // bile atmaz — üretici fabrika internetsiz; gerekçe jobs/exchange-rate.job.ts).
    startExchangeRateScheduler();

    void AuditService.logEvent({
        category: "SYSTEM",
        action: "STARTUP",
        payload: {
            port: Number(PORT),
            host: HOST,
            lanAddresses: lan.map((l) => l.address),
            env: process.env.APP_ENV ?? process.env.NODE_ENV ?? "development",
            nodeVersion: process.version,
        },
    });
});

/**
 * TÜNEL DİNLEYİCİSİ — YALNIZ `127.0.0.1`.
 *
 * ⚠️ HOST SABİT VE LOAD-BEARING. `0.0.0.0`a açılsaydı bu port LAN'dan da
 * erişilebilir olurdu ve `req.socket.localPort`e dayanan tüm uzak/LAN ayrımı
 * çökerdi: fabrikadaki herhangi biri `<lan-ip>:4001`e bağlanıp "uzak" sayılırdı
 * (ya da tersi — LAN'daki bir istemci kendini uzak gösterip Access JWT kapısına
 * takılırdı). `cloudflared` aynı makinede koştuğu için 127.0.0.1 yeterlidir.
 *
 * `HOST` env'i BİLEREK onurlandırılmaz — o LAN dinleyicisinin ayarıdır.
 */
const remoteServer =
  remoteAccess.remotePort === null
    ? null
    : app.listen(remoteAccess.remotePort, "127.0.0.1", () => {
        bilgi(
          "remote-access",
          `tünel dinleyicisi hazır: 127.0.0.1:${remoteAccess.remotePort}`,
        );
      });

// L (düşük bulgu): graceful shutdown — eskiden hiç handler yoktu, restart'ta
// (pm2 restart/deploy, Ctrl+C) uçuştaki istekler TCP düzeyinde kopuyordu.
// server.close() yeni bağlantıyı reddedip mevcut istekleri bitirir; 5s'de
// kapanmazsa zorla çıkılır (asılı keep-alive bağlantıları sonsuza dek bekletmesin).
let shuttingDown = false;
function gracefulShutdown(signal: string, exitCode = 0): void {
    if (shuttingDown) return;
    shuttingDown = true;
    satir("");
    bilgi("shutdown", `${signal} alındı — sunucu kapatılıyor (uçuştaki istekler bitiriliyor)...`);
    const forceTimer = setTimeout(() => {
        uyari("shutdown", "Kapanış 5s'de tamamlanmadı — zorla çıkılıyor.");
        process.exit(1);
    }, 5000);
    forceTimer.unref();
    // Son gecikme delta'ları kaybolmasın (dev'de nodemon her kayıtta restart eder!)
    // — 2sn tavanlı best-effort flush; başarısızlık kapanışı ASLA bloklamaz.
    //
    // mDNS ilanı AYNI 2sn'lik tavanın ALTINDA, flush ile PARALEL kapanır (sıralı
    // olsaydı iki bütçe toplanır ve yukarıdaki 5sn'lik zorla-çıkış sayacını
    // yakma riski doğardı). `stopMdnsAdvertiser` kendi içinde de 1sn kapı taşır
    // ve asla reject etmez — goodbye paketi gitmezse kapanış yine de ilerler.
    void Promise.race([
        Promise.allSettled([flushLatencyNow().catch(() => {}), stopMdnsAdvertiser()]),
        new Promise((resolve) => setTimeout(resolve, 2000).unref()),
    ]).finally(() => {
        // Tünel dinleyicisi ÖNCE kapanır: yeni uzak istek kabul edilmesin ama
        // LAN'daki uçuştaki istekler normal akışında bitsin.
        remoteServer?.close();
        server.close(() => {
            bilgi("shutdown", "Sunucu kapandı.");
            // O3-3: DB kaynaklarını temiz bırak (eski lib/prisma.ts shutdown handler'ından
            // TAŞINDI — çift handler F10 graceful shutdown'ı boşa çıkarıyordu). Sıra önemli:
            // önce $disconnect, sonra pool.end. Best-effort; üstteki 5s forceTimer güvenlik ağı korur.
            void (async () => {
                try {
                    await prisma.$disconnect();
                    await pool.end();
                } catch (err) {
                    hata("shutdown", "DB kapanış hatası", err);
                }
                process.exit(exitCode);
            })();
        });
    });
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
// pm2 + Windows: Windows'ta gerçek POSIX sinyali gönderilemez, bu yüzden pm2
// `shutdown_with_message: true` (ecosystem.config.js) ile IPC üzerinden "shutdown"
// mesajı yollar. Bu dinleyici OLMADAN `pm2 restart/stop` prosesi HARD KILL eder →
// yukarıdaki graceful shutdown hiç çalışmaz: uçuştaki istekler TCP düzeyinde kopar
// ve son gecikme delta'ları kaybolur.
process.on("message", (msg) => {
    if (msg === "shutdown") gracefulShutdown("pm2 shutdown");
});

// L (düşük bulgu, silent-failure): eskiden process-seviyesi hata yakalayıcı yoktu.
// Yakalanmamış bir promise reddi / senkron istisna, ana akışın dışında (timer,
// event handler, eksik await) süreci log bırakmadan düşürebiliyordu — "kim/ne
// patlattı" izi kaybolurdu. İkisini de best-effort SystemLog'a yaz (AuditService
// zaten yutar + /health auditWriteFailures'a düşer); fark POLİTİKADIR:
//   - unhandledRejection: süreç hâlâ tanımlı durumda → logla, AYAKTA KAL
//     (LAN-only tek-process; gereksiz restart vardiyayı keser).
//   - uncaughtException: süreç tanımsız/bozuk durumda olabilir → logla + temiz
//     kapan; süreç yöneticisi (pm2) otomatik yeniden başlatır.
process.on("unhandledRejection", (reason) => {
    hata("unhandled-rejection", "Yakalanmamış promise reddi", reason);
    void AuditService.logEvent({
        category: "SYSTEM",
        action: "UNHANDLED_REJECTION",
        payload: {
            reason: reason instanceof Error ? reason.message : String(reason),
            stack: reason instanceof Error ? reason.stack?.split("\n").slice(0, 8) : undefined,
        },
    });
});
process.on("uncaughtException", (err) => {
    hata("uncaught-exception", "Yakalanmamış istisna — süreç kapanıyor", err);
    // F12: crash izini (kim/ne patlattı) boşta senaryoda bile kaydet — audit
    // yazımını ~2sn tavanla BEKLE, sonra exitCode=1 ile kapan (pm2 crash'i
    // normal restart'tan ayırt edebilsin; forceTimer'ın
    // exit(1)'iyle de tutarlı).
    const auditDone = AuditService.logEvent({
        category: "SYSTEM",
        action: "UNCAUGHT_EXCEPTION",
        payload: { message: err.message, stack: err.stack?.split("\n").slice(0, 8) },
    }).catch(() => {});
    void Promise.race([
        auditDone,
        new Promise((resolve) => setTimeout(resolve, 2000).unref()),
    ]).finally(() => gracefulShutdown("uncaughtException", 1));
});
