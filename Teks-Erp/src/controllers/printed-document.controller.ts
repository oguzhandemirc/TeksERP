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

/** Görünüm ayarı — değerler render'da resolveDocStyle ile ayrıca clamp'lenir. */
const docStyleSchema = z.object({
  pageSize: z.enum(["A4", "A5"]).optional(),
  margins: z
    .object({
      top: z.number().optional(),
      right: z.number().optional(),
      bottom: z.number().optional(),
      left: z.number().optional(),
    })
    .optional(),
  fontScale: z.number().optional(),
  fontWeight: z.enum(["light", "normal", "bold"]).optional(),
  tableDensity: z.enum(["compact", "normal", "relaxed"]).optional(),
  tableStyle: z.enum(["grid", "zebra", "plain"]).optional(),
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
    style: docStyleSchema.optional(),
    showLogo: z.boolean().optional(),
    logoPosition: z.enum(["left", "right"]).optional(),
    columns: z
      .record(
        z.string(),
        z.object({
          hidden: z.array(z.string()).optional(),
          order: z.array(z.string()).optional(),
        }),
      )
      .optional(),
    qr: z.boolean().optional(),
    stamps: z
      .object({
        printedAt: z.boolean().optional(),
        printedBy: z.boolean().optional(),
        copyLabel: z.string().max(20).optional(),
      })
      .optional(),
    blocks: z
      .array(
        z.object({
          position: z.enum(["afterHeader", "beforeSignatures"]),
          text: z.string().max(500),
        }),
      )
      .max(4)
      .optional(),
    language: z.enum(["tr", "en", "auto"]).optional(),
    blankWidths: z.boolean().optional(),
    footerNotePlacement: z.enum(["top", "bottom"]).optional(),
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
      const result = await printedDocumentService.getCurrent(docType, sourceId, {
        computeTemplateStale: true,
      });
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
      // ?currentTemplate=1 → içerik donuk kalır, görünüm (şablon+künye) güncel
      // ayardan çözülür (yeniden baskıda "güncel şablonla" seçeneği).
      const useCurrentConfig =
        req.query.currentTemplate === "1" || req.query.currentTemplate === "true";
      // ?printNote= → tek seferlik baskı notu (persist edilmez, yalnız bu render).
      const printNote =
        typeof req.query.printNote === "string" ? req.query.printNote.slice(0, 300) : null;
      // ?rowNotes=1 → satır notlarını (çuval yorumu) BU baskıda göster. Kalıcı kolon
      // ayarını EZER (OR); ayara da snapshot'a da YAZILMAZ, yeni versiyon doğurmaz.
      const forceRowNotes = req.query.rowNotes === "1" || req.query.rowNotes === "true";
      const result = await printedDocumentService.getHtml(docType, sourceId, version, {
        allowDraft,
        useCurrentConfig,
        printedBy: req.user?.username ?? null,
        printNote,
        forceRowNotes,
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
