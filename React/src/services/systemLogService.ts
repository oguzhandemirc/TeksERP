import { createCrudService } from "./crudService";
import type { SystemLog } from "@/types/models";

export const systemLogService = createCrudService<SystemLog>("/api/system-logs");
