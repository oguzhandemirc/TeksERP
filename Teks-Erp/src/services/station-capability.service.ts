// =============================================================================
// TeksERP - Station Capability Service
// =============================================================================
// Bir istasyonun uygulayabileceği renk + özellik yetkinliklerini yönetir.
// İş Kuralı: WO planlamada hedef rengin/özelliğin atandığı adımın istasyonu
// bu yetkinliğe sahip OLMAK ZORUNDA. Yetkinlik = StationColor / StationProperty
// tablolarındaki kayıt.
//
// API: GET ve PUT — bulk get / bulk replace pattern.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";

export interface StationCapabilityDto {
  stationId: string;
  stationCode: string;
  stationName: string;
  colors: { id: string; code: string; name: string; hex: string | null }[];
  properties: {
    id: string;
    code: string;
    name: string;
    category: string | null;
  }[];
}

export class StationCapabilityService {
  /**
   * Bir istasyonun mevcut renk + özellik yetkinliklerini döner.
   */
  async findByStation(
    stationId: string,
  ): Promise<ApiResponse<StationCapabilityDto>> {
    const station = await prisma.station.findUnique({
      where: { id: stationId },
      select: { id: true, code: true, name: true },
    });
    if (!station) throw AppError.notFound("İstasyon bulunamadı");

    const [colorRows, propertyRows] = await Promise.all([
      prisma.stationColor.findMany({
        where: { stationId },
        include: {
          color: {
            select: { id: true, code: true, name: true, hex: true, isActive: true },
          },
        },
      }),
      prisma.stationProperty.findMany({
        where: { stationId },
        include: {
          property: {
            select: {
              id: true,
              code: true,
              name: true,
              category: true,
              isActive: true,
            },
          },
        },
      }),
    ]);

    return {
      success: true,
      data: {
        stationId: station.id,
        stationCode: station.code,
        stationName: station.name,
        colors: colorRows
          .filter((r) => r.color.isActive)
          .map((r) => ({
            id: r.color.id,
            code: r.color.code,
            name: r.color.name,
            hex: r.color.hex,
          })),
        properties: propertyRows
          .filter((r) => r.property.isActive)
          .map((r) => ({
            id: r.property.id,
            code: r.property.code,
            name: r.property.name,
            category: r.property.category,
          })),
      },
    };
  }

