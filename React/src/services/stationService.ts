import { createCrudService } from "./crudService";
import type { Station } from "@/types/models";

export const stationService = createCrudService<Station>("/api/stations");
