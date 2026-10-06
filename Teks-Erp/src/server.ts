import "./lib/hizmet-duzeni-once"; // Windows hizmetinde .env yolunu kurar — dotenv'den ÖNCE (pm2/geliştirmede no-op)
import "dotenv/config"; // .env yükle — diğer tüm importlardan ÖNCE (JWT_SECRET vb. modül-load anında okunur)
import "./lib/hizmet-duzeni-sonra"; // Windows hizmetinde .env'de olmayan yolları doldurur — env okuyan modüllerden ÖNCE
import "./lib/zod-locale"; // Zod tr locale
import app from './app';
import prisma, { pool } from './lib/prisma';
import { getLanAddresses, partitionLanAddresses } from './lib/lan-addresses';
import { startInstallationIdentity } from './jobs/installation-identity.job';
import { startSuperadminAccount } from './jobs/superadmin.job';
import { startShortCredentialJob } from './jobs/short-credential.job';
import { flushLoginLockoutPersistence } from './middlewares/login-lockout';
import { startModuleProfileJob } from './jobs/module-profile.job';
import { warnStaleReportKeys } from './jobs/report-catalog.job';
import { refreshDiscoveryCache } from './services/discovery.service';
import { startMdnsAdvertiser, stopMdnsAdvertiser } from './jobs/mdns-advertiser.job';
import { startArchiveScheduler } from './jobs/archive-scheduler';
import { startBackupScheduler } from './jobs/backup-scheduler';
import { startOffsiteSweeper } from './jobs/offsite-sweeper';
import { startPermissionCatalogReconciler } from './jobs/permission-catalog.job';
import { startDefaultWarehouseReconciler } from './jobs/default-warehouse.job';
import { startExchangeRateScheduler } from './jobs/exchange-rate.job';
import { startShiftCalendarScheduler } from './jobs/shift-calendar.job';
import { startShiftCloseScheduler } from './jobs/machine-shift-close.job';
import { startLicensePoll, stopLicensePoll } from './jobs/license-poll.job';
import { startLicenseDoorbell, stopLicenseDoorbell } from './jobs/license-doorbell.job';
import { startPatronCloudJobs, stopPatronCloudJobs } from './jobs/patron-cloud.jobs';
import { initLicenseEngine } from './services/license.service';
import { preloadEncryptedModules } from './lib/license/encrypted-module-router';
import { AuditService } from './services/audit.service';
import { flushLatencyNow } from './services/latency-persist.service';
import { assertBaseServiceGuards } from './services/base.service';
import { logProcessWarnings } from './lib/process-warnings';
import { readWebHardeningConfig, isWebHardeningDeclared } from './middlewares/web-hardening';
import { hata, uyari, bilgi, satir } from "./lib/logger";
import type { Server } from "node:http";
import { bootFactoryTimezone } from "./services/factory-timezone.service";
import { shutdownChannel } from "./lib/hizmet-duzeni";
import { listenShutdownChannel } from "./lib/kapanis-kanali";
import { isVerificationMode } from "./lib/dogrulama-kipi";

const PORT = process.env.PORT || 4000;
// 0.0.0.0 = tüm ağ arayüzlerinden dinle (tablet/diğer cihazlar LAN üzerinden erişebilsin).
// HOST env ile override edilebilir (örn. sadece localhost'a kısıtlamak için 127.0.0.1).
// Doğrulama kipinde (güncelleyicinin `--dogrulama` başlatması) yalnız döngü adresi — `.env` bunu genişletemez.
const VERIFYING = isVerificationMode();
const HOST = VERIFYING ? "127.0.0.1" : process.env.HOST || "0.0.0.0";

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
// =============================================================================

