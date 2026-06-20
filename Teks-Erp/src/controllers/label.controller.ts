// =============================================================================
// TeksERP - Label Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { LabelKind } from "@prisma/client";
import { LabelService } from "../services/label.service";
import "../types/express-augment";

const bulkLabelsSchema = z.object({
  rollIds: z.array(z.string().uuid("Geçersiz top ID")).min(1, "En az bir top").max(2000),
  copies: z.number().int().min(1).max(5).optional(),
});

const updateNamesSchema = z.object({
  customerItemName:  z.string().max(200).nullable().optional(),
  customerColorName: z.string().max(200).nullable().optional(),
});

const previewSchema = z.object({
  kind: z.enum([LabelKind.ROLL_RAW, LabelKind.ROLL_FINISHED, LabelKind.SWATCH]),
  fields: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    order: z.number().int().min(1),
    isVisible: z.boolean(),
    isBold: z.boolean().optional(),
    fontSize: z.enum(["sm", "md", "lg", "xl"]).optional(),
  })),
});

// Test Et: örnek etiketi verilen yazıcıya gönder (Faz-2 doğrulama).
const testNativeSchema = z.object({
  profileId: z.string().uuid("Geçersiz profil ID").optional(),
  printerIp: z.string().trim().min(3, "Yazıcı IP gerekli").max(64),
  port: z.number().int().min(1).max(65535).optional(),
  language: z.enum(["RASTER_HTML", "PPLA", "PPLB", "ZPL"]).optional(),
});

/**
 * Fiziksel format çözümü girdisi: explicit ?profileId= veya makine bağlamı.
 * machineId — mobil isteklerde device.middleware'den (req.device.machineId) OTO;
 * Electron'da yoksa opsiyonel ?machineId= query. Yoksa resolver sistem-default'a düşer.
 */
function parseFormatOpts(req: Request): { profileId?: string; machineId?: string } {
  const machineId =
    req.device?.machineId ??
    (typeof req.query.machineId === "string" ? req.query.machineId : undefined);
  return {
    profileId: typeof req.query.profileId === "string" ? req.query.profileId : undefined,
    machineId: machineId ?? undefined,
  };
}

export class LabelController {
  private service = new LabelService();

