import { createCrudService } from "@/services/crudService";
import type { Station } from "./types";

export const stationService = createCrudService<Station>("/api/stations");