// LİSANS DEPOSU dinlemeden ÖNCE ve SENKRON yüklenir: ilk istek geldiğinde kurulum anahtarı,
// HAK/kira ve proxy bellekte olsun. Hata sunucuyu düşürmez (motor gözlemde "ölçülemedi" kalır).
try {
    initLicenseEngine();
    // Faz 2d: şifreli pakette anahtarı olan modüller önceden yüklenir (geliştirmede kapı yok → no-op).
    preloadEncryptedModules();
} catch (err) {
    uyari("lisans", "lisans deposu yüklenemedi — motor ölçülemedi durumunda", err);
}

// Node süreç uyarıları YIĞIN İZİYLE log'a düşsün — Node'un kendi çıktısı
// "nereden geldiğini görmek için --trace-deprecation ile başlat" diyor ve o
// bayrak canlıda YENİDEN BAŞLATMA demek. Dinleyici erken kurulur ki açılış
// sırasındaki uyarılar da yakalansın. (bkz. lib/process-warnings.ts)
logProcessWarnings();

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

function startLanListener(): Server {
  return app.listen(Number(PORT), HOST, () => {
    const allLan = getLanAddresses();
    const lan = partitionLanAddresses(allLan);

    satir("");
    satir("========================================================");
    satir(`  TeksERP Backend ayakta  (port ${PORT}, host ${HOST})`);
    satir("--------------------------------------------------------");
    satir(`  Yerel  : http://localhost:${PORT}`);
    if (lan.usable.length === 0) {
        satir("  Ağ     : (aktif LAN IPv4 adresi bulunamadı)");
    } else {
        for (const { iface, address } of lan.usable) {
            satir(`  Ağ     : http://${address}:${PORT}   [${iface}]`);
        }
    }
    for (const { iface, address, reason } of lan.excluded) {
        const reasonText = reason === "link-local" ? "kendi kendine atanmış" : "sanal kart";
        satir(`  Duyurulmaz: ${address}   [${iface}] (${reasonText})`);
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
    if (VERIFYING) {
        satir("--------------------------------------------------------");
        satir("  DOĞRULAMA KİPİ: yalnız 127.0.0.1 — zamanlayıcılar ve dış bağlantılar başlatılmadı");
    }
    satir("========================================================");
    satir("");

    // ⚠️ Doğrulama kipinde zamanlayıcıyla tekrarlayan ya da dışarı konuşan işler BAŞLAMAZ (`lib/dogrulama-kipi.ts`).
    if (!VERIFYING) startArchiveScheduler();
    if (!VERIFYING) startBackupScheduler();
    // ⚠️ AYRI ÇAĞRI — `startBackupScheduler` sahada erken döner
    // (BACKUP_SCHEDULE_ENABLED=false: gece yedeğini harici görev alıyor).
    // Süpürme oraya gömülseydi ihtiyaç duyulan tek ortamda hiç koşmazdı.
    if (!VERIFYING) startOffsiteSweeper();
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
    // Kısa kimlik (PIN/kart) anahtar halkası + yedek emaneti + düz/uyuşmayan uyarısı. Veri DÖNÜŞTÜRMEZ.
    startShortCredentialJob();
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
    // Kapalı rapor listesindeki BAYAT anahtarlar (katalogdan çıkmış rapor) ve bozuk
    // satır boot'ta TEK SEFER duyurulur; job yazmaz — liste temizliği süperadmin kararı.
    void warnStaleReportKeys();
    // Keşif ucunun port kopyası; firma adı istek anında bellekteki lisanstan okunur.
    refreshDiscoveryCache(Number(PORT));
    // Servis ilanı — "ben buradayım". Her arızada sessizce kapanır (ilanın
    // kendisi de fail-open); istemcide alt ağ taraması yedeği var.
    if (!VERIFYING) void startMdnsAdvertiser({ port: Number(PORT) });
    void warnIfAuditGuardDisabled();
    // Varsayılan depo da aynı gerekçeyle boot-time uzlaştırılır (migration'a INSERT
    // gömmek uuid/adı taşa yazar). Bu satır olmadan `resolveTargetWarehouseId`
    // varsayılan bulamaz ve yeni toplar deposuz doğar.
    startDefaultWarehouseReconciler();
    // TCMB kur çekme: `finance.enabled` KAPALIYKEN tam no-op (dış HTTP denemesi
    // bile atmaz — üretici fabrika internetsiz; gerekçe jobs/exchange-rate.job.ts).
    if (!VERIFYING) startExchangeRateScheduler();
    // Vardiya takvimi: `dokuma.enabled` KAPALIYKEN tam no-op — referans fabrikada
    // `shift_instances` satırı doğmaz (gerekçe jobs/shift-calendar.job.ts).
    if (!VERIFYING) startShiftCalendarScheduler();
    // Kapanan vardiya × tezgah karnesi (M2) — aynı bayrak, aynı sıfır fark.
    if (!VERIFYING) startShiftCloseScheduler();
    // Lisans yoklaması + kapı zili: kurulum etkinleşmemişse ya da satıcı adresi kapalıysa
    // (`LICENSE_SERVER_URL=kapali`) DIŞARI HİÇ İSTEK ATILMAZ; motor gözlem kipinde (hiçbir istek engellenmez).
    // Doğrulama kipinde motor yalnız YEREL ölçümü koşar (bütünlük dahil — `/health/yerel`in `lisans`ı), yoklamaz.
    startLicensePoll();
    if (!VERIFYING) startLicenseDoorbell();
    // Patron bulutu (eşitleme + gelen kutusu): yalnız ÜRETİM sınıfı + `patron-bulut` hakkı + kiradaki
    // aralık varken dışarı çıkar (fail-closed); aksi hâlde tek işi günlük işaret budamasıdır.
    if (!VERIFYING) startPatronCloudJobs();

    void AuditService.logEvent({
        category: "SYSTEM",
        action: "STARTUP",
        payload: {
            port: Number(PORT),
            host: HOST,
            lanAddresses: allLan.map((l) => l.address),
            env: process.env.APP_ENV ?? process.env.NODE_ENV ?? "development",
            nodeVersion: process.version,
            dogrulamaKipi: VERIFYING,
        },
    });
});
}

// Fabrika saat dilimi dinleyiciden ÖNCE yüklenir: ilk istek de ilk zamanlayıcı da doğru günü görür.
// Geçersiz kayıtlı dilim → varsayılanla açılır + sağlık/panel uyarısı; DB'ye ulaşılamazsa bugünkü gibi açılır.
let lanListener: Server | null = null;
void bootFactoryTimezone({
  info: (m) => bilgi("saat-dilimi", m),
  warn: (m, e) => uyari("saat-dilimi", m, e),
}).then(
  () => {
    lanListener = startLanListener();
  },
  (err: unknown) => {
    hata("saat-dilimi", err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);

// L (düşük bulgu): graceful shutdown — eskiden hiç handler yoktu, restart'ta
// (pm2 restart/deploy, Ctrl+C) uçuştaki istekler TCP düzeyinde kopuyordu.
// server.close() yeni bağlantıyı reddedip mevcut istekleri bitirir; 5s'de
// kapanmazsa zorla çıkılır (asılı keep-alive bağlantıları sonsuza dek bekletmesin).
let shuttingDown = false;
function gracefulShutdown(signal: string, exitCode = 0): void {
    if (shuttingDown) return;
    shuttingDown = true;
    const server = lanListener;
    if (!server) {
        // Dinleyici henüz açılmadı (saat dilimi yükleniyor) — boşaltılacak istek yok.
        process.exit(exitCode);
        return;
    }
    satir("");
    bilgi("shutdown", `${signal} alındı — sunucu kapatılıyor (uçuştaki istekler bitiriliyor)...`);
    // ⚠️ TEŞHİS (2026-09-10): zorla-çıkış eskiden TEK cümle basıyordu ve sebep
    // hiçbir yerde kalmıyordu — sahada 5 kapanışın 2'si böyle bitti (2026-09-07)
    // ve log'dan hangi adımda takıldığı ÇIKARILAMADI. Erişim log'u isteği yalnız
    // BİTTİĞİNDE yazar, yani asılı bir istek hiç iz bırakmaz; faz + açık bağlantı
    // sayısı o körlüğü kapatan iki sayıdır (bağlantı > 0 ise asılı istek, 0 ise
    // zincir fazın kendisinde durmuş).
    let shutdownPhase = "sinyal alındı";
    const forceTimer = setTimeout(() => {
        const bailOut = (connectionNote: string): void => {
            uyari(
                "shutdown",
                `Kapanış 5s'de tamamlanmadı — zorla çıkılıyor. Faz: ${shutdownPhase}${connectionNote}`,
            );
            process.exit(1);
        };
        // `getConnections` geri çağrısı da gelmeyebilir (kapanan dinleyici) —
        // 250ms sonra sayı OLMADAN çıkılır; teşhis için faz tek başına da değerli.
        setTimeout(() => bailOut(""), 250).unref();
        server.getConnections((_err, count) => bailOut(`, açık bağlantı: ${count}`));
    }, 5000);
    forceTimer.unref();
    // Son gecikme delta'ları kaybolmasın (dev'de nodemon her kayıtta restart eder!)
    // — 2sn tavanlı best-effort flush; başarısızlık kapanışı ASLA bloklamaz.
    //
    // mDNS ilanı AYNI 2sn'lik tavanın ALTINDA, flush ile PARALEL kapanır (sıralı
    // olsaydı iki bütçe toplanır ve yukarıdaki 5sn'lik zorla-çıkış sayacını
    // yakma riski doğardı). `stopMdnsAdvertiser` kendi içinde de 1sn kapı taşır
    // ve asla reject etmez — goodbye paketi gitmezse kapanış yine de ilerler.
    // Zil akışı kesilir, lisans birikimi diske yazılır (senkron, kısa).
    shutdownPhase = "lisans";
    try {
        stopPatronCloudJobs();
        stopLicenseDoorbell();
        stopLicensePoll();
    } catch (err) {
        uyari("shutdown", "lisans kapanışı tamamlanamadı", err);
    }
    shutdownPhase = "gecikme flush + mDNS";
    void Promise.race([
        Promise.allSettled([
            flushLatencyNow().catch(() => {}),
            stopMdnsAdvertiser(),
            flushLoginLockoutPersistence().catch(() => {}),
        ]),
        new Promise((resolve) => setTimeout(resolve, 2000).unref()),
    ]).finally(() => {
        shutdownPhase = "dinleyiciler kapatılıyor";
        server.close(() => {
            shutdownPhase = "DB kapatılıyor";
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
        shutdownPhase = "uçuştaki istekler bekleniyor";
    });
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
// Windows konsolunda Ctrl+Break: dinleyici yoksa Node süreci ANINDA öldürür (uçuştaki istek kopar).
process.on("SIGBREAK", () => gracefulShutdown("SIGBREAK"));
// Windows hizmet konağı (`TEKSERP_KAPANIS=stdin`): `kapat` satırı ya da boru kapanışı. Konak
// ölünce boru da kapanır — yetim backend portu tutup ikinci süreci doğurmaz (tek-process).
{
    const shutdown = shutdownChannel(process.env);
    if (shutdown.channel === "stdin") {
        listenShutdownChannel(process.stdin, (reason) => gracefulShutdown(reason));
    } else if (shutdown.unknown) {
        uyari("shutdown", `TEKSERP_KAPANIS='${shutdown.unknown}' tanınmıyor — kapanış kanalı açılmadı (konak zorla durdurur)`);
    }
}
// pm2 düzeni (hizmete geçene dek): Windows'ta gerçek POSIX sinyali gönderilemez, bu yüzden pm2
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
//     kapan; süreç yöneticisi (pm2 ya da hizmette SCM kurtarma eylemi) yeniden başlatır.
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
