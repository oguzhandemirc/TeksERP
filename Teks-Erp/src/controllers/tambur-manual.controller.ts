// =============================================================================
// TeksERP — Tambur Saha Düzeltmesi Controller
// =============================================================================
// HTTP katmanı: Zod doğrulama + oturum damgası (makine/istasyon) çözümü.
// İş mantığı `TamburManualService`de; burada prisma YOK.
//
// `getStampContext(req, { enforceForMobile: true })`: saha cihazında (TABLET/PHONE)
// aktif çalışma oturumu ZORUNLU — elle top yaratmanın/taşımanın kime ve hangi
// makineye yazıldığı belirsiz kalamaz. Electron (DESKTOP) muaftır (null döner);
// o zaman istasyon eşleşme kontrolü de atlanır (F221: bağlam yoksa enforcement yok).
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { TamburManualService } from "../services/tambur-manual.service";
import { getStampContext } from "../services/helpers/work-session.helper";
import "../types/express-augment";

/** Top referansı: okutma (barkod) ya da listeden seçim (rollId). En az biri zorunlu. */
const rollRefFields = {
  rollId: z.string().uuid("Geçersiz top ID").optional(),
  barcode: z.string().trim().min(1, "Barkod boş olamaz").max(64, "Barkod çok uzun").optional(),
};
const rollRefRule = {
  message: "Top barkodu ya da ID'si gerekli",
} as const;

const bringPreviewSchema = z
  .object({
    ...rollRefFields,
    targetStepId: z.string().uuid("Geçersiz adım ID"),
  })
  .refine((v) => Boolean(v.rollId || v.barcode), rollRefRule);

const bringSchema = z
  .object({
    ...rollRefFields,
    targetStepId: z.string().uuid("Geçersiz adım ID"),
    reason: z
      .string()
      .trim()
      .min(3, "İşlem nedeni en az 3 karakter olmalı")
      .max(500, "İşlem nedeni çok uzun"),
  })
  .refine((v) => Boolean(v.rollId || v.barcode), rollRefRule);

// Manuel top: metraj + sebep + idempotency anahtarı ZORUNLU; gerisi opsiyonel.
// `colorId: null` AÇIKÇA "renksiz" demektir (iş emri hedef rengi miras alınmaz);
// alan hiç gönderilmezse iş emrinin hedef rengi uygulanır.
const manualRollSchema = z.object({
  targetStepId: z.string().uuid("Geçersiz adım ID"),
  initialQty: z
    .number()
    .positive("Metraj pozitif olmalı")
    .max(999_999, "Metraj gerçekçi değil"),
  reason: z
    .string()
    .trim()
    .min(3, "İşlem nedeni en az 3 karakter olmalı")
    .max(500, "İşlem nedeni çok uzun"),
  clientToken: z.string().uuid("Geçersiz istemci anahtarı"),
  itemId: z.string().uuid("Geçersiz ürün ID").optional(),
  colorId: z.string().uuid("Geçersiz renk ID").optional().nullable(),
  width: z.number().positive("En pozitif olmalı").max(999_999, "En gerçekçi değil").optional().nullable(),
  qualityGrade: z.string().trim().max(50).optional(),
  weightKg: z
    .number()
    .positive("Ağırlık pozitif olmalı")
    .max(999_999, "Ağırlık gerçekçi değil")
    .optional(),
});

export class TamburManualController {
  private service: TamburManualService;

  constructor() {
    this.service = new TamburManualService();
    this.getBringPreview = this.getBringPreview.bind(this);
    this.bringRoll = this.bringRoll.bind(this);
    this.createManualRoll = this.createManualRoll.bind(this);
  }

  /** POST /api/tambur/manual/bring-preview — ne olacağını söyler, hiçbir şeyi değiştirmez. */
  async getBringPreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = bringPreviewSchema.parse(req.body);
      const stamp = await getStampContext(req, { enforceForMobile: true });
      res.status(200).json(
        await this.service.getBringPreview(body, {
          userId: req.user?.userId,
          machineId: stamp?.machineId ?? req.device?.machineId ?? null,
          stationId: stamp?.stationId ?? null,
        }),
      );
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/tambur/manual/bring — önizlemesi onaylanan taşımayı uygular. */
  async bringRoll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = bringSchema.parse(req.body);
      const stamp = await getStampContext(req, { enforceForMobile: true });
      res.status(200).json(
        await this.service.bringRoll(body, {
          userId: req.user?.userId,
          machineId: stamp?.machineId ?? req.device?.machineId ?? null,
          stationId: stamp?.stationId ?? null,
        }),
      );
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/tambur/manual/roll — sistemde olmayan topu elle ekle + Tambur'a bağla. */
  async createManualRoll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = manualRollSchema.parse(req.body);
      const stamp = await getStampContext(req, { enforceForMobile: true });
      res.status(201).json(
        await this.service.createManualRoll(body, {
          userId: req.user?.userId,
          machineId: stamp?.machineId ?? req.device?.machineId ?? null,
          stationId: stamp?.stationId ?? null,
        }),
      );
    } catch (error) {
      next(error);
    }
  }
}
