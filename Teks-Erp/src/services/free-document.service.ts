// =============================================================================
// Free Document Service — serbest belge (veri-bağsız, admin-yazımı)
// =============================================================================
// Üst yazı / tutanak / dekont / duyuru gibi sisteme bağlı olmayan belgeler.
// CRUD + baskı-hazır HTML render (antet/logo/damga/blok stil katmanı reuse).
// =============================================================================

import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { ApiResponse } from "../types/api.types";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { nextSeriesNo } from "./number-series.service";
import {
  readCompanyName,
  readCompanyLetterhead,
  readDocumentsLogo,
  sanitizeDocumentsConfig,
  type DocumentConfig,
} from "./system-setting.service";
import { renderFreeDocumentHtml } from "./document-render/free-document.html";

const TABLE = "FREE_DOCUMENT";
const DOC_PREFIX = "SB";

export interface FreeDocumentInput {
  title?: string;
  recipient?: string | null;
  body?: string;
  config?: unknown;
  isActive?: boolean;
}

/** Tek DocumentConfig'i süz (map-sanitizer'ı sar). */
function sanitizeConfig(raw: unknown): DocumentConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return sanitizeDocumentsConfig({ free: raw as Record<string, unknown> }).free ?? {};
}

async function nextFreeDocNo(): Promise<string> {
  // ⚠️ TEK TARİH — `nextCustomerCode` gerekçesi ("iki tarih" sınıfı): ön ek ve kod
  // AYNI `now`dan kurulur; `nextSeriesNo` tarihi tek argüman olarak taşır.
  // ⚠️ C0 KAPSAMI: sayaç yalnız BU BİÇİM yürürlüğe girdikten sonra doğan kodlara
  // bakar (`formatChangedAt`); tarih segmenti düşünce eski rejimin kodları sayaca
  // girerdi. `nextSeriesNo` kapsamı ve çakışma atlamasını TEK YERDE tutar.
  return nextSeriesNo("freeDocument", async (prefix) =>
    prisma.freeDocument.findMany({
      where: { documentNo: { gte: prefix, startsWith: prefix } },
      select: { documentNo: true, createdAt: true },
    }).then((rows) => rows.map((r) => ({ code: r.documentNo, createdAt: r.createdAt }))), new Date());
}

function shape(input: FreeDocumentInput, isCreate: boolean) {
  const out: { title?: string; recipient?: string | null; body?: string; config?: Prisma.InputJsonValue; isActive?: boolean } = {};
  if (input.title !== undefined) {
    const title = String(input.title).trim().slice(0, 120);
    if (isCreate && !title) throw AppError.badRequest("Belge başlığı gerekli");
    if (title) out.title = title;
  }
  if (input.recipient !== undefined) {
    out.recipient = typeof input.recipient === "string" ? input.recipient.trim().slice(0, 200) || null : null;
  }
  if (input.body !== undefined) {
    out.body = String(input.body).slice(0, 20000);
  }
  if (input.config !== undefined) {
    out.config = sanitizeConfig(input.config) as unknown as Prisma.InputJsonValue;
  }
  if (typeof input.isActive === "boolean") out.isActive = input.isActive;
  return out;
}

export class FreeDocumentService {
  async list(withInactive: boolean): Promise<ApiResponse<unknown[]>> {
    const rows = await prisma.freeDocument.findMany({
      where: withInactive ? {} : { isActive: true },
      orderBy: { createdAt: "desc" },
      select: { id: true, documentNo: true, title: true, recipient: true, isActive: true, updatedAt: true, createdAt: true },
      take: 500,
    });
    return { success: true, data: rows };
  }

  async get(id: string): Promise<ApiResponse<unknown>> {
    const doc = await prisma.freeDocument.findUnique({ where: { id } });
    if (!doc) throw AppError.notFound("Belge bulunamadı");
    return { success: true, data: doc };
  }

  async create(input: FreeDocumentInput, userId?: string): Promise<ApiResponse<unknown>> {
    const data = shape(input, true);
    if (!data.title) throw AppError.badRequest("Belge başlığı gerekli");
    const created = await withBarcodeRetry(async () => {
      const documentNo = await nextFreeDocNo();
      return prisma.freeDocument.create({
        data: {
          documentNo,
          title: data.title!,
          recipient: data.recipient ?? null,
          body: data.body ?? "",
          config: data.config ?? {},
          createdById: userId ?? null,
        },
      });
    });
    await AuditService.log({ userId, action: "CREATE", tableName: TABLE, recordId: created.id, newData: { documentNo: created.documentNo, title: created.title } });
    return { success: true, data: created, message: `Serbest belge oluşturuldu: ${created.documentNo}` };
  }

  async update(id: string, input: FreeDocumentInput, userId?: string): Promise<ApiResponse<unknown>> {
    const data = shape(input, false);
    try {
      const updated = await prisma.freeDocument.update({ where: { id }, data });
      await AuditService.log({ userId, action: "UPDATE", tableName: TABLE, recordId: id, newData: { title: updated.title, isActive: updated.isActive } });
      return { success: true, data: updated, message: "Belge güncellendi" };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") throw AppError.notFound("Belge bulunamadı");
      throw err;
    }
  }

  async deactivate(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    return this.update(id, { isActive: false }, userId);
  }

  /** Baskı-hazır HTML — antet/logo/damga/blok stil katmanı reuse. */
  async renderHtml(id: string, opts?: { printedBy?: string | null; printNote?: string | null }): Promise<ApiResponse<{ html: string }>> {
    const doc = await prisma.freeDocument.findUnique({ where: { id } });
    if (!doc) throw AppError.notFound("Belge bulunamadı");
    const [companyName, letterhead, logo] = [await readCompanyName(prisma), await readCompanyLetterhead(prisma), await readDocumentsLogo(prisma)];
    const cfg = sanitizeConfig(doc.config);
    const now = new Date();
    const p = (x: number) => String(x).padStart(2, "0");
    const html = renderFreeDocumentHtml(
      {
        company: { name: companyName, letterhead, logoHash: logo.current },
        config: cfg,
        doc: { documentNo: doc.documentNo, title: doc.title, recipient: doc.recipient, body: doc.body, date: doc.createdAt.toISOString() },
      },
      {
        logoDataUrl: logo.current ? (logo.items[logo.current] ?? null) : null,
        printedAtText: `${p(now.getDate())}.${p(now.getMonth() + 1)}.${now.getFullYear()} ${p(now.getHours())}:${p(now.getMinutes())}`,
        printedBy: opts?.printedBy ?? null,
        printNote: opts?.printNote?.trim().slice(0, 300) || null,
      },
    );
    return { success: true, data: { html } };
  }
}

export const freeDocumentService = new FreeDocumentService();
