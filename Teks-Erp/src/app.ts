import express, { Express, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import { setupSwagger } from "./config/swagger";
import { errorHandler } from "./middlewares/error.middleware";
import { installDecimalNumberSerializer } from "./utils/json-replacer";

// Tüm res.json() çıktısında Prisma Decimal → number çevirir
// (Decimal.prototype.toJSON override'ı). Aksi halde Decimal'ler client'a string
// olarak gider, frontend `toFixed`/aritmetik hataları alır. Bkz. json-replacer.ts.
installDecimalNumberSerializer();

// Routes
import authRoutes from "./routes/auth.routes";
import itemRoutes from "./routes/item.routes";
import customerRoutes from "./routes/customer.routes";
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
import defectTypeRoutes from "./routes/defect-type.routes";
import qualityGradeRoutes from "./routes/quality-grade.routes";
import colorRoutes from "./routes/color.routes";
import fabricPropertyRoutes from "./routes/fabric-property.routes";
import stationCapabilityRoutes from "./routes/station-capability.routes";
import labelRoutes from "./routes/label.routes";
import labelTemplateRoutes from "./routes/label-template.routes";
import shippingRoutes from "./routes/shipping.routes";
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
app.use(helmet());
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
// Health Check
// =============================================================================
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "UP", message: "TeksERP API is running." });
});

// =============================================================================
// API Routes
// =============================================================================
app.use("/api/auth", authRoutes);
app.use("/api/items", itemRoutes);
app.use("/api/customers", customerRoutes);
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
app.use("/api/swatches", swatchRoutes);
app.use("/api/defect-types", defectTypeRoutes);
app.use("/api/quality-grades", qualityGradeRoutes);
app.use("/api/colors", colorRoutes);
app.use("/api/fabric-properties", fabricPropertyRoutes);
app.use("/api/station-capabilities", stationCapabilityRoutes);
app.use("/api/labels", labelRoutes);
app.use("/api/label-templates", labelTemplateRoutes);
app.use("/api/shipping", shippingRoutes);
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
