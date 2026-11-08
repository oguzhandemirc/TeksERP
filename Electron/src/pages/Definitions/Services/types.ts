// Hizmet kartı — backend `service_items` (D1b) liste/detay şeklinin aynası. Stok/kumaş/renk alanı YOK.
import type { ItemLifecycleStatus } from "@/lib/item-lifecycle";

export interface ServiceItem {
  id: string;
  code: string;
  name: string;
  /** MT · KG · ADET — fatura satırındaki miktar birimi. */
  unit: string;
  isActive: boolean;
  lifecycleStatus?: ItemLifecycleStatus;
  createdAt: string;
  updatedAt: string;
}
