import express, { Express, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
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
import swatchRoutes from "./routes/swatch.routes";
import defectTypeRoutes from "./routes/defect-type.routes";
import qualityGradeRoutes from "./routes/quality-grade.routes";

const app: Express = express();

// =============================================================================
// Core Middlewares
// =============================================================================
app.use(helmet());
app.use(cors());
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
app.use("/api/swatches", swatchRoutes);
app.use("/api/defect-types", defectTypeRoutes);
app.use("/api/quality-grades", qualityGradeRoutes);

// =============================================================================
// Global Error Handler (must be LAST middleware)
// =============================================================================
app.use(errorHandler);

export default app;
