// Birleştirme uçlarının varlık → içe aktarım adaptörü eşlemesi (izin kodu + etiket adaptörden okunur).
// Kayıt defteri (`import-registry`) DEĞİL: o finans/maliyet adaptörlerini taşır ve rejimsiz birleştirme
// router'ını onların servislerine bağlardı (rejim kapısı bekçileri, 2026-11-01).
import type { MergeEntity } from "../../constants/merge-map";
import type { ImportAdapter } from "./import.types";
import { customerImportAdapter } from "./adapters/customer.adapter";
import { itemImportAdapter } from "./adapters/item.adapter";
import { colorImportAdapter } from "./adapters/color.adapter";
import { subcontractorImportAdapter } from "./adapters/subcontractor.adapter";

/** `MergeEntity` anahtarlı — yeni birleştirme varlığı adaptörü eklenmeden derlenmez. */
export const MERGE_ADAPTERS: Record<MergeEntity, ImportAdapter> = {
  customer: customerImportAdapter,
  item: itemImportAdapter,
  color: colorImportAdapter,
  subcontractor: subcontractorImportAdapter,
};
