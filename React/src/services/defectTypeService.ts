import { createCrudService } from "./crudService";
import type { DefectType } from "@/types/models";

export const defectTypeService = createCrudService<DefectType>("/api/defect-types");
