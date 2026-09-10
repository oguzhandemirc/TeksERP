import apiClient from "@/services/apiClient";
import { createCrudService } from "@/services/crudService";
import type { Machine } from "./types";

export const machineService = createCrudService<Machine>("/api/machines");

export interface MachineDeletePreview {
  machineId: string;
  machineName: string;
  /** Üretim izi (işlem/hareket/top girişi), çalışma oturumu ve tablet eşleşmesi yoksa true.
   *  Donanım (peripheral) BLOKLAMAZ — silmede otomatik boşa çıkar. */
  deletable: boolean;
  /** Oturum geçmişi SİLİNMEZ, kalıcı silmeyi engeller — toplam kayıt sayısı. */
  workSessionCount: number;
  /** Engelin dökümü: en yeni oturumlar (en fazla 5; toplam `workSessionCount`). */
  recentWorkSessions: { id: string; userName: string; startedAt: string; endedAt: string | null }[];
  /** Silmede bu makineden çözülecek (machineId=null) donanım sayısı. */
  peripheralDetachCount: number;
  /** Silmede boşa çıkacak donanımların her biri. */
  peripheralsToDetach: { id: string; code: string; name: string }[];
  /** Silmeyi engelleyen sebepler (deletable=false iken dolu). */
  blockers: { key: string; count: number; message: string }[];
}

/** Makine kalıcı silme önizlemesi — onay modalında ne olacağını göstermek için. */
export const getMachineDeletePreview = (id: string) =>
  apiClient
    .get<{ success: boolean; data: MachineDeletePreview }>(`/api/machines/${id}/delete-preview`)
    .then((r) => r.data.data);
