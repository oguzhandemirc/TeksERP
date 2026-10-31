// ÜRETİLMİŞ BEYAN — `npx tsx scripts/test_yazilabilir_alan_beyani.ts --beyan-yaz`.
// Genel CRUD gövdesinden yazılabilen kolonlar; satır eklemek bilinçli bir "yazılabilir" kararıdır.
export const YAZILABILIR_ALAN_BEYANI: Readonly<Record<string, readonly string[]>> = {
  bankAccount: ["balance", "bankName", "code", "currency", "iban", "isActive", "name", "notes"],
  cashBox: ["balance", "code", "currency", "isActive", "name", "notes"],
  color: ["code", "createdById", "hex", "isActive", "mergedAt", "mergedById", "mergedIntoId", "name", "sortOrder", "updatedById"],
  customer: ["address", "city", "code", "contactName", "contactPhone", "country", "createdById", "defaultDestination", "district", "documentProfileId", "email", "exportCode", "isActive", "isCustomerRole", "isSubcontractorRole", "isSupplierRole", "mergedAt", "mergedById", "mergedIntoId", "name", "notes", "taxNumber", "type", "updatedById"],
  customerBranch: ["address", "city", "code", "contactName", "contactPhone", "createdById", "customerId", "defaultDestination", "district", "isActive", "name", "notes", "updatedById"],
  defectType: ["code", "createdById", "defectGroup", "description", "fixedPoints", "isActive", "isDefault", "name", "severity", "sortOrder", "updatedById"],
  exchangeRate: ["createdById", "currency", "rate", "rateDate", "source"],
  fabricProperty: ["category", "code", "color", "createdById", "description", "isActive", "name", "sortOrder", "serviceItemId", "updatedById", "valueType", "variantOfPropertyId"],
  item: ["code", "composition", "createdById", "finishedGsm", "isActive", "itemType", "lifecycleChangedAt", "lifecycleChangedById", "lifecycleReason", "lifecycleStatus", "linearDensityDen", "mergedAt", "mergedById", "mergedIntoId", "name", "pendingReview", "rawGsm", "rawWidthCm", "unit", "updatedById", "warpSpecId", "weaveDesignId", "weftSpecId", "widthCm"],
  machine: ["code", "createdById", "isActive", "name", "productionLineCount", "stationId", "updatedById", "warpBeamSlots"],
  machineStopCodeMap: ["collectorType", "isActive", "machineId", "rawStopCode", "stopReasonId"],
  order: ["branchId", "cancelReason", "cancelReasonCode", "cancelledAt", "clientToken", "completedAt", "createdById", "currency", "customerId", "deadline", "destination", "manualCloseReason", "manualClosedById", "orderDate", "orderNumber", "shippedQty", "status", "totalAmount", "updatedById"],
  peripheralDevice: ["address", "code", "connectionType", "counterMode", "createdById", "decimals", "deviceId", "identifyPattern", "isActive", "kind", "labelDpi", "labelGapMm", "labelHeightMm", "labelWidthMm", "languageOverride", "machineId", "mediaType", "name", "notes", "pollCommand", "port", "rasterMode", "readMode", "resetCommand", "role", "scale", "simulate", "stationId", "terminator", "timeoutMs", "updatedById"],
  productRecipe: ["code", "colorId", "createdById", "foldType", "isActive", "itemId", "name", "routeId", "updatedById", "variantCode", "width"],
  qualityGrade: ["code", "color", "createdById", "description", "isActive", "name", "returnTargetStatus", "role", "skipCustomerName", "skipLabel", "sortOrder", "targetStatus", "updatedById"],
  returnReason: ["code", "color", "createdById", "description", "isActive", "name", "sortOrder", "updatedById"],
  route: ["code", "createdById", "customerId", "description", "isActive", "isFavorite", "name", "updatedById"],
  station: ["allowAsWorkOrderStep", "appliesColor", "appliesProperty", "appliesQuality", "capturesWidth", "code", "consumesWarpBeam", "createdById", "defaultCategoryId", "defaultLabelCopies", "department", "inspectionEnabled", "isActive", "kind", "name", "producesWarpBeam", "type", "updatedById"],
  warehouse: ["address", "code", "isActive", "name", "notes"],
  warpSpec: ["code", "createdById", "endsCount", "endsPerDent", "isActive", "name", "notes", "reedNo", "reedWidthCm", "selvedgeEnds", "takeUpPct", "updatedById", "wastePct", "yarnItemId"],
};
