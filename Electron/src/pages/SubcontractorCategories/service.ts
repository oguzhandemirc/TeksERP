import { createCrudService } from "@/services/crudService";
import type { SubcontractorCategory } from "./types";

export const subcontractorCategoryService = createCrudService<SubcontractorCategory>(
  "/api/subcontractor-categories",
);
