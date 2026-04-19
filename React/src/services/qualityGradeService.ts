import { createCrudService } from "./crudService";
import type { QualityGrade } from "@/types/models";

export const qualityGradeService = createCrudService<QualityGrade>(
  "/api/quality-grades",
);
