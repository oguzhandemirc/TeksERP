import express, { Express, NextFunction, Request, Response } from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { monitorEventLoopDelay } from "perf_hooks";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import { setupSwagger } from "./config/swagger";
import { errorHandler } from "./middlewares/error.middleware";
import { installDecimalNumberSerializer } from "./utils/json-replacer";
import prisma from "./lib/prisma";
import { readAppDiskMetrics } from "./lib/disk-metrics";
import { getPoolHealth } from "./lib/pool-health";
import { getOffsiteHealth } from "./services/helpers/offsite-backup.helper";
import { AuditService } from "./services/audit.service";

// Tüm res.json() çıktısında Prisma Decimal → number çevirir
// (Decimal.prototype.toJSON override'ı). Aksi halde Decimal'ler client'a string
// olarak gider, frontend `toFixed`/aritmetik hataları alır. Bkz. json-replacer.ts.
installDecimalNumberSerializer();

// Routes
import authRoutes from "./routes/auth.routes";
import itemRoutes from "./routes/item.routes";
import customerRoutes from "./routes/customer.routes";
import customerBranchListRoutes from "./routes/customer-branch-list.routes";
import stationRoutes, { machineRouter } from "./routes/station.routes";
import routeRoutes from "./routes/route.routes";
import productRecipeRoutes from "./routes/product-recipe.routes";
import inventoryRoutes from "./routes/inventory.routes";
import orderRoutes from "./routes/order.routes";
import workOrderRoutes from "./routes/workorder.routes";
import productionBalanceRoutes from "./routes/production-balance.routes";
import tamburRoutes from "./routes/tambur.routes";
import kursunQcRoutes from "./routes/kursun-qc.routes";
import kursunBypassRoutes from "./routes/kursun-bypass.routes";
import travelerCardRoutes from "./routes/traveler-card.routes";
import travelerTemplateRoutes from "./routes/traveler-template.routes";
import subcontractorRoutes from "./routes/subcontractor.routes";
import batchRoutes from "./routes/batch.routes";
import {
  subcontractorRouter,
  subcontractorCategoryRouter,
} from "./routes/subcontractor-management.routes";
import swatchRoutes from "./routes/swatch.routes";
import kartelaRoutes from "./routes/kartela.routes";
import defectTypeRoutes from "./routes/defect-type.routes";
import qualityGradeRoutes from "./routes/quality-grade.routes";
import colorRoutes from "./routes/color.routes";
import fabricPropertyRoutes from "./routes/fabric-property.routes";
import stationCapabilityRoutes from "./routes/station-capability.routes";
import labelRoutes from "./routes/label.routes";
import labelTemplateRoutes from "./routes/label-template.routes";
import { peripheralRouter } from "./routes/peripheral.routes";
import shippingRoutes from "./routes/shipping.routes";
import printedDocumentRoutes from "./routes/printed-document.routes";
import documentProfileRoutes from "./routes/document-profile.routes";
import freeDocumentRoutes from "./routes/free-document.routes";
import returnRoutes from "./routes/return.routes";
import returnReasonRoutes from "./routes/return-reason.routes";
import warehouseRoutes from "./routes/warehouse.routes";
import goodsReceiptRoutes from "./routes/goods-receipt.routes";
import financeRoutes from "./routes/finance.routes";
import warehouseTransferRoutes from "./routes/warehouse-transfer.routes";
import currencyRoutes from "./routes/currency.routes";
import featureFlagRoutes from "./routes/feature-flag.routes";
import adminRoutes from "./routes/admin.routes";
import { verifyToken } from "./middlewares/auth.middleware";
import { requirePermission } from "./middlewares/rbac.middleware";
import dbCopyRoutes from "./routes/db-copy.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import reportsRoutes from "./routes/reports.routes";
import { devicePublicRouter, deviceAdminRouter } from "./routes/device.routes";
import workSessionRoutes from "./routes/work-session.routes";
import { resolveDevice } from "./middlewares/device.middleware";
import { latencyMiddleware } from "./middlewares/latency.middleware";
import { getPresence } from "./lib/presence";

const app: Express = express();


