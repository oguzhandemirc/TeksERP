import { createCrudService } from "@/services/crudService";
import type { WarpSpec } from "./types";

/** Çözgü kartı CRUD — uçlar `requireDevereEnabled` kapısının arkasında
 *  (modül kapalıyken 403 `MODULE_DISABLED`). */
export const warpSpecService = createCrudService<WarpSpec>("/api/warp-specs");
