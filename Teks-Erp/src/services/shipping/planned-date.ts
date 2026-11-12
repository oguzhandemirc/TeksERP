// =============================================================================
// Shipping Service / planned-date — planlanan sevk gününü yaz (yalnız PLANNED)
// =============================================================================
// Teslim yeri (`setDeliveryTo`) ile aynı kalıp: atomik claim `WHERE {id, status: PLANNED}`;
// sevk edilmiş/iptal sevkiyatta değer DEĞİŞMEZ (409), yalnız okunur. Audit tx dışında.
// =============================================================================
import { ShipmentStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import type { ApiResponse } from "../../types/api.types";
import { formatPlannedDate } from "../helpers/shipment-planned-date.helper";

export async function setPlannedDate(
  shipmentId: string,
  plannedDate: Date | null,
  userId?: string,
): Promise<ApiResponse<{ shipmentId: string; plannedDate: string | null }>> {
  const claimed = await prisma.shipment.updateMany({
    where: { id: shipmentId, status: ShipmentStatus.PLANNED },
    data: { plannedDate, updatedById: userId ?? null },
  });
  if (claimed.count === 0) {
    const exists = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true } });
    if (!exists) throw AppError.notFound("Sevkiyat bulunamadı");
    throw AppError.conflict("Planlanan sevk tarihi yalnız sevk edilmemiş (planlanan) sevkiyatta değiştirilebilir.", { code: "SHIPMENT_NOT_PLANNED" });
  }
  const value = formatPlannedDate(plannedDate);
  await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "PLANNED_DATE", plannedDate: value } });
  return {
    success: true,
    data: { shipmentId, plannedDate: value },
    message: value ? "Planlanan sevk tarihi güncellendi" : "Planlanan sevk tarihi kaldırıldı",
  };
}
