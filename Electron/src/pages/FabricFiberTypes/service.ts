import { createCrudService } from "@/services/crudService";
import type { FabricType, FiberType } from "./types";

// Silme ucu YOK (sunucu): kaldırma = pasife alma (PATCH isActive:false).
export const fabricTypeService = createCrudService<FabricType>("/api/fabric-types");
export const fiberTypeService = createCrudService<FiberType>("/api/fiber-types");
