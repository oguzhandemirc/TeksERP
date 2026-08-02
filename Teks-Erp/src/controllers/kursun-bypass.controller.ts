// =============================================================================
// TeksERP - Kurşun Dağıtım (Kurşun Bypass) Controller
// =============================================================================
// HTTP katmanı: Zod doğrulama + servise delege. İş mantığı YOK.
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { KursunBypassService } from "../services/kursun-bypass.service";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import "../types/express-augment";

// NEDEN `.nullish()` ve `.optional()` DEĞİL: iki istemci de bu alanları
// "boş bırakılabilir" diye tipliyor (`notes?: string | null`, `reason?: string | null`)
// ve `x ?? null` deseniyle gönderiyor. Zod'da düz `.optional()` yalnız `undefined`
// kabul eder — `null` gelirse istek İNGİLİZCE bir tip hatasıyla 400'lenir
// ("expected string, received null"), üstelik kullanıcının yaptığı şey sadece
// opsiyonel alanı boş bırakmaktır. `.nullish()` ikisini de alır; controller
// zaten `?? null` ile servise normalize ediyor.
const assignSchema = z.object({
  workOrderId: z.string().uuid("Geçersiz iş emri ID"),
  // ATAMA MAKİNE BAZINDA: PROCESS_QC istasyonu tektir, dağıtımcı o istasyona
  // bağlı fiziksel kurşun MAKİNELERİNDEN birini seçer.
  machineId: z.string().uuid("Geçersiz makine ID"),
  // KursunBypassAssignment.notes VarChar(500)
  notes: z.string().trim().max(500, "Not en fazla 500 karakter olabilir").nullish(),
});

const cancelSchema = z.object({
  // KursunBypassAssignment.cancelReason VarChar(200)
  reason: z.string().trim().max(200, "Sebep en fazla 200 karakter olabilir").nullish(),
});

const completeSchema = z.object({
  rollIds: z
    .array(z.string().uuid("Geçersiz top ID"))
    .min(1, "En az bir top seçilmelidir"),
});

export class KursunBypassController {
  private service: KursunBypassService;

  constructor() {
    this.service = new KursunBypassService();
    this.getVisibility = this.getVisibility.bind(this);
    this.listDistribution = this.listDistribution.bind(this);
    this.assign = this.assign.bind(this);
    this.cancelAssignment = this.cancelAssignment.bind(this);
    this.getCompletePreview = this.getCompletePreview.bind(this);
    this.complete = this.complete.bind(this);
  }

  /**
   * GET /api/kursun-bypass/visibility — menü çizme ucu (üç sayı, gövde yok).
   * Sorgu parametresi ALMAZ: Zod şeması da yok, her istemci aynı yanıtı alır.
   */
  async getVisibility(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getVisibility();
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/kursun-bypass/distribution */
  async listDistribution(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.listDistribution();
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kursun-bypass/assign */
  async assign(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = assignSchema.parse(req.body);
      const result = await this.service.assign(
        {
          workOrderId: body.workOrderId,
          machineId: body.machineId,
          notes: body.notes ?? null,
        },
        req.user?.userId,
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kursun-bypass/:id/cancel */
  async cancelAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = assertValidUuid(req.params.id, "id");
      const body = cancelSchema.parse(req.body ?? {});
      const result = await this.service.cancelAssignment(
        id,
        { reason: body.reason ?? null },
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/kursun-bypass/:id/complete-preview */
  async getCompletePreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = assertValidUuid(req.params.id, "id");
      const result = await this.service.getCompletePreview(id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kursun-bypass/:id/complete — SON ADIM yolu ("İşi Bitir"). */
  async complete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = assertValidUuid(req.params.id, "id");
      const body = completeSchema.parse(req.body);
      const result = await this.service.completeFromDistribution(
        id,
        { rollIds: body.rollIds },
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}
