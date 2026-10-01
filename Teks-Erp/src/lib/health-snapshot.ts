// Sağlık anlık görüntüsü — `/api/admin/health` zengin yükü ve lisans yoklamasının
// ALLOWLIST'li sağlık özeti tek yerden. `app.ts`'ten ayrıldı: yoklama işi bunu içe
// aktarınca döngü doğmasın (app → routes → service → app).
// ⚠️ Public `/health` alan kümesi DONMUŞTUR ve `app.ts`'te kalır; buraya eklenen alan
// yalnız kimlikli yüzeylere gider. Yoklama özeti ayrıca protokolün KATI şemasından geçer.
import { shortCredentialHealthSnapshot } from "../services/short-credential.service";
import fs from "fs";
import os from "os";
import path from "path";
import { monitorEventLoopDelay } from "perf_hooks";
import prisma from "./prisma";
import { APP_VERSION } from "./app-version";
import { readAppDiskMetrics } from "./disk-metrics";
import { getPoolHealth } from "./pool-health";
import { getPresence } from "./presence";
import { readUnvalidatedConstraints } from "./constraint-health";
import { getMdnsState } from "../jobs/mdns-advertiser.job";
import { getCachedInstallationIdentity } from "../jobs/installation-identity.job";
import { AuditService } from "../services/audit.service";
import { getOffsiteHealth } from "../services/helpers/offsite-backup.helper";
import { isBackupFileName, NIGHTLY_PREFIX } from "../services/helpers/backup-naming.helper";
import { seriesExhaustionWarnings } from "../services/helpers/series-exhaustion.helper";
import { masterDataArchiveHealthSnapshot } from "../services/helpers/master-data-health.helper";
import { licenseHealthBlock } from "./license/license-health";
import { compareBackupCryptoIntent, type BackupCryptoIntent } from "./backup-crypto/intent";
import { factoryTimezoneWarning, getFactoryTimezone } from "../constants/time";

// Yedek klasörü: BACKUP_DIR üretimde pm2 ortamından gelir (ecosystem.config env
// veya .env — tipik değer C:\ProgramData\TeksERP\backups). Tanımlıysa durum sayfası
// son yedek zamanını gösterir. Dev ortamında tanımsızdır → son yedek alanı null
// döner. DİKKAT: tanımsız kalırsa yedek listesi ve "son yedek" SESSİZCE boş döner.
const backupDir = process.env.BACKUP_DIR;

// Son yedeğin (.dump) adını ve zamanını döndürür. Klasör yoksa/erişilemezse null.
// PERF: /health 5sn'de bir, çok istemciyle yoklanıyor. Bu fonksiyon her çağrıda
// fs.readdirSync + dosya-başına fs.statSync yapıyordu → 50+ eski .dump dosyasında
// event loop'u 10-50ms bloklar (eş zamanlı isteklerde "donuk" hissi). Yedekler
// yavaş değişir (~günlük) → diskCache ile aynı 30sn TTL cache yeterli. null geçerli
// bir sonuç olduğundan bayatlığı değerle değil ayrı zaman damgasıyla izleriz.
let backupCache: { name: string; time: string } | null = null;
let nightlyCache: { name: string; time: string } | null = null;
let backupCacheComputedAt = 0;
const BACKUP_CACHE_MS = 30_000;

/**
 * ⚠️ "EN YENİ YEDEK" İLE "GECE YEDEĞİ" AYNI ŞEY DEĞİL (BULGU-T1-024).
 *
 * Klasörde üç yaşam döngüsü bir arada durur (`backup-naming.helper.ts`):
 *   `tekserp_`     → planlı gece yedeği + panelden elle alınan  → BAYATLIK BUNDAN ÖLÇÜLÜR
 *   `premigrate_`  → deploy öncesi geri dönüş noktası
 *   `pre-restore_` → geri yükleme öncesi güvenlik yedeği
 * Eski kod en yeni `.dump`'ı ayrım yapmadan alıyordu; bir deploy `premigrate_`
 * yazdığı anda "son yedek" TAZE görünüyordu — gece yedeği günlerdir düşse bile.
 * Yani sayacı sıfırlayan şey, tam da yedeğin en çok gerektiği an (sürüm geçişi)
 * oluyordu. Ölçüm: sahada 40 günlük defterde tek bir gece yedeği kaydı var.
 */
