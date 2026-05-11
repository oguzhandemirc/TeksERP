import { createCrudService } from "@/services/crudService";
import type { Color } from "./types";

export const colorService = createCrudService<Color>("/api/colors");