  /**
   * Bir istasyonun renk + özellik yetkinliklerini topluca değiştirir.
   * Eski liste silinip yeni liste yazılır (replace semantics).
   * Audit'e tek CUD logu yazılır (yetkinlik bütünü tek kayıt gibi davranır).
   */
  async setCapabilities(
    stationId: string,
    data: { colorIds: string[]; propertyIds: string[] },
    userId?: string,
  ): Promise<ApiResponse<StationCapabilityDto>> {
    const station = await prisma.station.findUnique({
      where: { id: stationId },
      select: { id: true, code: true, name: true, isActive: true },
    });
    if (!station) throw AppError.notFound("İstasyon bulunamadı");
    if (!station.isActive) {
      throw AppError.badRequest("Pasif istasyona yetkinlik atanamaz");
    }

    // Renk + özellik referans doğrulaması (her biri DB'de var ve aktif mi?)
    if (data.colorIds.length > 0) {
      const colors = await prisma.color.findMany({
        where: { id: { in: data.colorIds }, isActive: true },
        select: { id: true },
      });
      if (colors.length !== new Set(data.colorIds).size) {
        throw AppError.badRequest(
          "Bazı renkler bulunamadı veya pasif durumda",
        );
      }
    }
    if (data.propertyIds.length > 0) {
      const props = await prisma.fabricProperty.findMany({
        where: { id: { in: data.propertyIds }, isActive: true },
        select: { id: true },
      });
      if (props.length !== new Set(data.propertyIds).size) {
        throw AppError.badRequest(
          "Bazı özellikler bulunamadı veya pasif durumda",
        );
      }
    }

    // Eski snapshot — audit için
    const [oldColors, oldProperties] = await Promise.all([
      prisma.stationColor.findMany({
        where: { stationId },
        select: { colorId: true },
      }),
      prisma.stationProperty.findMany({
        where: { stationId },
        select: { propertyId: true },
      }),
    ]);

    const newColorSet = new Set(data.colorIds);
    const newPropertySet = new Set(data.propertyIds);

    await prisma.$transaction(async (tx) => {
      // Color: silinecekler ve eklenecekler
      const oldColorSet = new Set(oldColors.map((r) => r.colorId));
      const colorsToDelete = oldColors
        .map((r) => r.colorId)
        .filter((id) => !newColorSet.has(id));
      const colorsToAdd = data.colorIds.filter((id) => !oldColorSet.has(id));

      if (colorsToDelete.length > 0) {
        await tx.stationColor.deleteMany({
          where: { stationId, colorId: { in: colorsToDelete } },
        });
      }
      if (colorsToAdd.length > 0) {
        await tx.stationColor.createMany({
          data: colorsToAdd.map((colorId) => ({ stationId, colorId })),
          skipDuplicates: true,
        });
      }

      // Property: silinecekler ve eklenecekler
      const oldPropertySet = new Set(oldProperties.map((r) => r.propertyId));
      const propertiesToDelete = oldProperties
        .map((r) => r.propertyId)
        .filter((id) => !newPropertySet.has(id));
      const propertiesToAdd = data.propertyIds.filter(
        (id) => !oldPropertySet.has(id),
      );

      if (propertiesToDelete.length > 0) {
        await tx.stationProperty.deleteMany({
          where: { stationId, propertyId: { in: propertiesToDelete } },
        });
      }
      if (propertiesToAdd.length > 0) {
        await tx.stationProperty.createMany({
          data: propertiesToAdd.map((propertyId) => ({
            stationId,
            propertyId,
          })),
          skipDuplicates: true,
        });
      }
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "STATION_CAPABILITY",
      recordId: stationId,
      oldData: {
        colorIds: oldColors.map((r) => r.colorId),
        propertyIds: oldProperties.map((r) => r.propertyId),
      },
      newData: {
        colorIds: data.colorIds,
        propertyIds: data.propertyIds,
      },
    });

    return this.findByStation(stationId);
  }

  /**
   * Tüm istasyonların yetkinlik özetini döner (UI'da liste için).
   */
  async listAll(): Promise<
    ApiResponse<
      {
        stationId: string;
        stationCode: string;
        stationName: string;
        colorCount: number;
        propertyCount: number;
      }[]
    >
  > {
    const stations = await prisma.station.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        _count: {
          select: { colorCapabilities: true, propertyCapabilities: true },
        },
      },
      orderBy: { code: "asc" },
    });

    return {
      success: true,
      data: stations.map((s) => ({
        stationId: s.id,
        stationCode: s.code,
        stationName: s.name,
        colorCount: s._count.colorCapabilities,
        propertyCount: s._count.propertyCapabilities,
      })),
    };
  }

  /**
   * Tüm istasyonların yetkinlik DETAYINI tek seferde döner.
   * UI için: WO oluştururken adım-renk/özellik filtreleme tek istek ile çözülür.
   */
  async listAllDetailed(): Promise<ApiResponse<StationCapabilityDto[]>> {
    const stations = await prisma.station.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        colorCapabilities: {
          include: {
            color: {
              select: {
                id: true,
                code: true,
                name: true,
                hex: true,
                isActive: true,
              },
            },
          },
        },
        propertyCapabilities: {
          include: {
            property: {
              select: {
                id: true,
                code: true,
                name: true,
                category: true,
                isActive: true,
              },
            },
          },
        },
      },
      orderBy: { code: "asc" },
    });

    return {
      success: true,
      data: stations.map((s) => ({
        stationId: s.id,
        stationCode: s.code,
        stationName: s.name,
        colors: s.colorCapabilities
          .filter((r) => r.color.isActive)
          .map((r) => ({
            id: r.color.id,
            code: r.color.code,
            name: r.color.name,
            hex: r.color.hex,
          })),
        properties: s.propertyCapabilities
          .filter((r) => r.property.isActive)
          .map((r) => ({
            id: r.property.id,
            code: r.property.code,
            name: r.property.name,
            category: r.property.category,
          })),
      })),
    };
  }
}
