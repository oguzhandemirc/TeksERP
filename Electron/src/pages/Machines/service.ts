import { createCrudService } from "@/services/crudService";
import type { Machine } from "./types";

export const machineService = createCrudService<Machine>("/api/machines");
