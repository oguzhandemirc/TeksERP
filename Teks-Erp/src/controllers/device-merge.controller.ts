// Cihaz kopyası birleştirme uçları (izlenebilirlik D4) — ince katman; iş `device-merge.service`te.
import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { DeviceMergeService, MAX_MERGE_SOURCES } from "../services/device-merge.service";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import "../types/express-augment";

// Birleştirme (D4): hedef + kayıt kayıt seçilen kaynaklar; önizleme ve uygulama AYNI gövde.
const mergeSchema = z.object({
  targetId: z.string().uuid("Geçersiz ana kayıt"),
  sourceIds: z.array(z.string().uuid("Geçersiz cihaz kaydı"))
    .min(1, "Birleştirilecek en az bir kayıt seçin")
    .max(MAX_MERGE_SOURCES, `Tek seferde en çok ${MAX_MERGE_SOURCES} kayıt birleştirilebilir`),
});

export class DeviceMergeController {
  /** GET /api/admin/devices/merge/candidates — kopya olabilecek kayıt grupları (yalnız öneri). */
  static async mergeCandidates(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await DeviceMergeService.candidates();
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/admin/devices/merge/preview — yan etkisiz; kaynak başına etkilenen her kayıt. */
  static async mergePreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = mergeSchema.parse(req.body ?? {});
      const data = await DeviceMergeService.preview(body.targetId, body.sourceIds);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/admin/devices/merge — seçilen kopyaları ana kayda bağlar (durum geçişi). */
  static async merge(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = mergeSchema.parse(req.body ?? {});
      const data = await DeviceMergeService.merge(body.targetId, body.sourceIds, req.user!.userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/admin/devices/merge/:sourceId/undo — `UNMERGED` karşı olayı. */
  static async undoMerge(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = assertValidUuid(req.params.sourceId, "sourceId");
      const data = await DeviceMergeService.undo(id, req.user!.userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}
