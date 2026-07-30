// =============================================================================
// TeksERP - Customer Template Route Service (Etiket Stüdyosu v2)
// =============================================================================
// Müşteriye özel etiket şablonu ataması: (customerId, kind) → LabelTemplate.
// Çözüm zincirindeki yeri: explicit > MÜŞTERİ > cihaz route > bağlam default
// (label-routing.resolver). Müşterisiz/stok baskıda hiç sorgulanmaz.
// Emsal desen: CustomerColorAlias + PeripheralTemplateRoute.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { assertTemplateAssignable } from "./label-template.service";
import type { LabelKind } from "@prisma/client";

const TABLE = "CUSTOMER_TEMPLATE_ROUTE";

export interface CustomerTemplateRouteRow {
  kind: LabelKind;
  templateId: string;
  templateName: string;
  templateActive: boolean;
}

export class CustomerTemplateRouteService {
  async list(customerId: string): Promise<ApiResponse<CustomerTemplateRouteRow[]>> {
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw AppError.notFound("Müşteri bulunamadı");
    const rows = await prisma.customerTemplateRoute.findMany({
      where: { customerId },
      include: { template: { select: { id: true, name: true, isActive: true, deletedAt: true } } },
      orderBy: { kind: "asc" },
    });
    return {
      success: true,
      data: rows.map((r) => ({
        kind: r.kind,
        templateId: r.templateId,
        templateName: r.template.name,
        templateActive: r.template.isActive && r.template.deletedAt == null,
      })),
    };
  }

  /** Atama upsert / kaldır (templateId null → o bağlam için müşteri şablonu yok —
   *  cihaz route / bağlam default'una düşülür). */
  async set(
    customerId: string,
    kind: LabelKind,
    templateId: string | null,
    userId?: string,
  ): Promise<ApiResponse<{ customerId: string; kind: LabelKind; templateId: string | null }>> {
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true } });
    if (!customer) throw AppError.notFound("Müşteri bulunamadı");

    if (!templateId) {
      await prisma.customerTemplateRoute.deleteMany({ where: { customerId, kind } });
    } else {
      // Tek havuz: tür şartı yok — yalnız var + aktif + kalıcı-silinmemiş. Ama
      // bağlamın KİMLİK alanını basamayan şablon reddedilir (label-context-fit).
      const tpl = await prisma.labelTemplate.findFirst({
        where: { id: templateId, isActive: true, deletedAt: null },
        select: { id: true },
      });
      if (!tpl) throw AppError.badRequest("Şablon bulunamadı veya pasif");
      // Statik etiket kuralı: barkodsuz varyantlı şablon müşteriye ATANAMAZ (kaldırma serbest).
      await assertTemplateAssignable(templateId, kind);
      await prisma.customerTemplateRoute.upsert({
        where: { customerId_kind: { customerId, kind } },
        update: { templateId },
        create: { customerId, kind, templateId },
      });
    }

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: customerId,
      newData: { customerName: customer.name, kind, templateId: templateId ?? null },
    }).catch(() => undefined);

    return { success: true, data: { customerId, kind, templateId: templateId ?? null } };
  }
}
