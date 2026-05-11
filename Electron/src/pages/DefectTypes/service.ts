import { createCrudService } from "@/services/crudService";
import type { DefectType } from "./types";

export const defectTypeService = createCrudService<DefectType>("/api/defect-types");