// =============================================================================
// Core Middlewares
// =============================================================================
// HTTP-only LAN sunucusu (HTTPS yok). helmet'in varsayilan CSP'sindeki
// `upgrade-insecure-requests` direktifi tarayiciyi TUM alt-istekleri
// (status.js, logo.png, /health fetch) https'e cevirmeye zorlar; sunucu
// yalnizca http://...:4000 konustugu icin bu istekler basarisiz olur ve durum
// sayfasi "Kontrol ediliyor..." ekraninda donar. Direktifi null'a cekip kaldir.
// HSTS de HTTPS olmadigi icin anlamsiz (tarayici http'de zaten yok sayar).
//
// WEB PANELI (OPT-IN, 2026-08-12): `WEB_DIST_DIR` ortam degiskeni dolu ise web
// paneli build'i (Electron/dist-web) ayni origin'den servis edilir — panel ile
// API tek adreste bulusur (CORS/mixed-content/adres-ayari uclusu tamamen duser).
// Degisken YOKKEN davranis bayt-bayt bugunku gibidir; fabrika deploy'u etkilenmez.
const webDistDir = process.env.WEB_DIST_DIR ?? null;
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        upgradeInsecureRequests: null,
        // Panel modunda header CSP'si panelin index.html'indeki meta CSP ile
        // esitlenir (efektif politika iki CSP'nin KESISIMIdir — helmet
        // varsayilanlari daha dar oldugu icin panelin blob: worker'lari ve
        // data: baglantilarini sessizce kirardi). Panel modu disinda helmet
        // varsayilanlari aynen kalir.
        ...(webDistDir
          ? {
              scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
              connectSrc: ["'self'", "data:"],
              imgSrc: ["'self'", "data:", "blob:"],
              fontSrc: ["'self'", "data:"],
              frameSrc: ["'self'", "blob:"],
              workerSrc: ["'self'", "blob:"],
            }
          : {}),
      },
    },
    strictTransportSecurity: false,
  })
);
// exposedHeaders: tarayıcı/Electron renderer'ı cross-origin custom response
// header'larını ancak burada listelenirse JS'e açar. Etiket dili (native baskı
// guard'ı buna bakar) + sunucu saati (apiClient offset) okunabilsin diye gerekli.
app.use(cors({ exposedHeaders: ["X-Label-Language", "X-Label-Kind", "X-Label-Count", "X-Label-Template-Id", "X-Label-Variant-Match", "Date"] }));
// gzip + brotli yoksa sıkıştır — JSON listelerde 60-80% boyut tasarrufu.
// 1KB altı response'lar atlanır (overhead'e değmez).
app.use(compression({ threshold: 1024 }));
// F17: production'da 'combined' (tarih/IP/UA — pm2 dosya log'una ANSI'siz),
// dev'de renkli kısa 'dev'.
const isProd = (process.env.APP_ENV ?? process.env.NODE_ENV) === "production";
app.use(morgan(isProd ? "combined" : "dev"));

// Per-endpoint gecikme istatistiği (istek başına O(1)) — morgan'dan sonra,
// resolveDevice'tan ÖNCE: statik/health/swagger dahil her şey ölçülür. Canlı
// sayaçlar bellekte (GET /api/admin/perf); Faz 3 ile ~5dk'da bir istek-güdümlü
// flush günlük özet tablosuna yazar (GET /api/admin/perf/history — trend).
// Bkz. docs/history/SAHA-DAYANIKLILIK-FAZ2.md §B + docs/history/SAHA-DAYANIKLILIK-FAZ3.md §P1.
app.use(latencyMiddleware);

// F16: 1MB limit — toplu uçlar (yüzlerce rollId) 100kb default'u aşınca generic
// 500/İngilizce 'entity.too.large' yerine error.middleware net 413 Türkçe döner.
//
// ⚠️ KONUM: morgan + latency'den SONRA (2026-08-09, denetim F-CORE-OPS-003).
// Eskiden ikisinden de ÖNCEYDİ ve bu bir gözlemlenebilirlik kör noktasıydı:
// bozuk JSON (400) ve 1MB aşımı (413) burada `next(err)` ile hata zincirine
// çıkıyor, hata zinciri sonraki NORMAL middleware'ları ATLIYOR ve o istekler NE
// erişim log'una NE gecikme metriğine düşüyordu. Yani 413 döngüsüne girmiş bir
// tablet `/api/admin/perf` ekranında HİÇ görünmüyordu — uç sanki hiç çağrılmamış
// gibi. Bağımlılık yok: morgan ve latency gövdeyi okumaz, resolveDevice yalnız
// x-device-id başlığına bakar, route handler'ları zaten aşağıda.
app.use(express.json({ limit: "1mb" }));