  getRollLabel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getRollLabel(req.params.id as string, {
        orderLineId: typeof req.query.orderLineId === "string" ? req.query.orderLineId : undefined,
        customerId: typeof req.query.customerId === "string" ? req.query.customerId : undefined,
        stock: req.query.stock === "1" || req.query.stock === "true",
      });
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /**
   * Roll etiketinin tam HTML'i. Mobil expo-print bunu basar, Electron iframe
   * srcDoc ile preview gösterir. Kind otomatik (renksiz STOCK SUPPLIER → RAW,
   * aksi FINISHED); `?kind=ROLL_RAW|ROLL_FINISHED` ile override.
   *
   * Response: text/html (raw), JSON sarmalama yok — iframe ve Print için direkt.
   */
  /**
   * Şablon düzenleme önizlemesi için HTML. Body: { kind, fields[] }. Henüz
   * kaydedilmemiş değişiklikleri preview için backend render eder; Electron
   * iframe srcDoc ile gösterir. text/html döner.
   */
  getPreviewHtml = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = previewSchema.parse(req.body);
      const result = await this.service.getPreviewHtml(body);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(result.data.html);
    } catch (e) { next(e); }
  };

  getRollLabelHtml = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const kindParam = typeof req.query.kind === "string" ? req.query.kind : undefined;
      const kindOverride =
        kindParam === LabelKind.ROLL_RAW || kindParam === LabelKind.ROLL_FINISHED
          ? (kindParam as LabelKind)
          : undefined;
      const result = await this.service.getRollLabelHtml(
        req.params.id as string,
        kindOverride,
        {
          orderLineId: typeof req.query.orderLineId === "string" ? req.query.orderLineId : undefined,
          customerId: typeof req.query.customerId === "string" ? req.query.customerId : undefined,
          stock: req.query.stock === "1" || req.query.stock === "true",
          // Saha #6: ?copies= override — verilmezse label.copies ayarı (default 2).
          copies:
            typeof req.query.copies === "string" && /^\d+$/.test(req.query.copies)
              ? parseInt(req.query.copies, 10)
              : undefined,
          ...parseFormatOpts(req),
        },
      );
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Label-Kind", result.data.kind);
      res.status(200).send(result.data.html);
    } catch (e) { next(e); }
  };

  /**
   * Rolün Argox PPLA native komut string'i (text/plain). `/html`'in native analoğu.
   * Faz-1: yalnız ÜRETİLİR (gönderim simüle). Format profili `/html` ile aynı resolver.
   */
  getRollLabelPpla = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getRollLabelPpla(req.params.id as string, {
        orderLineId: typeof req.query.orderLineId === "string" ? req.query.orderLineId : undefined,
        customerId: typeof req.query.customerId === "string" ? req.query.customerId : undefined,
        stock: req.query.stock === "1" || req.query.stock === "true",
        copies:
          typeof req.query.copies === "string" && /^\d+$/.test(req.query.copies)
            ? parseInt(req.query.copies, 10)
            : undefined,
        ...parseFormatOpts(req),
      });
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.status(200).send(result.data.ppla);
    } catch (e) { next(e); }
  };

  /**
   * Rolün etiketini SEÇİLİ dilde döner — global ayar `label.printerLanguage`
   * (default PPLA) veya istasyon yazıcı modelinin dili. RASTER_HTML → text/html;
   * PPLA/PPLB/ZPL → text/plain native komut. Dil X-Label-Language header'ında.
   */
  getRollLabelNative = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getRollLabelNative(req.params.id as string, {
        orderLineId: typeof req.query.orderLineId === "string" ? req.query.orderLineId : undefined,
        customerId: typeof req.query.customerId === "string" ? req.query.customerId : undefined,
        stock: req.query.stock === "1" || req.query.stock === "true",
        copies:
          typeof req.query.copies === "string" && /^\d+$/.test(req.query.copies)
            ? parseInt(req.query.copies, 10)
            : undefined,
        ...parseFormatOpts(req),
      });
      res.setHeader("Content-Type", result.data.contentType);
      res.setHeader("X-Label-Language", result.data.language);
      res.setHeader("X-Label-Kind", result.data.kind);
      res.status(200).send(result.data.content);
    } catch (e) { next(e); }
  };

  /**
   * FAZ-2 PRODUCTION: rolün etiketini istasyon yazıcısına native gönder
   * (label.nativeSendEnabled açıkken gerçek, kapalıyken simüle). JSON sonuç döner.
   */
  printRollNative = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.printRollNative(req.params.id as string, req.user?.userId, {
        orderLineId: typeof req.query.orderLineId === "string" ? req.query.orderLineId : undefined,
        customerId: typeof req.query.customerId === "string" ? req.query.customerId : undefined,
        stock: req.query.stock === "1" || req.query.stock === "true",
        ...parseFormatOpts(req),
      });
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /** Test Et: profil geometrisinde örnek etiket HTML'i (boyut/pay önizleme). */
  getSampleLabelHtml = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const profileId =
        (req.params.id as string | undefined) ??
        (typeof req.query.profileId === "string" ? req.query.profileId : undefined);
      const result = await this.service.getSampleLabelHtml(profileId);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(result.data.html);
    } catch (e) { next(e); }
  };

  /** Test Et: örnek etiketi seçili dilde verilen yazıcı IP'sine gönder (gerçek/simüle). */
  testNativeSend = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = testNativeSchema.parse(req.body);
      const result = await this.service.testNativeSend(body);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  // Saha #7: toplu etiket HTML — { rollIds: [...], copies? } → tek birleşik belge.
  getBulkRollLabelsHtml = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = bulkLabelsSchema.parse(req.body);
      const result = await this.service.getBulkRollLabelsHtml(body.rollIds, { copies: body.copies });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(result.data.html);
    } catch (e) { next(e); }
  };

  getSwatchLabel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getSwatchLabel(req.params.id as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /**
   * Kartela etiketinin tam HTML'i (text/html). `/rolls/:id/html`'in kartela analoğu.
   * Kartela hep 100×60 yatay düzende basılır; format `?profileId=`/`?machineId=` veya
   * sistem default ile çözülür.
   */
  getSwatchLabelHtml = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getSwatchLabelHtml(req.params.id as string, {
        copies:
          typeof req.query.copies === "string" && /^\d+$/.test(req.query.copies)
            ? parseInt(req.query.copies, 10)
            : undefined,
        ...parseFormatOpts(req),
      });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Label-Kind", result.data.kind);
      res.status(200).send(result.data.html);
    } catch (e) { next(e); }
  };

  /**
   * Kartela etiketi SEÇİLİ yazıcı dilinde (RASTER_HTML → text/html; PPLA/PPLB/ZPL →
   * text/plain native komut). `/rolls/:id/native`'in kartela analoğu.
   */
  getSwatchLabelNative = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getSwatchLabelNative(req.params.id as string, {
        copies:
          typeof req.query.copies === "string" && /^\d+$/.test(req.query.copies)
            ? parseInt(req.query.copies, 10)
            : undefined,
        ...parseFormatOpts(req),
      });
      res.setHeader("Content-Type", result.data.contentType);
      res.setHeader("X-Label-Language", result.data.language);
      res.setHeader("X-Label-Kind", result.data.kind);
      res.status(200).send(result.data.content);
    } catch (e) { next(e); }
  };

  updateOrderLineCustomerNames = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = updateNamesSchema.parse(req.body);
      const result = await this.service.updateOrderLineCustomerNames(
        req.params.id as string,
        body,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  recordPrintEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = (req.body ?? {}) as {
        orderLineId?: string | null;
        customerId?: string | null;
        stock?: boolean;
      };
      const result = await this.service.recordPrintEvent(
        req.params.id as string,
        req.user?.userId,
        {
          orderLineId: body.orderLineId ?? undefined,
          customerId: body.customerId ?? undefined,
          stock: body.stock === true,
        },
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };
}
