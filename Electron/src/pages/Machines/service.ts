import apiClient from "@/services/apiClient";
import { createCrudService } from "@/services/crudService";
import type { Machine } from "./types";

export const machineService = createCrudService<Machine>("/api/machines");

export interface MachineDeletePreview {
  machineId: string;
  machineName: string;
  /** Üretim izi (işlem/hareket/top girişi) ve eşleşme (cihaz/donanım) yoksa true. */
  deletable: boolean;
  /** Kalıcı silmede tx içinde temizlenecek oturum (login) satırı sayısı. */
  workSessionCount: number;
  /** Silmeyi engelleyen sebepler (deletable=false iken dolu). */
  blockers: { key: string; count: number; message: string }[];
}

/** Makine kalıcı silme önizlemesi — onay modalında ne olacağını göstermek için. */
export const getMachineDeletePreview = (id: string) =>
  apiClient
    .get<{ success: boolean; data: MachineDeletePreview }>(`/api/machines/${id}/delete-preview`)
    .then((r) => r.data.data);
