import { createCrudService } from "@/services/crudService";
import type { FabricProperty } from "./types";

export const fabricPropertyService = createCrudService<FabricProperty>("/api/fabric-properties");
