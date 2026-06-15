import { createCrudService } from "@/services/crudService";
import type { PrinterModel } from "./types";

export const printerModelService = createCrudService<PrinterModel>("/api/printer-models");
