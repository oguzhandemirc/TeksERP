// Ürün kartı yaşam döngüsü uçları — `ItemLifecycleDialog` / `ItemLifecycleBadge` varsayılanı (hizmet kartı kendi
// nesnesini verir: `Definitions/Services/service.ts`). Sarmalayıcılar `itemService`i ÇAĞRI anında okur.
import type { CardLifecycleApi } from "@/lib/item-lifecycle";
import { itemService } from "./service";

export const itemLifecycleApi: CardLifecycleApi = {
  queryRoot: "items",
  lifecyclePreview: (id, to) => itemService.lifecyclePreview(id, to),
  transitionLifecycle: (id, to, reason) => itemService.transitionLifecycle(id, to, reason),
  lifecycleSummary: (ids) => itemService.lifecycleSummary(ids),
};
