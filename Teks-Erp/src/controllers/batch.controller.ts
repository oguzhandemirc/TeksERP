// =============================================================================
// TeksERP - Batch (Parti) Controller — K8 düzeltme araçları HTTP katmanı
// =============================================================================
// Sevksiz parti düzeltme uçları: top taşı / parti birleştir / elle böl. Servis
// (batch.service) türetilmiş kilit + izsiz-boş silme + audit'i zaten yönetir.
// RBAC: workorder:write (parti = iş emrinin üretim birimi).
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  moveRolls as svcMoveRolls,
  mergeBatches as svcMergeBatches,
  splitBatch as svcSplitBatch,
  getBatchNumberState as svcGetBatchNumberState,
} from "../services/batch.service";

const moveSchema = z.object({
  rollIds: z.array(z.string().uuid()).min(1, "En az bir top seçilmeli"),
  toBatchId: z.string().uuid(),
});
const mergeSchema = z.object({
  batchIds: z.array(z.string().uuid()).min(2, "En az iki parti seçilmeli"),
});
const splitSchema = z.object({
  rollIds: z.array(z.string().uuid()).min(1, "En az bir top seçilmeli"),
});

export class BatchController {
  constructor() {
    this.moveRolls = this.moveRolls.bind(this);
    this.mergeBatches = this.mergeBatches.bind(this);
    this.splitBatch = this.splitBatch.bind(this);
    this.numberState = this.numberState.bind(this);
  }

  /**
   * GET /api/batches/number-state — kısa parti sayacının durumu (salt-okunur).
   *
   * Genel Ayarlar'daki bayrağın yanında "şu an: P42 · sıradaki: P43" göstergesi
   * için. Körlemesine sarma seçildiği için bu, fabrikanın FİZİKSEL plaka setiyle
   * sistemi karşılaştırabileceği tek yüzey.
   *
   * ⚠️ `next` ÖNİZLEMEDİR, rezervasyon DEĞİL — kilit dışında okunur; arada bir
   * parti doğarsa gerçekleşen numara başka olur.
   */
  async numberState(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(200).json({ success: true, data: await svcGetBatchNumberState() });
    } catch (e) {
      next(e);
    }
  }

  /** POST /api/batches/move-rolls — topları başka sevksiz partiye taşı. */
  async moveRolls(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { rollIds, toBatchId } = moveSchema.parse(req.body);
      const result = await svcMoveRolls({ rollIds, toBatchId, userId: req.user?.userId });
      res.status(200).json({
        success: true,
        data: result,
        message: `${result.movedCount} top ${result.toBatchNumber} partisine taşındı`,
      });
    } catch (e) {
      next(e);
    }
  }

  /** POST /api/batches/merge — sevksiz partileri birleştir (en eski no yaşar). */
  async mergeBatches(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { batchIds } = mergeSchema.parse(req.body);
      const result = await svcMergeBatches({ batchIds, userId: req.user?.userId });
      res.status(200).json({
        success: true,
        data: result,
        message: `${result.mergedNumbers.length + 1} parti ${result.survivorNumber} altında birleştirildi`,
      });
    } catch (e) {
      next(e);
    }
  }

  /** POST /api/batches/:batchId/split — partiden seçili topları yeni partiye ayır. */
  async splitBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { rollIds } = splitSchema.parse(req.body);
      const result = await svcSplitBatch({
        batchId: req.params.batchId as string,
        rollIds,
        userId: req.user?.userId,
      });
      res.status(201).json({
        success: true,
        data: result,
        message: `Yeni parti oluşturuldu: ${result.newBatchNumber}`,
      });
    } catch (e) {
      next(e);
    }
  }
}
