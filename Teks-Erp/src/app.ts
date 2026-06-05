import express, { Express, Request, Response } from "express";
import path from "path";
import fs from "fs";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import { setupSwagger } from "./config/swagger";
import { errorHandler } from "./middlewares/error.middleware";
import { installDecimalNumberSerializer } from "./utils/json-replacer";
import prisma from "./lib/prisma";

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
import productionRoutes from "./routes/production.routes";
import productionBalanceRoutes from "./routes/production-balance.routes";
import tamburRoutes from "./routes/tambur.routes";
import kursunQcRoutes from "./routes/kursun-qc.routes";
import travelerCardRoutes from "./routes/traveler-card.routes";
import subcontractorRoutes from "./routes/subcontractor.routes";
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
import shippingRoutes from "./routes/shipping.routes";
import returnRoutes from "./routes/return.routes";
import returnReasonRoutes from "./routes/return-reason.routes";
import currencyRoutes from "./routes/currency.routes";
import featureFlagRoutes from "./routes/feature-flag.routes";
import adminRoutes from "./routes/admin.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import reportsRoutes from "./routes/reports.routes";
import { devicePublicRouter, deviceAdminRouter } from "./routes/device.routes";
import { resolveDevice } from "./middlewares/device.middleware";

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
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: { upgradeInsecureRequests: null },
    },
    strictTransportSecurity: false,
  })
);
app.use(cors());
// gzip + brotli yoksa sıkıştır — JSON listelerde 60-80% boyut tasarrufu.
// 1KB altı response'lar atlanır (overhead'e değmez).
app.use(compression({ threshold: 1024 }));
app.use(express.json());
app.use(morgan("dev"));

// x-device-id header'ı varsa req.device'a Device + machineId çöz
app.use(resolveDevice);

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
// CWD = backend kökü (dev) veya app\ (kurulumda NSSM AppDirectory) → her ikisinde
// de public\ klasörü bunun altındadır.
const publicDir = path.join(process.cwd(), "public");
app.use(express.static(publicDir));

// Sürüm bilgisi (durum sayfasında gösterilir). NSSM node'u doğrudan çalıştırdığı
// için `npm_package_version` env'i serviste tanımsızdır — package.json'dan oku.
let appVersion = "1.0.0";
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  if (pkg?.version) appVersion = pkg.version;
} catch {
  /* package.json okunamazsa varsayılan sürümle devam */
}

// Yedek klasörü: manage.ps1 backend servisini kaydederken BACKUP_DIR env'i verir
// (C:\ProgramData\TeksERP\backups). Tanımlıysa durum sayfası son yedek zamanını
// gösterir. Dev ortamında tanımsızdır → son yedek alanı null döner.
const backupDir = process.env.BACKUP_DIR;

// Son yedeğin (.dump) adını ve zamanını döndürür. Klasör yoksa/erişilemezse null.
function latestBackupInfo(): { name: string; time: string } | null {
  if (!backupDir) return null;
  try {
    let newest: { name: string; mtimeMs: number } | null = null;
    for (const f of fs.readdirSync(backupDir)) {
      if (!f.toLowerCase().endsWith(".dump")) continue;
      const st = fs.statSync(path.join(backupDir, f));
      if (!newest || st.mtimeMs > newest.mtimeMs) newest = { name: f, mtimeMs: st.mtimeMs };
    }
    return newest ? { name: newest.name, time: new Date(newest.mtimeMs).toISOString() } : null;
  } catch {
    return null;
  }
}

// =============================================================================
// Health Check  (durum sayfası ve tepsi paneli buradan beslenir)
// =============================================================================
// API her zaman UP (bu kod çalışıyorsa); ek olarak DB bağlantısını canlı test
// eder. Geriye dönük uyumluluk için HTTP durumu 200 KALIR ve eski alanlar
// (status, message) korunur — yeni alanlar (db, version, uptimeSec, dbSizeBytes,
// dbConnections, lastBackup) eklenir.
app.get("/health", async (_req: Request, res: Response) => {
  let db: "UP" | "DOWN" = "DOWN";
  let dbSizeBytes: number | null = null;
  let dbConnections: number | null = null;
  try {
    // Tek round-trip: DB canlılığı + boyut + aktif bağlantı sayısı.
    const rows = await prisma.$queryRaw<Array<{ size: bigint; conns: bigint }>>`
      SELECT pg_database_size(current_database()) AS size,
             (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS conns`;
    db = "UP";
    if (rows && rows[0]) {
      dbSizeBytes = Number(rows[0].size);
      dbConnections = Number(rows[0].conns);
    }
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
    uptimeSec: Math.floor(process.uptime()),
    dbSizeBytes,
    dbConnections,
    lastBackup: latestBackupInfo(),
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
app.use("/api/routes", routeRoutes);
app.use("/api/product-recipes", productRecipeRoutes);
app.use("/api/rolls", inventoryRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/work-orders", workOrderRoutes);
app.use("/api/production", productionRoutes);
app.use("/api/production-balance", productionBalanceRoutes);
app.use("/api/tambur", tamburRoutes);
app.use("/api/kursun-qc", kursunQcRoutes);
app.use("/api/traveler-cards", travelerCardRoutes);
app.use("/api/subcontractor", subcontractorRoutes);
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
app.use("/api/returns", returnRoutes);
app.use("/api/return-reasons", returnReasonRoutes);
app.use("/api/currencies", currencyRoutes);
app.use("/api/feature-flags", featureFlagRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/devices", devicePublicRouter);
app.use("/api/admin/devices", deviceAdminRouter);

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
// Global Error Handler (must be LAST middleware)
// =============================================================================
app.use(errorHandler);

export default app;