function scanBackups(): void {
  const now = Date.now();
  if (backupCacheComputedAt > 0 && now - backupCacheComputedAt < BACKUP_CACHE_MS) return;
  backupCacheComputedAt = now;
  if (!backupDir) {
    backupCache = null;
    nightlyCache = null;
    return;
  }
  try {
    let newest: { name: string; mtimeMs: number } | null = null;
    let newestNightly: { name: string; mtimeMs: number } | null = null;
    for (const f of fs.readdirSync(backupDir)) {
      if (!isBackupFileName(f)) continue; // düz .dump + şifreli .dump.tkenc; .part görünmez
      const st = fs.statSync(path.join(backupDir, f));
      if (!newest || st.mtimeMs > newest.mtimeMs) newest = { name: f, mtimeMs: st.mtimeMs };
      if (f.startsWith(NIGHTLY_PREFIX) && (!newestNightly || st.mtimeMs > newestNightly.mtimeMs)) {
        newestNightly = { name: f, mtimeMs: st.mtimeMs };
      }
    }
    const bicim = (x: { name: string; mtimeMs: number } | null): { name: string; time: string } | null =>
      x ? { name: x.name, time: new Date(x.mtimeMs).toISOString() } : null;
    backupCache = bicim(newest);
    nightlyCache = bicim(newestNightly);
  } catch {
    // Erişilemezse de cache'le — her 5sn'de tekrar deneyip bloklamasın.
    backupCache = null;
    nightlyCache = null;
  }
}

function latestBackupInfo(): { name: string; time: string } | null {
  scanBackups();
  return backupCache;
}

/**
 * Gece yedeğinin HÜKMÜ — ham veri değil karar.
 *
 * Sinyal zaten üretiliyordu (`lastBackup`), eksik olan onu bir hükme bağlayan ve
 * bir alıcıya veren katmandı: panelde yalnız tarih yazıyordu, "bu tarih kötü mü"
 * sorusunu kimse sormuyordu. Üç durum + yapılandırılmamış:
 *   ok      ≤ 26 sa  (24 sa + zamanlayıcı sapması payı)
 *   uyari   ≤ 50 sa  (bir gece atlandı — henüz felaket değil, ama bakılmalı)
 *   kritik  > 50 sa ya da HİÇ gece yedeği yok
 */
const NIGHTLY_OK_HOURS = 26;
const NIGHTLY_WARN_HOURS = 50;
/**
 * Gece yedeğinin SAHİBİ — "backend" mi "harici" (Windows Görev Zamanlayıcı) mı?
 *
 * ⚠️ İKİSİ DE MEŞRU, bu bir alarm DEĞİL bir OLGUdur: sahadaki sunucuda yedeği
 * bilerek harici görev alıyor (`BACKUP_SCHEDULE_ENABLED=false`) — backend
 * çökmüşken bile yedek alınsın diye; ikisi birden açık kalırsa her gece İKİ dump
 * alınır (kök CLAUDE.md, 2026-07-31).
 *
 * Neden görünür olması gerekiyor (BULGU-T1-020): bu değer `ecosystem.config.js`te
 * yaşıyor. `kur.ps1` artık o dosyayı KORUYOR (2026-08-29, `560f74f0`) ama iki yol
 * hâlâ açık: pakette gelen YENİ anahtar elle eklenmezse özellik sessizce kapalı
 * kalır, ve sunucuda dosya hiç yoksa paketin repo varsayılanları geçerli olur.
 * Ayrışmanın gerçek olduğu ölçüldü (2026-08-31): repo dosyası `"false"` derken
 * canlı sistem 2026-08-25 03:05'te `trigger=nightly` bir yedek üretmiş. Sahip
 * bilgisi yaş hükmünün YANINDA durursa "kimse yedek almıyor" tek bakışta görünür.
 */
export function backupScheduler(): "backend" | "harici" {
  return process.env.BACKUP_SCHEDULE_ENABLED === "false" ? "harici" : "backend";
}

