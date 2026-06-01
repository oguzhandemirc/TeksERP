// Kanban'ın "Kurşun Bekleyen" / "Tambur Bekleyen" kolonları için kuyruk verisi.
// Bunlar rulo statüsü değil, istasyon kuyruğu (refakat kartı / WO seviyesi).
// İki farklı backend endpoint'ini tek kart tipine (KanbanQueueCard) normalize eder.

import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import { kursunQueueService } from "@/pages/Operations/KursunQueue/service";

/** Kurşun/Tambur kolonlarının ortak kart şekli — parti (refakat kartı) bazında. */
export interface KanbanQueueCard {
  id: string;
  itemName: string | null;
  colorName: string | null;
  colorHex: string | null;
  openRollCount: number;
  totalCurrentQty: number;
  batchNumber: string;
  isUrgent: boolean;
}

interface QueueResult {
  cards: KanbanQueueCard[];
  total: number;
}

interface TamburOpenCard {
  stepId: string;
  batchNumber: string;
  openRollCount: number;
  totalCurrentQty: number;
  itemName: string | null;
  colorName: string | null;
  colorHex: string | null;
}

/** PROCESS_QC (Kurşun + KK2) kuyruğu. */
export async function fetchKursunQueueCards(): Promise<QueueResult> {
  const res = await kursunQueueService.list();
  const items = res.data ?? [];
  return {
    total: items.length,
    cards: items.map((i) => ({
      id: i.workOrderStepId,
      itemName: i.itemName,
      colorName: i.colorName,
      colorHex: i.colorHex,
      openRollCount: i.openRollCount,
      totalCurrentQty: i.totalCurrentQty,
      batchNumber: i.batchNumber,
      isUrgent: i.isUrgent,
    })),
  };
}

/** TAMBUR'da bekleyen açık refakat kartları. */
export async function fetchTamburQueueCards(): Promise<QueueResult> {
  const res = await apiClient.get<ApiResponse<TamburOpenCard[]>>("/api/tambur/open-cards");
  const items = res.data.data ?? [];
  return {
    total: items.length,
    cards: items.map((i) => ({
      id: i.stepId,
      itemName: i.itemName,
      colorName: i.colorName,
      colorHex: i.colorHex,
      openRollCount: i.openRollCount,
      totalCurrentQty: i.totalCurrentQty,
      batchNumber: i.batchNumber,
      isUrgent: false,
    })),
  };
}
