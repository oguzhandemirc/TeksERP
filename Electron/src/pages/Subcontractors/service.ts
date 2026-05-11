import { createCrudService } from "@/services/crudService";
import type { Subcontractor } from "./types";

export const subcontractorService = createCrudService<Subcontractor>("/api/subcontractors");
