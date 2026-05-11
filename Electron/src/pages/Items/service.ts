import { createCrudService } from "@/services/crudService";
import type { Item } from "./types";

export const itemService = createCrudService<Item>("/api/items");
