// Ham duruş kodu eşlemesi — `/api/machine-stop-code-maps` (D2). Kapı: tezgah modülü ∧ `loom:spec-manage`.
// DELETE pasife alır (silme yok); PATCH yalnız `stopReasonId`/`isActive` kabul eder (anahtar değişmez).
import { createCrudService } from "@/services/crudService";
import type { MachineStopCodeMap } from "./types";

export const machineStopCodeMapService = createCrudService<MachineStopCodeMap>("/api/machine-stop-code-maps");
