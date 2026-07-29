// =============================================================================
// TeksERP - Customer Standalone Label Service (Serbest Etiket Bağı)
// =============================================================================
// Müşteriye bağlı SERBEST (statik) etiketler — M:N kolaylık bağı. ROTA DEĞİL:
// rulo/kartela etiket çözümüne (label-routing.resolver / CustomerTemplateRoute)
// KATILMAZ. Yalnız baskı ekranındaki serbest etiket seçicisini müşteriye göre
// filtrelemek için. Bağ OPSİYONEL: hiç bağı olmayan serbest şablon "genel"dir
// ve her müşteride görünür (bkz. LabelService.listStandaloneTemplates).
// Emsal desen: CustomerTemplateRouteService (list/set + AuditService).
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";

const TABLE = "CUSTOMER_STANDALONE_LABEL";

export interface StandaloneLabelRow {
  id: string;
  name: string;
}

export class CustomerStandaloneLabelService {
  /** Müşterinin bağlı, aktif + kalıcı-silinmemiş serbest etiketleri. */
  async list(customerId: string): Promise<ApiResponse<StandaloneLabelRow[]>> {
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw AppError.notFound("Müşteri bulunamadı");
    const rows = await prisma.customerStandaloneLabel.findMany({
      where: { customerId, template: { standalone: true, isActive: true, deletedAt: null } },
      select: { template: { select: { id: true, name: true } } },
      orderBy: { template: { name: "asc" } },
    });
    return { success: true, data: rows.map((r) => ({ id: r.template.id, name: r.template.name })) };
  }

  /**
   * Bağ kümesini değiştir (replace-set) — pivot replace (izinli non-soft-delete).
   * Gelen her id AKTİF + kalıcı-silinmemiş + standalone=true olmalı; değilse 400
   * (Türkçe, hangisi olduğunu adıyla belirtir). Boş dizi → gösterilen (aktif)
   * bağlar kalkar.
   *
   * ÖNEMLİ (veri kaybı koruması): Panel yalnız AKTİF serbest etiketleri gösterir;
   * pasif/silinmiş bir şablona olan mevcut bağ checkbox'ta görünmez. Blind full
   * replace yapılırsa o gizli bağ sessizce düşer (şablon tekrar aktifleşince
   * "genel"e dönüp her müşteride görünür). Bu yüzden gelen kümeye, müşterinin
   * GÖRÜNMEYEN (pasif/silinmiş şablonlu) mevcut bağları korunarak eklenir —
   * kullanıcı yalnız gördüğü kümeyi yönetir.
   */
  async set(
    customerId: string,
    templateIds: string[],
    userId?: string,
  ): Promise<ApiResponse<{ customerId: string; templateIds: string[] }>> {
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true } });
    if (!customer) throw AppError.notFound("Müşteri bulunamadı");

    // Dedupe — aynı id iki kez gelirse createMany @@unique çakışmasın.
    const incoming = [...new Set(templateIds)];

    if (incoming.length > 0) {
      const templates = await prisma.labelTemplate.findMany({
        where: { id: { in: incoming } },
        select: { id: true, name: true, isActive: true, deletedAt: true, standalone: true },
      });
      const byId = new Map(templates.map((t) => [t.id, t]));
      for (const id of incoming) {
        const t = byId.get(id);
        if (!t || !t.isActive || t.deletedAt != null) throw AppError.badRequest("Şablon bulunamadı veya pasif");
        if (!t.standalone) throw AppError.badRequest(`『${t.name}』 serbest etiket değil — bağlanamaz`);
      }
    }

    // Panelin göstermediği (pasif/silinmiş şablonlu) mevcut bağları koru.
    const existing = await prisma.customerStandaloneLabel.findMany({
      where: { customerId },
      select: { templateId: true, template: { select: { isActive: true, deletedAt: true } } },
    });
    const hiddenPreserved = existing
      .filter((e) => !e.template.isActive || e.template.deletedAt != null)
      .map((e) => e.templateId);
    const ids = [...new Set([...incoming, ...hiddenPreserved])];

    // Küçük satır kümesi (tek müşteri) — tümünü sil + yenilerini ekle, atomik.
    await prisma.$transaction(async (tx) => {
      await tx.customerStandaloneLabel.deleteMany({ where: { customerId } });
      if (ids.length > 0) {
        await tx.customerStandaloneLabel.createMany({ data: ids.map((templateId) => ({ customerId, templateId })) });
      }
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: customerId,
      newData: { customerName: customer.name, templateIds: ids },
    }).catch(() => undefined);

    return { success: true, data: { customerId, templateIds: ids } };
  }
}
