// POST /api/kursun-qc/reopen-roll — açık adımda kontrolü tamamlanmış tek topu yeniden açar (GK 2026-11-10).
// Ayrı dosya: kursun-qc.controller dosya uzunluğu tavanında.
import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { KursunQcService } from "../services/kursun-qc.service";
import "../types/express-augment";

const reopenRollSchema = z.object({
  rollId: z.string().uuid("Geçersiz top ID"),
  stepId: z.string().uuid("Geçersiz adım ID"),
});

const service = new KursunQcService();

export async function reopenKursunRoll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = reopenRollSchema.parse(req.body);
    const result = await service.reopenRoll(body, req.user?.userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
