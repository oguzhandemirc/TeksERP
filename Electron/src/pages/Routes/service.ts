import { createCrudService } from "@/services/crudService";
import type { ProductionRoute } from "./types";

export const routeService = createCrudService<ProductionRoute>("/api/routes");