// =============================================================================
// Swagger UI Documentation
// =============================================================================
setupSwagger(app);

// =============================================================================
// Durum Sayfası (kök /) + statik varlıklar
// =============================================================================
// Sunucu adresi tarayıcıda açıldığında (operatör/tablet) Swagger yerine markalı
// bir durum sayfası gösterilir: API + DB bağlantısı OK mu değil mi. Sayfa
// public/ altındaki statik dosyalardan gelir (index.html + status.js + logo.png) —
// helmet'in varsayılan CSP'si inline script'i bloklar; harici 'self' dosyalar geçer.
// CWD = backend kökü (dev) veya app\ (üretimde pm2 `cwd`) → her ikisinde de
// public\ klasörü bunun altındadır.
// Web paneli statigi DURUM SAYFASINDAN ONCE baglanir: panel modunda kok (/)
// artik paneldir (durum bilgisi /health'te yasamaya devam eder). Env yokken bu
// blok hic kosmaz ve kok, asagidaki durum sayfasidir.
if (webDistDir) {
  app.use(express.static(webDistDir));
}

const publicDir = path.join(process.cwd(), "public");
app.use(express.static(publicDir));

// x-device-id header'ı varsa req.device'a Device + machineId çöz.
//
// ⚠️ KONUM: swagger + statik varlıklardan SONRA (2026-08-09 denetimi,
// F-CORE-VER-002). Eskiden ikisinden de ÖNCEYDİ ve bu, mobil istemcinin
// gönderdiği HER statik dosya isteğine (durum sayfası, logo, swagger iç
// varlıkları) bir `device` DB sorgusu bindiriyordu — o sorgunun sonucunu
// statik yolun okuması İMKÂNSIZ. Ölçülen taban: 18 APPROVED cihaz, 5 sn'de bir
// yoklama; kimlik+cihaz çözümü iş sorgusu başlamadan ~11 sorgu/sn ediyordu.
// API route'ları AŞAĞIDA olduğu için `req.device`a bağlı hiçbir yol etkilenmez.
app.use(resolveDevice);

