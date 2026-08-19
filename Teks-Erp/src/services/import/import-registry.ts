// =============================================================================
// İÇE AKTARIM KAYIT DEFTERİ — desteklenen varlıklar
// =============================================================================
// Yeni bir varlık eklemek = buraya BİR satır. Uçlar, izin kontrolü, şablon
// üretimi ve panel menüsü hepsi bu listeden beslenir; ikinci bir liste tutulmaz
// (izin kataloğu dersi: kopyalanan liste zamanla ayrışır).
//
// ⚠️ `writePermission` katalogda TANIMLI bir kod olmalı (`permission-catalog.ts`)
// — bekçi `scripts/test_import_registry.ts` bunu mekanik doğrular.

import { AppError } from "../../utils/app-error";
import type { ImportAdapter } from "./import.types";
import { colorImportAdapter } from "./adapters/color.adapter";
import { customerImportAdapter } from "./adapters/customer.adapter";
import { customerBranchImportAdapter } from "./adapters/customer-branch.adapter";
import { itemImportAdapter } from "./adapters/item.adapter";
import { defectTypeImportAdapter } from "./adapters/defect-type.adapter";
import { returnReasonImportAdapter } from "./adapters/return-reason.adapter";
import { qualityGradeImportAdapter } from "./adapters/quality-grade.adapter";
import { stationImportAdapter } from "./adapters/station.adapter";
import { machineImportAdapter } from "./adapters/machine.adapter";
import { fabricPropertyImportAdapter } from "./adapters/fabric-property.adapter";
import { subcontractorCategoryImportAdapter } from "./adapters/subcontractor-category.adapter";
import { subcontractorImportAdapter } from "./adapters/subcontractor.adapter";
import { customerItemAliasImportAdapter, customerColorAliasImportAdapter } from "./adapters/customer-alias.adapter";
import { productRecipeImportAdapter } from "./adapters/product-recipe.adapter";
import { routeImportAdapter } from "./adapters/route.adapter";
import { orderImportAdapter } from "./adapters/order.adapter";

const ADAPTERS: ImportAdapter[] = [
  // — Ana veri (F1 pilotları)
  itemImportAdapter,
  customerImportAdapter,
  customerBranchImportAdapter,
  colorImportAdapter,
  // — Ana veri (F2)
  fabricPropertyImportAdapter,
  qualityGradeImportAdapter,
  defectTypeImportAdapter,
  returnReasonImportAdapter,
  stationImportAdapter,
  machineImportAdapter,
  subcontractorCategoryImportAdapter,
  subcontractorImportAdapter,
  customerItemAliasImportAdapter,
  customerColorAliasImportAdapter,
  productRecipeImportAdapter,
  routeImportAdapter,
  // — İşlem verisi (F4)
  orderImportAdapter,
];

const BY_ENTITY = new Map(ADAPTERS.map((a) => [a.entity, a]));

export function listAdapters(): ImportAdapter[] {
  return ADAPTERS;
}

export function getImportAdapter(entity: string): ImportAdapter {
  const a = BY_ENTITY.get(entity);
  if (!a) {
    throw AppError.notFound(
      `Bilinmeyen içe aktarım türü: '${entity}'. Desteklenenler: ${ADAPTERS.map((x) => x.entity).join(", ")}`,
    );
  }
  return a;
}