export function backupHealth(): {
  verdict: "ok" | "uyari" | "kritik" | "yapilandirilmamis";
  nightly: { name: string; time: string } | null;
  ageHours: number | null;
  scheduler: "backend" | "harici";
  reason: string;
} {
  if (!backupDir) {
    return {
      verdict: "yapilandirilmamis",
      nightly: null,
      ageHours: null,
      scheduler: backupScheduler(),
      reason: "BACKUP_DIR tanımlı değil — bu kurulumda yedek alınmıyor.",
    };
  }
  scanBackups();
  if (!nightlyCache) {
    return {
      verdict: "kritik",
      nightly: null,
      ageHours: null,
      scheduler: backupScheduler(),
      reason: `Yedek klasöründe hiç '${NIGHTLY_PREFIX}' yedeği yok (deploy/geri-yükleme yedekleri sayılmaz).`,
    };
  }
  const yasSaat = (Date.now() - new Date(nightlyCache.time).getTime()) / 3_600_000;
  const yuvarlak = Math.round(yasSaat * 10) / 10;
  const verdict = yasSaat <= NIGHTLY_OK_HOURS ? "ok" : yasSaat <= NIGHTLY_WARN_HOURS ? "uyari" : "kritik";
  return {
    verdict,
    nightly: nightlyCache,
    ageHours: yuvarlak,
    scheduler: backupScheduler(),
    reason:
      verdict === "ok"
        ? `Son gece yedeği ${yuvarlak} saat önce.`
        : verdict === "uyari"
          ? `Son gece yedeği ${yuvarlak} saat önce — bir gece atlanmış olabilir.`
          : `Son gece yedeği ${yuvarlak} saat önce — gece yedeği ÇALIŞMIYOR.`,
  };
}

// Yedek şifreleme niyeti: backend ile gece görevi aynı kararı mı veriyor (D13). Disk okur;
// uç 5 sn'de bir sorulduğu için yedek taramasıyla aynı 30 sn önbellek.
let cryptoIntentCache: { at: number; value: BackupCryptoIntent } | null = null;
function backupCryptoIntent(): BackupCryptoIntent {
  const now = Date.now();
  if (!cryptoIntentCache || now - cryptoIntentCache.at >= BACKUP_CACHE_MS) {
    cryptoIntentCache = { at: now, value: compareBackupCryptoIntent() };
  }
  return cryptoIntentCache.value;
}

// =============================================================================
// Kaynak (CPU/RAM) ölçümü — backend prosesi + makinenin geneli
// =============================================================================
// `process.cpuUsage()` ve `os.cpus()` BİRİKİMLİ değer verir (process başından
// beri toplam mikrosaniye / tick). "Anlık %" için iki ölçüm arası FARK gerekir.
// Son örneği modül seviyesinde tutar, her /health çağrısında delta alırız —
// durum sayfası 5sn'de bir yokladığı için pencere ~5sn olur. İlk çağrıdaki
// pencere process başlangıcına kadar uzanır (yine de geçerli bir ortalama).
// Windows NOT: `os.loadavg()` Windows'ta her zaman [0,0,0] döner → KULLANMIYORUZ;
// makine CPU%'sini os.cpus() idle/total delta'sından hesaplarız (Windows'ta çalışır).

function sampleSysCpu(): { idle: number; total: number; cores: number } {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total, cores: cpus.length || 1 };
}

// Baz örnekler (modül yüklenirken). İlk /health çağrısında bunlara göre delta alınır.
let lastProcCpu = process.cpuUsage(); // {user, system} — mikrosaniye
let lastCpuSampleNs = process.hrtime.bigint();
let lastSysCpu = sampleSysCpu();

// Event loop gecikmesi — native histogram. SÜREKLI çalışır ama tick başına JS işi
// YOK (libuv seviyesinde ölçer), maliyet ihmal edilebilir. Lag yükselirse uygulama
// "donuk" hisseder; operatör şikayetinden önce yakalanır. Her okumada reset →
// değer son ~5sn'lik pencereyi yansıtır (ömür-boyu ortalama değil).
const eventLoopMonitor = monitorEventLoopDelay({ resolution: 20 });
eventLoopMonitor.enable();

// Disk: fs.statfs ucuz bir syscall ama disk hızlı değişmez → yol başına 30sn
// cache. Çok sayıda istemci 5sn'de bir yoklasa bile statfs en fazla 30sn'de bir
// çalışır. Mantık `lib/disk-metrics.ts`'e taşındı — geri yükleme kopyası akışı da
// disk ölçmek zorunda (PGDATA volume'ünü doldurmak canlı DB'yi durdurur).
// DB verisi + yedekler kurulumda aynı sürücüde (ProgramData/AppDir) → cwd ölçülür.