// Sürüm bilgisi (durum sayfasında gösterilir). pm2 derlenmiş server.js'i doğrudan
// çalıştırır (npm script üzerinden değil) → `npm_package_version` env'i üretimde
// tanımsızdır; package.json'dan oku.
let appVersion = "1.0.0";
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  if (pkg?.version) appVersion = pkg.version;
} catch {
  /* package.json okunamazsa varsayılan sürümle devam */
}

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
let backupCacheComputedAt = 0;
const BACKUP_CACHE_MS = 30_000;
function latestBackupInfo(): { name: string; time: string } | null {
  if (!backupDir) return null;
  const now = Date.now();
  if (backupCacheComputedAt > 0 && now - backupCacheComputedAt < BACKUP_CACHE_MS) {
    return backupCache;
  }
  try {
    let newest: { name: string; mtimeMs: number } | null = null;
    for (const f of fs.readdirSync(backupDir)) {
      if (!f.toLowerCase().endsWith(".dump")) continue;
      const st = fs.statSync(path.join(backupDir, f));
      if (!newest || st.mtimeMs > newest.mtimeMs) newest = { name: f, mtimeMs: st.mtimeMs };
    }
    backupCache = newest
      ? { name: newest.name, time: new Date(newest.mtimeMs).toISOString() }
      : null;
  } catch {
    // Erişilemezse de cache'le — her 5sn'de tekrar deneyip bloklamasın.
    backupCache = null;
  }
  backupCacheComputedAt = now;
  return backupCache;
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

// =============================================================================
// Health Check  (durum sayfası ve tepsi paneli buradan beslenir)
// =============================================================================
// API her zaman UP (bu kod çalışıyorsa); ek olarak DB bağlantısını canlı test
// eder. Geriye dönük uyumluluk için HTTP durumu 200 KALIR ve eski alanlar
// (status, message) korunur — yeni alanlar (db, version, uptimeSec, dbSizeBytes,
// dbConnections, lastBackup) eklenir.
// ⚠️ İKİ UÇ, İKİ SÖZLEŞME (2026-08-09 denetimi, F-CORE-GUV-002):
//
//   GET /health             → PUBLIC, YALNIZ CANLILIK (5 alan)
//   GET /api/admin/health   → verifyToken + admin:settings, TAM operasyon panosu
//
// `/health` kimlik doğrulaması TAŞIYAMAZ: Electron login ÖNCESİ sunucu adresini
// onunla test ediyor (ApiEndpointDialog) ve `useServerClock` yanıttaki `Date`
// başlığını okuyor; kök durum sayfası (public/status.js) da onu çağırıyor.
// Ama uç, canlılığın çok ötesinde bir panoyu kimliksiz döndürüyordu: DB boyutu,
// disk doluluğu, havuz içleri, o an online kullanıcı/cihaz sayısı, YEDEK DOSYA
// ADI ve iki HAM hata metni (`lastAuditError`, `lastPoolTimeoutError` —
// içerikleri süzülmüyor; Prisma/pg metinleri şema ve bağlantı ayrıntısı
// taşıyabilir). LAN'daki kimliksiz herhangi bir istemci — CORS `*` sayesinde
// ofis bilgisayarında açılan herhangi bir web sayfası dahil — hepsini tek GET
// ile okuyabiliyordu.
//
// ⚠️ YENİ METRİK EKLERKEN: "bu alan sunucuya erişimi olmayan birine ne söyler?"
// Cevap "operasyonel iç durum" ise `buildRichHealth`e ekle, `/health`e DEĞİL.
// `/health`in alan kümesi DONDURULMUŞTUR.
async function buildRichHealth(): Promise<Record<string, unknown>> {
  let db: "UP" | "DOWN" = "DOWN";
  let dbSizeBytes: number | null = null;
  let dbConnections: number | null = null;
  let cacheHitPct: number | null = null;
  let rollsDeadPct: number | null = null;
  let longestQuerySec: number | null = null;
  let dbBlockedCount: number | null = null;
  let restoreCopyCount: number | null = null;
  let restoreCopyBytes: number | null = null;
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
      }>
    >`
      SELECT pg_database_size(current_database()) AS size,
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
    version: appVersion,
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
    lastBackup: latestBackupInfo(),
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
    // Backend prosesinin + makinenin kaynak kullanımı (CPU/RAM)
    ...readResourceMetrics(),
  };
}

/**
 * PUBLIC canlılık ucu — SÖZLEŞMESİ DONDURULMUŞ beş alan.
 * DB'ye YALNIZ ucuz bir `SELECT 1` atar: zengin yükün pg_stat sorgusu buraya
 * gerekmiyor ve kimliksiz bir istemcinin onu tetiklemesi için sebep yok.
 */
app.get("/health", async (_req: Request, res: Response) => {
  let db: "UP" | "DOWN" = "DOWN";
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "UP";
  } catch {
    db = "DOWN";
  }
  res.status(200).json({
    status: "UP",
    message: "TeksERP API is running.",
    api: "UP",
    db,
    version: appVersion,
    time: new Date().toISOString(),
  });
});

// =============================================================================
// API Routes
// =============================================================================
app.use("/api/auth", authRoutes);
app.use("/api/items", itemRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/customer-branches", customerBranchListRoutes);
app.use("/api/stations", stationRoutes);
app.use("/api/machines", machineRouter);
app.use("/api/peripherals", peripheralRouter);
app.use("/api/routes", routeRoutes);
app.use("/api/product-recipes", productRecipeRoutes);
app.use("/api/rolls", inventoryRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/work-orders", workOrderRoutes);
app.use("/api/production-balance", productionBalanceRoutes);
app.use("/api/tambur", tamburRoutes);
app.use("/api/kursun-qc", kursunQcRoutes);
app.use("/api/kursun-bypass", kursunBypassRoutes);
app.use("/api/traveler-cards", travelerCardRoutes);
app.use("/api/traveler-templates", travelerTemplateRoutes);
app.use("/api/subcontractor", subcontractorRoutes);
app.use("/api/batches", batchRoutes);
app.use("/api/subcontractors", subcontractorRouter);
app.use("/api/subcontractor-categories", subcontractorCategoryRouter);
app.use("/api/kartela", kartelaRoutes);
app.use("/api/swatches", swatchRoutes);
app.use("/api/defect-types", defectTypeRoutes);
app.use("/api/quality-grades", qualityGradeRoutes);
app.use("/api/colors", colorRoutes);
app.use("/api/fabric-properties", fabricPropertyRoutes);
app.use("/api/station-capabilities", stationCapabilityRoutes);
app.use("/api/labels", labelRoutes);
app.use("/api/label-templates", labelTemplateRoutes);
app.use("/api/shipping", shippingRoutes);
app.use("/api/printed-documents", printedDocumentRoutes);
app.use("/api/document-profiles", documentProfileRoutes);
app.use("/api/free-documents", freeDocumentRoutes);
app.use("/api/returns", returnRoutes);
app.use("/api/return-reasons", returnReasonRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/goods-receipts", goodsReceiptRoutes);
app.use("/api/warehouse-transfers", warehouseTransferRoutes);
// Ön muhasebe — router'ın KENDİSİ `requireFinanceEnabled` taşır (bayrak
// kapalıysa hepsi 403). Tek tek uçlarda tekrarlanmaz.
app.use("/api/finance", financeRoutes);
app.use("/api/currencies", currencyRoutes);
app.use("/api/feature-flags", featureFlagRoutes);
// db-copies GENEL admin router'ından ÖNCE: Express 5 prefix eşleşmesinde daha
// spesifik olan önce gelmeli, yoksa admin.routes içindeki bir yakalayıcı öne geçebilir.
app.use("/api/admin/db-copies", dbCopyRoutes);
// ZENGİN sağlık yükü — `/health`ten AYRILDI (F-CORE-GUV-002). adminRoutes'tan
// ÖNCE kaydedilir ki aynı prefix altında bu özel yol önce eşleşsin. Guard'lar
// route satırında açık: kimlik + `admin:settings` (Sunucu Durumu ekranı zaten
// Sistem hub'ının arkasında ve o izni taşıyan kişi tarafından açılıyor).
app.get(
  "/api/admin/health",
  verifyToken,
  requirePermission("admin:settings"),
  async (_req: Request, res: Response) => {
    res.status(200).json(await buildRichHealth());
  },
);
app.use("/api/admin", adminRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/devices", devicePublicRouter);
app.use("/api/admin/devices", deviceAdminRouter);
app.use("/api/work-sessions", workSessionRoutes);

// =============================================================================
// JSON 404 — tanımsız /api/* route'lar için
// =============================================================================
// Express default 404'ü HTML döner ("Cannot GET /api/foo") — JSON API contract'ı
// bozar (frontend res.json() üzerinde parse hatası alır). Bu catch-all tüm
// tanımsız /api path'leri için tutarlı JSON yanıt verir.
//
// Yalnız /api altına bind edildi — Swagger UI (/api-docs/*) ve /health
// etkilenmez.
app.use("/api", (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Endpoint bulunamadı: ${req.method} ${req.originalUrl}`,
  });
});

// =============================================================================
// SPA fallback (yalniz panel modunda) — /api* disindaki HTML isteyen GET'ler
// panelin index.html'ine duser. Panel HashRouter kullandigi icin bugun derin
// yol istegi zaten gelmez ("/" + asset'ler yeter); bu blok, router ileride
// BrowserRouter'a gecerse yenileme/derin baglanti 404'lerini simdiden kapatir.
// =============================================================================
if (webDistDir) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api")) return next(); // JSON 404 sozlesmesi bozulmasin
    if (!req.accepts("html")) return next();
    // `root` opsiyonu SART: mutlak yol verilirse `send` yolun ICINDEKI nokta
    // segmentlerini (orn. gelistirme worktree'sindeki `.claude/`) gizli dosya
    // sayip 404 uretir; root'a gore "index.html" ise nokta segmenti tasimaz.
    res.sendFile("index.html", { root: webDistDir });
  });
}

// =============================================================================
// Global Error Handler (must be LAST middleware)
// =============================================================================
app.use(errorHandler);

export default app;
