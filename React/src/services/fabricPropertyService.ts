import { createCrudService } from "./crudService";
import type { FabricProperty } from "@/types/models";

export const fabricPropertyService = createCrudService<FabricProperty>(
  "/api/fabric-properties",
);
