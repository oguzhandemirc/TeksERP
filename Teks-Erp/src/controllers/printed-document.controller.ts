// =============================================================================
// TeksERP - Printed Document Controller (resmi belge defteri)
// =============================================================================
// Versiyonlu irsaliye/çeki belgeleri: güncel belge + versiyon listesi + tek
// versiyon + gerekçeli revizyon (reissue). docType path paramı PrintedDocType
// enum'una zod ile doğrulanır; izinler route katmanında docType'a göre eşlenir.

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { PrintedDocType } from "@prisma/client";
import { printedDocumentService } from "../services/printed-document.service";
import "../types/express-augment";

const docTypeSchema = z.nativeEnum(PrintedDocType);
const sourceIdSchema = z.string().uuid("Geçersiz kaynak ID");
const versionSchema = z.coerce.number().int().positive("Geçersiz versiyon");

const reissueSchema = z.object({
  reason: z.string().trim().min(3, "Revizyon gerekçesi en az 3 karakter").max(500),
});

/** Belge Şablonu önizlemesi — admin'in düzenlediği taslak içerik ayarı (ResolvedDocConfig). */
const docConfigSchema = z
  .object({
    titleOverride: z.string().optional(),
    showLetterhead: z.boolean().optional(),
    sections: z.record(z.string(), z.boolean()).optional(),
    signatureLabels: z.array(z.string()).optional(),
    showSignatures: z.boolean().optional(),
    footerNote: z.string().optional(),
  })
  .nullable();

const sampleHtmlSchema = z.object({ config: docConfigSchema.optional() });

function parseParams(req: Request): { docType: PrintedDocType; sourceId: string } {
  return {
    docType: docTypeSchema.parse(req.params.docType),
    sourceId: sourceIdSchema.parse(req.params.sourceId),
  };
}

export class PrintedDocumentController {
  constructor() {
    this.getCurrent = this.getCurrent.bind(this);
    this.getHtml = this.getHtml.bind(this);
    this.getSampleHtml = this.getSampleHtml.bind(this);
    this.listVersions = this.listVersions.bind(this);
    this.getVersion = this.getVersion.bind(this);
    this.reissue = this.reissue.bind(this);
  }

  /** GET /api/printed-documents/:docType/:sourceId/current */
  async getCurrent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { docType, sourceId } = parseParams(req);
      const result = await printedDocumentService.getCurrent(docType, sourceId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/printed-documents/:docType/:sourceId/html
   * Baskı-hazır HTML (TEK KAYNAK) — mobil expo-print + Electron printHtmlString
   * aynı HTML'i basar. Kaynak henüz taslaksa 409.
   */
  async getHtml(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { docType, sourceId } = parseParams(req);
      const version =
        req.query.version != null
          ? versionSchema.parse(req.query.version)
          : undefined;
      // ?draft=1 → donmuş belge yoksa canlı TASLAK önizlemesi (sevk öncesi baskı).
      const allowDraft = req.query.draft === "1" || req.query.draft === "true";
      const result = await printedDocumentService.getHtml(docType, sourceId, version, {
        allowDraft,
      });
      const data = result.data as { html: string } | null;
      if (!data) {
        res
          .status(409)
          .json({ success: false, message: "Belge henüz hazır değil (taslak)." });
        return;
      }
      res.type("html").send(data.html);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/printed-documents/:docType/sample-html
   * Belge Şablonu canlı önizlemesi — örnek veri + gönderilen taslak config ile
   * gerçek renderHtml çıktısı (TASLAK filigranlı). Persist edilmez.
   */
  async getSampleHtml(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const docType = docTypeSchema.parse(req.params.docType);
      const { config } = sampleHtmlSchema.parse(req.body ?? {});
      const html = await printedDocumentService.renderSampleHtml(docType, config ?? null);
      res.type("html").send(html);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/printed-documents/:docType/:sourceId/versions */
  async listVersions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { docType, sourceId } = parseParams(req);
      const result = await printedDocumentService.listVersions(docType, sourceId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/printed-documents/:docType/:sourceId/versions/:version */
  async getVersion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { docType, sourceId } = parseParams(req);
      const version = versionSchema.parse(req.params.version);
      const result = await printedDocumentService.getVersion(docType, sourceId, version);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/printed-documents/:docType/:sourceId/reissue */
  async reissue(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { docType, sourceId } = parseParams(req);
      const { reason } = reissueSchema.parse(req.body);
      const result = await printedDocumentService.reissue(
        docType,
        sourceId,
        reason,
        req.user?.userId
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
}
