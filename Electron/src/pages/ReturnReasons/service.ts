import { createCrudService } from "@/services/crudService";
import type { ReturnReason } from "./types";

export const returnReasonService = createCrudService<ReturnReason>("/api/return-reasons");
