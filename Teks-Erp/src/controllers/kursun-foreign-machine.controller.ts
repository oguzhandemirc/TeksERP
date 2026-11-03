// K16 "Yine de al" (fabrika cevabı 21-ek): başka kurşun makinesine atanmış işi bu makinede almanın izi.
// Ayrı dosya: kursun-qc.controller max-lines tavanında; davranış servis tarafında (`KursunQcService.takeForeignMachine`).
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { KursunQcService } from "../services/kursun-qc.service";
import { getStampContext } from "../services/helpers/work-session.helper";

const service = new KursunQcService();

/** POST /api/kursun-qc/step/:stepId/foreign-machine-take */
export async function takeForeignMachine(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stepId = z.string().uuid("Geçersiz adım ID").parse(req.params.stepId);
    const stamp = await getStampContext(req, { enforceForMobile: true });
    res.status(200).json(await service.takeForeignMachine(stepId, stamp?.machineId ?? null, req.user?.userId));
  } catch (err) {
    next(err);
  }
}
