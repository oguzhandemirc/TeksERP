import { createCrudService } from "@/services/crudService";
import type { MachineHardware } from "./types";

export const machineHardwareService = createCrudService<MachineHardware>("/api/machine-hardware");
