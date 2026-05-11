import { createCrudService } from "@/services/crudService";
import type { QualityGrade } from "./types";

export const qualityGradeService = createCrudService<QualityGrade>("/api/quality-grades");
