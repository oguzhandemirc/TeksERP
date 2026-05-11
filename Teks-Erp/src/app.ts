import express, { Express, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import { setupSwagger } from "./config/swagger";
import { errorHandler } from "./middlewares/error.middleware";

// Routes
import authRoutes from "./routes/auth.routes";
import itemRoutes from "./routes/item.routes";
import customerRoutes from "./routes/customer.routes";
import stationRoutes, { machineRouter } from "./routes/station.routes";
import routeRoutes from "./routes/route.routes";
import inventoryRoutes from "./routes/inventory.routes";
import orderRoutes from "./routes/order.routes";
import workOrderRoutes from "./routes/workorder.routes";
import productionRoutes from "./routes/production.routes";
import tamburRoutes from "./routes/tambur.routes";
import packagingRoutes from "./routes/packaging.routes";
import kursunQcRoutes from "./routes/kursun-qc.routes";
import shippingRoutes from "./routes/shipping.routes";
import travelerCardRoutes from "./routes/traveler-card.routes";
import subcontractorRoutes from "./routes/subcontractor.routes";
import {
  subcontractorRouter,
  subcontractorCategoryRouter,
} from "./routes/subcontractor-management.routes";
import serviceProductionRoutes from "./routes/service-production.routes";
import swatchRoutes from "./routes/swatch.routes";
import defectTypeRoutes from "./routes/defect-type.routes";
import qualityGradeRoutes from "./routes/quality-grade.routes";
import colorRoutes from "./routes/color.routes";
import fabricPropertyRoutes from "./routes/fabric-property.routes";
import stationCapabilityRoutes from "./routes/station-capability.routes";
import allocationRoutes from "./routes/allocation.routes";
import packagingQueueRoutes from "./routes/packaging-queue.routes";
import shippingQueueRoutes from "./routes/shipping-queue.routes";
import sackRoutes from "./routes/sack.routes";
import adminRoutes from "./routes/admin.routes";

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
app.use("/api/rolls", inventoryRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/work-orders", workOrderRoutes);
app.use("/api/production", productionRoutes);
app.use("/api/tambur", tamburRoutes);
app.use("/api/packaging", packagingRoutes);
app.use("/api/kursun-qc", kursunQcRoutes);
app.use("/api/shipping", shippingRoutes);
app.use("/api/traveler-cards", travelerCardRoutes);
app.use("/api/subcontractor", subcontractorRoutes);
app.use("/api/subcontractors", subcontractorRouter);
app.use("/api/subcontractor-categories", subcontractorCategoryRouter);
app.use("/api/service-production", serviceProductionRoutes);
app.use("/api/swatches", swatchRoutes);
app.use("/api/defect-types", defectTypeRoutes);
app.use("/api/quality-grades", qualityGradeRoutes);
app.use("/api/colors", colorRoutes);
app.use("/api/fabric-properties", fabricPropertyRoutes);
app.use("/api/station-capabilities", stationCapabilityRoutes);
app.use("/api/allocations", allocationRoutes);
app.use("/api/packaging-queue", packagingQueueRoutes);
app.use("/api/shipping-queue", shippingQueueRoutes);
app.use("/api/sacks", sackRoutes);
app.use("/api/admin", adminRoutes);

// =============================================================================
// Global Error Handler (must be LAST middleware)
// =============================================================================
app.use(errorHandler);

export default app;
