// Kanıtı doğrulanamayan cihazlar + toplu yeniden bağlama uçları (izlenebilirlik D5) — ince katman.
import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { DeviceProofResetService, PROOF_RESET_MAX } from "../services/device-proof-reset.service";
import "../types/express-augment";

// Kayıt kayıt seçim: yalnız işaretlenen cihazlar sıfırlanır (önizleme listesi GET ucundan).
const resetSchema = z.object({
  deviceIds: z.array(z.string().uuid("Geçersiz cihaz kaydı"))
    .min(1, "Yeniden bağlanacak en az bir cihaz seçin")
    .max(PROOF_RESET_MAX, `Tek seferde en çok ${PROOF_RESET_MAX} cihaz seçilebilir`),
});

export class DeviceProofResetController {
  /** GET /api/admin/devices/proof-lost — kanıtı doğrulanamayan cihazlar + bekleyenler (yazmaz). */
  static async proofLost(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await DeviceProofResetService.listProofLost();
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/admin/devices/proof-reset — seçilen cihazlarda kanıtı sıfırla (durum geçişi + defter). */
  static async proofReset(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = resetSchema.parse(req.body ?? {});
      const data = await DeviceProofResetService.resetProofs(body.deviceIds, req.user!.userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}
