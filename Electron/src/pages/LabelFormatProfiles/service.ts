import { createCrudService } from "@/services/crudService";
import type { LabelFormatProfile } from "./types";

export const labelFormatProfileService = createCrudService<LabelFormatProfile>(
  "/api/label-format-profiles",
);