function readResourceMetrics() {
  // --- Backend prosesinin CPU%'si (makinenin TÜM kapasitesine oranla, 0-100) ---
  const nowNs = process.hrtime.bigint();
  const curProcCpu = process.cpuUsage();
  const elapsedMicros = Number(nowNs - lastCpuSampleNs) / 1000; // ns → µs
  const procCpuMicros =
    curProcCpu.user - lastProcCpu.user + (curProcCpu.system - lastProcCpu.system);
  const sys = sampleSysCpu();
  const cores = sys.cores;
  let procCpuPct: number | null = null;
  if (elapsedMicros > 0) {
    // procCpuMicros / (geçen süre × çekirdek) → tek çekirdeği değil tüm makineyi baz alır
    const pct = (procCpuMicros / (elapsedMicros * cores)) * 100;
    procCpuPct = Math.round(Math.min(100, Math.max(0, pct)) * 10) / 10;
  }
  lastProcCpu = curProcCpu;
  lastCpuSampleNs = nowNs;

  // --- Makine geneli CPU%'si (tüm prosesler dahil) ---
  const idleDelta = sys.idle - lastSysCpu.idle;
  const totalDelta = sys.total - lastSysCpu.total;
  let sysCpuPct: number | null = null;
  if (totalDelta > 0) {
    const pct = (1 - idleDelta / totalDelta) * 100;
    sysCpuPct = Math.round(Math.min(100, Math.max(0, pct)) * 10) / 10;
  }
  lastSysCpu = sys;

  const mem = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  // Event loop ortalama gecikmesi (ms) — okuyup sıfırla (pencere = son poll arası).
  const eventLoopLagMs = Math.round((eventLoopMonitor.mean / 1e6) * 10) / 10;
  eventLoopMonitor.reset();

  return {
    cpuCores: cores,
    procRssBytes: mem.rss, // backend prosesinin tuttuğu fiziksel RAM
    procHeapUsedBytes: mem.heapUsed,
    procHeapTotalBytes: mem.heapTotal,
    procCpuPct, // backend'in kendi CPU yüzdesi (null = ilk örnek alınamadı)
    sysCpuPct, // makinenin geneli (backend + PostgreSQL + her şey)
    sysTotalMemBytes: totalMem,
    sysFreeMemBytes: freeMem,
    sysUsedMemBytes: totalMem - freeMem,
    eventLoopLagMs, // backend yanıt verme gecikmesi (yüksek = donuk hisseder)
  };
}

