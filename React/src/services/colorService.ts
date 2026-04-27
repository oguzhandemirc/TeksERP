import { createCrudService } from "./crudService";
import type { Color } from "@/types/models";

export const colorService = createCrudService<Color>("/api/colors");