export async function buildRichHealth(): Promise<Record<string, unknown>> {
  // NUMARA SERİSİ TÜKENMESİ — yalnız UYARI ÜRETENLER (boş dizi = sorun yok).
  // ⚠️ Sınırı olmayan seri DB'ye hiç gitmez; bugün bu, `roll` dışında hepsi
  // demek. Eşik ve hesap TEK helper'da; panel satırı da onu okur.
  // ⚠️ ÜÇ SONUÇ: `[]` = uyarı YOK · dolu dizi = uyarı VAR · `null` = OKUNAMADI.
  // Hatayı boş diziye indirgemek, DB düştüğünde sahte bir "her şey yolunda"
  // üretirdi — `auditGuard` alanının birebir gerekçesi.
  let numberSeriesExhaustion: unknown[] | null = null;
  try {
    numberSeriesExhaustion = await seriesExhaustionWarnings();
  } catch {
    numberSeriesExhaustion = null;
  }
  let db: "UP" | "DOWN" = "DOWN";
  let dbSizeBytes: number | null = null;
  let dbConnections: number | null = null;
  let cacheHitPct: number | null = null;
  let rollsDeadPct: number | null = null;
  let longestQuerySec: number | null = null;
  let dbBlockedCount: number | null = null;
  let restoreCopyCount: number | null = null;
  let restoreCopyBytes: number | null = null;
  // DB okunamazsa null kalır — "kapalı" DEMEK DEĞİL, "bilinmiyor". İkisini
  // aynı değere indirgemek, DB düştüğünde sahte bir "koruma kapalı" alarmı üretirdi.
  let auditGuard: "on" | "off" | null = null;
  // Validate edilmemiş (NOT VALID) kısıtlar — `[]` yok · ad listesi var · `null` okunamadı.
  // Migration ihlalli eski satır bulunca kısıtı NOT VALID bırakır (ör. `swatches_status_shape`);
  // o hâl sessiz kalmasın diye burada.
  let unvalidatedConstraints: string[] | null = null;
  try {
    unvalidatedConstraints = await readUnvalidatedConstraints();
  } catch {
    unvalidatedConstraints = null;
  }
  try {
    // Tek round-trip: DB canlılığı + boyut + bağlantı + ucuz sağlık metrikleri
    // (cache isabeti, rolls ölü-satır oranı, en uzun aktif sorgu süresi). Hepsi
    // in-memory stat view'lerden — TABLO TARAMASI YOK, 5sn poll'e güvenli. Ağır
    // bloat/index teşhisi scripts/index-health.sql'de (talep üzerine çalışır).
    const rows = await prisma.$queryRaw<
      Array<{
        size: bigint;
        conns: bigint;
        cache_hit: number | null;
        rolls_dead: number | null;
        longest_sec: number | null;
        blocked: bigint;
        copy_count: bigint;
        copy_bytes: bigint;
        audit_guard: string | null;
      }>
    >`
      SELECT pg_database_size(current_database()) AS size,
             -- Audit değiştirilemezlik koruması AÇIK MI (2026-08-19). Koruma
             -- ortama özgü bir ops adımıyla açılır (ALTER DATABASE ... SET),
             -- yani UNUTULABİLİR — ve unutulduğunda hiçbir yerde görünmezdi.
             -- Tek atımlık boot uyarısı yerine kalıcı yüzey: bu satır.
             -- (Şablon içinde backtick YOK: JS template literal'ını böler.)
             coalesce(current_setting('teks.audit_guard', true), '') AS audit_guard,
             -- Unutulmuş geri yükleme kopyaları disk yer: ServerStatus'un mevcut
             -- 5sn poll'unda görünsün diye buraya eklendi (yeni round-trip YOK).
             (SELECT count(*) FROM pg_database
               WHERE datname LIKE current_database() || '\_restore\_%') AS copy_count,
             (SELECT COALESCE(sum(pg_database_size(datname)), 0) FROM pg_database
               WHERE datname LIKE current_database() || '\_restore\_%') AS copy_bytes,
             (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS conns,
             (SELECT round(100.0 * sum(blks_hit) / NULLIF(sum(blks_hit + blks_read), 0), 1)
                FROM pg_stat_database WHERE datname = current_database())::float8 AS cache_hit,
             (SELECT round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 1)
                FROM pg_stat_user_tables WHERE relname = 'rolls')::float8 AS rolls_dead,
             -- tz-ok: query_start (pg_stat_activity) timestamptz; iki timestamptz
             -- çıkarılıyor, tz'siz kolona yazım/karşılaştırma yok.
             -- clock_timestamp() de bilinçli: tx başlangıcı değil ŞU AN gerekli
             -- (en uzun süren sorgunun anlık yaşı ölçülüyor).
             (SELECT COALESCE(max(extract(epoch FROM (clock_timestamp() - query_start))), 0)
                FROM pg_stat_activity
                WHERE datname = current_database() AND state = 'active'
                  AND backend_type = 'client backend'
                  AND query NOT ILIKE '%pg_stat_activity%')::float8 AS longest_sec,
             (SELECT count(*) FROM pg_stat_activity
                WHERE datname = current_database() AND wait_event_type = 'Lock') AS blocked`;
    db = "UP";
    if (rows && rows[0]) {
      dbSizeBytes = Number(rows[0].size);
      dbConnections = Number(rows[0].conns);
      cacheHitPct = rows[0].cache_hit != null ? Number(rows[0].cache_hit) : null;
      rollsDeadPct = rows[0].rolls_dead != null ? Number(rows[0].rolls_dead) : null;
      longestQuerySec =
        rows[0].longest_sec != null ? Math.round(Number(rows[0].longest_sec)) : null;
      dbBlockedCount = Number(rows[0].blocked);
      restoreCopyCount = Number(rows[0].copy_count);
      restoreCopyBytes = Number(rows[0].copy_bytes);
      auditGuard = rows[0].audit_guard === "on" ? "on" : "off";
    }
  } catch {
    db = "DOWN";
  }
  // Audit yazım sağlığı — best-effort log'lar sessizce düşerse burada görünür.
  const auditHealth = AuditService.getHealth();
  return {
    status: "UP",
    message: "TeksERP API is running.",
    api: "UP",
    db,
    version: APP_VERSION,
    time: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime()),
    dbSizeBytes,
    dbConnections,
    cacheHitPct,
    rollsDeadPct,
    longestQuerySec,
    dbBlockedCount, // lock bekleyen oturum sayısı (>0 = bir şey takılmış olabilir)
    restoreCopyCount, // unutulmuş geri yükleme kopyası sayısı
    restoreCopyBytes, // bu kopyaların toplam disk kullanımı
    // Numara serisi tükenmesi: `[]` uyarı yok · dolu uyarı var · `null` okunamadı.
    numberSeriesExhaustion,
    // Pasif ana veride canlı referans (URUN-YASAM-DONGUSU §10): `total` beklenen 0 · `null` ölçülemedi.
    // Ölçüm 10 dk önbellekli (bu uç 5 sn'de bir sorulur); `stale` = arkada tazeleniyor.
    masterDataArchive: masterDataArchiveHealthSnapshot(),
    // Fabrika saat dilimi: `warning` null değilse kayıtlı değer geçersiz ve sunucu `active` ile koşuyor
    // (kod FACTORY_TIMEZONE_INVALID_STORED; düzeltme Şirket Bilgileri → Saat dilimi). Bellek içi, sorgusuz.
    factoryTimezone: { active: getFactoryTimezone(), warning: factoryTimezoneWarning() },
    // Validate edilmemiş DB kısıtı: `[]` beklenen · dolu = eski veri ihlalde (kuru script adı NOTICE'ta) · `null` okunamadı.
    unvalidatedConstraints,
    lastBackup: latestBackupInfo(),
    // Ham veri değil HÜKÜM: "gece yedeği çalışıyor mu". `lastBackup` bilerek
    // olduğu gibi bırakıldı (eski panel sözleşmesi), bu alan EK'tir.
    backupHealth: backupHealth(),
    // Şifreleme niyeti ayrışması: `warning` null değilse bir taraf düz döküm üretiyor.
    backupCryptoIntent: backupCryptoIntent(),
    // Kısa kimlikler (PIN/kart): düz kalan · anahtarı uyuşmayan · emaneti eksik. Değer TAŞIMAZ;
    // 60 sn önbellekli, `status: null` = ölçülemedi.
    shortCredentials: shortCredentialHealthSnapshot(),
    // Havuzun KENDİ durumu + kümülatif zaman aşımı sayacı. Yukarıdaki
    // `dbConnections` `pg_stat_activity` sayımıdır → SUNUCU tarafını sayar
    // (psql/pgAdmin/pg_dump dahil), idle/busy ayırt etmez ve havuzun kaç bağlantı
    // tuttuğunu / KİMİN BEKLEDİĞİNİ bilmez. Havuz doygunluğu yalnız burada görünür.
    // Senkron getter (SORGU YOK) ve try/catch DIŞINDA → DB DOWN iken de doğru
    // değer döner; havuz durumu tam o anda en çok gereken şeydir.
    ...getPoolHealth(),
    // Felaket kurtarma kapsamı — 'yedek var mı' ile 'yedek BAŞKA YERDE var mı'
    // ayrı sorulardır; ikincisi 2026-08-10'a kadar hiçbir yüzeyde görünmüyordu.
    ...(await getOffsiteHealth()),
    // Disk doluluğu (DB + yedeklerin bulunduğu sürücü) — 30sn cache
    ...readAppDiskMetrics(),
    // Anlık online kullanıcı + bağlı cihaz (bellekte, son 5 dk)
    ...getPresence(),
    // Audit kaybı izleme (0 = sağlıklı; >0 ise log yazımı başarısız oluyor)
    auditWriteFailures: auditHealth.failureCount,
    lastAuditError: auditHealth.lastError,
    lastAuditFailureAt: auditHealth.lastFailureAt,
    // Audit değiştirilemezliği (ISO 27001 A.8.15) — "on" = UPDATE/DELETE engelli.
    // null = DB okunamadı, "off" ile karıştırma.
    auditGuard,
    // Servis keşfi — "yazdık ama sahada hiç çalışmadı"nın TEK ölçülebilir kanıtı.
    // `mdns.reason` sahada `"ok"` değilse ilan kurulamamıştır (Windows'ta 5353'ü
    // Apple Bonjour Service / Adobe tutuyor olabilir) ve keşif yalnız istemci
    // tarafındaki alt ağ taramasıyla çalışıyordur. Buraya ait çünkü OPERASYONEL
    // İÇ DURUM — kimliksiz keşif ucuna değil (bkz. routes/discovery.routes.ts).
    discovery: {
      mdns: getMdnsState(),
      installationId: getCachedInstallationIdentity()?.installationId ?? null,
    },
    // Lisans motoru (gözlem/zorla, kademe, son yoklama) — public /health'e GİRMEZ.
    license: licenseHealthBlock(),
    // Backend prosesinin + makinenin kaynak kullanımı (CPU/RAM)
    ...readResourceMetrics(),
  };
}
